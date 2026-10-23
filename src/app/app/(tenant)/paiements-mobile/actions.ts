"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  cancelPaymentIntent,
  confirmIntent,
  createPaymentIntent,
  createPaymentProvider,
  expireDuePaymentIntents,
  markProviderCredentialsRotated,
  pollPaymentIntent,
  setPaymentProviderStatus,
  setProviderLive,
  setProviderRefundsEnabled,
  setSandboxOutcome,
} from "@/lib/services/payments/mobileIntents";
import { replayWebhookEvent } from "@/lib/services/payments/webhooks";
import {
  completeSettlement,
  decideDiscrepancy,
  declareSettlement,
  syncReconciliations,
  verifyReconciliation,
} from "@/lib/services/payments/reconciliation";
import {
  approveRefund,
  cancelRefund,
  confirmRefund,
  createRefundRequest,
  executeRefund,
  rejectRefund,
} from "@/lib/services/payments/refunds";
import { prisma } from "@/lib/db/prisma";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}
const back = (path: string): never => redirect(path as never);
const BASE = "/app/paiements-mobile";

const providerSchema = z.object({
  label: z.string().min(1).max(120),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().positive().optional().or(z.literal("")),
});

export async function createSandboxProviderAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const p = providerSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await createPaymentProvider(ctx(t), {
    code: "SANDBOX",
    label: p.data.label,
    mode: "SANDBOX",
    minAmount: p.data.minAmount,
    maxAmount: p.data.maxAmount === "" || p.data.maxAmount === undefined ? null : p.data.maxAmount,
  });
  return back(`${BASE}?${res.ok ? "ok=provider" : `error=${res.error}`}`);
}

export async function toggleProviderAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = String(formData.get("providerId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "ACTIVE" && status !== "ARCHIVED")) {
    return back(`${BASE}?error=INVALID_INPUT`);
  }
  const res = await setPaymentProviderStatus(ctx(t), id, status);
  return back(`${BASE}?${res.ok ? "ok=status" : `error=${res.error}`}`);
}

/**
 * G3-E — Activation LIVE contrôlée : exige la saisie explicite de
 * « LIVE » (confirmation anti-clic). La désactivation est immédiate.
 */
export async function setProviderLiveAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = String(formData.get("providerId") ?? "");
  const enable = formData.get("enable") === "1";
  if (!id) return back(`${BASE}?error=INVALID_INPUT`);
  if (enable && String(formData.get("confirm") ?? "") !== "LIVE") {
    return back(`${BASE}?error=CONFIRM_REQUIRED`);
  }
  const res = await setProviderLive(ctx(t), id, enable);
  return back(`${BASE}?${res.ok ? "ok=live" : `error=${res.error}`}`);
}

export async function setProviderRefundsAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = String(formData.get("providerId") ?? "");
  if (!id) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await setProviderRefundsEnabled(ctx(t), id, formData.get("enable") === "1");
  return back(`${BASE}?${res.ok ? "ok=refunds" : `error=${res.error}`}`);
}

/** Trace une rotation de secret effectuée côté ops (valeur hors app). */
export async function rotateProviderSecretAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = String(formData.get("providerId") ?? "");
  if (!id) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await markProviderCredentialsRotated(ctx(t), id);
  return back(`${BASE}?${res.ok ? "ok=rotated" : `error=${res.error}`}`);
}

const intentSchema = z.object({
  studentId: z.string().min(1),
  academicYearId: z.string().min(1),
  providerId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  payerPhone: z.string().max(30).optional(),
  idempotencyKey: z.string().max(120).optional(),
  sandboxOutcome: z.enum(["SUCCESS", "FAILED", "PENDING", "LATE", "TIMEOUT", "REPEATED"]).optional(),
});

export async function createIntentAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const p = intentSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await createPaymentIntent(ctx(t), {
    studentId: p.data.studentId,
    academicYearId: p.data.academicYearId,
    providerId: p.data.providerId,
    amount: p.data.amount,
    currency: "XOF",
    payerPhone: p.data.payerPhone || null,
    channel: "ADMIN_TEST",
    idempotencyKey: p.data.idempotencyKey || undefined,
    sandboxOutcome: p.data.sandboxOutcome,
  });
  return back(
    `${BASE}?${res.ok ? (res.data.replayed ? "ok=replayed" : "ok=intent") : `error=${res.error}`}&intent=${res.ok ? res.data.intentId : ""}`,
  );
}

