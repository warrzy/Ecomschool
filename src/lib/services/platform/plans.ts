import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type PlansResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: "INVALID_INPUT" | "NOT_FOUND" | "DUPLICATE" | "CREATE_FAILED" | "UPDATE_FAILED" };

export async function listPlans(includeArchived = false) {
  return prisma.subscriptionPlan.findMany({
    where: includeArchived ? {} : { status: "ACTIVE" },
    include: { modules: { include: { module: { select: { code: true, name: true } } } } },
    orderBy: { monthlyPrice: "asc" },
  });
}

/** Offres commercialisables affichées sur les pages publiques (/tarifs, /, /inscription). */
export async function listPublicPlans() {
  return prisma.subscriptionPlan.findMany({
    where: { status: "ACTIVE", commercial: true },
    include: { modules: { include: { module: { select: { code: true, name: true } } } } },
    orderBy: { monthlyPrice: "asc" },
  });
}

export async function getPlan(id: string) {
  return prisma.subscriptionPlan.findUnique({
    where: { id },
    include: { modules: { include: { module: true } } },
  });
}

export async function createPlan(
  actorUserId: string,
  input: {
    code: string;
    name: string;
    description?: string;
    monthlyPrice: number;
    yearlyPrice: number;
    maxStudents?: number | null;
    maxUsers?: number | null;
    trialDays?: number;
    graceDays?: number;
    moduleCodes: string[];
  },
): Promise<PlansResult<{ id: string }>> {
  const code = input.code.trim().toUpperCase();
  if (!code || !input.name.trim()) return { ok: false, error: "INVALID_INPUT" };
  if (!Number.isInteger(input.monthlyPrice) || input.monthlyPrice < 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const dup = await prisma.subscriptionPlan.findUnique({ where: { code } });
  if (dup) return { ok: false, error: "DUPLICATE" };

  const modules = await prisma.platformModule.findMany({
    where: { code: { in: input.moduleCodes } },
    select: { id: true },
  });
  try {
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        monthlyPrice: input.monthlyPrice,
        yearlyPrice: Math.trunc(input.yearlyPrice),
        maxStudents: input.maxStudents ?? null,
        maxUsers: input.maxUsers ?? null,
        trialDays: input.trialDays ?? 0,
        graceDays: input.graceDays ?? 7,
        modules: { create: modules.map((m) => ({ moduleId: m.id })) },
      },
      select: { id: true },
    });
    await logAudit({
      actorId: actorUserId,
      action: "platform.plan.create",
      entity: "SubscriptionPlan",
      entityId: plan.id,
      metadata: { code },
    });
    return { ok: true, result: plan };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updatePlan(
  actorUserId: string,
  id: string,
  input: {
    name?: string;
    description?: string;
    monthlyPrice?: number;
    yearlyPrice?: number;
    maxStudents?: number | null;
    maxUsers?: number | null;
    trialDays?: number;
    graceDays?: number;
    moduleCodes?: string[];
    status?: "ACTIVE" | "ARCHIVED";
  },
): Promise<PlansResult> {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscriptionPlan.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description.trim() || null }
            : {}),
          ...(input.monthlyPrice !== undefined
            ? { monthlyPrice: Math.trunc(input.monthlyPrice) }
            : {}),
          ...(input.yearlyPrice !== undefined
            ? { yearlyPrice: Math.trunc(input.yearlyPrice) }
            : {}),
          ...(input.maxStudents !== undefined ? { maxStudents: input.maxStudents } : {}),
          ...(input.maxUsers !== undefined ? { maxUsers: input.maxUsers } : {}),
          ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
          ...(input.graceDays !== undefined ? { graceDays: input.graceDays } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });
      if (input.moduleCodes) {
        const modules = await tx.platformModule.findMany({
          where: { code: { in: input.moduleCodes } },
          select: { id: true },
        });
        await tx.planModule.deleteMany({ where: { planId: id } });
        await tx.planModule.createMany({
          data: modules.map((m) => ({ planId: id, moduleId: m.id })),
        });
      }
    });
    await logAudit({
      actorId: actorUserId,
      action: "platform.plan.update",
      entity: "SubscriptionPlan",
      entityId: id,
      metadata: { moduleCodes: input.moduleCodes },
    });
    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
