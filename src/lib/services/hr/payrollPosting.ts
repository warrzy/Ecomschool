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
import { Prisma } from "@prisma/client";

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
    include: { payslips: { select: { id: true, gross: true, deductions: true, employerCost: true, net: true, unpaidDays: true, lines: true } } },
  });
  if (!run) return err("NOT_FOUND");
  if (run.status !== "VALIDATED" || run.postedEntryId) return err("INVALID_STATE");
  if (run.payslips.length === 0) return err("NO_PAYSLIPS");
  const exs = await openExercises(ctx.schoolId);
  const exercise = exerciseFor(exs, run.periodEnd);
  if (!exercise) return err("NO_OPEN_EXERCISE");
  const journal = await prisma.accountingJournal.findFirst({ where: { schoolId: ctx.schoolId, code: "OD" } });
  const [c66, c422, c431, cAdv] = await Promise.all([
    acc(ctx.schoolId, "66"), acc(ctx.schoolId, "422"), acc(ctx.schoolId, "431"),
    // Avances et acomptes au personnel : 421 (plan de démarrage), 425 toléré.
    acc(ctx.schoolId, "421").then((a) => a ?? acc(ctx.schoolId, "425")),
  ]);
  if (!journal || !c66 || !c422 || !c431) return err("MISSING_ACCOUNTS");

  const gross = run.payslips.reduce((s, p) => s + p.gross, 0);
  const ded = run.payslips.reduce((s, p) => s + p.deductions, 0);
  const emp = run.payslips.reduce((s, p) => s + p.employerCost, 0);
  const net = run.payslips.reduce((s, p) => s + p.net, 0);
  // Recouvrements d'avances → 421 (créance personnel), pas 431 (dettes
  // sociales). Retenues pour absences → réduction du coût 66 (salaire
  // non couru), pas une dette à reverser.
  const slipIds = run.payslips.map((p) => p.id);
  const advances = (await prisma.advanceRecovery.aggregate({
    where: { payslipId: { in: slipIds } }, _sum: { amount: true },
  }))._sum.amount ?? 0;
  const absence = run.payslips.reduce(
    (s, p) => s + ((p.lines as { code?: string; amount?: number }[] | null) ?? [])
      .filter((l) => l.code === "ABS_NP")
      .reduce((x, l) => x + (l.amount ?? 0), 0),
    0,
  );
  if (advances > 0 && !cAdv) return err("MISSING_ACCOUNTS");
  const social = ded - absence - advances;

  // B3 : écriture + marquage POSTED/postedEntryId dans UNE transaction —
  // plus d'état "écriture posée, run resté VALIDATED" après crash.
  const markPosted = async (tx: Prisma.TransactionClient, entry: { id: string }) => {
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "POSTED", postedEntryId: entry.id } });
  };
  const created = await postEntrySafe(ctx, {
    journalId: journal.id, exerciseId: exercise.id, date: run.periodEnd,
    description: `Paie ${run.periodStart.toISOString().slice(0, 7)} — ${run.payslips.length} bulletin(s)`,
    sourceType: "PAYROLL", sourceId: runId,
    lines: [
      { accountId: c66.id, debit: gross - absence, label: absence > 0 ? `Salaires bruts (nets de ${absence} absences)` : "Salaires bruts" },
      ...(emp > 0 ? [{ accountId: c66.id, debit: emp, label: "Charges patronales" }] : []),
      { accountId: c422.id, credit: net, label: "Net à payer" },
      ...(social + emp > 0 ? [{ accountId: c431.id, credit: social + emp, label: "Retenues + charges à reverser" }] : []),
      ...(advances > 0 && cAdv ? [{ accountId: cAdv.id, credit: advances, label: "Recouvrement avances personnel" }] : []),
    ],
  }, markPosted);
  if (!created) {
    // Rattrapage : l'écriture existait déjà (crash entre anciens commits)
    // → rattacher postedEntryId plutôt que laisser le run irrécupérable.
    const existing = await prisma.accountingEntry.findFirst({
      where: { schoolId: ctx.schoolId, sourceType: "PAYROLL", sourceId: runId }, select: { id: true },
    });
    if (existing) {
      await prisma.payrollRun.update({ where: { id: runId }, data: { status: "POSTED", postedEntryId: existing.id } });
      return ok({ entryId: existing.id });
    }
    return err("ALREADY_POSTED");
  }
  const entry = await prisma.accountingEntry.findFirstOrThrow({
    where: { schoolId: ctx.schoolId, sourceType: "PAYROLL", sourceId: runId }, select: { id: true },
  });
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
      // Exercice d'origine clôturé : la contre-passation ne peut pas y
      // entrer (EXERCISE_CLOSED) → elle est postée dans l'exercice OUVERT
      // couvrant la date du jour (régularisation comptable classique).
      let targetExerciseId = orig.exerciseId;
      let targetDate = orig.date;
      const origEx = await prisma.accountingExercise.findUnique({
        where: { id: orig.exerciseId }, select: { status: true },
      });
      if (origEx?.status !== "OPEN") {
        const now = new Date();
        const exs = await openExercises(ctx.schoolId);
        const open = exerciseFor(exs, now);
        if (!open) return err("NO_OPEN_EXERCISE");
        targetExerciseId = open.id;
        targetDate = now;
      }
      // Contre-passation + statut RECTIFIED + run correctif dans UNE
      // transaction (crash-safe, idempotent via PAYROLL_RECTIF:<runId>).
      const created = await postEntrySafe(ctx, {
        journalId: orig.journalId, exerciseId: targetExerciseId, date: targetDate,
        description: `Contre-passation — paie ${run.periodStart.toISOString().slice(0, 7)}`,
        sourceType: "PAYROLL_RECTIF", sourceId: runId,
        lines: orig.lines.map((l) => ({
          accountId: l.accountId, debit: l.credit, credit: l.debit,
          label: `Contre-passation — ${l.label ?? "paie"}`,
        })),
      }, async (tx) => {
        await tx.payrollRun.update({ where: { id: runId }, data: { status: "RECTIFIED" } });
        await tx.payrollRun.create({
          data: { schoolId: ctx.schoolId, periodStart: run.periodStart, periodEnd: run.periodEnd, rectifiesRunId: runId },
        });
      });
      if (!created) return err("COUNTER_ENTRY_FAILED");
      const newRun = await prisma.payrollRun.findFirstOrThrow({
        where: { schoolId: ctx.schoolId, rectifiesRunId: runId }, select: { id: true },
      });
      await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.run.rectify", entity: "PayrollRun", entityId: runId, metadata: { newRunId: newRun.id } });
      return ok({ newRunId: newRun.id });
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
