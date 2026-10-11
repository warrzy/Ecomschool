import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { parseDay } from "@/lib/services/schedules";
import type { AttendanceStatus } from "@prisma/client";

export type AttendanceError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "SAVE_FAILED"
  | "UPDATE_FAILED";

export type AttendanceResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: AttendanceError };

type SchoolCtx = { userId: string; schoolId: string };

/** Résout la fiche enseignant liée à un compte utilisateur (ou null). */
export async function teacherIdForUser(
  ctx: SchoolCtx,
): Promise<string | null> {
  const t = await prisma.teacher.findFirst({
    where: { schoolId: ctx.schoolId, userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return t?.id ?? null;
}

// ---------- Appel par séance ----------

export async function getSessionRoster(ctx: SchoolCtx, sessionId: string) {
  const session = await prisma.courseSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: {
      id: true,
      date: true,
      startMin: true,
      endMin: true,
      status: true,
      classroomId: true,
      teacherId: true,
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      room: { select: { name: true } },
    },
  });
  if (!session) return null;

  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId: session.classroomId,
      status: "ENROLLED",
      enrolledAt: { lte: new Date(session.date.getTime() + 86399999) },
      OR: [{ leftAt: null }, { leftAt: { gt: session.date } }],
    },
    select: {
      student: {
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: [
      { student: { lastName: "asc" } },
      { student: { firstName: "asc" } },
    ],
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { sessionId, schoolId: ctx.schoolId },
    select: {
      id: true,
      studentId: true,
      status: true,
      expectedMin: true,
      arrivalMin: true,
      reason: true,
      justification: true,
      justifiedAt: true,
    },
  });

  return {
    session,
    students: enrollments.map((e) => e.student),
    records: new Map(records.map((r) => [r.studentId, r])),
  };
}

export type SessionMark = {
  studentId: string;
  status: Exclude<AttendanceStatus, "UNMARKED">;
  expectedMin?: number;
  arrivalMin?: number;
  reason?: string;
};

export async function saveSessionAttendance(
  ctx: SchoolCtx,
  sessionId: string,
  marks: SessionMark[],
  /** Si défini (accès enseignant), la séance doit appartenir à cet enseignant. */
  forTeacherId?: string,
): Promise<AttendanceResult> {
  const session = await prisma.courseSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: { id: true, teacherId: true, classroomId: true, date: true, startMin: true },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };
  if (forTeacherId && session.teacherId !== forTeacherId) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const enrolled = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId: session.classroomId,
      status: "ENROLLED",
      studentId: { in: marks.map((m) => m.studentId) },
    },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));

  try {
    await prisma.$transaction(async (tx) => {
      for (const m of marks) {
        if (!enrolledIds.has(m.studentId)) continue;
        const durationMin =
          m.status === "LATE" && m.arrivalMin != null
            ? Math.max(0, m.arrivalMin - (m.expectedMin ?? session.startMin))
            : m.status === "LATE" && m.expectedMin != null
              ? Math.max(0, session.startMin - m.expectedMin)
              : null;

        const existing = await tx.attendanceRecord.findFirst({
          where: { sessionId, studentId: m.studentId },
          select: { id: true },
        });
        if (existing) {
          await tx.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              status: m.status,
              expectedMin: m.expectedMin ?? null,
              arrivalMin: m.arrivalMin ?? null,
              durationMin,
              reason: m.reason || null,
              recordedById: ctx.userId,
            },
          });
        } else {
          await tx.attendanceRecord.create({
            data: {
              schoolId: ctx.schoolId,
              sessionId,
              studentId: m.studentId,
              date: session.date,
              status: m.status,
              expectedMin: m.expectedMin ?? null,
              arrivalMin: m.arrivalMin ?? null,
              durationMin,
              reason: m.reason || null,
              recordedById: ctx.userId,
            },
          });
        }
      }
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "attendance.session.save",
      entity: "CourseSession",
      entityId: sessionId,
      metadata: { count: marks.length },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "SAVE_FAILED" };
  }
}

// ---------- Appel journalier (sans séance) ----------

export async function getDailyAttendance(
  ctx: SchoolCtx,
  classroomId: string,
  dateStr: string,
) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId: ctx.schoolId },
    select: { id: true, name: true, academicYearId: true },
  });
  if (!classroom) return null;

  const date = parseDay(dateStr);
  if (!date) return null;

  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId,
      status: "ENROLLED",
      enrolledAt: { lte: new Date(date.getTime() + 86399999) },
      OR: [{ leftAt: null }, { leftAt: { gt: date } }],
    },
    select: {
      student: {
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: [
      { student: { lastName: "asc" } },
      { student: { firstName: "asc" } },
    ],
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { schoolId: ctx.schoolId, sessionId: null, date },
    select: {
      id: true,
      studentId: true,
      status: true,
      expectedMin: true,
      arrivalMin: true,
      durationMin: true,
      reason: true,
      justification: true,
      justifiedAt: true,
    },
  });
  const byStudent = new Map(records.map((r) => [r.studentId, r]));

  return {
    classroom,
    date,
    students: enrollments.map((e) => e.student),
    records: byStudent,
  };
}

