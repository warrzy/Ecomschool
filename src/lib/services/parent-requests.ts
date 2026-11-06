/**
 * H1 — Demandes administratives déposées par les parents (portail) et
 * traitées manuellement par l'établissement.
 *
 * Garanties :
 * - `schoolId` et `guardianId` toujours déterminés côté serveur
 *   (le parent ne fournit jamais d'identifiant).
 * - Le rattachement parent↔enfant est revérifié en base quand la
 *   demande porte sur un élève.
 * - Une demande ne déclenche aucune modification sensible : le
 *   traitement est humain (statut + réponse), tracé dans l'audit.
 * - Transitions de statut par updateMany conditionnel — une double
 *   réponse ou une annulation concurrente est impossible.
 * - Le parent est notifié en interne (Notification, ADMIN_MESSAGE) à
 *   chaque réponse — aucun canal externe ici.
 */
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import type {
  AdminRequestStatus,
  AdminRequestType,
} from "@prisma/client";
import type { ParentCtx } from "./portal/parent";
import { verifyChildAccess } from "./portal/parent";

export type ParentRequestError =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "NOT_OPEN"
  | "UPDATE_FAILED";

export type ParentRequestResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ParentRequestError };

export const REQUEST_TYPE_LABELS: Record<AdminRequestType, string> = {
  DOCUMENT: "Document administratif",
  ABSENCE_JUSTIFICATION: "Justificatif d'absence",
  ACCOUNT_INFO: "Information de compte",
  MEETING: "Demande de rendez-vous",
  OTHER: "Autre demande",
};

export const REQUEST_STATUS_LABELS: Record<AdminRequestStatus, string> = {
  SUBMITTED: "Déposée",
  IN_PROGRESS: "En cours de traitement",
  RESOLVED: "Traitée",
  REJECTED: "Refusée",
  CANCELLED: "Annulée",
};

export const REQUEST_STATUS_TONES: Record<AdminRequestStatus, string> = {
  SUBMITTED: "bg-amber-50 text-amber-800",
  IN_PROGRESS: "bg-blue-50 text-blue-800",
  RESOLVED: "bg-emerald-50 text-emerald-800",
  REJECTED: "bg-red-50 text-red-800",
  CANCELLED: "bg-zinc-100 text-zinc-600",
};

/** Statuts sur lesquels l'établissement peut encore agir. */
const OPEN_STATUSES: AdminRequestStatus[] = ["SUBMITTED", "IN_PROGRESS"];

/** Dossier Guardian du parent connecté (compte lié, actif). */
async function guardianOf(ctx: ParentCtx) {
  return prisma.guardian.findFirst({
    where: { schoolId: ctx.schoolId, userId: ctx.userId, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true },
  });
}

/**
 * Dépôt d'une demande par le parent. `studentId` optionnel : s'il est
 * fourni, le lien parent↔enfant est revérifié (404 sinon — pas de fuite).
 */
export async function createParentRequest(
  ctx: ParentCtx,
  input: {
    type: AdminRequestType;
    subject: string;
    body: string;
    studentId?: string;
    contextRef?: string;
  },
): Promise<ParentRequestResult<{ id: string }>> {
  const guardian = await guardianOf(ctx);
  if (!guardian) return { ok: false, error: "FORBIDDEN" };

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || subject.length > 200 || !body || body.length > 4000) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!Object.keys(REQUEST_TYPE_LABELS).includes(input.type)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let studentId: string | null = null;
  if (input.studentId) {
    const link = await verifyChildAccess(ctx, input.studentId);
    if (!link) return { ok: false, error: "NOT_FOUND" };
    studentId = input.studentId;
  }

  const req = await prisma.administrativeRequest.create({
    data: {
      schoolId: ctx.schoolId,
      guardianId: guardian.id,
      studentId,
      type: input.type,
      subject,
      body,
      contextRef: input.contextRef?.trim() || null,
    },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "parent_request.create",
    entity: "AdministrativeRequest",
    entityId: req.id,
    metadata: { type: input.type, studentId },
  });
  return { ok: true, result: { id: req.id } };
}

