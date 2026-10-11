import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { BillingCycle, SubscriptionEventType, SubscriptionStatus } from "@prisma/client";

export type SubsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type SubsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: SubsError };

const TERMINAL: SubscriptionStatus[] = ["CANCELLED", "EXPIRED"];

async function addEvent(
  subscriptionId: string,
  type: SubscriptionEventType,
  opts: { actorId?: string; note?: string; fromPlanId?: string; toPlanId?: string } = {},
) {
  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId,
      type,
      actorId: opts.actorId ?? null,
      note: opts.note ?? null,
      fromPlanId: opts.fromPlanId ?? null,
      toPlanId: opts.toPlanId ?? null,
    },
  });
}

function periodEnd(start: Date, cycle: BillingCycle) {
  const d = new Date(start);
  if (cycle === "YEARLY") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Attribue un abonnement à une école. L'ancien est résilié (historique conservé). */
export async function assignSubscription(
  actorUserId: string,
  input: {
    schoolId: string;
    planId: string;
    cycle?: BillingCycle;
    trialDays?: number;
    startTrial?: boolean;
  },
): Promise<SubsResult<{ id: string }>> {
  const [school, plan] = await Promise.all([
    prisma.school.findUnique({ where: { id: input.schoolId }, select: { id: true } }),
    prisma.subscriptionPlan.findFirst({
      where: { id: input.planId, status: "ACTIVE" },
    }),
  ]);
  if (!school || !plan) return { ok: false, error: "NOT_FOUND" };

  const now = new Date();
  const trialDays = input.trialDays ?? plan.trialDays;
  const startTrial = input.startTrial ?? trialDays > 0;
  const cycle = input.cycle ?? "MONTHLY";
  const periodEndDate = periodEnd(now, cycle);
  const trialEndsAt = startTrial
    ? new Date(now.getTime() + trialDays * 86400000)
    : null;

  try {
    const sub = await prisma.$transaction(async (tx) => {
      // Résilier l'abonnement courant non terminal (conservé dans l'historique)
      const current = await tx.schoolSubscription.findFirst({
        where: { schoolId: input.schoolId, status: { notIn: TERMINAL } },
        orderBy: { createdAt: "desc" },
      });
      if (current) {
        await tx.schoolSubscription.update({
          where: { id: current.id },
          data: { status: "CANCELLED", cancelledAt: now, endedAt: now },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: current.id,
            type: "CANCELLED",
            actorId: actorUserId,
            note: "Remplacé par un nouvel abonnement",
          },
        });
      }

      const created = await tx.schoolSubscription.create({
        data: {
          schoolId: input.schoolId,
          planId: plan.id,
          cycle,
          status: startTrial ? "TRIALING" : "ACTIVE",
          startedAt: now,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: startTrial ? (trialEndsAt as Date) : periodEndDate,
          graceEndsAt: null,
          createdById: actorUserId,
        },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: created.id,
          type: startTrial ? "TRIAL_STARTED" : "ACTIVATED",
          actorId: actorUserId,
          toPlanId: plan.id,
          note: `Offre ${plan.name}`,
        },
      });
      return created;
    });
    await logAudit({
      actorId: actorUserId,
      schoolId: input.schoolId,
      action: "platform.subscription.assign",
      entity: "SchoolSubscription",
      entityId: sub.id,
      metadata: { planId: plan.id, cycle, trial: startTrial },
    });
    return { ok: true, result: { id: sub.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

async function transition(
  actorUserId: string | null,
  subscriptionId: string,
  expected: string[],
  type: SubscriptionEventType,
  patch: Record<string, unknown>,
  auditAction: string,
  note?: string,
): Promise<SubsResult> {
  const sub = await prisma.schoolSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, status: true, schoolId: true },
  });
  if (!sub) return { ok: false, error: "NOT_FOUND" };
  if (!expected.includes(sub.status)) return { ok: false, error: "INVALID_STATUS" };

  await prisma.schoolSubscription.update({
    where: { id: subscriptionId },
    data: patch,
  });
  await addEvent(subscriptionId, type, { actorId: actorUserId ?? undefined, note });
  await logAudit({
    actorId: actorUserId ?? undefined,
    schoolId: sub.schoolId,
    action: auditAction,
    entity: "SchoolSubscription",
    entityId: subscriptionId,
    metadata: { from: sub.status },
  });
  return { ok: true, result: undefined };
}

