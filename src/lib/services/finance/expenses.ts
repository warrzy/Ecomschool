import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { ExpenseStatus, PaymentMethod } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type ExpensesError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "DUPLICATE"
  | "CLOSED_DAY"
  | "YEAR_CLOSED"
  | "ALREADY_PAID"
  | "ALREADY_CANCELLED"
  | "IDEMPOTENCY_CONFLICT"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type ExpensesResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ExpensesError };

type SchoolCtx = { userId: string; schoolId: string };

function dayBounds(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
  );
}

// ---------- Catégories de dépenses ----------

export const DEFAULT_EXPENSE_CATEGORIES = [
  { code: "FONCTIONNEMENT", label: "Fonctionnement" },
  { code: "SALAIRES", label: "Salaires et indemnités" },
  { code: "FOURNITURES", label: "Fournitures et matériels" },
  { code: "MAINTENANCE", label: "Maintenance et services" },
  { code: "DIVERS", label: "Autres décaissements" },
] as const;

export async function ensureDefaultExpenseCategories(ctx: SchoolCtx) {
  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      schoolId: ctx.schoolId,
      code: c.code,
      label: c.label,
    })),
    skipDuplicates: true,
  });
  return prisma.expenseCategory.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    orderBy: { label: "asc" },
  });
}

export async function createExpenseCategory(
  ctx: SchoolCtx,
  input: { code: string; label: string; description?: string },
): Promise<ExpensesResult<{ id: string }>> {
  const code = input.code.trim().toUpperCase();
  if (!code || !input.label.trim()) return { ok: false, error: "INVALID_INPUT" };
  const dup = await prisma.expenseCategory.findFirst({
    where: { schoolId: ctx.schoolId, code },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "DUPLICATE" };
  try {
    const c = await prisma.expenseCategory.create({
      data: {
        schoolId: ctx.schoolId,
        code,
        label: input.label.trim(),
        description: input.description?.trim() || null,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "expenses.category.create",
      entity: "ExpenseCategory",
      entityId: c.id,
      metadata: { code },
    });
    return { ok: true, result: c };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function setExpenseCategoryStatus(
  ctx: SchoolCtx,
  id: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<ExpensesResult> {
  const c = await prisma.expenseCategory.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!c) return { ok: false, error: "NOT_FOUND" };
  await prisma.expenseCategory.update({ where: { id }, data: { status } });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: `expenses.category.${status.toLowerCase()}`,
    entity: "ExpenseCategory",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

export async function listExpenseCategories(
  ctx: SchoolCtx,
  filters: { includeArchived?: boolean } = {},
) {
  return prisma.expenseCategory.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.includeArchived ? {} : { status: "ACTIVE" }),
    },
    orderBy: { label: "asc" },
  });
}

// ---------- Dépenses ----------

/**
 * Crée une dépense (DRAFT). Idempotente via `idempotencyKey` (unique par école).
 * Le rattachement à une année est facultatif ; une année CLOSED refuse
 * toute nouvelle dépense rattachée (YEAR_CLOSED).
 */
export async function createExpense(
  ctx: SchoolCtx,
  input: {
    categoryId: string;
    academicYearId?: string;
    label: string;
    amount: number;
    beneficiary: string;
    expenseAt?: Date;
    method?: PaymentMethod;
    paymentReference?: string;
    attachmentRef?: string;
    idempotencyKey?: string;
  },
): Promise<ExpensesResult<{ id: string }>> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!input.label.trim() || !input.beneficiary.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const category = await prisma.expenseCategory.findFirst({
    where: { id: input.categoryId, schoolId: ctx.schoolId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!category) return { ok: false, error: "NOT_FOUND" };

  if (input.academicYearId) {
    const year = await prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    });
    if (!year) return { ok: false, error: "NOT_FOUND" };
    if (year.status === "CLOSED") return { ok: false, error: "YEAR_CLOSED" };
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  if (input.idempotencyKey) {
    const existing = await prisma.expense.findFirst({
      where: { schoolId: ctx.schoolId, idempotencyKey: input.idempotencyKey },
      select: { id: true, categoryId: true, label: true, amount: true, beneficiary: true },
    });
    if (existing) {
      // Rejeu strict : la clé ne renvoie l'existant que si le contenu est
      // identique. Une clé réutilisée avec d'autres données est refusée.
      const same =
        existing.categoryId === input.categoryId &&
        existing.label === input.label.trim() &&
        existing.amount === input.amount &&
        existing.beneficiary === input.beneficiary.trim();
      if (!same) return { ok: false, error: "IDEMPOTENCY_CONFLICT" };
      return { ok: true, result: existing };
    }
  }

  try {
    const e = await prisma.expense.create({
      data: {
        schoolId: ctx.schoolId,
        categoryId: input.categoryId,
        academicYearId: input.academicYearId ?? null,
        label: input.label.trim(),
        amount: input.amount,
        beneficiary: input.beneficiary.trim(),
        expenseAt: input.expenseAt ?? new Date(),
        method: input.method ?? null,
        paymentReference: input.paymentReference?.trim() || null,
        attachmentRef: input.attachmentRef?.trim() || null,
        recordedById: ctx.userId,
        idempotencyKey,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "expenses.expense.create",
      entity: "Expense",
      entityId: e.id,
      metadata: { categoryId: input.categoryId, amount: input.amount },
    });
    return { ok: true, result: e };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await prisma.expense.findFirst({
        where: { schoolId: ctx.schoolId, idempotencyKey },
        select: { id: true, categoryId: true, label: true, amount: true, beneficiary: true },
      });
      if (existing) {
        const same =
          existing.categoryId === input.categoryId &&
          existing.label === input.label.trim() &&
          existing.amount === input.amount &&
          existing.beneficiary === input.beneficiary.trim();
        return same
          ? { ok: true, result: existing }
          : { ok: false, error: "IDEMPOTENCY_CONFLICT" };
      }
    }
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Modification des champs descriptifs d'une dépense DRAFT uniquement.
 * Une dépense PAID ou CANCELLED est immuable (annulation motivée pour sortir).
 */
export async function updateExpense(
  ctx: SchoolCtx,
  id: string,
  input: {
    categoryId?: string;
    academicYearId?: string | null;
    label?: string;
    amount?: number;
    beneficiary?: string;
    expenseAt?: Date;
    method?: PaymentMethod;
    paymentReference?: string;
    attachmentRef?: string;
  },
): Promise<ExpensesResult> {
  const e = await prisma.expense.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!e) return { ok: false, error: "NOT_FOUND" };
  if (e.status !== "DRAFT") return { ok: false, error: "FORBIDDEN" };

  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount <= 0)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.label !== undefined && !input.label.trim()) return { ok: false, error: "INVALID_INPUT" };
  if (input.beneficiary !== undefined && !input.beneficiary.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (input.categoryId) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id: input.categoryId, schoolId: ctx.schoolId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!category) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.academicYearId) {
    const year = await prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    });
    if (!year) return { ok: false, error: "NOT_FOUND" };
    if (year.status === "CLOSED") return { ok: false, error: "YEAR_CLOSED" };
  }

  await prisma.expense.update({
    where: { id: e.id },
    data: {
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.academicYearId !== undefined
        ? { academicYearId: input.academicYearId }
        : {}),
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.beneficiary !== undefined
        ? { beneficiary: input.beneficiary.trim() }
        : {}),
      ...(input.expenseAt !== undefined ? { expenseAt: input.expenseAt } : {}),
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.paymentReference !== undefined
        ? { paymentReference: input.paymentReference.trim() || null }
        : {}),
      ...(input.attachmentRef !== undefined
        ? { attachmentRef: input.attachmentRef.trim() || null }
        : {}),
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "expenses.expense.update",
    entity: "Expense",
    entityId: e.id,
  });
  return { ok: true, result: undefined };
}