/** Demandes du parent connecté, triées par date décroissante. */
export async function listParentRequests(ctx: ParentCtx) {
  const guardian = await guardianOf(ctx);
  if (!guardian) return [];
  return prisma.administrativeRequest.findMany({
    where: { schoolId: ctx.schoolId, guardianId: guardian.id },
    include: {
      student: {
        select: { firstName: true, lastName: true, matricule: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/**
 * Justificatif d'absence : crée une demande typée rattachée au relevé
 * de présence. Le relevé doit exister, appartenir à un enfant du parent
 * et être une absence/un retard non encore justifié. La justification
 * effective reste un acte de l'établissement (justifiedAt).
 */
export async function submitAbsenceJustification(
  ctx: ParentCtx,
  input: { attendanceRecordId: string; body: string },
): Promise<ParentRequestResult<{ id: string }>> {
  const guardian = await guardianOf(ctx);
  if (!guardian) return { ok: false, error: "FORBIDDEN" };
  const body = input.body.trim();
  if (!body || body.length > 2000) return { ok: false, error: "INVALID_INPUT" };

  const record = await prisma.attendanceRecord.findFirst({
    where: {
      id: input.attendanceRecordId,
      schoolId: ctx.schoolId,
      status: { in: ["ABSENT", "LATE"] },
      justifiedAt: null,
    },
    select: { studentId: true, date: true, status: true },
  });
  if (!record) return { ok: false, error: "NOT_FOUND" };
  if (!(await verifyChildAccess(ctx, record.studentId))) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const req = await prisma.administrativeRequest.create({
    data: {
      schoolId: ctx.schoolId,
      guardianId: guardian.id,
      studentId: record.studentId,
      type: "ABSENCE_JUSTIFICATION",
      subject: `Justificatif — ${record.status === "ABSENT" ? "absence" : "retard"} du ${record.date.toISOString().slice(0, 10)}`,
      body,
      contextRef: input.attendanceRecordId,
    },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "parent_request.absence_justification",
    entity: "AdministrativeRequest",
    entityId: req.id,
    metadata: { attendanceRecordId: input.attendanceRecordId },
  });
  return { ok: true, result: { id: req.id } };
}

/** Annulation par le parent — uniquement tant que la demande est déposée. */
export async function cancelParentRequest(
  ctx: ParentCtx,
  requestId: string,
): Promise<ParentRequestResult<undefined>> {
  const guardian = await guardianOf(ctx);
  if (!guardian) return { ok: false, error: "FORBIDDEN" };
  const updated = await prisma.administrativeRequest.updateMany({
    where: {
      id: requestId,
      schoolId: ctx.schoolId,
      guardianId: guardian.id,
      status: "SUBMITTED",
    },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (updated.count === 0) return { ok: false, error: "NOT_OPEN" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "parent_request.cancel",
    entity: "AdministrativeRequest",
    entityId: requestId,
    metadata: {},
  });
  return { ok: true, result: undefined };
}

// ---------- Côté établissement ----------

export type SchoolCtx = { userId: string; schoolId: string };

async function canHandle(ctx: SchoolCtx) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: "administrative-requests.manage",
  });
}

/** File des demandes de l'établissement (filtre statut optionnel). */
export async function listSchoolRequests(
  ctx: SchoolCtx,
  opts: { status?: AdminRequestStatus; take?: number } = {},
) {
  return prisma.administrativeRequest.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: {
      guardian: { select: { firstName: true, lastName: true, phone: true } },
      student: {
        select: { firstName: true, lastName: true, matricule: true },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: opts.take ?? 200,
  });
}

export async function getSchoolRequest(ctx: SchoolCtx, id: string) {
  return prisma.administrativeRequest.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      guardian: {
        select: { firstName: true, lastName: true, phone: true, email: true },
      },
      student: {
        select: { firstName: true, lastName: true, matricule: true },
      },
    },
  });
}

/**
 * Traitement d'une demande par l'établissement : changement de statut
 * (IN_PROGRESS / RESOLVED / REJECTED) avec réponse optionnelle — requise
 * pour un refus. Transition conditionnelle (la demande doit être ouverte),
 * audit + notification interne du parent.
 */
export async function respondSchoolRequest(
  ctx: SchoolCtx,
  input: {
    id: string;
    status: "IN_PROGRESS" | "RESOLVED" | "REJECTED";
    response?: string;
  },
): Promise<ParentRequestResult<undefined>> {
  if (!(await canHandle(ctx))) return { ok: false, error: "FORBIDDEN" };
  const response = input.response?.trim() || null;
  if (input.status === "REJECTED" && !response) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (response && response.length > 4000) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const target = await prisma.administrativeRequest.findFirst({
    where: { id: input.id, schoolId: ctx.schoolId },
    select: {
      id: true,
      type: true,
      subject: true,
      status: true,
      guardian: { select: { userId: true } },
    },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };

  const updated = await prisma.administrativeRequest.updateMany({
    where: { id: input.id, schoolId: ctx.schoolId, status: { in: OPEN_STATUSES } },
    data: {
      status: input.status,
      response,
      respondedById: ctx.userId,
      respondedAt: new Date(),
    },
  });
  if (updated.count === 0) return { ok: false, error: "NOT_OPEN" };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "parent_request.respond",
    entity: "AdministrativeRequest",
    entityId: input.id,
    metadata: { status: input.status, type: target.type },
  });

  if (target.guardian.userId) {
    await notifyUsers({
      schoolId: ctx.schoolId,
      userIds: [target.guardian.userId],
      type: "ADMIN_MESSAGE",
      title: `Votre demande « ${target.subject} » : ${REQUEST_STATUS_LABELS[input.status].toLowerCase()}`,
      body: response ?? undefined,
      link: "/parent?tab=demandes",
    });
  }
  return { ok: true, result: undefined };
}

// ---------- Profil parent (coordonnées du dossier Guardian) ----------

/** Coordonnées visibles par le parent (son dossier Guardian + compte). */
export async function getParentProfile(ctx: ParentCtx) {
  const [guardian, user] = await Promise.all([
    prisma.guardian.findFirst({
      where: { schoolId: ctx.schoolId, userId: ctx.userId, status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        address: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true, firstName: true, lastName: true },
    }),
  ]);
  return { guardian, user };
}

/**
 * Mise à jour des coordonnées du dossier Guardian (téléphone, email de
 * contact, adresse) — n'affecte ni l'identifiant de connexion
 * (`User.email`) ni les accès. Auditée.
 */
export async function updateParentContact(
  ctx: ParentCtx,
  input: { phone?: string; email?: string; address?: string },
): Promise<ParentRequestResult<undefined>> {
  const guardian = await prisma.guardian.findFirst({
    where: { schoolId: ctx.schoolId, userId: ctx.userId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!guardian) return { ok: false, error: "FORBIDDEN" };

  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  const address = input.address?.trim() || null;
  if (phone && phone.length > 30) return { ok: false, error: "INVALID_INPUT" };
  if (email && (email.length > 200 || !email.includes("@"))) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (address && address.length > 300) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  await prisma.guardian.update({
    where: { id: guardian.id },
    data: { phone, email, address },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "parent.contact_update",
    entity: "Guardian",
    entityId: guardian.id,
    metadata: {
      phoneChanged: true,
      emailChanged: email !== null,
      addressChanged: true,
    },
  });
  return { ok: true, result: undefined };
}
