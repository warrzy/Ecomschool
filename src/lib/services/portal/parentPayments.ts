/**
 * G3-C — Paiements Mobile Money depuis le portail parent.
 *
 * Chaque fonction revérifie en base le lien tuteur↔élève
 * (`verifyChildAccess`) — le `studentId` envoyé par le navigateur
 * n'est jamais suffisant. Les intentions créées ici passent par le
 * service G3-A (`createPaymentIntent`) avec `channel: PARENT_PORTAL` ;
 * elles restent en mode SANDBOX tant qu'aucun prestataire réel n'est
 * autorisé — aucun outil de simulation n'est exposé aux parents.
 *
 * Solde exigible d'une échéance = montant − allocations validées −
 * intentions actives déjà engagées sur cette échéance (évite les
 * dépassements par paiements concurrents).
 */
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import { getProviderAdapter } from "@/lib/services/payments/providers";
import {
  cancelPaymentIntent,
  createPaymentIntent,
} from "@/lib/services/payments/mobileIntents";
import {
  getChildFinances,
  verifyChildAccess,
  listChildren,
  type ParentCtx,
} from "./parent";
import type { PaymentIntentStatus } from "@prisma/client";

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const ACTIVE_INTENT_STATUSES: PaymentIntentStatus[] = [
  "CREATED", "PENDING", "CONFIRMED_PENDING_POSTING",
];

// ─── Fournisseurs disponibles pour le parent ────────────────────────

/** Prestataires actifs disposant d'un adaptateur enregistré. */
export async function listParentProviders(ctx: ParentCtx) {
  const providers = await prisma.paymentProvider.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    select: { id: true, code: true, label: true, mode: true, minAmount: true, maxAmount: true },
    orderBy: { createdAt: "asc" },
  });
  // Seuls les prestataires avec adaptateur enregistré sont payables —
  // en l'état, cela signifie SANDBOX ; les réels s'activeront en G3-E.
  return providers.filter((p) => getProviderAdapter(p.code) !== null);
}

// ─── Tableau consolidé multi-enfants ────────────────────────────────

export async function parentFinancesOverview(ctx: ParentCtx) {
  const children = await listChildren(ctx);
  const rows = [];
  for (const c of children) {
    const f = await getChildFinances(ctx, c.student.id);
    rows.push({
      student: c.student,
      relation: c.relation,
      year: f?.year ?? null,
      due: f?.due ?? 0,
      paid: f?.paid ?? 0,
      balance: f?.balance ?? 0,
      lateInstallments:
        f?.installments.filter((i) => i.status === "LATE").length ?? 0,
    });
  }
  return rows;
}

// ─── Échéance payable ───────────────────────────────────────────────

/** Solde exigible serveur : reste − intentions actives engagées. */
export async function getPayableInstallment(
  ctx: ParentCtx,
  studentId: string,
  installmentId: string,
) {
  if (!(await verifyChildAccess(ctx, studentId))) return null;
  const inst = await prisma.feeInstallment.findFirst({
    where: {
      id: installmentId,
      schoolId: ctx.schoolId,
      studentId,
      status: "ACTIVE",
      charge: { status: "ACTIVE" },
    },
    select: {
      id: true, label: true, dueDate: true, amount: true,
      academicYearId: true,
      charge: { select: { category: { select: { label: true } } } },
      allocations: {
        where: { payment: { status: "VALIDATED" } },
        select: { amount: true },
      },
    },
  });
  if (!inst) return null;
  const paidAmount = inst.allocations.reduce((s, a) => s + a.amount, 0);
  const inFlight = await prisma.paymentIntent.aggregate({
    where: {
      schoolId: ctx.schoolId,
      feeInstallmentId: inst.id,
      status: { in: ACTIVE_INTENT_STATUSES },
    },
    _sum: { amount: true },
  });
  const remaining = Math.max(0, inst.amount - paidAmount - (inFlight._sum.amount ?? 0));
  return {
    id: inst.id,
    label: inst.label,
    category: inst.charge.category.label,
    dueDate: inst.dueDate,
    amount: inst.amount,
    paid: paidAmount,
    inFlight: inFlight._sum.amount ?? 0,
    remaining,
    academicYearId: inst.academicYearId,
  };
}

// ─── Création d'intention depuis le portail ─────────────────────────

/**
 * Crée une intention de paiement pour une échéance de l'enfant.
 * Vérifications serveur : accès parent, échéance réelle et soldable,
 * montant 0 < m ≤ solde exigible, prestataire actif et borné,
 * idempotence gérée par `createPaymentIntent` (même clé + même
 * contenu → même intention ; clé + contenu différent → conflit).
 */
