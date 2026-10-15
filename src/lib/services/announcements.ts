import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import type { AnnouncementAudience, Prisma } from "@prisma/client";

export type AnnouncementsError =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";
export type AnnouncementsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: AnnouncementsError };

type SchoolCtx = { userId: string; schoolId: string };

/** Rôle de membership → audiences d'annonces réellement destinées à ce rôle. */
const ROLE_AUDIENCES: Record<string, AnnouncementAudience[]> = {
  PARENT: ["ALL", "PARENTS"],
  STUDENT: ["ALL", "STUDENTS"],
  TEACHER: ["ALL", "TEACHERS"],
  ADMIN_SCHOOL: ["ALL", "PARENTS", "STUDENTS", "TEACHERS"],
  // Personnel non pédagogique : annonces générales uniquement.
  FINANCE_MANAGER: ["ALL"],
  CASHIER: ["ALL"],
};

/** Rôles notifiés par audience (ALL = tous les membres actifs de l'école). */
const AUDIENCE_ROLES: Record<AnnouncementAudience, string[]> = {
  ALL: ["PARENT", "STUDENT", "TEACHER", "ADMIN_SCHOOL", "FINANCE_MANAGER", "CASHIER"],
  PARENTS: ["PARENT"],
  STUDENTS: ["STUDENT"],
  TEACHERS: ["TEACHER"],
};

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  publish?: boolean;
  scheduledAt?: Date | null;
}

async function userRoleNames(ctx: SchoolCtx): Promise<string[]> {
  const ms = await prisma.schoolMembership.findMany({
    where: { schoolId: ctx.schoolId, userId: ctx.userId, status: "ACTIVE" },
    select: { role: { select: { name: true } } },
  });
  return ms.map((m) => m.role.name);
}

/** Nombre de membres actifs qui recevraient la notification pour l'audience. */
export async function countAudienceMembers(
  ctx: SchoolCtx,
  audience: AnnouncementAudience,
): Promise<number> {
  return prisma.schoolMembership.count({
    where: {
      schoolId: ctx.schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: { name: { in: AUDIENCE_ROLES[audience] } },
    },
  });
}

/**
 * Liste des annonces. `canManage` → vue complète (admin).
 * Sinon : uniquement les annonces publiées, non archivées et dont l'audience
 * correspond aux rôles effectifs de l'utilisateur (enseignants, parents,
 * élèves, personnel financier).
 */
export async function listAnnouncements(
  ctx: SchoolCtx,
  opts: { includeArchived?: boolean; canManage?: boolean } = {},
) {
  let audienceFilter: Prisma.AnnouncementWhereInput = {};
  if (!opts.canManage) {
    const roles = await userRoleNames(ctx);
    const audiences = [
      ...new Set(roles.flatMap((r) => ROLE_AUDIENCES[r] ?? ["ALL"])),
    ];
    audienceFilter = {
      publishedAt: { not: null },
      archivedAt: null,
      audience: { in: audiences },
    };
  } else if (!opts.includeArchived) {
    audienceFilter = { archivedAt: null };
  }
  return prisma.announcement.findMany({
    where: { schoolId: ctx.schoolId, ...audienceFilter },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      body: true,
      audience: true,
      publishedAt: true,
      scheduledAt: true,
      archivedAt: true,
      createdAt: true,
    },
  });
}

export async function getAnnouncement(ctx: SchoolCtx, id: string) {
  return prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
}

/** Annonces publiées visibles par une audience donnée (portails). */
export async function listPublishedAnnouncements(
  schoolId: string,
  audience: AnnouncementAudience | "ALL",
  opts: { take?: number } = {},
) {
  return prisma.announcement.findMany({
    where: {
      schoolId,
      publishedAt: { not: null },
      archivedAt: null,
      OR: [{ audience: "ALL" }, { audience }],
    },
    orderBy: { publishedAt: "desc" },
    take: opts.take ?? 10,
    select: { id: true, title: true, body: true, audience: true, publishedAt: true },
  });
}

