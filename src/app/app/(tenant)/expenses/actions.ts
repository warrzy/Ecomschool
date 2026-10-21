"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  cancelExpense,
  createExpense,
  createExpenseCategory,
  payExpense,
  setExpenseCategoryStatus,
  updateExpense,
} from "@/lib/services/finance/expenses";
import { z } from "zod";
import {
  dateField,
  idField,
  intField,
  optionalText,
  requiredText,
} from "@/lib/validations/form";

const paymentMethodSchema = z.enum([
  "CASH",
  "BANK_TRANSFER",
  "CHECK",
  "MOBILE_MONEY",
  "OTHER",
]);

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string): never => redirect(path as never);

// ---------- Catégories de dépenses ----------

export async function createExpenseCategoryAction(formData: FormData) {
  const tenant = await requireSchoolPermission("expenses.categories.manage");
  const parsed = z
    .object({
      code: requiredText.max(30),
      label: requiredText.max(120),
      description: z.string(),
    })
    .safeParse({
      code: formData.get("code"),
      label: formData.get("label"),
      description: formData.get("description"),
    });
  if (!parsed.success) return back("/app/expenses/categories?error=INVALID_INPUT");
  const res = await createExpenseCategory(ctx(tenant), parsed.data);
  back(
    res.ok
      ? "/app/expenses/categories?ok=category"
      : `/app/expenses/categories?error=${res.error}`,
  );
}

export async function archiveExpenseCategoryAction(formData: FormData) {
  const tenant = await requireSchoolPermission("expenses.categories.manage");
  const id = String(formData.get("id") ?? "");
  const res = await setExpenseCategoryStatus(ctx(tenant), id, "ARCHIVED");
  back(
    res.ok
      ? "/app/expenses/categories?ok=archived"
      : `/app/expenses/categories?error=${res.error}`,
  );
}

// ---------- Dépenses ----------

export async function createExpenseAction(formData: FormData) {
  const tenant = await requireSchoolPermission("expenses.create");
  const parsed = z
    .object({
      categoryId: idField,
      academicYearId: optionalText,
      label: requiredText.max(200),
      amount: intField.refine((v) => v > 0),
      beneficiary: requiredText.max(200),
      expenseAt: dateField,
      method: paymentMethodSchema.optional(),
      paymentReference: optionalText,
      attachmentRef: optionalText,
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      academicYearId: formData.get("academicYearId"),
      label: formData.get("label"),
      amount: formData.get("amount"),
      beneficiary: formData.get("beneficiary"),
      expenseAt: formData.get("expenseAt"),
      method: formData.get("method") || undefined,
      paymentReference: formData.get("paymentReference"),
      attachmentRef: formData.get("attachmentRef"),
    });
  if (!parsed.success) return back("/app/expenses?error=INVALID_INPUT");

  // Idempotence applicative : une clé par soumission de formulaire.
  const res = await createExpense(ctx(tenant), {
    ...parsed.data,
    academicYearId: parsed.data.academicYearId || undefined,
    expenseAt: new Date(`${parsed.data.expenseAt}T00:00:00Z`),
    idempotencyKey: randomUUID(),
  });
  back(res.ok ? "/app/expenses?ok=expense" : `/app/expenses?error=${res.error}`);
}

export async function updateExpenseAction(formData: FormData) {
  const tenant = await requireSchoolPermission("expenses.create");
  const parsed = z
    .object({
      id: idField,
      label: requiredText.max(200).optional(),
      amount: intField.refine((v) => v > 0).optional(),
      beneficiary: requiredText.max(200).optional(),
      expenseAt: dateField.optional(),
      paymentReference: optionalText,
      attachmentRef: optionalText,
    })
    .safeParse({
      id: formData.get("id"),
      label: formData.get("label") || undefined,
      amount: formData.get("amount") || undefined,
      beneficiary: formData.get("beneficiary") || undefined,
      expenseAt: formData.get("expenseAt") || undefined,
      paymentReference: formData.get("paymentReference"),
      attachmentRef: formData.get("attachmentRef"),
    });
  if (!parsed.success) return back("/app/expenses?error=INVALID_INPUT");
  const { id, expenseAt, ...rest } = parsed.data;
  const res = await updateExpense(ctx(tenant), id, {
    ...rest,
    ...(expenseAt ? { expenseAt: new Date(`${expenseAt}T00:00:00Z`) } : {}),
  });
  back(res.ok ? "/app/expenses?ok=updated" : `/app/expenses?error=${res.error}`);
}

export async function payExpenseAction(formData: FormData) {
  const tenant = await requireSchoolPermission("expenses.pay");
  const parsed = z
    .object({
      id: idField,
      method: paymentMethodSchema,
      paidAt: dateField.optional(),
      paymentReference: optionalText,
    })
    .safeParse({
      id: formData.get("id"),
      method: formData.get("method"),
      paidAt: formData.get("paidAt") || undefined,
      paymentReference: formData.get("paymentReference"),
    });
  if (!parsed.success) return back("/app/expenses?error=INVALID_INPUT");
  const { id, paidAt, ...rest } = parsed.data;
  const res = await payExpense(ctx(tenant), id, {
    ...rest,
    ...(paidAt ? { paidAt: new Date(`${paidAt}T00:00:00Z`) } : {}),
  });
  back(
    res.ok
      ? "/app/expenses?ok=expense_paid"
      : `/app/expenses?error=${res.error}`,
  );
}

export async function cancelExpenseAction(formData: FormData) {
  const tenant = await requireSchoolPermission("expenses.cancel");
  const parsed = z
    .object({ id: idField, reason: requiredText.max(300) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/app/expenses?error=INVALID_INPUT");
  const res = await cancelExpense(ctx(tenant), parsed.data.id, {
    reason: parsed.data.reason,
  });
  back(
    res.ok
      ? "/app/expenses?ok=expense_cancelled"
      : `/app/expenses?error=${res.error}`,
  );
}
