import type { Prisma, SignupRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type SignupRequestsResult<T = undefined> =
  | { ok: true; result: T }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "ALREADY_CONVERTED"
        | "UPDATE_FAILED";
    };

const REQUEST_INCLUDE = {
  requestedPlan: { select: { code: true, name: true } },
  convertedSchool: { select: { id: true, name: true, code: true } },
} satisfies Prisma.SchoolSignupRequestInclude;

export async function listSignupRequests(status?: SignupRequestStatus) {
  return prisma.schoolSignupRequest.findMany({
    where: status ? { status } : {},
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getSignupRequest(id: string) {
  return prisma.schoolSignupRequest.findUnique({
    where: { id },
    include: REQUEST_INCLUDE,
  });
}

/**
 * Création d'une demande depuis le formulaire public.
 * Aucun School/User n'est créé — statut PENDING uniquement.
 * Anti-doublon : refuse si une demande active (PENDING/CONTACTED/APPROVED)
 * existe déjà pour le même email de contact ou le même nom d'établissement.
 */
export async function createSignupRequest(input: {
  schoolName: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  planCode?: string;
  note?: string;
}): Promise<
  | { ok: true; result: { id: string } }
  | { ok: false; error: "DUPLICATE" | "PLAN_NOT_FOUND" | "CREATE_FAILED" }
> {
  const existing = await prisma.schoolSignupRequest.findFirst({
    where: {
      status: { in: ["PENDING", "CONTACTED", "APPROVED"] },
      OR: [
        { contactEmail: input.contactEmail },
        { schoolName: { equals: input.schoolName, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "DUPLICATE" };

  let requestedPlanId: string | undefined;
  if (input.planCode) {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { code: input.planCode },
      select: { id: true, status: true },
    });
    if (!plan || plan.status !== "ACTIVE") {
      return { ok: false, error: "PLAN_NOT_FOUND" };
    }
    requestedPlanId = plan.id;
  }

  try {
    const created = await prisma.schoolSignupRequest.create({
      data: {
        schoolName: input.schoolName,
        city: input.city || null,
        country: input.country || null,
        phone: input.phone || null,
        email: input.email || null,
        website: input.website || null,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone || null,
        note: input.note || null,
        requestedPlanId: requestedPlanId ?? null,
      },
      select: { id: true },
    });
    return { ok: true, result: created };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Transitions autorisées :
 *   PENDING   → CONTACTED | APPROVED | REJECTED
 *   CONTACTED → APPROVED | REJECTED
 *   APPROVED  → REJECTED | (CONVERTED via claimSignupRequestForConversion)
 *   CONVERTED / REJECTED : états terminaux.
 * La transition est atomique (updateMany conditionnel) : deux revues
 * concurrentes ne peuvent pas toutes les deux aboutir.
 */
const ALLOWED_FROM: Record<
  Exclude<SignupRequestStatus, "PENDING" | "CONVERTED">,
  SignupRequestStatus[]
> = {
  CONTACTED: ["PENDING"],
  APPROVED: ["PENDING", "CONTACTED"],
  REJECTED: ["PENDING", "CONTACTED", "APPROVED"],
};

export async function reviewSignupRequest(
  actorUserId: string,
  input: {
    id: string;
    action: "CONTACTED" | "APPROVED" | "REJECTED";
    note?: string;
  },
): Promise<SignupRequestsResult> {
  const allowed = ALLOWED_FROM[input.action];
  if (!allowed) return { ok: false, error: "INVALID_STATE" };

  try {
    const updated = await prisma.schoolSignupRequest.updateMany({
      where: { id: input.id, status: { in: allowed } },
      data: {
        status: input.action,
        reviewNote: input.note?.trim() || null,
        reviewedById: actorUserId,
        reviewedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const exists = await prisma.schoolSignupRequest.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      return { ok: false, error: exists ? "INVALID_STATE" : "NOT_FOUND" };
    }
    await logAudit({
      actorId: actorUserId,
      action: `platform.signup_request.${input.action.toLowerCase()}`,
      entity: "SchoolSignupRequest",
      entityId: input.id,
      metadata: { note: input.note?.trim() || undefined },
    });
    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

/**
 * Revendication atomique de la conversion d'une demande vers l'école créée.
 * À appeler DANS la transaction de création : si la demande n'est plus
 * APPROVED ou déjà rattachée, retourne false → l'appelant fait échouer la
 * transaction (aucune école orpheline, aucune double conversion possible,
 * même en double clic ou soumissions concurrentes).
 */
export async function claimSignupRequestForConversion(
  tx: Prisma.TransactionClient,
  requestId: string,
  schoolId: string,
): Promise<boolean> {
  const updated = await tx.schoolSignupRequest.updateMany({
    where: { id: requestId, status: "APPROVED", convertedSchoolId: null },
    data: {
      status: "CONVERTED",
      convertedSchoolId: schoolId,
      convertedAt: new Date(),
    },
  });
  return updated.count === 1;
}
