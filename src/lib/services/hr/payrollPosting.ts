/**
 * RH-5 — Comptabilisation de la paie : OD équilibrée et idempotente.
 *   D 66  (charges de personnel)  : brut + charges patronales
 *   C 422 (rémunérations dues)    : net
 *   C 431 (dettes sociales)       : retenues + charges patronales
 * Source unique PAYROLL:<runId> ; le run passe POSTED (postedEntryId posé)
 * → la garde PAYROLL_UNPOSTED de la clôture (CG-6) se lève.
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { postEntrySafe, openExercises, exerciseFor } from "@/lib/services/accounting";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

const acc = (schoolId: string, code: string) =>
  prisma.accountingAccount.findFirst({ where: { schoolId, code }, select: { id: true } });

export async function postPayrollToAccounting(ctx: Ctx, runId: string): Promise<Res<{ entryId: string }>> {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, schoolId: ctx.schoolId },
    include: { payslips: { select: { gross: true, deductions: true, employerCost: true, net: true } } },
  });
  if (!run) return err("NOT_FOUND");
  if (run.status !== "VALIDATED" || run.postedEntryId) return err("INVALID_STATE");
  if (run.payslips.length === 0) return err("NO_PAYSLIPS");
  const exs = await openExercises(ctx.schoolId);
  const exercise = exerciseFor(exs, run.periodEnd);
  if (!exercise) return err("NO_OPEN_EXERCISE");
  const journal = await prisma.accountingJournal.findFirst({ where: { schoolId: ctx.schoolId, code: "OD" } });
  const [c66, c422, c431] = await Promise.all([acc(ctx.schoolId, "66"), acc(ctx.schoolId, "422"), acc(ctx.schoolId, "431")]);
  if (!journal || !c66 || !c422 || !c431) return err("MISSING_ACCOUNTS");

  const gross = run.payslips.reduce((s, p) => s + p.gross, 0);
  const ded = run.payslips.reduce((s, p) => s + p.deductions, 0);
  const emp = run.payslips.reduce((s, p) => s + p.employerCost, 0);
  const net = run.payslips.reduce((s, p) => s + p.net, 0);

  const created = await postEntrySafe(ctx, {
    journalId: journal.id, exerciseId: exercise.id, date: run.periodEnd,
    description: `Paie ${run.periodStart.toISOString().slice(0, 7)} — ${run.payslips.length} bulletin(s)`,
    sourceType: "PAYROLL", sourceId: runId,
    lines: [
      { accountId: c66.id, debit: gross, label: "Salaires bruts" },
      ...(emp > 0 ? [{ accountId: c66.id, debit: emp, label: "Charges patronales" }] : []),
      { accountId: c422.id, credit: net, label: "Net à payer" },
      ...(ded + emp > 0 ? [{ accountId: c431.id, credit: ded + emp, label: "Retenues + charges à reverser" }] : []),
    ],
  });
  if (!created) return err("ALREADY_POSTED");
  const entry = await prisma.accountingEntry.findFirstOrThrow({
    where: { schoolId: ctx.schoolId, sourceType: "PAYROLL", sourceId: runId }, select: { id: true },
  });
  await prisma.payrollRun.update({ where: { id: runId }, data: { status: "POSTED", postedEntryId: entry.id } });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.run.post", entity: "PayrollRun", entityId: runId, metadata: { entryId: entry.id, gross, net } });
  return ok({ entryId: entry.id });
}

/**
 * RH-6 — Rectification : aucune écriture/bulletin historique n'est modifié.
 * Run POSTED → contre-passation exacte (débit↔crédit inversés, source PAYROLL_RECTIF)
 * puis statut RECTIFIED ; un nouveau run DRAFT (rectifiesRunId) reprend la période.
 * Rejouable : la contre-passation existante est détectée, le run rectificatif réutilisé.
 */
export async function rectifyRun(ctx: Ctx, runId: string): Promise<Res<{ newRunId: string }>> {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, schoolId: ctx.schoolId } });
  if (!run) return err("NOT_FOUND");
  if (run.status !== "VALIDATED" && run.status !== "POSTED") return err("INVALID_STATE");
  const existing = await prisma.payrollRun.findFirst({
    where: { schoolId: ctx.schoolId, rectifiesRunId: runId, status: { notIn: ["CANCELLED"] } },
    select: { id: true },
  });
  if (existing) return ok({ newRunId: existing.id });

  if (run.status === "POSTED") {
    const orig = await prisma.accountingEntry.findFirst({
      where: { schoolId: ctx.schoolId, sourceType: "PAYROLL", sourceId: runId },
      include: { lines: true },
    });
    if (!orig) return err("ENTRY_NOT_FOUND");
    const already = await prisma.accountingEntry.findFirst({
      where: { schoolId: ctx.schoolId, sourceType: "PAYROLL_RECTIF", sourceId: runId }, select: { id: true },
    });
    if (!already) {
      const created = await postEntrySafe(ctx, {
        journalId: orig.journalId, exerciseId: orig.exerciseId, date: orig.date,
        description: `Contre-passation — paie ${run.periodStart.toISOString().slice(0, 7)}`,
        sourceType: "PAYROLL_RECTIF", sourceId: runId,
        lines: orig.lines.map((l) => ({
          accountId: l.accountId, debit: l.credit, credit: l.debit,
          label: `Contre-passation — ${l.label ?? "paie"}`,
        })),
      });
      if (!created) return err("COUNTER_ENTRY_FAILED");
    }
  }

  const newRun = await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "RECTIFIED" } });
    return tx.payrollRun.create({
      data: { schoolId: ctx.schoolId, periodStart: run.periodStart, periodEnd: run.periodEnd, rectifiesRunId: runId },
    });
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.run.rectify", entity: "PayrollRun", entityId: runId, metadata: { newRunId: newRun.id } });
  return ok({ newRunId: newRun.id });
}

/** Lier une dépense « salaires » à un run : elle ne sera plus comptabilisée (M-5). */
export async function linkExpenseToRun(ctx: Ctx, expenseId: string, runId: string) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const [e, r] = await Promise.all([
    prisma.expense.findFirst({ where: { id: expenseId, schoolId: ctx.schoolId } }),
    prisma.payrollRun.findFirst({ where: { id: runId, schoolId: ctx.schoolId } }),
  ]);
  if (!e || !r) return err("NOT_FOUND");
  await prisma.expense.update({ where: { id: expenseId }, data: { payrollRunId: runId } });
  return ok({ id: expenseId });
}
