/**
 * CG-6 — Clôture avancée : à-nouveaux, garde paie, bascule CASH→ACCRUAL.
 * À-nouveaux : une écriture OPENING équilibrée reprenant les soldes nets
 * des comptes de bilan (classes 1-5) + le résultat au compte 12.
 * Bascule : OD OPENING de reprise des créances impayées (D411/C12) —
 * aucun produit re-comptabilisé, aucun rejeu possible (source unique).
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { postEntrySafe, trialBalance } from "@/lib/services/accounting";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

const RESULT_ACCOUNT = "12";

async function odJournal(schoolId: string) {
  const j = await prisma.accountingJournal.findFirst({ where: { schoolId, code: "OD" } });
  return j?.id ?? null;
}

/** Vrai si une paie validée reste non comptabilisée (table RH-5 optionnelle). */
export async function unpostedPayrollCount(schoolId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "PayrollRun"
      WHERE "schoolId" = ${schoolId} AND "status" = 'VALIDATED' AND "postedEntryId" IS NULL`;
    return Number(rows[0]?.n ?? 0);
  } catch { return 0; } // table absente (RH-5 non livré) → pas de garde
}

/** Reprise des soldes de bilan dans un nouvel exercice (écriture OPENING unique). */
export async function carryForward(ctx: Ctx, closedExerciseId: string, input: {
  name: string; startDate: Date; endDate: Date;
}): Promise<Res<{ exerciseId: string; lines: number }>> {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const old = await prisma.accountingExercise.findFirst({
    where: { id: closedExerciseId, schoolId: ctx.schoolId },
  });
  if (!old) return err("NOT_FOUND");
  if (old.status !== "CLOSED") return err("EXERCISE_NOT_CLOSED");
  // Idempotence en amont : ne jamais créer d'exercice orphelin au rejeu.
  const dup = await prisma.accountingEntry.findFirst({
    where: { schoolId: ctx.schoolId, sourceType: "OPENING", sourceId: old.id },
    select: { id: true },
  });
  if (dup) return err("ALREADY_CARRIED");
  const journalId = await odJournal(ctx.schoolId);
  const resAcc = await prisma.accountingAccount.findFirst({
    where: { schoolId: ctx.schoolId, code: RESULT_ACCOUNT },
  });
  if (!journalId || !resAcc) return err("MISSING_OD_OR_12");
  const overlap = await prisma.accountingExercise.findFirst({
    where: {
      schoolId: ctx.schoolId, status: "OPEN",
      startDate: { lte: input.endDate }, endDate: { gte: input.startDate },
    },
  });
  if (overlap) return err("EXERCISE_OVERLAP");

  const tb = await trialBalance(ctx, old.id);
  if (!tb.ok) return err(tb.error);
  const lines: { accountId: string; debit?: number; credit?: number; label?: string }[] = [];
  let net = 0;
  for (const r of tb.result.balance) {
    if (r.classNumber < 1 || r.classNumber > 5) continue;
    const solde = r.debit - r.credit;
    if (solde === 0) continue;
    net += solde;
    const acc = await prisma.accountingAccount.findFirst({
      where: { schoolId: ctx.schoolId, code: r.code }, select: { id: true },
    });
    if (!acc) continue;
    lines.push(solde > 0
      ? { accountId: acc.id, debit: solde, label: `À-nouveau ${r.code}` }
      : { accountId: acc.id, credit: -solde, label: `À-nouveau ${r.code}` });
  }
  if (lines.length === 0) return err("NOTHING_TO_CARRY");
  // Résultat au compte 12 : équilibre l'écriture d'ouverture.
  lines.push(net > 0
    ? { accountId: resAcc.id, credit: net, label: "Résultat reporté" }
    : { accountId: resAcc.id, debit: -net, label: "Perte reportée" });

  const exercise = await prisma.accountingExercise.create({
    data: { schoolId: ctx.schoolId, name: input.name, startDate: input.startDate, endDate: input.endDate, mode: old.mode },
  });
  const created = await postEntrySafe(ctx, {
    journalId, exerciseId: exercise.id, date: input.startDate,
    description: `À-nouveaux — reprise ${old.name}`,
    sourceType: "OPENING", sourceId: old.id,
    lines,
  });
  if (!created) {
    // Concurrence : une autre reprise a gagné — supprimer l'exercice orphelin.
    await prisma.accountingExercise.delete({ where: { id: exercise.id } }).catch(() => {});
    return err("ALREADY_CARRIED");
  }
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "accounting.exercise.carryforward", entity: "AccountingExercise", entityId: exercise.id, metadata: { from: old.id, lines: lines.length } });
  return ok({ exerciseId: exercise.id, lines: lines.length });
}

/**
 * Bascule CASH → ACCRUAL : OD de reprise des créances impayées (D411/C12).
 * Irréversible, idempotente (source unique MIGRATION_ACCRUAL).
 */
export async function migrateToAccrual(ctx: Ctx, exerciseId: string): Promise<Res<{ receivables: number; count: number }>> {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const ex = await prisma.accountingExercise.findFirst({
    where: { id: exerciseId, schoolId: ctx.schoolId },
  });
  if (!ex) return err("NOT_FOUND");
  if (ex.status !== "OPEN") return err("EXERCISE_CLOSED");
  if (ex.mode !== "CASH") return err("ALREADY_ACCRUAL");
  const journalId = await odJournal(ctx.schoolId);
  const [receivable, resAcc] = await Promise.all([
    prisma.accountingAccountMap.findFirst({ where: { schoolId: ctx.schoolId, key: "FALLBACK:RECEIVABLE" }, select: { accountId: true } }),
    prisma.accountingAccount.findFirst({ where: { schoolId: ctx.schoolId, code: RESULT_ACCOUNT }, select: { id: true } }),
  ]);
  if (!journalId || !receivable || !resAcc) return err("MISSING_ACCOUNTS");

  // Créances impayées = échéances − règlements alloués, sur la période de l'exercice.
  const insts = await prisma.feeInstallment.findMany({
    where: { schoolId: ctx.schoolId, dueDate: { gte: ex.startDate, lte: ex.endDate } },
    select: { studentId: true, amount: true, allocations: { select: { amount: true } } },
  });
  const byStudent = new Map<string, number>();
  for (const i of insts) {
    const paid = i.allocations.reduce((s, a) => s + a.amount, 0);
    const due = i.amount - paid;
    if (due > 0) byStudent.set(i.studentId, (byStudent.get(i.studentId) ?? 0) + due);
  }
  if (byStudent.size === 0) return err("NOTHING_TO_CARRY");

  // Auxiliaires élèves : provisionnement idempotent.
  const students = await prisma.student.findMany({
    where: { id: { in: [...byStudent.keys()] }, schoolId: ctx.schoolId },
    select: { id: true, firstName: true, lastName: true, matricule: true },
  });
  const lines: { accountId: string; debit?: number; credit?: number; label: string; thirdPartyId?: string }[] = [];
  let total = 0;
  for (const s of students) {
    const due = byStudent.get(s.id)!;
    total += due;
    const tp = await prisma.accountingThirdParty.upsert({
      where: { schoolId_kind_refId: { schoolId: ctx.schoolId, kind: "STUDENT", refId: s.id } },
      create: {
        schoolId: ctx.schoolId, kind: "STUDENT", refId: s.id,
        name: `${s.firstName} ${s.lastName}`.trim() || s.matricule,
        collectiveAccountId: receivable.accountId,
      },
      update: {},
      select: { id: true },
    });
    lines.push({ accountId: receivable.accountId, debit: due, label: `Reprise créance ${s.matricule}`, thirdPartyId: tp.id });
  }
  lines.push({ accountId: resAcc.id, credit: total, label: "Contrepartie reprise créances" });

  const created = await postEntrySafe(ctx, {
    journalId, exerciseId, date: ex.startDate,
    description: `Bascule CASH→ACCRUAL — reprise créances impayées`,
    sourceType: "MIGRATION_ACCRUAL", sourceId: exerciseId,
    lines,
  });
  if (!created) return err("ALREADY_MIGRATED");
  await prisma.accountingExercise.update({ where: { id: exerciseId }, data: { mode: "ACCRUAL" } });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "accounting.exercise.accrual", entity: "AccountingExercise", entityId: exerciseId, metadata: { receivables: total, students: byStudent.size } });
  return ok({ receivables: total, count: byStudent.size });
}
