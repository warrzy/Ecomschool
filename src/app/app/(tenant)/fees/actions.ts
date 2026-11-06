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
import {
  recordManualMobileMoney,
  rejectManualPayment,
  validateManualPayment,
} from "@/lib/services/finance/manualMobileMoney";
import type { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import {
  dateField,
  idField,
  intField,
  intPositive,
  optionalText,
  requiredText,
} from "@/lib/validations/form";

const paymentMethodSchema = z.enum([
  "CASH",
  "BANK_TRANSFER",
  "CHECK",
  "MOBILE_MONEY",
  "MOBILE_MONEY_MANUAL",
  "OTHER",
]);
const momoOperatorSchema = z.enum(["ORANGE_MONEY", "MOOV_MONEY"]);
const discountTypeSchema = z.enum([
  "FIXED_AMOUNT",
  "PERCENT",
  "SCHOLARSHIP",
  "EXEMPTION",
  "FAMILY",
  "EXCEPTIONAL",
]);

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string): never => redirect(path as never);

// ---------- Catégories ----------

export async function createCategoryAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.configure");
  const parsed = z
    .object({ code: requiredText.max(30), label: requiredText.max(120), description: z.string() })
    .safeParse({
      code: formData.get("code"),
      label: formData.get("label"),
      description: formData.get("description"),
    });
  if (!parsed.success) return back("/app/fees/settings?error=INVALID_INPUT");
  const res = await createFeeCategory(ctx(tenant), parsed.data);
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
  const parsed = z
    .object({
      academicYearId: idField,
      categoryId: idField,
      levelId: optionalText,
      classroomId: optionalText,
      amount: intField.refine((v) => v >= 0, "INVALID_NUMBER"),
      paymentPlan: z.enum(["SINGLE", "INSTALLMENTS"]),
      installmentCount: intPositive,
      conditions: optionalText,
    })
    .safeParse({
      academicYearId: formData.get("academicYearId"),
      categoryId: formData.get("categoryId"),
      levelId: formData.get("levelId"),
      classroomId: formData.get("classroomId"),
      amount: formData.get("amount"),
      paymentPlan: formData.get("paymentPlan") ?? "SINGLE",
      installmentCount: formData.get("installmentCount") ?? 1,
      conditions: formData.get("conditions"),
    });
  if (!parsed.success) return back("/app/fees/settings?error=INVALID_INPUT");
  const res = await createFeeTariff(ctx(tenant), {
    ...parsed.data,
    mandatory: formData.get("mandatory") === "on",
  });
  back(res.ok ? "/app/fees/settings?ok=tariff" : `/app/fees/settings?error=${res.error}`);
}

export async function updateTariffAmountAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.fees.manage");
  const parsed = z
    .object({ id: idField, amount: intField.refine((v) => v >= 0) })
    .safeParse({ id: formData.get("id"), amount: formData.get("amount") });
  if (!parsed.success) return back("/app/fees/settings?error=INVALID_INPUT");
  const res = await updateFeeTariff(ctx(tenant), parsed.data.id, {
    amount: parsed.data.amount,
  });
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
      ? `/app/fees?ok=charges&count=${res.result.created}&existing=${res.result.existing}&year=${academicYearId}`
      : `/app/fees?error=${res.error}&year=${academicYearId}`,
  );
}