const idSchema = z.string().min(1);

export async function pollIntentAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = idSchema.safeParse(formData.get("intentId"));
  if (!id.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await pollPaymentIntent(ctx(t), id.data);
  return back(
    `${BASE}?${res.ok ? "ok=polled" : `error=${res.error}`}&intent=${id.data}`,
  );
}

export async function cancelIntentAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = idSchema.safeParse(formData.get("intentId"));
  if (!id.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await cancelPaymentIntent(ctx(t), id.data);
  return back(
    `${BASE}?${res.ok ? "ok=cancelled" : `error=${res.error}`}&intent=${id.data}`,
  );
}

export async function simulateOutcomeAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.simulate");
  const id = idSchema.safeParse(formData.get("intentId"));
  const outcome = z
    .enum(["SUCCESS", "FAILED", "PENDING", "LATE", "TIMEOUT", "REPEATED"])
    .safeParse(formData.get("outcome"));
  if (!id.success || !outcome.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await setSandboxOutcome(ctx(t), id.data, outcome.data);
  return back(
    `${BASE}?${res.ok ? "ok=script" : `error=${res.error}`}&intent=${id.data}`,
  );
}

export async function sweepExpiredAction() {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const res = await expireDuePaymentIntents(ctx(t));
  return back(`${BASE}?ok=sweep&n=${res.expired}`);
}

/**
 * Comptabilisation réelle d'une intention confirmée — `confirmIntent`
 * appelle `postConfirmedIntent` en interne (reprend aussi un
 * CONFIRMED_PENDING_POSTING en attente). Réservée aux tests
 * d'intégration isolés : en G3-A, les confirmations sandbox ne doivent
 * PAS passer par ici dans le flux normal.
 */
export async function postIntentAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = idSchema.safeParse(formData.get("intentId"));
  if (!id.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await confirmIntent(ctx(t), id.data, { postToLedger: true });
  return back(
    `${BASE}?${res.ok ? "ok=posted" : `error=${res.error}`}&intent=${id.data}`,
  );
}

/** Relance le traitement d'un événement webhook (FAILED / ANOMALY). */
export async function replayWebhookAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const id = idSchema.safeParse(formData.get("eventId"));
  if (!id.success) return back(`${BASE}?error=INVALID_INPUT`);
  const res = await replayWebhookEvent(ctx(t), id.data);
  return back(
    `${BASE}?${res.ok ? `ok=webhook_replayed&outcome=${res.data.outcome}` : `error=${res.error}`}#webhooks`,
  );
}

// ─── G3-D : commissions, rapprochement, reversements, remboursements ──

const feesSchema = z.object({
  providerId: z.string().min(1),
  feeFixed: z.coerce.number().int().min(0),
  feePercent: z.coerce.number().int().min(0).max(10000),
  feeBearer: z.enum(["SCHOOL", "PAYER"]),
});

/** Paramétrage contractuel de la commission opérateur (points de base). */
export async function setProviderFeesAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.manage");
  const p = feesSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return back(`${BASE}?error=INVALID_INPUT#commissions`);
  const upd = await prisma.paymentProvider.updateMany({
    where: { id: p.data.providerId, schoolId: t.schoolId },
    data: { feeFixed: p.data.feeFixed, feePercent: p.data.feePercent, feeBearer: p.data.feeBearer },
  });
  return back(`${BASE}?${upd.count ? "ok=fees" : "error=NOT_FOUND"}#commissions`);
}

const settlementSchema = z.object({
  providerId: z.string().min(1),
  reference: z.string().min(1).max(120),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  netDeclared: z.coerce.number().int().min(0).optional().or(z.literal("")),
  receivedAt: z.coerce.date().optional().or(z.literal("")),
  notes: z.string().max(500).optional(),
});

/** Déclaration d'un reversement groupé — jamais une preuve bancaire. */
export async function declareSettlementAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.reconcile");
  const p = settlementSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return back(`${BASE}?error=INVALID_INPUT#reversements`);
  const res = await declareSettlement(ctx(t), {
    providerId: p.data.providerId,
    reference: p.data.reference,
    periodStart: p.data.periodStart,
    periodEnd: p.data.periodEnd,
    netDeclared: p.data.netDeclared === "" || p.data.netDeclared === undefined ? null : p.data.netDeclared,
    receivedAt: p.data.receivedAt instanceof Date ? p.data.receivedAt : null,
    notes: p.data.notes,
  });
  return back(`${BASE}?${res.ok ? `ok=settlement&st=${res.data.status}` : `error=${res.error}`}#reversements`);
}

