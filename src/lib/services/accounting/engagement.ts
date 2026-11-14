/**
 * CG-1 — Comptabilité d'engagement (mode ACCRUAL uniquement).
 *   Facturation :  D 411 Élèves-créances / C 706 produit     (source CHARGE)
 *   Règlement :    D 57x trésorerie      / C 411             (source SETTLEMENT)
 *   Lettrage :     AccountingAllocation chargeLine↔paymentLine (partiel)
 * Règles : jamais d'écriture si exercice.mode = CASH ; idempotence par
 * l'unicité (schoolId, sourceType, sourceId) de AccountingEntry.
 */
import { prisma } from "@/lib/db/prisma";
import { postEntrySafe, mapsByKey, openExercises, exerciseFor, type Line } from "@/lib/services/accounting";

export type AcctResult<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(result: T): AcctResult<T> => ({ ok: true, result });
const err = (error: string): AcctResult<never> => ({ ok: false, error });

/** Écriture d'engagement pour une créance scolaire (appelée à la facturation). */
export async function postChargeEntry(
  ctx: { userId: string; schoolId: string },
  charge: { id: string; label: string; amount: number; createdAt: Date },
): Promise<AcctResult<{ posted: boolean }>> {
  const exercises = await openExercises(ctx.schoolId);
  const ex = exerciseFor(exercises, charge.createdAt);
  if (!ex || ex.mode !== "ACCRUAL") return ok({ posted: false }); // mode caisse : rien à poster
  const maps = await mapsByKey(ctx);
  const receivable = maps.get("FALLBACK:RECEIVABLE");
  const product = maps.get("FALLBACK:CAT");
  if (!receivable || !product) return err("INCOMPLETE_MAPPINGS");
  const posted = await postEntrySafe(ctx, {
    journalId: receivable.journalId ?? product.journalId!,
    exerciseId: ex.id,
    date: charge.createdAt,
    description: `Facturation — ${charge.label}`,
    sourceType: "CHARGE",
    sourceId: charge.id,
    lines: [
      { accountId: receivable.accountId, debit: charge.amount, label: charge.label },
      { accountId: product.accountId, credit: charge.amount },
    ],
  });
  return ok({ posted });
}

/** Lettrage partiel : lie une ligne de règlement à une ligne de créance. */
export async function allocate(
  ctx: { userId: string; schoolId: string },
  input: { chargeLineId: string; paymentLineId: string; amount: number; thirdPartyId?: string },
): Promise<AcctResult<{ allocated: number; balance: number }>> {
  if (input.amount <= 0) return err("INVALID_AMOUNT");
  return prisma.$transaction(async (tx) => {
    const [charge, payment] = await Promise.all([
      tx.accountingEntryLine.findFirst({
        where: { id: input.chargeLineId, entry: { schoolId: ctx.schoolId } },
        select: { debit: true },
      }),
      tx.accountingEntryLine.findFirst({
        where: { id: input.paymentLineId, entry: { schoolId: ctx.schoolId } },
        select: { credit: true },
      }),
    ]);
    if (!charge?.debit || !payment?.credit) return err("LINES_NOT_FOUND");
    const used = await tx.accountingAllocation.aggregate({
      where: { chargeLineId: input.chargeLineId },
      _sum: { amount: true },
    });
    const balance = charge.debit - (used._sum.amount ?? 0);
    if (input.amount > balance) return err("OVER_ALLOCATED");
    await tx.accountingAllocation.create({
      data: {
        schoolId: ctx.schoolId, chargeLineId: input.chargeLineId,
        paymentLineId: input.paymentLineId, amount: input.amount,
        thirdPartyId: input.thirdPartyId ?? null,
      },
    });
    return ok({ allocated: input.amount, balance: balance - input.amount });
  });
}

/** Solde auxiliaire d'un tiers (créances − allocations). */
export async function thirdPartyBalance(ctx: { schoolId: string }, thirdPartyId: string) {
  const [charges, settled] = await Promise.all([
    prisma.accountingEntryLine.aggregate({
      where: { thirdPartyId, entry: { schoolId: ctx.schoolId }, debit: { gt: 0 } },
      _sum: { debit: true },
    }),
    prisma.accountingAllocation.aggregate({
      where: { thirdPartyId, schoolId: ctx.schoolId },
      _sum: { amount: true },
    }),
  ]);
  return ok({ balance: (charges._sum.debit ?? 0) - (settled._sum.amount ?? 0) });
}
