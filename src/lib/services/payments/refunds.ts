/**
 * G3-D — Remboursements Mobile Money (workflow sécurisé, sandbox).
 *
 *   REQUESTED → APPROVED → EXECUTED → CONFIRMED
 *        ↓         ↓          ↓
 *     REJECTED  CANCELLED   FAILED
 *
 * Une demande N'EST JAMAIS un remboursement effectué : seul CONFIRMED
 * marque un remboursement effectif. L'exécution est simulée tant
 * qu'aucun prestataire réel n'est activé — aucun appel externe n'est
 * effectué. Le paiement d'origine n'est pas annulé automatiquement :
 * la traçabilité du reçu est préservée et le rapprochement est noté.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyReconcileAdmins } from "./reconciliation";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

/** Statuts qui « engagent » un montant remboursé. */
const ENGAGED: readonly string[] = ["REQUESTED", "APPROVED", "EXECUTED", "CONFIRMED"];

/**
 * Demande de remboursement d'un encaissement Mobile Money.
 * Contrôles : paiement existant et validé, lié à Mobile Money
 * (méthode ou intention), motif obligatoire, montant entier positif
 * ne dépassant pas le remboursable (montant − remboursements déjà
 * engagés). Idempotent par `idempotencyKey` : le rejeu de la même
 * clé renvoie la demande existante. Transaction sérialisable pour
 * le contrôle de montant face aux demandes concurrentes.
 */
export async function createRefundRequest(
  ctx: Ctx,
  input: {
    paymentId?: string;
    intentId?: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  },
): Promise<Res<{ id: string; already?: boolean }>> {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) return { ok: false, error: "REASON_REQUIRED" };
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Cible : un Payment (direct ou via son intention confirmée).
  let paymentId = input.paymentId ?? null;
  if (!paymentId && input.intentId) {
    const intent = await prisma.paymentIntent.findFirst({
      where: { id: input.intentId, schoolId: ctx.schoolId },
      select: { paymentId: true },
    });
    paymentId = intent?.paymentId ?? null;
  }
  if (!paymentId) return { ok: false, error: "NOT_FOUND" };

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, schoolId: ctx.schoolId },
    include: { intent: { select: { id: true } } },
  });
  if (!payment) return { ok: false, error: "NOT_FOUND" };
  if (payment.status !== "VALIDATED") return { ok: false, error: "INVALID_STATE" };
  if (payment.method !== "MOBILE_MONEY" && !payment.intent) {
    return { ok: false, error: "NOT_MOBILE_MONEY" };
  }

  const idempotencyKey = input.idempotencyKey?.trim() || `rf-${crypto.randomUUID()}`;
  if (input.idempotencyKey) {
    const existing = await prisma.paymentRefund.findFirst({
      where: { schoolId: ctx.schoolId, idempotencyKey },
      select: { id: true, amount: true, paymentId: true },
    });
    if (existing) {
      if (existing.amount === input.amount && existing.paymentId === paymentId) {
        return { ok: true, data: { id: existing.id, already: true } };
      }
      return { ok: false, error: "IDEMPOTENCY_CONFLICT" };
    }
  }

  try {
    const refund = await prisma.$transaction(
      async (tx) => {
        const engaged = await tx.paymentRefund.aggregate({
          where: { paymentId, status: { in: ENGAGED as never[] } },
          _sum: { amount: true },
        });
        const refundable = payment.amount - (engaged._sum.amount ?? 0);
        if (input.amount > refundable) throw new Error("EXCEEDS_REFUNDABLE");
        return tx.paymentRefund.create({
          data: {
            schoolId: ctx.schoolId,
            paymentId,
            intentId: payment.intent?.id ?? input.intentId ?? null,
            amount: input.amount,
            reason,
            idempotencyKey,
            requestedById: ctx.userId,
          },
          select: { id: true },
        });
      },
      { isolationLevel: "Serializable" },
    );
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "payment_refund.requested",
      entity: "PaymentRefund",
      entityId: refund.id,
      metadata: { paymentId, amount: input.amount, reason },
    });
    await notifyReconcileAdmins(ctx.schoolId, {
      title: "Demande de remboursement Mobile Money",
      body: `${input.amount} XOF — paiement ${payment.receiptNumber ?? paymentId}`,
      link: "/app/paiements-mobile?tab=remboursements",
    });
    return { ok: true, data: { id: refund.id } };
  } catch (e) {
    if ((e as Error)?.message === "EXCEEDS_REFUNDABLE") {
      return { ok: false, error: "EXCEEDS_REFUNDABLE" };
    }
    if ((e as { code?: string })?.code === "P2002") {
      const existing = await prisma.paymentRefund.findFirst({
        where: { schoolId: ctx.schoolId, idempotencyKey },
        select: { id: true },
      });
      if (existing) return { ok: true, data: { id: existing.id, already: true } };
    }
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/** Transition gardée par statut — idempotente face aux courses. */
async function transition(
  ctx: Ctx,
  id: string,
  from: readonly string[],
  data: Record<string, unknown>,
  target: string,
): Promise<Res<true>> {
  const refund = await prisma.paymentRefund.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true, paymentId: true, intentId: true, amount: true },
  });
  if (!refund) return { ok: false, error: "NOT_FOUND" };
  if (refund.status === target) return { ok: true, data: true };
  const upd = await prisma.paymentRefund.updateMany({
    where: { id: refund.id, status: { in: from as never[] } },
    data: data as never,
  });
  if (upd.count === 0) return { ok: false, error: "INVALID_STATE" };
  return { ok: true, data: true };
}