/** Clôture un reversement déclaré en saisissant le net réellement reçu. */
export async function completeSettlementAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.reconcile");
  const id = idSchema.safeParse(formData.get("settlementId"));
  const net = z.coerce.number().int().min(0).safeParse(formData.get("netDeclared"));
  if (!id.success || !net.success) return back(`${BASE}?error=INVALID_INPUT#reversements`);
  const res = await completeSettlement(ctx(t), id.data, {
    netDeclared: net.data,
    notes: String(formData.get("notes") ?? ""),
  });
  return back(`${BASE}?${res.ok ? `ok=settlement&st=${res.data.status}` : `error=${res.error}`}#reversements`);
}

/** Décision sur un rapprochement (vérifier / rapprocher / clôturer). */
export async function verifyReconciliationAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.reconcile");
  const id = idSchema.safeParse(formData.get("reconciliationId"));
  const action = z.enum(["TO_VERIFY", "MATCHED", "RESOLVED"]).safeParse(formData.get("action"));
  if (!id.success || !action.success) return back(`${BASE}?error=INVALID_INPUT#rapprochement`);
  const res = await verifyReconciliation(ctx(t), id.data, {
    action: action.data,
    note: String(formData.get("note") ?? ""),
  });
  return back(`${BASE}?${res.ok ? "ok=reconciled" : `error=${res.error}`}#rapprochement`);
}

/** Décision sur une anomalie — motif obligatoire, historique conservé. */
export async function decideDiscrepancyAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.reconcile");
  const id = idSchema.safeParse(formData.get("discrepancyId"));
  const action = z.enum(["IN_REVIEW", "RESOLVED", "IGNORED"]).safeParse(formData.get("action"));
  if (!id.success || !action.success) return back(`${BASE}?error=INVALID_INPUT#anomalies`);
  const res = await decideDiscrepancy(ctx(t), id.data, {
    action: action.data,
    note: String(formData.get("note") ?? ""),
  });
  return back(`${BASE}?${res.ok ? "ok=decided" : `error=${res.error}`}#anomalies`);
}

/** Balayage manuel des rapprochements et anomalies. */
export async function syncReconciliationAction() {
  const t = await requireSchoolPermission("mobilepayments.reconcile");
  const res = await syncReconciliations(t.schoolId);
  return back(`${BASE}?ok=sync&n=${res.created + res.anomalies}#rapprochement`);
}

const refundSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().max(120).optional(),
});

/** Demande de remboursement — n'est JAMAIS un remboursement effectué. */
export async function createRefundAction(formData: FormData) {
  const t = await requireSchoolPermission("mobilepayments.refund");
  const p = refundSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return back(`${BASE}?error=INVALID_INPUT#remboursements`);
  const res = await createRefundRequest(ctx(t), {
    paymentId: p.data.paymentId,
    amount: p.data.amount,
    reason: p.data.reason,
    idempotencyKey: p.data.idempotencyKey || undefined,
  });
  return back(`${BASE}?${res.ok ? (res.data.already ? "ok=replayed" : "ok=refund") : `error=${res.error}`}#remboursements`);
}

const refundOp = (action: "approve" | "reject" | "cancel" | "execute" | "confirm") =>
  async (formData: FormData) => {
    const t = await requireSchoolPermission("mobilepayments.refund");
    const id = idSchema.safeParse(formData.get("refundId"));
    if (!id.success) return back(`${BASE}?error=INVALID_INPUT#remboursements`);
    const res =
      action === "approve" ? await approveRefund(ctx(t), id.data)
      : action === "reject" ? await rejectRefund(ctx(t), id.data, String(formData.get("reason") ?? ""))
      : action === "cancel" ? await cancelRefund(ctx(t), id.data)
      : action === "execute" ? await executeRefund(ctx(t), id.data)
      : await confirmRefund(ctx(t), id.data);
    return back(`${BASE}?${res.ok ? `ok=refund_${action}` : `error=${res.error}`}#remboursements`);
  };

export const approveRefundAction = refundOp("approve");
export const rejectRefundAction = refundOp("reject");
export const cancelRefundAction = refundOp("cancel");
export const executeRefundAction = refundOp("execute");
export const confirmRefundAction = refundOp("confirm");