export async function createParentPaymentIntent(
  ctx: ParentCtx,
  input: {
    studentId: string;
    feeInstallmentId: string;
    amount: number;
    providerId: string;
    payerPhone?: string | null;
    idempotencyKey?: string;
    /** Scénario sandbox — réservé aux recettes, jamais exposé au parent. */
    __sandboxOutcome?: "SUCCESS" | "FAILED" | "PENDING" | "LATE" | "TIMEOUT" | "REPEATED";
  },
): Promise<Res<{ intentId: string; replayed: boolean }>> {
  if (!(await verifyChildAccess(ctx, input.studentId))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }

  const inst = await getPayableInstallment(ctx, input.studentId, input.feeInstallmentId);
  if (!inst) return { ok: false, error: "NOT_FOUND" };
  if (inst.paid >= inst.amount) return { ok: false, error: "INSTALLMENT_PAID" };
  if (input.amount > inst.remaining) {
    return { ok: false, error: "AMOUNT_EXCEEDS_BALANCE" };
  }

  const provider = await prisma.paymentProvider.findFirst({
    where: { id: input.providerId, schoolId: ctx.schoolId, status: "ACTIVE" },
    select: { id: true, code: true, mode: true },
  });
  if (!provider) return { ok: false, error: "PROVIDER_INACTIVE" };
  if (!getProviderAdapter(provider.code)) {
    return { ok: false, error: "PROVIDER_UNAVAILABLE" };
  }

  const res = await createPaymentIntent(ctx, {
    studentId: input.studentId,
    academicYearId: inst.academicYearId,
    providerId: provider.id,
    feeInstallmentId: inst.id,
    amount: input.amount,
    currency: "XOF",
    payerPhone: input.payerPhone ?? null,
    channel: "PARENT_PORTAL",
    allocations: [{ installmentId: inst.id, amount: input.amount }],
    idempotencyKey: input.idempotencyKey,
    sandboxOutcome: input.__sandboxOutcome,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "parent_payment.initiated", entity: "PaymentIntent", entityId: res.data.intentId,
    metadata: {
      studentId: input.studentId,
      feeInstallmentId: inst.id,
      amount: input.amount,
      providerCode: provider.code,
      replayed: res.data.replayed,
    },
  });
  return { ok: true, data: { intentId: res.data.intentId, replayed: res.data.replayed } };
}

// ─── Suivi, historique, annulation ──────────────────────────────────

/** Intentions d'un enfant du parent (historique du portail). */
export async function listParentIntents(ctx: ParentCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return [];
  return prisma.paymentIntent.findMany({
    where: { schoolId: ctx.schoolId, studentId, channel: "PARENT_PORTAL" },
    include: {
      provider: { select: { label: true, code: true, mode: true } },
      feeInstallment: {
        select: { label: true, dueDate: true, charge: { select: { category: { select: { label: true } } } } },
      },
      payment: { select: { id: true, receiptNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Détail d'une intention — seulement si l'élève appartient au parent. */
export async function getParentIntent(ctx: ParentCtx, intentId: string) {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, schoolId: ctx.schoolId, channel: "PARENT_PORTAL" },
    include: {
      student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
      provider: { select: { label: true, code: true, mode: true } },
      feeInstallment: {
        select: { label: true, dueDate: true, charge: { select: { category: { select: { label: true } } } } },
      },
      payment: { select: { id: true, receiptNumber: true, status: true } },
      transactions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!intent) return null;
  if (!(await verifyChildAccess(ctx, intent.studentId))) return null;
  return intent;
}

/** Annulation parent — uniquement CREATED/PENDING, jamais une confirmation. */
export async function cancelParentIntent(
  ctx: ParentCtx,
  intentId: string,
  reason?: string,
): Promise<Res<true>> {
  const intent = await getParentIntent(ctx, intentId);
  if (!intent) return { ok: false, error: "NOT_FOUND" };
  const res = await cancelPaymentIntent(ctx, intentId, reason ?? "CANCELLED_BY_PARENT");
  return res.ok ? { ok: true, data: true } : { ok: false, error: res.error };
}

/** Notification interne au parent après évolution d'une intention. */
export async function notifyParentIntentUpdate(
  ctx: ParentCtx,
  intentId: string,
  title: string,
  body?: string,
) {
  await notifyUsers({
    schoolId: ctx.schoolId,
    userIds: [ctx.userId],
    type: "ADMIN_MESSAGE",
    title,
    body,
    link: `/parent?tab=finances&intent=${intentId}`,
  });
}
