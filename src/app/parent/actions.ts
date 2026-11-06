"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  replyParentReenrollment,
  submitParentReenrollment,
  uploadParentReenrollmentDoc,
} from "@/lib/services/reenrollment";
import {
  cancelParentIntent,
  createParentPaymentIntent,
  getParentIntent,
} from "@/lib/services/portal/parentPayments";
import {
  cancelParentRequest,
  createParentRequest,
  submitAbsenceJustification,
  updateParentContact,
} from "@/lib/services/parent-requests";
import type { AdminRequestType } from "@prisma/client";
import { pollPaymentIntent } from "@/lib/services/payments/mobileIntents";

const back = (path: string): never => redirect(path as never);

export async function submitReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const campaignId = String(formData.get("campaignId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const kind = String(formData.get("kind") ?? "REENROLL") === "DEPARTURE" ? "DEPARTURE" : "REENROLL";
  if (!campaignId || !studentId) return back("/parent?tab=reinscription&error=INVALID_INPUT");
  const res = await submitParentReenrollment(ctx, {
    campaignId,
    studentId,
    kind,
    desiredLevelId: String(formData.get("desiredLevelId") ?? "") || undefined,
    contactUpdate: {
      phone: String(formData.get("phone") ?? "") || undefined,
      email: String(formData.get("email") ?? "") || undefined,
      address: String(formData.get("address") ?? "") || undefined,
    },
    note: String(formData.get("note") ?? "") || undefined,
  });
  return back(
    res.ok
      ? "/parent?tab=reinscription&ok=submitted"
      : `/parent?tab=reinscription&error=${res.error}`,
  );
}

export async function replyReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const requestId = String(formData.get("requestId") ?? "");
  const body = String(formData.get("reply") ?? "");
  if (!requestId || !body.trim()) return back("/parent?tab=reinscription&error=INVALID_INPUT");
  const res = await replyParentReenrollment(ctx, requestId, body);
  return back(
    res.ok
      ? "/parent?tab=reinscription&ok=reply"
      : `/parent?tab=reinscription&error=${res.error}`,
  );
}

export async function uploadReenrollDocAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const requestId = String(formData.get("requestId") ?? "");
  const docKey = String(formData.get("docKey") ?? "");
  const file = formData.get("file");
  if (!requestId || !docKey || !(file instanceof File) || file.size === 0) {
    return back("/parent?tab=reinscription&error=INVALID_INPUT");
  }
  const res = await uploadParentReenrollmentDoc(ctx, requestId, {
    buffer: Buffer.from(await file.arrayBuffer()),
    originalName: file.name,
    docKey,
    ip: String(formData.get("ip") ?? "") || undefined,
  });
  return back(
    res.ok
      ? "/parent?tab=reinscription&ok=uploaded"
      : `/parent?tab=reinscription&error=${res.error}`,
  );
}

// ─── G3-C : paiement Mobile Money depuis le portail ────────────────

const paySchema = z.object({
  studentId: z.string().min(1),
  feeInstallmentId: z.string().min(1),
  providerId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  payerPhone: z.string().max(30).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const finUrl = (studentId: string, extra: string) =>
  `/parent?child=${studentId}&tab=finances&${extra}`;

export async function payInstallmentAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const p = paySchema.safeParse(Object.fromEntries(formData));
  const studentId = String(formData.get("studentId") ?? "");
  if (!p.success) return back(finUrl(studentId, "error=INVALID_INPUT"));
  const res = await createParentPaymentIntent(ctx, {
    studentId: p.data.studentId,
    feeInstallmentId: p.data.feeInstallmentId,
    amount: p.data.amount,
    providerId: p.data.providerId,
    payerPhone: p.data.payerPhone || null,
    idempotencyKey: p.data.idempotencyKey,
  });
  return back(
    res.ok
      ? finUrl(p.data.studentId, `intent=${res.data.intentId}&ok=intent`)
      : finUrl(p.data.studentId, `error=${res.error}`),
  );
}

/** Rafraîchissement contrôlé : consultation ponctuelle du statut
 *  prestataire (même mécanisme central que les webhooks). */
export async function refreshParentIntentAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const intentId = String(formData.get("intentId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  if (!intentId) return back(finUrl(studentId, "error=INVALID_INPUT"));
  const intent = await getParentIntent(ctx, intentId);
  if (!intent) return back(finUrl(studentId, "error=NOT_FOUND"));
  const res = await pollPaymentIntent(ctx, intentId);
  return back(
    finUrl(studentId, res.ok ? `intent=${intentId}&ok=refreshed` : `intent=${intentId}&error=${res.error}`),
  );
}

export async function cancelParentIntentAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const intentId = String(formData.get("intentId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  if (!intentId) return back(finUrl(studentId, "error=INVALID_INPUT"));
  const res = await cancelParentIntent(ctx, intentId, "CANCELLED_BY_PARENT");
  return back(
    finUrl(studentId, res.ok ? "ok=cancelled" : `intent=${intentId}&error=${res.error}`),
  );
}

// ─── H1 : demandes administratives, profil, justificatifs ──────────

const reqSchema = z.object({
  type: z.enum([
    "DOCUMENT",
    "ABSENCE_JUSTIFICATION",
    "ACCOUNT_INFO",
    "MEETING",
    "OTHER",
  ]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  studentId: z.string().optional(),
});

const reqUrl = (extra: string) => `/parent?tab=demandes&${extra}`;

export async function createParentRequestAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const p = reqSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return back(reqUrl("error=INVALID_INPUT"));
  const res = await createParentRequest(ctx, {
    type: p.data.type as AdminRequestType,
    subject: p.data.subject,
    body: p.data.body,
    studentId: p.data.studentId || undefined,
  });
  return back(
    res.ok ? reqUrl("ok=request_created") : reqUrl(`error=${res.error}`),
  );
}

export async function cancelParentRequestAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const id = String(formData.get("requestId") ?? "");
  if (!id) return back(reqUrl("error=INVALID_INPUT"));
  const res = await cancelParentRequest(ctx, id);
  return back(
    res.ok ? reqUrl("ok=request_cancelled") : reqUrl(`error=${res.error}`),
  );
}

export async function submitJustificationAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const attendanceRecordId = String(formData.get("attendanceRecordId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const body = String(formData.get("body") ?? "");
  const url = (extra: string) =>
    `/parent?child=${studentId}&tab=absences&${extra}`;
  if (!attendanceRecordId || !body.trim()) {
    return back(url("error=INVALID_INPUT"));
  }
  const res = await submitAbsenceJustification(ctx, {
    attendanceRecordId,
    body,
  });
  return back(
    res.ok ? url("ok=justification_sent") : url(`error=${res.error}`),
  );
}

export async function updateParentContactAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const res = await updateParentContact(ctx, {
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    address: String(formData.get("address") ?? ""),
  });
  return back(
    res.ok
      ? "/parent?tab=profil&ok=contact_saved"
      : `/parent?tab=profil&error=${res.error}`,
  );
}