/**
 * Marque une dépense DRAFT comme payée : `method` requis, `paidAt` figé.
 * Refusé si le jour de paiement est déjà clôturé (CashClosure).
 */
export async function payExpense(
  ctx: SchoolCtx,
  id: string,
  input: { method: PaymentMethod; paidAt?: Date; paymentReference?: string },
): Promise<ExpensesResult> {
  if (!input.method) return { ok: false, error: "INVALID_INPUT" };
  const e = await prisma.expense.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!e) return { ok: false, error: "NOT_FOUND" };
  if (e.status === "PAID") return { ok: false, error: "ALREADY_PAID" };
  if (e.status === "CANCELLED") return { ok: false, error: "ALREADY_CANCELLED" };

  const paidAt = input.paidAt ?? new Date();
  const { start, end } = dayBounds(paidAt);
  const closure = await prisma.cashClosure.findFirst({
    where: { schoolId: ctx.schoolId, date: { gte: start, lt: end } },
    select: { id: true },
  });
  if (closure) return { ok: false, error: "CLOSED_DAY" };

  await prisma.expense.update({
    where: { id: e.id },
    data: {
      status: "PAID",
      method: input.method,
      paidAt,
      ...(input.paymentReference !== undefined
        ? { paymentReference: input.paymentReference.trim() || null }
        : {}),
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "expenses.expense.pay",
    entity: "Expense",
    entityId: e.id,
    metadata: { method: input.method, paidAt },
  });
  return { ok: true, result: undefined };
}

/**
 * Annulation motivée d'une dépense (DRAFT ou PAID). Non destructive :
 * le décaissement initial et son annulation restent tracés.
 */
export async function cancelExpense(
  ctx: SchoolCtx,
  id: string,
  input: { reason: string },
): Promise<ExpensesResult> {
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const e = await prisma.expense.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!e) return { ok: false, error: "NOT_FOUND" };
  if (e.status === "CANCELLED") return { ok: false, error: "ALREADY_CANCELLED" };

  await prisma.expense.update({
    where: { id: e.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: ctx.userId,
      cancelReason: input.reason.trim(),
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "expenses.expense.cancel",
    entity: "Expense",
    entityId: e.id,
    metadata: { reason: input.reason.trim() },
  });
  return { ok: true, result: undefined };
}

export async function listExpenses(
  ctx: SchoolCtx,
  filters: {
    academicYearId?: string;
    categoryId?: string;
    status?: ExpenseStatus;
    from?: Date;
    to?: Date;
  } = {},
) {
  return prisma.expense.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            expenseAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    include: {
      category: { select: { code: true, label: true } },
      academicYear: { select: { name: true } },
    },
    orderBy: [{ expenseAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

export async function getExpense(ctx: SchoolCtx, id: string) {
  return prisma.expense.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      category: { select: { code: true, label: true } },
      academicYear: { select: { name: true } },
    },
  });
}