export async function changePlan(
  actorUserId: string,
  input: { subscriptionId: string; planId: string; note?: string },
): Promise<SubsResult> {
  const [sub, plan] = await Promise.all([
    prisma.schoolSubscription.findUnique({
      where: { id: input.subscriptionId },
      select: { id: true, status: true, schoolId: true, planId: true },
    }),
    prisma.subscriptionPlan.findFirst({
      where: { id: input.planId, status: "ACTIVE" },
    }),
  ]);
  if (!sub || !plan) return { ok: false, error: "NOT_FOUND" };
  if (TERMINAL.includes(sub.status)) return { ok: false, error: "INVALID_STATUS" };

  // Jamais de suppression de données lors d'un déclassement.
  await prisma.schoolSubscription.update({
    where: { id: sub.id },
    data: { planId: plan.id },
  });
  await addEvent(sub.id, "PLAN_CHANGED", {
    actorId: actorUserId,
    note: input.note ?? `Offre → ${plan.name}`,
    fromPlanId: sub.planId,
    toPlanId: plan.id,
  });
  await logAudit({
    actorId: actorUserId,
    schoolId: sub.schoolId,
    action: "platform.subscription.plan_change",
    entity: "SchoolSubscription",
    entityId: sub.id,
    metadata: { fromPlanId: sub.planId, toPlanId: plan.id },
  });
  return { ok: true, result: undefined };
}

export async function extendTrial(
  actorUserId: string,
  input: { subscriptionId: string; days: number },
): Promise<SubsResult> {
  if (input.days <= 0 || input.days > 365) return { ok: false, error: "INVALID_INPUT" };
  const sub = await prisma.schoolSubscription.findUnique({
    where: { id: input.subscriptionId },
    select: { id: true, status: true, trialEndsAt: true },
  });
  if (!sub) return { ok: false, error: "NOT_FOUND" };
  if (sub.status !== "TRIALING" || !sub.trialEndsAt) {
    return { ok: false, error: "INVALID_STATUS" };
  }
  const newEnd = new Date(sub.trialEndsAt.getTime() + input.days * 86400000);
  await prisma.schoolSubscription.update({
    where: { id: sub.id },
    data: { trialEndsAt: newEnd, currentPeriodEnd: newEnd },
  });
  await addEvent(sub.id, "TRIAL_EXTENDED", {
    actorId: actorUserId,
    note: `+${input.days} jours`,
  });
  return { ok: true, result: undefined };
}

export async function renewSubscription(
  actorUserId: string,
  subscriptionId: string,
): Promise<SubsResult> {
  const sub = await prisma.schoolSubscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!sub) return { ok: false, error: "NOT_FOUND" };
  if (TERMINAL.includes(sub.status)) return { ok: false, error: "INVALID_STATUS" };
  const start = new Date();
  await prisma.schoolSubscription.update({
    where: { id: sub.id },
    data: {
      status: "ACTIVE",
      currentPeriodStart: start,
      currentPeriodEnd: periodEnd(start, sub.cycle),
      trialEndsAt: null,
      graceEndsAt: null,
      suspendedAt: null,
    },
  });
  await addEvent(sub.id, "RENEWED", { actorId: actorUserId });
  return { ok: true, result: undefined };
}

export async function suspendSubscription(actorUserId: string, subscriptionId: string, note?: string) {
  return transition(
    actorUserId,
    subscriptionId,
    ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"],
    "SUSPENDED",
    { status: "SUSPENDED", suspendedAt: new Date() },
    "platform.subscription.suspend",
    note,
  );
}

export async function reactivateSubscription(actorUserId: string, subscriptionId: string) {
  const sub = await prisma.schoolSubscription.findUnique({
    where: { id: subscriptionId },
    select: { status: true, currentPeriodEnd: true, cycle: true },
  });
  if (!sub) return { ok: false, error: "NOT_FOUND" };
  if (sub.status !== "SUSPENDED") return { ok: false, error: "INVALID_STATUS" };
  // Réactivation : si la période est dépassée, on repart sur une nouvelle période.
  const now = new Date();
  const start = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  const patch =
    sub.currentPeriodEnd > now
      ? { status: "ACTIVE" as const, suspendedAt: null, graceEndsAt: null }
      : {
          status: "ACTIVE" as const,
          suspendedAt: null,
          graceEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd(start, sub.cycle),
        };
  return transition(
    actorUserId,
    subscriptionId,
    ["SUSPENDED"],
    "REACTIVATED",
    patch,
    "platform.subscription.reactivate",
  );
}

export async function cancelSubscription(actorUserId: string, subscriptionId: string, note?: string) {
  return transition(
    actorUserId,
    subscriptionId,
    ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED"],
    "CANCELLED",
    { status: "CANCELLED", cancelledAt: new Date(), endedAt: new Date() },
    "platform.subscription.cancel",
    note,
  );
}

/**
 * Balayage du cycle de vie (idempotent, appelable par tâche planifiée) :
 * TRIALING/ACTIVE dont la période est dépassée → GRACE (fin = fin de période + graceDays du plan)
 * GRACE échue → SUSPENDED (données conservées, lecture seule)
 * SUSPENDED depuis > 90 jours → EXPIRED
 */