export async function createAnnouncement(
  ctx: SchoolCtx,
  input: AnnouncementInput,
): Promise<AnnouncementsResult<{ id: string }>> {
  if (!input.title.trim() || !input.body.trim()) return { ok: false, error: "INVALID_INPUT" };
  try {
    const a = await prisma.announcement.create({
      data: {
        schoolId: ctx.schoolId,
        title: input.title.trim(),
        body: input.body.trim(),
        audience: input.audience,
        publishedAt: input.publish ? new Date() : null,
        scheduledAt: input.publish ? null : (input.scheduledAt ?? null),
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "announcement.create",
      entity: "Announcement",
      entityId: a.id,
      metadata: { audience: input.audience, published: !!input.publish },
    });
    if (input.publish) await notifyAnnouncementPublished(ctx.schoolId, a.id);
    return { ok: true, result: a };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Modification autorisée uniquement tant que l'annonce n'a jamais été
 * publiée et n'est pas archivée (brouillon ou programmée).
 * `scheduledAt` undefined → conserve la programmation existante ;
 * l'annulation passe exclusivement par cancelSchedule (transition explicite).
 */
export async function updateAnnouncement(
  ctx: SchoolCtx,
  id: string,
  input: Omit<AnnouncementInput, "publish">,
): Promise<AnnouncementsResult> {
  const a = await prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, publishedAt: true, archivedAt: true },
  });
  if (!a) return { ok: false, error: "NOT_FOUND" };
  if (a.publishedAt || a.archivedAt) return { ok: false, error: "INVALID_STATE" };
  if (!input.title.trim() || !input.body.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  try {
    await prisma.announcement.update({
      where: { id: a.id },
      data: {
        title: input.title.trim(),
        body: input.body.trim(),
        audience: input.audience,
        ...(input.scheduledAt !== undefined
          ? { scheduledAt: input.scheduledAt }
          : {}),
      },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "announcement.update",
      entity: "Announcement",
      entityId: a.id,
    });
    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

/** Annule la programmation : retour en brouillon (jamais publiée requis). */
export async function cancelSchedule(
  ctx: SchoolCtx,
  id: string,
): Promise<AnnouncementsResult> {
  const claimed = await prisma.announcement.updateMany({
    where: {
      id,
      schoolId: ctx.schoolId,
      publishedAt: null,
      archivedAt: null,
      scheduledAt: { not: null },
    },
    data: { scheduledAt: null },
  });
  if (claimed.count === 0) return { ok: false, error: "INVALID_STATE" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "announcement.unschedule",
    entity: "Announcement",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

/**
 * Publication atomique : le claim `updateMany` garantit qu'un seul appel
 * publie et notifie (même garde que la publication programmée du cron).
 */
export async function publishAnnouncement(
  ctx: SchoolCtx,
  id: string,
): Promise<AnnouncementsResult> {
  const exists = await prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, publishedAt: true, archivedAt: true },
  });
  if (!exists) return { ok: false, error: "NOT_FOUND" };
  if (exists.archivedAt) return { ok: false, error: "INVALID_STATE" };
  if (exists.publishedAt) return { ok: true, result: undefined }; // déjà publiée
  const claimed = await prisma.announcement.updateMany({
    where: { id: exists.id, publishedAt: null, archivedAt: null },
    data: { publishedAt: new Date(), scheduledAt: null },
  });
  if (claimed.count === 0) return { ok: true, result: undefined }; // perdu la course
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "announcement.publish",
    entity: "Announcement",
    entityId: exists.id,
  });
  await notifyAnnouncementPublished(ctx.schoolId, exists.id);
  return { ok: true, result: undefined };
}

/** Archive une annonce — conservation de l'historique, jamais de suppression physique. */
export async function archiveAnnouncement(ctx: SchoolCtx, id: string): Promise<AnnouncementsResult> {
  const claimed = await prisma.announcement.updateMany({
    where: { id, schoolId: ctx.schoolId, archivedAt: null },
    data: { archivedAt: new Date(), scheduledAt: null },
  });
  if (claimed.count === 0) return { ok: false, error: "NOT_FOUND" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "announcement.archive",
    entity: "Announcement",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

/**
 * Désarchivage vers brouillon — uniquement si l'annonce n'a jamais été
 * publiée (`publishedAt` reste nul). Une annonce publiée puis archivée
 * conserve son historique et n'est jamais republiée implicitement.
 */
export async function unarchiveAnnouncement(
  ctx: SchoolCtx,
  id: string,
): Promise<AnnouncementsResult> {
  const a = await prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, publishedAt: true, archivedAt: true },
  });
  if (!a) return { ok: false, error: "NOT_FOUND" };
  if (!a.archivedAt || a.publishedAt) return { ok: false, error: "INVALID_STATE" };
  await prisma.announcement.update({
    where: { id: a.id },
    data: { archivedAt: null },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "announcement.unarchive",
    entity: "Announcement",
    entityId: a.id,
  });
  return { ok: true, result: undefined };
}

/**
 * Suppression définitive — autorisée uniquement si l'annonce n'a JAMAIS
 * été publiée (`publishedAt` nul, vérifié sur la ligne réelle) : brouillons,
 * programmations annulées, archivées jamais publiées. Aucune FK ne référence
 * Announcement ; la trace audit est conservée après suppression.
 */
export async function deleteAnnouncement(
  ctx: SchoolCtx,
  id: string,
): Promise<AnnouncementsResult> {
  const a = await prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, publishedAt: true, scheduledAt: true },
  });
  if (!a) return { ok: false, error: "NOT_FOUND" };
  // Jamais publiée ET programmation annulée (ou archivée) requis.
  if (a.publishedAt || a.scheduledAt) return { ok: false, error: "FORBIDDEN" };
  try {
    await prisma.announcement.delete({ where: { id: a.id } });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "announcement.delete",
      entity: "Announcement",
      entityId: id,
    });
    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

async function notifyAnnouncementPublished(schoolId: string, announcementId: string) {
  const a = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { title: true, audience: true },
  });
  if (!a) return;
  const memberships = await prisma.schoolMembership.findMany({
    where: {
      schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: { name: { in: AUDIENCE_ROLES[a.audience] } },
    },
    select: { userId: true },
  });
  await notifyUsers({
    schoolId,
    userIds: memberships.map((m) => m.userId),
    type: "ANNOUNCEMENT",
    title: `Annonce — ${a.title}`,
    link: "/app/announcements",
  });
}
