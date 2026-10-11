import { prisma } from "@/lib/db/prisma";

type SchoolCtx = { schoolId: string };

export async function getSchoolDashboard(ctx: SchoolCtx) {
  const school = await prisma.school.findUnique({
    where: { id: ctx.schoolId },
    select: { name: true, city: true, type: true, logoUrl: true },
  });

  const currentYear = await prisma.academicYear.findFirst({
    where: { schoolId: ctx.schoolId, isCurrent: true },
    select: { id: true, name: true, startDate: true, endDate: true },
  });

  const [
    studentsActive,
    teachersActive,
    classroomsActive,
    enrolledCount,
    bySexMale,
    bySexFemale,
    byLevelRaw,
    latestEnrollments,
  ] = await Promise.all([
    prisma.student.count({
      where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    }),
    prisma.teacher.count({
      where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    }),
    prisma.classroom.count({
      where: {
        schoolId: ctx.schoolId,
        status: "ACTIVE",
        ...(currentYear ? { academicYearId: currentYear.id } : {}),
      },
    }),
    currentYear
      ? prisma.enrollment.count({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: currentYear.id,
            status: "ENROLLED",
          },
        })
      : Promise.resolve(0),
    currentYear
      ? prisma.enrollment.count({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: currentYear.id,
            status: "ENROLLED",
            student: { sex: "MALE" },
          },
        })
      : Promise.resolve(0),
    currentYear
      ? prisma.enrollment.count({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: currentYear.id,
            status: "ENROLLED",
            student: { sex: "FEMALE" },
          },
        })
      : Promise.resolve(0),
    currentYear
      ? prisma.enrollment.groupBy({
          by: ["classroomId"],
          where: {
            schoolId: ctx.schoolId,
            academicYearId: currentYear.id,
            status: "ENROLLED",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.enrollment.findMany({
      where: { schoolId: ctx.schoolId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        enrolledAt: true,
        status: true,
        student: {
          select: { id: true, matricule: true, firstName: true, lastName: true },
        },
        classroom: { select: { name: true } },
        academicYear: { select: { name: true } },
      },
    }),
  ]);

  let byLevel: { level: string; count: number }[] = [];
  if (byLevelRaw.length > 0) {
    const classrooms = await prisma.classroom.findMany({
      where: { id: { in: byLevelRaw.map((r) => r.classroomId) } },
      select: { id: true, level: { select: { name: true, order: true } } },
    });
    const levelByClassroom = new Map(
      classrooms.map((c) => [c.id, c.level] as const),
    );
    const agg = new Map<string, { order: number; count: number }>();
    for (const row of byLevelRaw) {
      const level = levelByClassroom.get(row.classroomId);
      if (!level) continue;
      const cur = agg.get(level.name) ?? { order: level.order, count: 0 };
      cur.count += row._count._all;
      cur.order = Math.min(cur.order, level.order);
      agg.set(level.name, cur);
    }
    byLevel = [...agg.entries()]
      .map(([level, v]) => ({ level, count: v.count, order: v.order }))
      .sort((a, b) => a.order - b.order || a.level.localeCompare(b.level))
      .map(({ level, count }) => ({ level, count }));
  }

  return {
    school,
    currentYear,
    studentsActive,
    teachersActive,
    classroomsActive,
    enrolledCount,
    bySex: { male: bySexMale, female: bySexFemale },
    byLevel,
    latestEnrollments,
  };
}