export async function updateInstallmentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.fees.manage");
  const parsed = z
    .object({
      id: idField,
      studentId: idField,
      academicYearId: idField,
      dueDate: dateField.optional(),
      amount: intField.optional(),
    })
    .safeParse({
      id: formData.get("id"),
      studentId: formData.get("studentId"),
      academicYearId: formData.get("academicYearId"),
      dueDate: formData.get("dueDate") || undefined,
      amount: formData.get("amount") ?? undefined,
    });
  if (!parsed.success) return back(`/app/fees?error=INVALID_INPUT`);
  const { id, studentId, academicYearId: yearId, dueDate, amount } = parsed.data;
  const res = await updateInstallment(ctx(tenant), id, {
    ...(dueDate ? { dueDate: new Date(`${dueDate}T00:00:00Z`) } : {}),
    ...(amount !== undefined && amount >= 0 ? { amount } : {}),
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
  const parsed = z
    .object({
      studentId: idField,
      academicYearId: idField,
      type: discountTypeSchema,
      value: intField.refine((v) => v >= 0),
      reason: requiredText.max(300),
    })
    .safeParse({
      studentId: formData.get("studentId"),
      academicYearId: formData.get("academicYearId"),
      type: formData.get("type") ?? "FIXED_AMOUNT",
      value: formData.get("value"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) return back("/app/fees?error=INVALID_INPUT");
  const { studentId, academicYearId: yearId } = parsed.data;
  const res = await createDiscount(ctx(tenant), parsed.data);
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
  const parsed = z
    .object({
      studentId: idField,
      academicYearId: idField,
      amount: intPositive,
      method: paymentMethodSchema,
      reference: optionalText,
      observation: optionalText,
    })
    .safeParse({
      studentId: formData.get("studentId"),
      academicYearId: formData.get("academicYearId"),
      amount: formData.get("amount"),
      method: formData.get("method") ?? "CASH",
      reference: formData.get("reference"),
      observation: formData.get("observation"),
    });
  if (!parsed.success) return back("/app/fees?error=INVALID_INPUT");
  const { studentId, academicYearId: yearId } = parsed.data;
  const idempotencyKey =
    String(formData.get("idempotencyKey") ?? "").trim() || randomUUID();

  // Mobile Money « vérification manuelle » : la ligne est créée PENDING
  // — elle n'est comptabilisée qu'après confirmation explicite par un
  // agent habilité (finance.payments.validate).
  if (parsed.data.method === "MOBILE_MONEY_MANUAL") {
    const extra = z
      .object({
        operator: momoOperatorSchema,
        reference: requiredText.max(120),
        merchantAccount: optionalText,
      })
      .safeParse({
        operator: formData.get("operator"),
        reference: formData.get("reference"),
        merchantAccount: formData.get("merchantAccount"),
      });
    if (!extra.success) {
      return back(
        `/app/fees/accounts/${studentId}?year=${yearId}&error=INVALID_INPUT`,
      );
    }
    const res = await recordManualMobileMoney(ctx(tenant), {
      studentId,
      academicYearId: yearId,
      amount: parsed.data.amount,
      operator: extra.data.operator,
      reference: extra.data.reference,
      merchantAccount: extra.data.merchantAccount,
      observation: parsed.data.observation,
      idempotencyKey,
    });
    return back(
      res.ok
        ? `/app/fees/accounts/${studentId}?year=${yearId}&ok=payment_pending`
        : `/app/fees/accounts/${studentId}?year=${yearId}&error=${res.error}`,
    );
  }

  const res = await recordPayment(ctx(tenant), {
    ...parsed.data,
    method: parsed.data.method as PaymentMethod,
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
  const parsed = z
    .object({ id: idField, reason: requiredText.max(300) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/app/fees/payments?error=INVALID_INPUT");
  const res = await cancelPayment(ctx(tenant), {
    paymentId: parsed.data.id,
    reason: parsed.data.reason,
  });
  back(res.ok ? "/app/fees/payments?ok=cancelled" : `/app/fees/payments?error=${res.error}`);
}

/** Confirmation humaine d'un encaissement MoMo manuel (PENDING → VALIDATED). */
export async function validateManualPaymentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.payments.validate");
  const parsed = z.object({ id: idField }).safeParse({ id: formData.get("id") });
  if (!parsed.success) return back("/app/fees/payments?error=INVALID_INPUT");
  const res = await validateManualPayment(ctx(tenant), parsed.data.id);
  back(
    res.ok
      ? `/app/fees/payments?ok=payment_validated&receipt=${res.result.receiptNumber}`
      : `/app/fees/payments?error=${res.error}`,
  );
}

/** Rejet d'un encaissement MoMo manuel en attente (motif obligatoire). */
export async function rejectManualPaymentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.payments.validate");
  const parsed = z
    .object({ id: idField, reason: requiredText.max(300) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/app/fees/payments?error=INVALID_INPUT");
  const res = await rejectManualPayment(ctx(tenant), {
    paymentId: parsed.data.id,
    reason: parsed.data.reason,
  });
  back(res.ok ? "/app/fees/payments?ok=payment_rejected" : `/app/fees/payments?error=${res.error}`);
}

// ---------- Caisse / relances ----------

export async function closeCashAction(formData: FormData) {
  const tenant = await requireSchoolPermission("finance.cash.close");
  const dateStr = String(formData.get("date") ?? "");
  const parsed = dateField.optional().safeParse(dateStr || undefined);
  if (!parsed.success) return back("/app/fees/payments?error=INVALID_INPUT");
  const date = parsed.data ? new Date(`${parsed.data}T00:00:00Z`) : new Date();
  const res = await closeCashDay(ctx(tenant), date);
  back(res.ok ? "/app/fees/payments?ok=closed" : `/app/fees/payments?error=${res.error}`);
}

export async function remindAction(formData: FormData) {
  // Aligné sur la page /app/fees/unpaid : la relance relève du suivi des
  // impayés (supervision), pas de la simple consultation financière.
  const tenant = await requireSchoolPermission("finance.reports.read");
  const parsed = z
    .object({
      studentId: idField,
      installmentId: optionalText,
      note: requiredText.max(300),
    })
    .safeParse({
      studentId: formData.get("studentId"),
      installmentId: formData.get("installmentId"),
      note: formData.get("note"),
    });
  if (!parsed.success) return back("/app/fees/unpaid?error=INVALID_INPUT");
  const res = await remindUnpaid(ctx(tenant), parsed.data);
  back(res.ok ? "/app/fees/unpaid?ok=reminded" : `/app/fees/unpaid?error=${res.error}`);
}