export async function saveDailyAttendance(
  ctx: SchoolCtx,
  classroomId: string,
  dateStr: string,
  marks: SessionMark[],
): Promise<AttendanceResult> {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!classroom) return { ok: false, error: "NOT_FOUND" };

  const date = parseDay(dateStr);
  if (!date) return { ok: false, error: "INVALID_INPUT" };

  const enrolled = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      classroomId,
      status: "ENROLLED",
      studentId: { in: marks.map((m) => m.studentId) },
    },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));

  try {
    await prisma.$transaction(async (tx) => {
      for (const m of marks) {
        if (!enrolledIds.has(m.studentId)) continue;

        // Anti-doublon : si une absence session existe déjà ce jour, on la met à jour
        const sessionRecord = await tx.attendanceRecord.findFirst({
          where: {
            schoolId: ctx.schoolId,
            studentId: m.studentId,
            date,
            sessionId: { not: null },
          },
          select: { id: true },
        });
        const dailyRecord = sessionRecord
          ? null
          : await tx.attendanceRecord.findFirst({
              where: {
                schoolId: ctx.schoolId,
                studentId: m.studentId,
                date,
                sessionId: null,
              },
              select: { id: true },
            });

        const durationMin =
          m.status === "LATE" &&
          m.arrivalMin != null &&
          m.expectedMin != null
            ? Math.max(0, m.arrivalMin - m.expectedMin)
            : m.arrivalMin != null && m.expectedMin == null
              ? null
              : null;

        if (sessionRecord) {
          await tx.attendanceRecord.update({
            where: { id: sessionRecord.id },
            data: {
              status: m.status,
              expectedMin: m.expectedMin ?? null,
              arrivalMin: m.arrivalMin ?? null,
              durationMin,
              reason: m.reason || null,
              recordedById: ctx.userId,
            },
          });
        } else if (dailyRecord) {
          await tx.attendanceRecord.update({
            where: { id: dailyRecord.id },
            data: {
              status: m.status,
              expectedMin: m.expectedMin ?? null,
              arrivalMin: m.arrivalMin ?? null,
              durationMin,
              reason: m.reason || null,
              recordedById: ctx.userId,
            },
          });
        } else {
          await tx.attendanceRecord.create({
            data: {
              schoolId: ctx.schoolId,
              sessionId: null,
              studentId: m.studentId,
              date,
              status: m.status,
              expectedMin: m.expectedMin ?? null,
              arrivalMin: m.arrivalMin ?? null,
              durationMin,
              reason: m.reason || null,
              recordedById: ctx.userId,
            },
          });
        }
      }
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "attendance.daily.save",
      entity: "Classroom",
      entityId: classroomId,
      metadata: { date: dateStr, count: marks.length },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "SAVE_FAILED" };
  }
}

// ---------- Absence/retard manuel ----------

export async function addAttendanceRecord(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    date: string;
    status: "ABSENT" | "LATE";
    sessionId?: string;
    expectedMin?: number;
    arrivalMin?: number;
    durationMin?: number;
    reason?: string;
  },
): Promise<AttendanceResult<{ id: string }>> {
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!student) return { ok: false, error: "NOT_FOUND" };

  const date = parseDay(input.date);
  if (!date) return { ok: false, error: "INVALID_INPUT" };

  let sessionId: string | null = null;
  if (input.sessionId) {
    const session = await prisma.courseSession.findFirst({
      where: { id: input.sessionId, schoolId: ctx.schoolId },
      select: { id: true, startMin: true },
    });
    if (!session) return { ok: false, error: "NOT_FOUND" };
    sessionId = session.id;
  }

  const durationMin =
    input.status === "LATE"
      ? input.durationMin ??
        (input.arrivalMin != null
          ? Math.max(0, input.arrivalMin - (input.expectedMin ?? 0))
          : null)
      : input.durationMin ?? null;

  try {
    // Anti-doublon : une séance = un enregistrement par élève
    if (sessionId) {
      const existing = await prisma.attendanceRecord.findFirst({
        where: { sessionId, studentId: input.studentId },
        select: { id: true },
      });
      if (existing) {
        await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            expectedMin: input.expectedMin ?? null,
            arrivalMin: input.arrivalMin ?? null,
            durationMin,
            reason: input.reason || null,
            recordedById: ctx.userId,
          },
          select: { id: true },
        });
        return { ok: true, result: { id: existing.id } };
      }
    }

    const row = await prisma.attendanceRecord.create({
      data: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        sessionId,
        date,
        status: input.status,
        expectedMin: input.expectedMin ?? null,
        arrivalMin: input.arrivalMin ?? null,
        durationMin,
        reason: input.reason || null,
        recordedById: ctx.userId,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: `attendance.${input.status.toLowerCase()}.create`,
      entity: "AttendanceRecord",
      entityId: row.id,
      metadata: { studentId: input.studentId, date: input.date },
    });

    return { ok: true, result: { id: row.id } };
  } catch {
    return { ok: false, error: "SAVE_FAILED" };
  }
}

