"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  createFeeCategory,
  createFeeTariff,
  setFeeCategoryStatus,
  updateFeeTariff,
} from "@/lib/services/finance/fees";
import {
  archiveDiscount,
  createDiscount,
  generateCharges,
  updateInstallment,
} from "@/lib/services/finance/accounts";
import {
  cancelPayment,
  closeCashDay,
  recordPayment,
  remindUnpaid,
} from "@/lib/services/finance/payments";
import type { PaymentMethod } from "@prisma/client";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string) => redirect(path as never);

// ---------- Catégories ----------

export async function createCategoryAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.configure");
  const res = await createFeeCategory(ctx(tenant), {
    code: String(formData.get("code") ?? ""),
    label: String(formData.get("label") ?? ""),
    description: String(formData.get("description") ?? ""),
  });
  back(res.ok ? "/app/fees/settings?ok=category" : `/app/fees/settings?error=${res.error}`);
}

export async function archiveCategoryAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.configure");
  const id = String(formData.get("id") ?? "");
  const res = await setFeeCategoryStatus(ctx(tenant), id, "ARCHIVED");
  back(res.ok ? "/app/fees/settings?ok=archived" : `/app/fees/settings?error=${res.error}`);
}

// ---------- Tarifs ----------

export async function createTariffAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.fees.manage");
  const res = await createFeeTariff(ctx(tenant), {
    academicYearId: String(formData.get("academicYearId") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    levelId: String(formData.get("levelId") ?? "") || undefined,
    classroomId: String(formData.get("classroomId") ?? "") || undefined,
    amount: Math.trunc(Number(formData.get("amount") ?? 0)),
    mandatory: formData.get("mandatory") !== "on" ? false : true,
    paymentPlan:
      String(formData.get("paymentPlan") ?? "SINGLE") === "INSTALLMENTS"
        ? "INSTALLMENTS"
        : "SINGLE",
    installmentCount: Math.max(1, Math.trunc(Number(formData.get("installmentCount") ?? 1))),
    conditions: String(formData.get("conditions") ?? "") || undefined,
  });
  back(res.ok ? "/app/fees/settings?ok=tariff" : `/app/fees/settings?error=${res.error}`);
}

export async function updateTariffAmountAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.fees.manage");
  const id = String(formData.get("id") ?? "");
  const amount = Math.trunc(Number(formData.get("amount") ?? -1));
  const res = await updateFeeTariff(ctx(tenant), id, { amount });
  back(res.ok ? "/app/fees/settings?ok=tariff" : `/app/fees/settings?error=${res.error}`);
}

// ---------- Créances / échéances ----------

export async function generateChargesAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.fees.manage");
  const academicYearId = String(formData.get("academicYearId") ?? "");
  const classroomId = String(formData.get("classroomId") ?? "") || undefined;
  const res = await generateCharges(ctx(tenant), { academicYearId, classroomId });
  back(
    res.ok
      ? `/app/fees?ok=charges&count=${res.result.created}&year=${academicYearId}`
      : `/app/fees?error=${res.error}&year=${academicYearId}`,
  );
}

export async function updateInstallmentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.fees.manage");
  const id = String(formData.get("id") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const yearId = String(formData.get("academicYearId") ?? "");
  const dueDateStr = String(formData.get("dueDate") ?? "");
  const amount = Math.trunc(Number(formData.get("amount") ?? -1));
  const res = await updateInstallment(ctx(tenant), id, {
    ...(dueDateStr ? { dueDate: new Date(`${dueDateStr}T00:00:00Z`) } : {}),
    ...(amount >= 0 ? { amount } : {}),
  });
  back(
    res.ok
      ? `/app/fees/accounts/${studentId}?year=${yearId}&ok=installment`
      : `/app/fees/accounts/${studentId}?year=${yearId}&error=${res.error}`,
  );
}

// ---------- Réductions ----------

export async function createDiscountAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.discounts.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const yearId = String(formData.get("academicYearId") ?? "");
  const res = await createDiscount(ctx(tenant), {
    studentId,
    academicYearId: yearId,
    type: String(formData.get("type") ?? "FIXED_AMOUNT") as
      | "FIXED_AMOUNT"
      | "PERCENT"
      | "SCHOLARSHIP"
      | "EXEMPTION"
      | "FAMILY"
      | "EXCEPTIONAL",
    value: Math.trunc(Number(formData.get("value") ?? 0)),
    reason: String(formData.get("reason") ?? ""),
  });
  back(
    res.ok
      ? `/app/fees/accounts/${studentId}?year=${yearId}&ok=discount`
      : `/app/fees/accounts/${studentId}?year=${yearId}&error=${res.error}`,
  );
}

export async function archiveDiscountAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.discounts.manage");
  const id = String(formData.get("id") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const yearId = String(formData.get("academicYearId") ?? "");
  const res = await archiveDiscount(ctx(tenant), id);
  back(
    res.ok
      ? `/app/fees/accounts/${studentId}?year=${yearId}&ok=discount_archived`
      : `/app/fees/accounts/${studentId}?year=${yearId}&error=${res.error}`,
  );
}

// ---------- Paiements ----------

export async function recordPaymentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.payments.create");
  const studentId = String(formData.get("studentId") ?? "");
  const yearId = String(formData.get("academicYearId") ?? "");
  const idempotencyKey =
    String(formData.get("idempotencyKey") ?? "").trim() || randomUUID();
  const res = await recordPayment(ctx(tenant), {
    studentId,
    academicYearId: yearId,
    amount: Math.trunc(Number(formData.get("amount") ?? 0)),
    method: String(formData.get("method") ?? "CASH") as PaymentMethod,
    reference: String(formData.get("reference") ?? "") || undefined,
    observation: String(formData.get("observation") ?? "") || undefined,
    idempotencyKey,
  });
  back(
    res.ok
      ? `/app/fees/accounts/${studentId}?year=${yearId}&ok=payment&receipt=${res.result.receiptNumber}`
      : `/app/fees/accounts/${studentId}?year=${yearId}&error=${res.error}`,
  );
}

export async function cancelPaymentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.payments.cancel");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const res = await cancelPayment(ctx(tenant), { paymentId: id, reason });
  back(res.ok ? "/app/fees/payments?ok=cancelled" : `/app/fees/payments?error=${res.error}`);
}

// ---------- Caisse / relances ----------

export async function closeCashAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.cash.close");
  const dateStr = String(formData.get("date") ?? "");
  const date = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  const res = await closeCashDay(ctx(tenant), date);
  back(res.ok ? "/app/fees/payments?ok=closed" : `/app/fees/payments?error=${res.error}`);
}

export async function remindAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.read");
  const res = await remindUnpaid(ctx(tenant), {
    studentId: String(formData.get("studentId") ?? ""),
    installmentId: String(formData.get("installmentId") ?? "") || undefined,
    note: String(formData.get("note") ?? ""),
  });
  back(res.ok ? "/app/fees/unpaid?ok=reminded" : `/app/fees/unpaid?error=${res.error}`);
}
