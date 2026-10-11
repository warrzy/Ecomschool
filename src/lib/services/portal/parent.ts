import { prisma } from "@/lib/db/prisma";

/**
 * Données du portail parent. Chaque fonction revérifie en base le lien
 * tuteur↔élève (StudentGuardian) — on ne se fie jamais au seul JWT.
 * Seules les données publiées sont exposées.
 */

export type ParentCtx = { userId: string; schoolId: string };

/** Vérifie le lien parent↔enfant côté serveur. Retourne null si non autorisé. */
export async function verifyChildAccess(ctx: ParentCtx, studentId: string) {
  const link = await prisma.studentGuardian.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      guardian: {
        userId: ctx.userId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
    },
    select: { studentId: true },
  });
  return link;
}

export async function listChildren(ctx: ParentCtx) {
  const links = await prisma.studentGuardian.findMany({
    where: {
      schoolId: ctx.schoolId,
      guardian: {
        userId: ctx.userId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
    },
    select: {
      relation: true,
      student: {
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          status: true,
        },
      },
    },
    orderBy: { student: { lastName: "asc" } },
  });
  return links.filter((l) => l.student.status === "ACTIVE");
}

/** Classe courante de l'enfant (dernière inscription ENROLLED). */
export async function getChildOverview(ctx: ParentCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return null;
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId: ctx.schoolId },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      sex: true,
    },
  });
  const enrollment = await prisma.enrollment.findFirst({
    where: { schoolId: ctx.schoolId, studentId, status: "ENROLLED" },
    orderBy: { enrolledAt: "desc" },
    select: {
      classroom: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true } },
    },
  });
  return { student, enrollment };
}

export async function getChildTimetable(ctx: ParentCtx, studentId: string) {
  const overview = await getChildOverview(ctx, studentId);
  if (!overview?.enrollment) return null;
  const schedules = await prisma.courseSchedule.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId: overview.enrollment.classroom.id,
      status: "ACTIVE",
    },
    include: {
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      room: { select: { name: true } },
    },
    orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
  });
  return { classroom: overview.enrollment.classroom, schedules };
}

/** Notes publiées uniquement (assessment.status = PUBLISHED). */
export async function getChildGrades(ctx: ParentCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return null;
  return prisma.grade.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      assessment: { status: "PUBLISHED" },
    },
    include: {
      assessment: {
        select: {
          title: true,
          date: true,
          maxScore: true,
          coefficient: true,
          type: { select: { name: true } },
          subject: { select: { name: true } },
          academicPeriod: { select: { name: true } },
        },
      },
    },
    orderBy: { assessment: { date: "desc" } },
  });
}

/** Résultats publiés (ou rectifiés après publication). */
export async function getChildResults(ctx: ParentCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return null;
  const results = await prisma.studentPeriodResult.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      status: { in: ["PUBLISHED", "RECTIFIED"] },
    },
    include: {
      academicPeriod: { select: { name: true, academicYear: { select: { name: true } } } },
      classroom: { select: { name: true } },
    },
    orderBy: { academicPeriod: { number: "desc" } },
  });
  const subjects = await prisma.subjectPeriodResult.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      academicPeriodId: { in: results.map((r) => r.academicPeriodId) },
    },
    include: { subject: { select: { name: true } } },
    orderBy: { subject: { name: "asc" } },
  });
  return { results, subjects };
}

/** Bulletins téléchargeables : publiés (y compris rectifiés après publication). */
export async function getChildReportCards(ctx: ParentCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return null;
  return prisma.reportCard.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      status: { in: ["PUBLISHED", "RECTIFIED"] },
    },
    select: {
      id: true,
      identifier: true,
      status: true,
      publishedAt: true,
      academicPeriod: { select: { name: true, academicYear: { select: { name: true } } } },
    },
    orderBy: { publishedAt: "desc" },
  });
}

export async function getChildAttendance(ctx: ParentCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return null;
  return prisma.attendanceRecord.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      status: { in: ["ABSENT", "LATE"] },
    },
    orderBy: { date: "desc" },
    take: 60,
    select: {
      id: true,
      date: true,
      status: true,
      durationMin: true,
      reason: true,
      justification: true,
      justifiedAt: true,
    },
  });
}
