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
  pollPaymentIntent,
  setPaymentProviderStatus,
  setSandboxOutcome,
} from "@/lib/services/payments/mobileIntents";

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
