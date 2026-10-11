import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import type { AnnouncementAudience } from "@prisma/client";

export type AnnouncementsError = "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CREATE_FAILED";
export type AnnouncementsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: AnnouncementsError };

type SchoolCtx = { userId: string; schoolId: string };

export async function listAnnouncements(ctx: SchoolCtx) {
  return prisma.announcement.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      body: true,
      audience: true,
      publishedAt: true,
      scheduledAt: true,
      createdAt: true,
    },
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
      OR: [{ audience: "ALL" }, { audience }],
    },
    orderBy: { publishedAt: "desc" },
    take: opts.take ?? 10,
    select: { id: true, title: true, body: true, audience: true, publishedAt: true },
  });
}

export async function createAnnouncement(
  ctx: SchoolCtx,
  input: {
    title: string;
    body: string;
    audience: AnnouncementAudience;
    publish?: boolean;
    scheduledAt?: Date | null;
  },
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

export async function publishAnnouncement(
  ctx: SchoolCtx,
  id: string,
): Promise<AnnouncementsResult> {
  const a = await prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, publishedAt: true },
  });
  if (!a) return { ok: false, error: "NOT_FOUND" };
  if (!a.publishedAt) {
    await prisma.announcement.update({
      where: { id: a.id },
      data: { publishedAt: new Date() },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "announcement.publish",
      entity: "Announcement",
      entityId: a.id,
    });
    await notifyAnnouncementPublished(ctx.schoolId, a.id);
  }
  return { ok: true, result: undefined };
}

export async function archiveAnnouncement(ctx: SchoolCtx, id: string): Promise<AnnouncementsResult> {
  const a = await prisma.announcement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!a) return { ok: false, error: "NOT_FOUND" };
  await prisma.announcement.delete({ where: { id: a.id } });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "announcement.delete",
    entity: "Announcement",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

async function notifyAnnouncementPublished(schoolId: string, announcementId: string) {
  const a = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { title: true, audience: true },
  });
  if (!a) return;
  const roleNames =
    a.audience === "PARENTS"
      ? ["PARENT"]
      : a.audience === "STUDENTS"
        ? ["STUDENT"]
        : a.audience === "TEACHERS"
          ? ["TEACHER"]
          : ["PARENT", "STUDENT", "TEACHER", "ADMIN_SCHOOL"];
  const memberships = await prisma.schoolMembership.findMany({
    where: {
      schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: { name: { in: roleNames } },
    },
    select: { userId: true },
  });
  await notifyUsers({
    schoolId,
    userIds: memberships.map((m) => m.userId),
    type: "ANNOUNCEMENT",
    title: `Annonce — ${a.title}`,
  });
}