async function auditRefund(
  ctx: Ctx,
  id: string,
  action: string,
  metadata: Prisma.InputJsonValue,
) {
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action,
    entity: "PaymentRefund",
    entityId: id,
    metadata,
  });
}

/** Validation par un rôle autorisé (mobilepayments.refund). */
export async function approveRefund(ctx: Ctx, id: string): Promise<Res<true>> {
  const r = await transition(ctx, id, ["REQUESTED"], {
    status: "APPROVED",
    approvedById: ctx.userId,
    approvedAt: new Date(),
  }, "APPROVED");
  if (r.ok) await auditRefund(ctx, id, "payment_refund.approved", {});
  return r;
}

/** Refus motivé d'une demande en attente ou approuvée. */
export async function rejectRefund(
  ctx: Ctx,
  id: string,
  rejectReason: string,
): Promise<Res<true>> {
  if (!rejectReason.trim()) return { ok: false, error: "REASON_REQUIRED" };
  const r = await transition(ctx, id, ["REQUESTED", "APPROVED"], {
    status: "REJECTED",
    rejectedAt: new Date(),
    rejectReason: rejectReason.trim(),
  }, "REJECTED");
  if (r.ok) await auditRefund(ctx, id, "payment_refund.rejected", { rejectReason });
  return r;
}

/** Annulation d'une demande non encore exécutée. */
export async function cancelRefund(ctx: Ctx, id: string): Promise<Res<true>> {
  const r = await transition(ctx, id, ["REQUESTED", "APPROVED"], {
    status: "CANCELLED",
  }, "CANCELLED");
  if (r.ok) await auditRefund(ctx, id, "payment_refund.cancelled", {});
  return r;
}

/**
 * Exécution SIMULÉE du remboursement — aucune API prestataire réelle
 * n'existe encore ; la référence produite est explicitement marquée
 * `SIMREF-`. `__simulateFail` est un indicateur INTERNE réservé aux
 * recettes (couverture du chemin d'échec).
 */
export async function executeRefund(
  ctx: Ctx,
  id: string,
  opts: { __simulateFail?: boolean } = {},
): Promise<Res<{ providerRef?: string }>> {
  const refund = await prisma.paymentRefund.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!refund) return { ok: false, error: "NOT_FOUND" };
  if (refund.status === "EXECUTED") return { ok: true, data: {} };
  if (opts.__simulateFail) {
    const r = await transition(ctx, id, ["APPROVED"], {
      status: "FAILED",
      failureReason: "SIMULATED_FAILURE",
    }, "FAILED");
    if (!r.ok) return r;
    await auditRefund(ctx, id, "payment_refund.failed", { simulated: true });
    return { ok: true, data: {} };
  }
  const providerRef = `SIMREF-${id.slice(0, 12).toUpperCase()}`;
  const r = await transition(ctx, id, ["APPROVED"], {
    status: "EXECUTED",
    executedAt: new Date(),
    providerRef,
  }, "EXECUTED");
  if (!r.ok) return r;
  await auditRefund(ctx, id, "payment_refund.executed", { providerRef, simulated: true });
  return { ok: true, data: { providerRef } };
}

/**
 * Confirmation du remboursement : le statut CONFIRMED seul signifie
 * « remboursement effectif ». Met à jour la trace du rapprochement.
 */
export async function confirmRefund(ctx: Ctx, id: string): Promise<Res<true>> {
  const refund = await prisma.paymentRefund.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true, intentId: true, amount: true },
  });
  if (!refund) return { ok: false, error: "NOT_FOUND" };
  if (refund.status === "CONFIRMED") return { ok: true, data: true };
  const r = await transition(ctx, id, ["EXECUTED"], {
    status: "CONFIRMED",
    confirmedAt: new Date(),
  }, "CONFIRMED");
  if (!r.ok) return r;

  // Traçabilité : le rapprochement de l'intention note le remboursement.
  if (refund.intentId) {
    await prisma.paymentReconciliation.updateMany({
      where: { intentId: refund.intentId, schoolId: ctx.schoolId },
      data: {
        notes: `Remboursement confirmé : ${refund.amount} XOF (${new Date().toISOString().slice(0, 10)})`,
      },
    });
  }
  await auditRefund(ctx, id, "payment_refund.confirmed", { amount: refund.amount });
  await notifyReconcileAdmins(ctx.schoolId, {
    title: "Remboursement Mobile Money confirmé",
    body: `${refund.amount} XOF — remboursement ${id.slice(0, 8)}…`,
    link: "/app/paiements-mobile?tab=remboursements",
  });
  return { ok: true, data: true };
}

export async function listRefunds(
  ctx: { schoolId: string },
  filter: { status?: string; limit?: number } = {},
) {
  return prisma.paymentRefund.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: (filter.status as never) ?? undefined,
    },
    include: {
      payment: { select: { id: true, receiptNumber: true, amount: true, method: true, status: true } },
      intent: { select: { id: true, providerTxId: true, student: { select: { matricule: true, lastName: true, firstName: true } } } },
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
      approvedBy: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 100, 300),
  });
}
