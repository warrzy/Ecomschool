"use server";

import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { createPlan, updatePlan } from "@/lib/services/platform/plans";
import {
  assignSubscription,
  changePlan,
  extendTrial,
  renewSubscription,
  suspendSubscription,
  reactivateSubscription,
  cancelSubscription,
  sweepSubscriptions,
  reviewChangeRequest,
} from "@/lib/services/platform/subscriptions";
import { setModuleOverride } from "@/lib/services/platform/modules";
import {
  cancelInvoice,
  cancelPlatformPayment,
  generateInvoice,
  issueCreditNote,
  recordPlatformPayment,
} from "@/lib/services/platform/billing";
import { startSupportSession, endSupportSession } from "@/lib/services/platform/support";
import type { BillingCycle } from "@prisma/client";
import { z } from "zod";
import {
  dateField,
  idField,
  intField,
  intPositive,
  optionalText,
  requiredText,
} from "@/lib/validations/form";

const nonNegInt = intField.refine((v) => v >= 0, "INVALID_NUMBER");

const back = (path: string): never => redirect(path as never);

// ---------- Offres ----------

export async function createPlanAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.plans.manage");
  const moduleCodes = formData.getAll("moduleCodes").map(String).filter(Boolean);
  const parsed = z
    .object({
      code: requiredText.max(40),
      name: requiredText.max(120),
      description: z.string().max(2000),
      monthlyPrice: nonNegInt,
      yearlyPrice: nonNegInt,
      maxStudents: nonNegInt.nullable(),
      maxUsers: nonNegInt.nullable(),
      trialDays: nonNegInt,
      graceDays: nonNegInt,
    })
    .safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      description: formData.get("description"),
      monthlyPrice: formData.get("monthlyPrice") ?? 0,
      yearlyPrice: formData.get("yearlyPrice") ?? 0,
      maxStudents: formData.get("maxStudents") || null,
      maxUsers: formData.get("maxUsers") || null,
      trialDays: formData.get("trialDays") ?? 0,
      graceDays: formData.get("graceDays") ?? 7,
    });
  if (!parsed.success) return back("/platform/plans?error=INVALID_INPUT");
  const res = await createPlan(ctx.userId, { ...parsed.data, moduleCodes });
  back(res.ok ? "/platform/plans?ok=created" : `/platform/plans?error=${res.error}`);
}

export async function updatePlanAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.plans.manage");
  const moduleCodes = formData.getAll("moduleCodes").map(String).filter(Boolean);
  const optInt = nonNegInt.optional();
  const parsed = z
    .object({
      id: idField,
      name: optionalText,
      monthlyPrice: optInt,
      yearlyPrice: optInt,
      maxStudents: optInt,
      maxUsers: optInt,
      trialDays: optInt,
      graceDays: optInt,
    })
    .safeParse({
      id: formData.get("id"),
      name: formData.get("name"),
      monthlyPrice: formData.get("monthlyPrice") || undefined,
      yearlyPrice: formData.get("yearlyPrice") || undefined,
      maxStudents: formData.get("maxStudents") || undefined,
      maxUsers: formData.get("maxUsers") || undefined,
      trialDays: formData.get("trialDays") || undefined,
      graceDays: formData.get("graceDays") || undefined,
    });
  if (!parsed.success) return back("/platform/plans?error=INVALID_INPUT");
  const { id, ...data } = parsed.data;
  const res = await updatePlan(ctx.userId, id, {
    ...data,
    moduleCodes: moduleCodes.length > 0 ? moduleCodes : undefined,
  });
  back(res.ok ? "/platform/plans?ok=updated" : `/platform/plans?error=${res.error}`);
}

// ---------- Abonnements ----------

