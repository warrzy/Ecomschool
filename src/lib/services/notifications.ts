import { prisma } from "@/lib/db/prisma";
import type { NotificationType } from "@prisma/client";

/**
 * Notifications internes persistées, scopées par établissement.
 * Conçues pour supporter ultérieurement des canaux externes (email/SMS/WhatsApp) :
 * aucune donnée scolaire sensible n'est transmise à un tiers ici.
 */
export async function notifyUsers(input: {
  schoolId: string | null;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const ids = [...new Set(input.userIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  await prisma.notification.createMany({
    data: ids.map((userId) => ({
      schoolId: input.schoolId,
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });
  return ids.length;
}

export async function listNotifications(
  userId: string,
  opts: { take?: number; unreadOnly?: boolean; type?: NotificationType } = {},
) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.type ? { type: opts.type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 20,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(userId: string, id: string) {
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

// ---------- Émissions métier ----------

/** Comptes utilisateurs liés à un élève (compte élève + comptes des tuteurs actifs). */
async function accountUserIdsForStudent(schoolId: string, studentId: string) {
  const [student, links] = await Promise.all([
    prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { user: { select: { id: true, status: true } } },
    }),
    prisma.studentGuardian.findMany({
      where: { schoolId, studentId },
      select: { guardian: { select: { user: { select: { id: true, status: true } } } } },
    }),
  ]);
  const ids: string[] = [];
  if (student?.user?.status === "ACTIVE") ids.push(student.user.id);
  for (const l of links) {
    if (l.guardian.user?.status === "ACTIVE") ids.push(l.guardian.user.id);
  }
  return ids;
}

export async function notifyResultsPublished(input: {
  schoolId: string;
  classroomId: string;
  periodName: string;
}) {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: input.schoolId,
      classroomId: input.classroomId,
      status: "ENROLLED",
    },
    select: { studentId: true },
  });
  const userIds = new Set<string>();
  for (const e of enrollments) {
    for (const id of await accountUserIdsForStudent(input.schoolId, e.studentId)) {
      userIds.add(id);
    }
  }
  return notifyUsers({
    schoolId: input.schoolId,
    userIds: [...userIds],
    type: "REPORT_CARD_PUBLISHED",
    title: `Résultats publiés — ${input.periodName}`,
    body: "Les résultats et bulletins de la période sont disponibles.",
    link: "/parent",
  });
}

export async function notifyAbsenceUnjustified(input: {
  schoolId: string;
  studentId: string;
  date: Date;
}) {
  const ids = await accountUserIdsForStudent(input.schoolId, input.studentId);
  return notifyUsers({
    schoolId: input.schoolId,
    userIds: ids,
    type: "ABSENCE_UNJUSTIFIED",
    title: "Absence non justifiée",
    body: `Une absence a été enregistrée le ${input.date.toLocaleDateString("fr-FR")}.`,
    link: "/parent",
  });
}

export async function notifyLateness(input: {
  schoolId: string;
  studentId: string;
  date: Date;
}) {
  const ids = await accountUserIdsForStudent(input.schoolId, input.studentId);
  return notifyUsers({
    schoolId: input.schoolId,
    userIds: ids,
    type: "LATENESS",
    title: "Retard enregistré",
    body: `Un retard a été enregistré le ${input.date.toLocaleDateString("fr-FR")}.`,
    link: "/parent",
  });
}