/** Indicateurs pédagogiques temps réel (Phase 4). */
export async function getPedagogyDashboard(
  ctx: SchoolCtx,
  filters: { academicYearId?: string; date?: Date } = {},
) {
  const day = filters.date ?? new Date();
  const dayStart = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const nowMin = day.getUTCHours() * 60 + day.getUTCMinutes();

  const weekday =
    (["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const)[
      dayStart.getUTCDay()
    ];

  const yearFilter = filters.academicYearId;

  const [
    sessionsToday,
    schedulesToday,
    absencesToday,
    latesToday,
    cancelledToday,
    marked,
    present,
  ] = await Promise.all([
    prisma.courseSession.findMany({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: dayStart, lt: dayEnd },
        ...(yearFilter ? { academicYearId: yearFilter } : {}),
      },
      select: {
        status: true,
        scheduleId: true,
        teacherId: true,
        classroomId: true,
        startMin: true,
        endMin: true,
      },
    }),
    prisma.courseSchedule.findMany({
      where: {
        schoolId: ctx.schoolId,
        status: "ACTIVE",
        weekday,
        validFrom: { lt: dayEnd },
        OR: [{ validUntil: null }, { validUntil: { gte: dayStart } }],
        ...(yearFilter ? { academicYearId: yearFilter } : {}),
      },
      select: {
        id: true,
        teacherId: true,
        classroomId: true,
        startMin: true,
        endMin: true,
      },
    }),
    prisma.attendanceRecord.count({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: dayStart, lt: dayEnd },
        status: "ABSENT",
      },
    }),
    prisma.attendanceRecord.count({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: dayStart, lt: dayEnd },
        status: "LATE",
      },
    }),
    prisma.courseSession.count({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: dayStart, lt: dayEnd },
        status: "CANCELLED",
      },
    }),
    prisma.attendanceRecord.count({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: dayStart, lt: dayEnd },
        status: { not: "UNMARKED" },
      },
    }),
    prisma.attendanceRecord.count({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: dayStart, lt: dayEnd },
        status: { in: ["PRESENT", "LATE", "EXCUSED"] },
      },
    }),
  ]);

  // Séances matérialisées (sauf annulées) + créneaux du jour non matérialisés
  const materializedScheduleIds = new Set(
    sessionsToday.map((s) => s.scheduleId).filter(Boolean) as string[],
  );
  const unMaterialized = schedulesToday.filter(
    (s) => !materializedScheduleIds.has(s.id),
  );
  const plannedToday =
    sessionsToday.filter((s) => s.status !== "CANCELLED").length +
    unMaterialized.length;

  const doneToday = sessionsToday.filter((s) => s.status === "DONE").length;

  const activeSessions = sessionsToday.filter(
    (s) =>
      s.status !== "CANCELLED" &&
      s.startMin <= nowMin &&
      s.endMin > nowMin,
  );
  const activeSlots = unMaterialized.filter(
    (s) => s.startMin <= nowMin && s.endMin > nowMin,
  );

  return {
    date: dayStart,
    plannedToday,
    doneToday,
    teachersInClass: new Set([
      ...activeSessions.map((s) => s.teacherId),
      ...activeSlots.map((s) => s.teacherId),
    ]).size,
    classesInSession: new Set([
      ...activeSessions.map((s) => s.classroomId),
      ...activeSlots.map((s) => s.classroomId),
    ]).size,
    absencesToday,
    latesToday,
    cancelledToday,
    attendanceRate: marked > 0 ? present / marked : null,
  };
}

/** Indicateurs évaluations / résultats / bulletins (Phase 5). */
export async function getEvaluationsDashboard(
  ctx: SchoolCtx,
  filters: { academicYearId?: string } = {},
) {
  const yearFilter = filters.academicYearId;
  const now = new Date();

  const [
    upcoming,
    open,
    missingGrades,
    pendingValidations,
    publishedCards,
    avgByClassroom,
  ] = await Promise.all([
    prisma.assessment.count({
      where: {
        schoolId: ctx.schoolId,
        status: { in: ["DRAFT", "OPEN"] },
        date: { gte: now },
        ...(yearFilter ? { academicYearId: yearFilter } : {}),
      },
    }),
    prisma.assessment.count({
      where: {
        schoolId: ctx.schoolId,
        status: "OPEN",
        ...(yearFilter ? { academicYearId: yearFilter } : {}),
      },
    }),
    prisma.grade.count({
      where: {
        schoolId: ctx.schoolId,
        status: "MISSING",
        assessment: yearFilter ? { academicYearId: yearFilter } : undefined,
      },
    }),
    prisma.resultValidation.count({
      where: {
        schoolId: ctx.schoolId,
        status: { in: ["CALCULATED", "PENDING_VALIDATION"] },
        ...(yearFilter
          ? { academicPeriod: { academicYearId: yearFilter } }
          : {}),
      },
    }),
    prisma.reportCard.count({
      where: {
        schoolId: ctx.schoolId,
        status: "PUBLISHED",
        ...(yearFilter
          ? { academicPeriod: { academicYearId: yearFilter } }
          : {}),
      },
    }),
    prisma.studentPeriodResult.groupBy({
      by: ["classroomId"],
      where: {
        schoolId: ctx.schoolId,
        generalAverage: { not: null },
        ...(yearFilter
          ? { academicPeriod: { academicYearId: yearFilter } }
          : {}),
      },
      _avg: { generalAverage: true },
      _count: true,
    }),
  ]);

  return {
    upcomingEvaluations: upcoming,
    openEvaluations: open,
    missingGrades,
    pendingValidations,
    publishedReportCards: publishedCards,
    averageByClassroom: avgByClassroom.length,
  };
}
