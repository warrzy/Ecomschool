/**
 * CG-5 — Rapprochement bancaire.
 * Import de relevés par journal (BQ/MM/CA), pointage automatique des lignes
 * sur les écritures du compte de trésorerie : même montant, date ± 3 jours,
 * sens débit/crédit selon le signe de la ligne relevé. Aucune écriture
 * modifiée : le lettrage ne touche que `matchedEntryLineId`.
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { logAudit } from "@/lib/services/audit";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

export async function importStatement(ctx: Ctx, input: {
  journalId: string; periodStart: Date; periodEnd: Date; closingBalance: number;
  lines: { date: Date; label: string; amount: number }[];
}): Promise<Res<{ id: string }>> {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  if (input.periodEnd < input.periodStart || input.lines.length === 0) return err("INVALID_INPUT");
  const j = await prisma.accountingJournal.findFirst({ where: { id: input.journalId, schoolId: ctx.schoolId } });
  if (!j || !j.defaultAccountId) return err("NOT_FOUND");
  const st = await prisma.bankStatement.create({
    data: {
      schoolId: ctx.schoolId, journalId: j.id,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      closingBalance: input.closingBalance,
      lines: { create: input.lines.map((l) => ({ date: l.date, label: l.label, amount: l.amount })) },
    },
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "accounting.bank.import", entity: "BankStatement", entityId: st.id, metadata: { lines: input.lines.length } });
  return ok({ id: st.id });
}

export async function listStatements(ctx: Ctx) {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const sts = await prisma.bankStatement.findMany({
    where: { schoolId: ctx.schoolId },
    include: { journal: { select: { code: true, label: true } }, _count: { select: { lines: true } } },
    orderBy: { periodEnd: "desc" },
  });
  return ok(sts);
}

/** Pointage automatique : montant égal + date ± 3 j + sens. Idempotent. */
export async function autoMatch(ctx: Ctx, statementId: string): Promise<Res<{ matched: number; unmatched: number }>> {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const st = await prisma.bankStatement.findFirst({
    where: { id: statementId, schoolId: ctx.schoolId },
    include: { lines: { where: { matchedEntryLineId: null } }, journal: true },
  });
  if (!st) return err("NOT_FOUND");
  const accountId = st.journal.defaultAccountId!;
  let matched = 0;
  for (const l of st.lines) {
    const day = 86400000;
    const cand = await prisma.accountingEntryLine.findMany({
      where: {
        accountId,
        entry: {
          schoolId: ctx.schoolId, status: "POSTED", journalId: st.journalId,
          date: { gte: new Date(+l.date - 3 * day), lte: new Date(+l.date + 3 * day) },
        },
        ...(l.amount > 0 ? { debit: Math.abs(l.amount) } : { credit: Math.abs(l.amount) }),
      },
      include: { entry: { select: { id: true } } },
      take: 5,
    });
    // Filtre doublon : exclure les lignes déjà référencées par un relevé.
    const already = await prisma.bankStatementLine.findMany({
      where: { matchedEntryLineId: { in: cand.map((c) => c.id) } },
      select: { matchedEntryLineId: true },
    });
    const taken = new Set(already.map((x) => x.matchedEntryLineId));
    const target = cand.find((c) => !taken.has(c.id));
    if (!target) continue;
    await prisma.bankStatementLine.update({ where: { id: l.id }, data: { matchedEntryLineId: target.id } });
    matched++;
  }
  const remaining = await prisma.bankStatementLine.count({ where: { statementId, matchedEntryLineId: null } });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "accounting.bank.match", entity: "BankStatement", entityId: statementId, metadata: { matched } });
  return ok({ matched, unmatched: remaining });
}

export async function unmatch(ctx: Ctx, lineId: string) {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const r = await prisma.bankStatementLine.updateMany({
    where: { id: lineId, statement: { schoolId: ctx.schoolId } },
    data: { matchedEntryLineId: null },
  });
  return r.count ? ok({ id: lineId }) : err("NOT_FOUND");
}

/** État du rapprochement : lignes pointées/non pointées + écarts livre↔relevé. */
export async function reconciliationReport(ctx: Ctx, statementId: string) {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const st = await prisma.bankStatement.findFirst({
    where: { id: statementId, schoolId: ctx.schoolId },
    include: { lines: { orderBy: { date: "asc" } }, journal: { include: { defaultAccount: { select: { code: true } } } } },
  });
  if (!st) return err("NOT_FOUND");
  const accountId = st.journal.defaultAccountId!;
  const book = await prisma.accountingEntryLine.findMany({
    where: {
      accountId,
      entry: { schoolId: ctx.schoolId, status: "POSTED", journalId: st.journalId, date: { gte: st.periodStart, lte: st.periodEnd } },
    },
    include: { entry: { select: { reference: true, date: true, description: true } } },
  });
  const matchedIds = new Set(st.lines.map((l) => l.matchedEntryLineId).filter(Boolean));
  const unmatchedBook = book.filter((l) => !matchedIds.has(l.id));
  const matchedSum = st.lines.filter((l) => l.matchedEntryLineId).reduce((s, l) => s + l.amount, 0);
  const statementSum = st.lines.reduce((s, l) => s + l.amount, 0);
  const bookNet = book.reduce((s, l) => s + l.debit - l.credit, 0);
  return ok({
    statement: st,
    matched: st.lines.filter((l) => l.matchedEntryLineId).length,
    unmatchedStatement: st.lines.filter((l) => !l.matchedEntryLineId),
    unmatchedBook,
    matchedSum, statementSum, bookNet,
    ecart: statementSum - bookNet,
  });
}
