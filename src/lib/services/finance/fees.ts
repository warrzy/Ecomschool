import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { FeePaymentPlan } from "@prisma/client";

export type FeesError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type FeesResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: FeesError };

type SchoolCtx = { userId: string; schoolId: string };

// ---------- Catégories de frais ----------

export const DEFAULT_FEE_CATEGORIES = [
  { code: "INSCRIPTION", label: "Frais d'inscription" },
  { code: "REINSCRIPTION", label: "Frais de réinscription" },
  { code: "SCOLARITE", label: "Scolarité" },
  { code: "CANTINE", label: "Cantine" },
  { code: "TRANSPORT", label: "Transport" },
  { code: "UNIFORME", label: "Uniformes" },
  { code: "EXAMEN", label: "Examens" },
  { code: "ACTIVITES", label: "Activités" },
] as const;

export async function ensureDefaultFeeCategories(ctx: SchoolCtx) {
  await prisma.feeCategory.createMany({
    data: DEFAULT_FEE_CATEGORIES.map((c) => ({
      schoolId: ctx.schoolId,
      code: c.code,
      label: c.label,
    })),
    skipDuplicates: true,
  });
  return prisma.feeCategory.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    orderBy: { label: "asc" },
  });
}

export async function createFeeCategory(
  ctx: SchoolCtx,
  input: { code: string; label: string; description?: string },
): Promise<FeesResult<{ id: string }>> {
  const code = input.code.trim().toUpperCase();
  if (!code || !input.label.trim()) return { ok: false, error: "INVALID_INPUT" };
  const dup = await prisma.feeCategory.findFirst({
    where: { schoolId: ctx.schoolId, code },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "DUPLICATE" };
  try {
    const c = await prisma.feeCategory.create({
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
      action: "finance.category.create",
      entity: "FeeCategory",
      entityId: c.id,
      metadata: { code },
    });
    return { ok: true, result: c };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function setFeeCategoryStatus(
  ctx: SchoolCtx,
  id: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<FeesResult> {
  const c = await prisma.feeCategory.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!c) return { ok: false, error: "NOT_FOUND" };
  await prisma.feeCategory.update({ where: { id }, data: { status } });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: `finance.category.${status.toLowerCase()}`,
    entity: "FeeCategory",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

export async function listFeeCategories(ctx: SchoolCtx) {
  return prisma.feeCategory.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { label: "asc" },
  });
}

// ---------- Tarifs (historisés : modifier le montant archive l'ancien) ----------

export async function createFeeTariff(
  ctx: SchoolCtx,
  input: {
    academicYearId: string;
    categoryId: string;
    levelId?: string;
    classroomId?: string;
    amount: number;
    mandatory?: boolean;
    paymentPlan?: FeePaymentPlan;
    installmentCount?: number;
    effectiveFrom?: Date;
    conditions?: string;
  },
): Promise<FeesResult<{ id: string }>> {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const [year, category] = await Promise.all([
    prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.feeCategory.findFirst({
      where: { id: input.categoryId, schoolId: ctx.schoolId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  if (!year || !category) return { ok: false, error: "NOT_FOUND" };
  if (input.levelId) {
    const l = await prisma.level.findFirst({
      where: { id: input.levelId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!l) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.classroomId) {
    const cl = await prisma.classroom.findFirst({
      where: { id: input.classroomId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!cl) return { ok: false, error: "NOT_FOUND" };
  }
  try {
    const t = await prisma.feeTariff.create({
      data: {
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
        categoryId: input.categoryId,
        levelId: input.levelId ?? null,
        classroomId: input.classroomId ?? null,
        amount: input.amount,
        mandatory: input.mandatory ?? true,
        paymentPlan: input.paymentPlan ?? "SINGLE",
        installmentCount:
          input.paymentPlan === "INSTALLMENTS"
            ? Math.max(1, input.installmentCount ?? 1)
            : 1,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        conditions: input.conditions?.trim() || null,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.tariff.create",
      entity: "FeeTariff",
      entityId: t.id,
      metadata: { categoryId: input.categoryId, amount: input.amount },
    });
    return { ok: true, result: t };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Modification d'un tarif : si le montant change, l'ancien tarif est archivé
 * (historique conservé) et un nouveau créé. Les créances déjà établies
 * conservent leur montant figé.
 */
export async function updateFeeTariff(
  ctx: SchoolCtx,
  id: string,
  input: { amount?: number; mandatory?: boolean; conditions?: string },
): Promise<FeesResult<{ id: string }>> {
  const t = await prisma.feeTariff.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!t) return { ok: false, error: "NOT_FOUND" };
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount < 0)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (input.amount !== undefined && input.amount !== t.amount) {
    const res = await prisma.$transaction(async (tx) => {
      await tx.feeTariff.update({ where: { id: t.id }, data: { status: "ARCHIVED" } });
      return tx.feeTariff.create({
        data: {
          schoolId: t.schoolId,
          academicYearId: t.academicYearId,
          categoryId: t.categoryId,
          levelId: t.levelId,
          classroomId: t.classroomId,
          amount: input.amount!,
          mandatory: input.mandatory ?? t.mandatory,
          paymentPlan: t.paymentPlan,
          installmentCount: t.installmentCount,
          effectiveFrom: new Date(),
          conditions: input.conditions?.trim() || t.conditions,
        },
        select: { id: true },
      });
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.tariff.reprice",
      entity: "FeeTariff",
      entityId: res.id,
      metadata: { previousTariffId: t.id, oldAmount: t.amount, newAmount: input.amount },
    });
    return { ok: true, result: res };
  }

  await prisma.feeTariff.update({
    where: { id: t.id },
    data: {
      ...(input.mandatory !== undefined ? { mandatory: input.mandatory } : {}),
      ...(input.conditions !== undefined
        ? { conditions: input.conditions.trim() || null }
        : {}),
    },
  });
  return { ok: true, result: { id: t.id } };
}

export async function listFeeTariffs(
  ctx: SchoolCtx,
  filters: { academicYearId?: string; includeArchived?: boolean } = {},
) {
  return prisma.feeTariff.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      ...(filters.includeArchived ? {} : { status: "ACTIVE" }),
    },
    include: {
      category: { select: { code: true, label: true } },
      level: { select: { name: true } },
      classroom: { select: { name: true } },
    },
    orderBy: [{ category: { label: "asc" } }, { createdAt: "desc" }],
  });
}
