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

const back = (path: string) => redirect(path as never);

// ---------- Offres ----------

export async function createPlanAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.plans.manage");
  const moduleCodes = formData.getAll("moduleCodes").map(String).filter(Boolean);
  const res = await createPlan(ctx.userId, {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    monthlyPrice: Math.trunc(Number(formData.get("monthlyPrice") ?? 0)),
    yearlyPrice: Math.trunc(Number(formData.get("yearlyPrice") ?? 0)),
    maxStudents: formData.get("maxStudents") ? Math.trunc(Number(formData.get("maxStudents"))) : null,
    maxUsers: formData.get("maxUsers") ? Math.trunc(Number(formData.get("maxUsers"))) : null,
    trialDays: Math.trunc(Number(formData.get("trialDays") ?? 0)),
    graceDays: Math.trunc(Number(formData.get("graceDays") ?? 7)),
    moduleCodes,
  });
  back(res.ok ? "/platform/plans?ok=created" : `/platform/plans?error=${res.error}`);
}

export async function updatePlanAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.plans.manage");
  const id = String(formData.get("id") ?? "");
  const moduleCodes = formData.getAll("moduleCodes").map(String).filter(Boolean);
  const res = await updatePlan(ctx.userId, id, {
    name: String(formData.get("name") ?? "") || undefined,
    monthlyPrice: formData.get("monthlyPrice")
      ? Math.trunc(Number(formData.get("monthlyPrice")))
      : undefined,
    yearlyPrice: formData.get("yearlyPrice")
      ? Math.trunc(Number(formData.get("yearlyPrice")))
      : undefined,
    maxStudents: formData.get("maxStudents")
      ? Math.trunc(Number(formData.get("maxStudents")))
      : undefined,
    maxUsers: formData.get("maxUsers")
      ? Math.trunc(Number(formData.get("maxUsers")))
      : undefined,
    trialDays: formData.get("trialDays")
      ? Math.trunc(Number(formData.get("trialDays")))
      : undefined,
    graceDays: formData.get("graceDays")
      ? Math.trunc(Number(formData.get("graceDays")))
      : undefined,
    moduleCodes: moduleCodes.length > 0 ? moduleCodes : undefined,
  });
  back(res.ok ? "/platform/plans?ok=updated" : `/platform/plans?error=${res.error}`);
}

// ---------- Abonnements ----------

export async function assignSubscriptionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await assignSubscription(ctx.userId, {
    schoolId,
    planId: String(formData.get("planId") ?? ""),
    cycle: (String(formData.get("cycle") ?? "MONTHLY") === "YEARLY" ? "YEARLY" : "MONTHLY") as BillingCycle,
    startTrial: formData.get("startTrial") === "on",
    trialDays: formData.get("trialDays") ? Math.trunc(Number(formData.get("trialDays"))) : undefined,
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
  const res = await changePlan(ctx.userId, {
    subscriptionId: String(formData.get("subscriptionId") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });
  back(
    res.ok
      ? `/platform/schools/${schoolId}?ok=plan`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function extendTrialAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.subscriptions.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await extendTrial(ctx.userId, {
    subscriptionId: String(formData.get("subscriptionId") ?? ""),
    days: Math.trunc(Number(formData.get("days") ?? 0)),
  });
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
  const res = await suspendSubscription(
    ctx.userId,
    String(formData.get("subscriptionId") ?? ""),
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
  const res = await cancelSubscription(
    ctx.userId,
    String(formData.get("subscriptionId") ?? ""),
    String(formData.get("note") ?? "") || undefined,
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
  const res = await generateInvoice(ctx.userId, {
    schoolId,
    subscriptionId: String(formData.get("subscriptionId") ?? "") || undefined,
    cycle: String(formData.get("cycle") ?? "") === "YEARLY" ? "YEARLY" : "MONTHLY",
    dueDate: formData.get("dueDate")
      ? new Date(`${formData.get("dueDate")}T00:00:00Z`)
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
  const res = await recordPlatformPayment(ctx.userId, {
    invoiceId: String(formData.get("invoiceId") ?? ""),
    amount: Math.trunc(Number(formData.get("amount") ?? 0)),
    method: String(formData.get("method") ?? "") || undefined,
    reference: String(formData.get("reference") ?? "") || undefined,
    idempotencyKey: String(formData.get("idempotencyKey") ?? "") || undefined,
  });
  back(
    res.ok
      ? `/platform/invoices?ok=payment`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function cancelPlatformPaymentAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.payments.manage");
  const res = await cancelPlatformPayment(ctx.userId, {
    paymentId: String(formData.get("id") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  back(res.ok ? "/platform/invoices?ok=payment_cancelled" : `/platform/invoices?error=${res.error}`);
}

export async function issueCreditNoteAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.invoices.manage");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await issueCreditNote(ctx.userId, {
    invoiceId: String(formData.get("invoiceId") ?? ""),
    amount: Math.trunc(Number(formData.get("amount") ?? 0)),
    reason: String(formData.get("reason") ?? ""),
  });
  back(
    res.ok
      ? `/platform/invoices?ok=credit`
      : `/platform/schools/${schoolId}?error=${res.error}`,
  );
}

export async function cancelInvoiceAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.invoices.manage");
  const res = await cancelInvoice(ctx.userId, {
    invoiceId: String(formData.get("id") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  back(res.ok ? "/platform/invoices?ok=cancelled" : `/platform/invoices?error=${res.error}`);
}

// ---------- Assistance ----------

export async function startSupportSessionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.support.access");
  const schoolId = String(formData.get("schoolId") ?? "");
  const res = await startSupportSession(ctx.userId, {
    schoolId,
    reason: String(formData.get("reason") ?? ""),
    durationHours: formData.get("hours") ? Math.trunc(Number(formData.get("hours"))) : undefined,
    authorizedById: String(formData.get("authorizedById") ?? "") || undefined,
  });
  back(res.ok ? "/platform/support?ok=started" : `/platform/support?error=${res.error}`);
}

export async function endSupportSessionAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.support.access");
  const res = await endSupportSession(ctx.userId, String(formData.get("id") ?? ""));
  back(res.ok ? "/platform/support?ok=ended" : `/platform/support?error=${res.error}`);
}