// ---------- Listes ----------

export async function listAttendance(
  ctx: SchoolCtx,
  filters: {
    status?: AttendanceStatus;
    classroomId?: string;
    studentId?: string;
    from?: string;
    until?: string;
    justified?: boolean; // true = justifiées, false = non justifiées
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));

  const where = {
    schoolId: ctx.schoolId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.studentId ? { studentId: filters.studentId } : {}),
    ...(filters.classroomId
      ? {
          student: {
            enrollments: {
              some: {
                classroomId: filters.classroomId,
                status: "ENROLLED" as const,
              },
            },
          },
        }
      : {}),
    ...(filters.from || filters.until
      ? {
          date: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.until
              ? { lte: new Date(new Date(filters.until).getTime() + 86399999) }
              : {}),
          },
        }
      : {}),
    ...(filters.justified === true ? { justifiedAt: { not: null } } : {}),
    ...(filters.justified === false
      ? { status: { in: ["ABSENT", "LATE"] as AttendanceStatus[] }, justifiedAt: null }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.attendanceRecord.count({ where }),
    prisma.attendanceRecord.findMany({
      where,
      orderBy: [{ date: "desc" }, { student: { lastName: "asc" } }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        date: true,
        status: true,
        expectedMin: true,
        arrivalMin: true,
        durationMin: true,
        reason: true,
        justification: true,
        justifiedAt: true,
        student: {
          select: {
            id: true,
            matricule: true,
            firstName: true,
            lastName: true,
          },
        },
        session: {
          select: {
            id: true,
            startMin: true,
            endMin: true,
            classroom: { select: { name: true } },
            subject: { select: { name: true } },
          },
        },
        recordedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

// ---------- Justification ----------

export async function justifyAttendance(
  ctx: SchoolCtx,
  recordId: string,
  justification: string,
): Promise<AttendanceResult> {
  const record = await prisma.attendanceRecord.findFirst({
    where: { id: recordId, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!record) return { ok: false, error: "NOT_FOUND" };
  if (record.status !== "ABSENT" && record.status !== "LATE") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        justification: justification || null,
        status: "EXCUSED",
        justifiedAt: new Date(),
        justifiedById: ctx.userId,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "attendance.justify",
      entity: "AttendanceRecord",
      entityId: recordId,
      metadata: { justification },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Statistiques élève / classe ----------

export async function studentAttendanceSummary(ctx: SchoolCtx, studentId: string) {
  const records = await prisma.attendanceRecord.findMany({
    where: {
      schoolId: ctx.schoolId,
      studentId,
      status: { in: ["ABSENT", "LATE", "EXCUSED"] },
    },
    select: { status: true, durationMin: true },
  });

  const absences = records.filter((r) => r.status === "ABSENT").length;
  const excused = records.filter((r) => r.status === "EXCUSED").length;
  const lates = records.filter((r) => r.status === "LATE");
  return {
    absences,
    justified: excused,
    unjustified: absences,
    lates: lates.length,
    lateMin: lates.reduce((s, r) => s + (r.durationMin ?? 0), 0),
  };
}

export async function classroomStats(ctx: SchoolCtx, classroomId: string) {
  const [sessions, records] = await Promise.all([
    prisma.courseSession.findMany({
      where: { schoolId: ctx.schoolId, classroomId },
      select: { status: true },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        schoolId: ctx.schoolId,
        OR: [
          { session: { classroomId } },
          {
            sessionId: null,
            student: {
              enrollments: { some: { classroomId, status: "ENROLLED" } },
            },
          },
        ],
      },
      select: { status: true },
    }),
  ]);

  const planned = sessions.filter((s) => s.status === "PLANNED").length;
  const done = sessions.filter((s) => s.status === "DONE").length;
  const cancelled = sessions.filter((s) => s.status === "CANCELLED").length;
  const marked = records.filter((r) => r.status !== "UNMARKED");
  const presents = marked.filter(
    (r) => r.status === "PRESENT" || r.status === "LATE" || r.status === "EXCUSED",
  ).length;
  const lates = records.filter((r) => r.status === "LATE").length;

  return {
    planned,
    done,
    cancelled,
    attendanceRate: marked.length > 0 ? presents / marked.length : null,
    lates,
  };
}
