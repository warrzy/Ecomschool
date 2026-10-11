import { prisma } from "@/lib/db/prisma";

/**
 * Données du portail élève. Le lien User↔Student est revérifié en base à
 * chaque requête. Aucune donnée non publiée n'est exposée.
 */

export type StudentCtx = { userId: string; schoolId: string };

/** Résout l'élève lié au compte connecté (null si non autorisé). */
export async function resolveStudent(ctx: StudentCtx) {
  return prisma.student.findFirst({
    where: {
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
    },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      birthPlace: true,
      sex: true,
    },
  });
}

export async function getStudentOverview(ctx: StudentCtx) {
  const student = await resolveStudent(ctx);
  if (!student) return null;
  const enrollment = await prisma.enrollment.findFirst({
    where: { schoolId: ctx.schoolId, studentId: student.id, status: "ENROLLED" },
    orderBy: { enrolledAt: "desc" },
    select: {
      classroom: {
        select: { id: true, name: true, level: { select: { name: true } } },
      },
      academicYear: { select: { name: true } },
    },
  });
  return { student, enrollment };
}

export async function getStudentTimetable(ctx: StudentCtx) {
  const overview = await getStudentOverview(ctx);
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

export async function getStudentSubjects(ctx: StudentCtx) {
  const overview = await getStudentOverview(ctx);
  if (!overview?.enrollment) return null;
  const subs = await prisma.classroomSubject.findMany({
    where: { schoolId: ctx.schoolId, classroomId: overview.enrollment.classroom.id },
    include: { subject: { select: { name: true, code: true, subjectGroup: true } } },
    orderBy: { subject: { name: "asc" } },
  });
  return subs;
}

export async function getStudentGrades(ctx: StudentCtx) {
  const student = await resolveStudent(ctx);
  if (!student) return null;
  return prisma.grade.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId: student.id,
      assessment: { status: "PUBLISHED" },
    },
    include: {
      assessment: {
        select: {
          title: true,
          date: true,
          maxScore: true,
          type: { select: { name: true } },
          subject: { select: { name: true } },
          academicPeriod: { select: { name: true } },
        },
      },
    },
    orderBy: { assessment: { date: "desc" } },
  });
}

export async function getStudentResults(ctx: StudentCtx) {
  const student = await resolveStudent(ctx);
  if (!student) return null;
  const results = await prisma.studentPeriodResult.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId: student.id,
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
      studentId: student.id,
      academicPeriodId: { in: results.map((r) => r.academicPeriodId) },
    },
    include: { subject: { select: { name: true } } },
    orderBy: { subject: { name: "asc" } },
  });
  return { results, subjects };
}

export async function getStudentReportCards(ctx: StudentCtx) {
  const student = await resolveStudent(ctx);
  if (!student) return null;
  return prisma.reportCard.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId: student.id,
      status: { in: ["PUBLISHED", "RECTIFIED"] },
    },
    select: {
      id: true,
      identifier: true,
      publishedAt: true,
      academicPeriod: { select: { name: true, academicYear: { select: { name: true } } } },
    },
    orderBy: { publishedAt: "desc" },
  });
}

export async function getStudentAttendance(ctx: StudentCtx) {
  const student = await resolveStudent(ctx);
  if (!student) return null;
  return prisma.attendanceRecord.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId: student.id,
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