export async function sweepSubscriptions() {
  const now = new Date();
  const expiredPeriods = await prisma.schoolSubscription.findMany({
    where: {
      status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
      currentPeriodEnd: { lt: now },
    },
    include: { plan: { select: { graceDays: true } } },
  });
  let graceStarted = 0;
  let suspended = 0;
  let expired = 0;
  let pastDue = 0;

  for (const sub of expiredPeriods) {
    const graceEnd = new Date(
      sub.currentPeriodEnd.getTime() + (sub.plan.graceDays ?? 7) * 86400000,
    );
    const stillInGrace = graceEnd > now;
    await prisma.schoolSubscription.update({
      where: { id: sub.id },
      data: { status: "GRACE", graceEndsAt: graceEnd },
    });
    await addEvent(sub.id, sub.status === "PAST_DUE" ? "GRACE_STARTED" : "PAST_DUE", {
      note: `Échéance ${sub.currentPeriodEnd.toISOString().slice(0, 10)}`,
    });
    if (stillInGrace) graceStarted++;
    else suspended++; // sera basculé ci-dessous
    if (sub.status !== "PAST_DUE") pastDue++;
  }

  const staleGrace = await prisma.schoolSubscription.findMany({
    where: { status: "GRACE", graceEndsAt: { lt: now } },
    select: { id: true, schoolId: true },
  });
  for (const sub of staleGrace) {
    await prisma.schoolSubscription.update({
      where: { id: sub.id },
      data: { status: "SUSPENDED", suspendedAt: now },
    });
    await addEvent(sub.id, "SUSPENDED", { note: "Fin de la période de grâce" });
    suspended++;
  }

  const retention = new Date(now.getTime() - 90 * 86400000);
  const staleSuspended = await prisma.schoolSubscription.findMany({
    where: { status: "SUSPENDED", suspendedAt: { lt: retention } },
    select: { id: true },
  });
  for (const sub of staleSuspended) {
    await prisma.schoolSubscription.update({
      where: { id: sub.id },
      data: { status: "EXPIRED", endedAt: now },
    });
    await addEvent(sub.id, "EXPIRED", { note: "Suspension > 90 jours" });
    expired++;
  }

  return { graceStarted, suspended, expired, pastDue };
}

// ---------- Demandes de changement d'offre (côté école) ----------

export async function requestPlanChange(
  ctx: { userId: string; schoolId: string },
  input: { planId: string; note?: string },
): Promise<SubsResult<{ id: string }>> {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { id: input.planId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!plan) return { ok: false, error: "NOT_FOUND" };
  const pending = await prisma.subscriptionChangeRequest.findFirst({
    where: { schoolId: ctx.schoolId, status: "PENDING" },
    select: { id: true },
  });
  if (pending) return { ok: false, error: "INVALID_STATUS" };

  const sub = await prisma.schoolSubscription.findFirst({
    where: { schoolId: ctx.schoolId, status: { notIn: TERMINAL } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  try {
    const req = await prisma.subscriptionChangeRequest.create({
      data: {
        schoolId: ctx.schoolId,
        subscriptionId: sub?.id ?? null,
        requestedPlanId: plan.id,
        note: input.note?.trim() || null,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "subscription.change_request",
      entity: "SubscriptionChangeRequest",
      entityId: req.id,
      metadata: { planId: plan.id },
    });
    return { ok: true, result: req };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function reviewChangeRequest(
  actorUserId: string,
  input: { requestId: string; approve: boolean; note?: string },
): Promise<SubsResult> {
  const req = await prisma.subscriptionChangeRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!req) return { ok: false, error: "NOT_FOUND" };
  if (req.status !== "PENDING") return { ok: false, error: "INVALID_STATUS" };

  await prisma.subscriptionChangeRequest.update({
    where: { id: req.id },
    data: {
      status: input.approve ? "APPROVED" : "REJECTED",
      reviewedById: actorUserId,
      reviewedAt: new Date(),
    },
  });
  if (input.approve && req.subscriptionId) {
    await changePlan(actorUserId, {
      subscriptionId: req.subscriptionId,
      planId: req.requestedPlanId,
      note: `Demande école approuvée${req.note ? ` — ${req.note}` : ""}`,
    });
  }
  await logAudit({
    actorId: actorUserId,
    schoolId: req.schoolId,
    action: `platform.change_request.${input.approve ? "approve" : "reject"}`,
    entity: "SubscriptionChangeRequest",
    entityId: req.id,
  });
  return { ok: true, result: undefined };
}

export async function listChangeRequests(status?: "PENDING" | "APPROVED" | "REJECTED") {
  return prisma.subscriptionChangeRequest.findMany({
    where: status ? { status } : {},
    include: {
      school: { select: { name: true, code: true } },
      requestedPlan: { select: { name: true, code: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