export async function assignSubscriptionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({
      schoolId: idField,
      planId: idField,
      cycle: z.enum(["MONTHLY", "YEARLY"]),
      trialDays: nonNegInt.optional(),
    })
    .safeParse({
      schoolId,
      planId: formData.get("planId"),
      cycle: formData.get("cycle") ?? "MONTHLY",
      trialDays: formData.get("trialDays") || undefined,
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await assignSubscription(ctx.userId, {
    ...parsed.data,
    cycle: parsed.data.cycle as BillingCycle,
    startTrial: formData.get("startTrial") === "on",
  });
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=subscription`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function changePlanAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({
      subscriptionId: idField,
      planId: idField,
      note: optionalText,
    })
    .safeParse({
      subscriptionId: formData.get("subscriptionId"),
      planId: formData.get("planId"),
      note: formData.get("note"),
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await changePlan(ctx.userId, parsed.data);
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=plan`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function extendTrialAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({ subscriptionId: idField, days: intPositive })
    .safeParse({
      subscriptionId: formData.get("subscriptionId"),
      days: formData.get("days"),
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await extendTrial(ctx.userId, parsed.data);
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=trial`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function renewSubscriptionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await renewSubscription(ctx.userId, String(formData.get("subscriptionId") ?? ""));
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=renewed`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function suspendSubscriptionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const subId = idField.safeParse(formData.get("subscriptionId"));
  if (!subId.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await suspendSubscription(
    ctx.userId,
    subId.data,
    String(formData.get("note") ?? "") || undefined,
  );
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=suspended`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function reactivateSubscriptionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await reactivateSubscription(ctx.userId, String(formData.get("subscriptionId") ?? ""));
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=reactivated`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function cancelSubscriptionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({ subscriptionId: idField, note: requiredText.max(300) })
    .safeParse({
      subscriptionId: formData.get("subscriptionId"),
      note: formData.get("note"),
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await cancelSubscription(
    ctx.userId,
    parsed.data.subscriptionId,
    parsed.data.note,
  );
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=cancelled`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function sweepSubscriptionsAction() {
  await requirePlatformPermission("platform.subscriptions.manage");
  const res = await sweepSubscriptions();
  back(`/platform/subscriptions?ok=sweep&g=${res.graceStarted}&s=${res.suspended}&e=${res.expired}`);
}

export async function reviewChangeRequestAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const res = await reviewChangeRequest(ctx.userId, {
    requestId: String(formData.get("requestId") ?? ""),
    approve: formData.get("approve") === "1",
    note: String(formData.get("note") ?? "") || undefined,
  });
  back(res.ok ? "/platform/subscriptions?ok=reviewed" : `/platform/subscriptions?error=${res.error}`);
}

// ---------- Modules ----------

export async function setModuleOverrideAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.modules.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await setModuleOverride(ctx.userId, {
    schoolId,
    moduleCode: String(formData.get("moduleCode") ?? ""),
    enabled: formData.get("enabled") === "1",
    note: String(formData.get("note") ?? "") || undefined,
  });
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=module`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

// ---------- Facturation ----------

export async function generateInvoiceAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.invoices.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({
      schoolId: idField,
      subscriptionId: optionalText,
      cycle: z.enum(["MONTHLY", "YEARLY"]),
      dueDate: dateField.optional(),
    })
    .safeParse({
      schoolId,
      subscriptionId: formData.get("subscriptionId"),
      cycle: formData.get("cycle") ?? "MONTHLY",
      dueDate: formData.get("dueDate") || undefined,
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await generateInvoice(ctx.userId, {
    schoolId: parsed.data.schoolId,
    subscriptionId: parsed.data.subscriptionId,
    cycle: parsed.data.cycle,
    dueDate: parsed.data.dueDate
      ? new Date(`${parsed.data.dueDate}T00:00:00Z`)
      : undefined,
  });
  back(
    res.ok
      ? `/platform/invoices?ok=created&n=${res.result.invoiceNumber}`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function recordPlatformPaymentAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.payments.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({
      invoiceId: idField,
      amount: intPositive,
      method: optionalText,
      reference: optionalText,
      idempotencyKey: optionalText,
    })
    .safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      method: formData.get("method"),
      reference: formData.get("reference"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await recordPlatformPayment(ctx.userId, parsed.data);
  back(
    res.ok
      ? `/platform/invoices?ok=payment`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function cancelPlatformPaymentAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.payments.manage");
  const parsed = z
    .object({ id: idField, reason: requiredText.max(300) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/platform/invoices?error=INVALID_INPUT");
  const res = await cancelPlatformPayment(ctx.userId, {
    paymentId: parsed.data.id,
    reason: parsed.data.reason,
  });
  back(res.ok ? "/platform/invoices?ok=payment_cancelled" : `/platform/invoices?error=${res.error}`);
}

export async function issueCreditNoteAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.invoices.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const parsed = z
    .object({
      invoiceId: idField,
      amount: intPositive,
      reason: requiredText.max(300),
    })
    .safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) return back(`/platform/schools/${schoolId}?error=INVALID_INPUT`);
  const res = await issueCreditNote(ctx.userId, parsed.data);
  back(
    res.ok
      ? `/platform/invoices?ok=credit`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function cancelInvoiceAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.invoices.manage");
  const parsed = z
    .object({ id: idField, reason: requiredText.max(300) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/platform/invoices?error=INVALID_INPUT");
  const res = await cancelInvoice(ctx.userId, {
    invoiceId: parsed.data.id,
    reason: parsed.data.reason,
  });
  back(res.ok ? "/platform/invoices?ok=cancelled" : `/platform/invoices?error=${res.error}`);
}

// ---------- Assistance ----------

export async function startSupportSessionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.support.access");
  const schoolId = String(formData.get("schoolId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const authorizedEmail = String(formData.get("authorizedEmail") ?? "")
    .toLowerCase()
    .trim();
  const parsed = z
    .object({
      schoolId: idField,
      reason: requiredText.max(300),
      authorizedEmail: z.string().email(),
      hours: intPositive.optional(),
    })
    .safeParse({
      schoolId,
      reason,
      authorizedEmail,
      hours: formData.get("hours") || undefined,
    });
  if (!parsed.success) return back("/platform/support?error=INVALID_INPUT");

  // Accord explicite de l'établissement : l'email doit correspondre à un
  // membre actif de l'école (vérifié côté service par SchoolMembership).
  const { prisma } = await import("@/lib/db/prisma");
  const authorizer = await prisma.user.findUnique({
    where: { email: parsed.data.authorizedEmail },
    select: { id: true },
  });
  if (!authorizer) return back("/platform/support?error=NOT_FOUND");

  const res = await startSupportSession(ctx.userId, {
    schoolId: parsed.data.schoolId,
    reason: parsed.data.reason,
    durationHours: parsed.data.hours,
    authorizedById: authorizer.id,
  });
  back(res.ok ? "/platform/support?ok=started" : `/platform/support?error=${res.error}`);
}

export async function endSupportSessionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.support.access");
  const res = await endSupportSession(ctx.userId, String(formData.get("id") ?? ""));
  back(res.ok ? "/platform/support?ok=ended" : `/platform/support?error=${res.error}`);
}
