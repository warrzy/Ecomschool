import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { SessionStatus, Weekday } from "@prisma/client";

export type SchedulesError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "YEAR_CLOSED"
  | "CONFLICT_CLASSROOM"
  | "CONFLICT_TEACHER"
  | "CONFLICT_ROOM"
  | "CONFLICT"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type SchedulesResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: SchedulesError; conflicts?: ConflictInfo[] };

export type ConflictInfo = {
  kind: "SCHEDULE" | "SESSION";
  dimension: "CLASSROOM" | "TEACHER" | "ROOM";
  id: string;
  label: string;
};

type SchoolCtx = { userId: string; schoolId: string };
type Tx = Prisma.TransactionClient;

const WEEKDAY_OF_DATE: Record<number, Weekday> = {
  0: "SUNDAY",
  1: "MONDAY",
  2: "TUESDAY",
  3: "WEDNESDAY",
  4: "THURSDAY",
  5: "FRIDAY",
  6: "SATURDAY",
};

/** Jour de semaine en UTC — toutes les dates "jour" sont stockées à minuit UTC. */
export function weekdayOf(date: Date): Weekday {
  return WEEKDAY_OF_DATE[date.getUTCDay()];
}

/** Parse une date YYYY-MM-DD en minuit UTC. */
export function parseDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function minutesToLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}`;
}



// ---------- Détection de conflits ----------

type SlotTarget = {
  classroomId: string;
  teacherId: string;
  roomId?: string | null;
  startMin: number;
  endMin: number;
};

function mapConflicts(
  rows: {
    id: string;
    classroomId: string;
    teacherId: string;
    roomId: string | null;
    label: string;
  }[],
  target: SlotTarget,
  kind: "SCHEDULE" | "SESSION",
): ConflictInfo[] {
  const out: ConflictInfo[] = [];
  for (const r of rows) {
    if (r.classroomId === target.classroomId) {
      out.push({ kind, dimension: "CLASSROOM", id: r.id, label: r.label });
    }
    if (r.teacherId === target.teacherId) {
      out.push({ kind, dimension: "TEACHER", id: r.id, label: r.label });
    }
    if (target.roomId && r.roomId === target.roomId) {
      out.push({ kind, dimension: "ROOM", id: r.id, label: r.label });
    }
  }
  return out;
}

/** Conflits pour un créneau récurrent (jour de semaine + plage de validité). */
async function findScheduleConflicts(
  tx: Tx,
  ctx: SchoolCtx,
  input: SlotTarget & {
    weekday: Weekday;
    validFrom: Date;
    validUntil: Date | null;
    excludeScheduleId?: string;
  },
): Promise<ConflictInfo[]> {
  const schedules = await tx.courseSchedule.findMany({
    where: {
      schoolId: ctx.schoolId,
      weekday: input.weekday,
      status: "ACTIVE",
      ...(input.excludeScheduleId ? { id: { not: input.excludeScheduleId } } : {}),
      startMin: { lt: input.endMin },
      endMin: { gt: input.startMin },
      validFrom: { lte: input.validUntil ?? input.validFrom },
      OR: [{ validUntil: null }, { validUntil: { gte: input.validFrom } }],
      AND: [
        {
          OR: [
            { classroomId: input.classroomId },
            { teacherId: input.teacherId },
            ...(input.roomId ? [{ roomId: input.roomId }] : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      classroomId: true,
      teacherId: true,
      roomId: true,
      classroom: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  // Séances ponctuelles le même jour de semaine dans la plage de validité
  const sessions = await tx.courseSession.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: { notIn: ["CANCELLED", "POSTPONED"] },
      startMin: { lt: input.endMin },
      endMin: { gt: input.startMin },
      date: {
        gte: input.validFrom,
        ...(input.validUntil ? { lte: input.validUntil } : {}),
      },
      AND: [
        {
          OR: [
            { classroomId: input.classroomId },
            { teacherId: input.teacherId },
            ...(input.roomId ? [{ roomId: input.roomId }] : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      date: true,
      classroomId: true,
      teacherId: true,
      roomId: true,
      classroom: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  const sameWeekday = sessions.filter(
    (s) => weekdayOf(s.date) === input.weekday,
  );

  return [
    ...mapConflicts(
      schedules.map((s) => ({
        ...s,
        label: `${s.classroom.name} — ${s.teacher.lastName} ${s.teacher.firstName}`,
      })),
      input,
      "SCHEDULE",
    ),
    ...mapConflicts(
      sameWeekday.map((s) => ({
        ...s,
        label: `${s.classroom.name} — ${s.teacher.lastName} ${s.teacher.firstName} (${s.date.toISOString().slice(0, 10)})`,
      })),
      input,
      "SESSION",
    ),
  ];
}

/** Conflits pour une séance à une date précise. */
async function findSessionConflicts(
  tx: Tx,
  ctx: SchoolCtx,
  input: SlotTarget & {
    date: Date;
    excludeSessionId?: string;
    excludeScheduleId?: string;
  },
): Promise<ConflictInfo[]> {
  const weekday = weekdayOf(input.date);

  const sessions = await tx.courseSession.findMany({
    where: {
      schoolId: ctx.schoolId,
      date: input.date,
      status: { notIn: ["CANCELLED", "POSTPONED"] },
      ...(input.excludeSessionId ? { id: { not: input.excludeSessionId } } : {}),
      startMin: { lt: input.endMin },
      endMin: { gt: input.startMin },
      AND: [
        {
          OR: [
            { classroomId: input.classroomId },
            { teacherId: input.teacherId },
            ...(input.roomId ? [{ roomId: input.roomId }] : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      classroomId: true,
      teacherId: true,
      roomId: true,
      classroom: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  const schedules = await tx.courseSchedule.findMany({
    where: {
      schoolId: ctx.schoolId,
      weekday,
      status: "ACTIVE",
      ...(input.excludeScheduleId
        ? { id: { not: input.excludeScheduleId } }
        : {}),
      startMin: { lt: input.endMin },
      endMin: { gt: input.startMin },
      validFrom: { lte: input.date },
      OR: [{ validUntil: null }, { validUntil: { gte: input.date } }],
      AND: [
        {
          OR: [
            { classroomId: input.classroomId },
            { teacherId: input.teacherId },
            ...(input.roomId ? [{ roomId: input.roomId }] : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      classroomId: true,
      teacherId: true,
      roomId: true,
      classroom: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  return [
    ...mapConflicts(
      sessions.map((s) => ({
        ...s,
        label: `${s.classroom.name} — ${s.teacher.lastName} ${s.teacher.firstName}`,
      })),
      input,
      "SESSION",
    ),
    ...mapConflicts(
      schedules.map((s) => ({
        ...s,
        label: `${s.classroom.name} — ${s.teacher.lastName} ${s.teacher.firstName}`,
      })),
      input,
      "SCHEDULE",
    ),
  ];
}

function conflictError(conflicts: ConflictInfo[]): {
  ok: false;
  error: SchedulesError;
  conflicts: ConflictInfo[];
} {
  const first = conflicts[0];
  const error: SchedulesError =
    first.dimension === "ROOM"
      ? "CONFLICT_ROOM"
      : first.dimension === "TEACHER"
        ? "CONFLICT_TEACHER"
        : "CONFLICT_CLASSROOM";
  return { ok: false, error, conflicts };
}

// ---------- Référentiels : vérification tenant ----------

async function assertRefs(
  ctx: SchoolCtx,
  input: {
    academicYearId: string;
    classroomId: string;
    teacherId: string;
    subjectId?: string | null;
    roomId?: string | null;
  },
): Promise<SchedulesError | null> {
  const [year, classroom, teacher, subject, room] = await Promise.all([
    prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { status: true },
    }),
    prisma.classroom.findFirst({
      where: {
        id: input.classroomId,
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
      },
      select: { id: true },
    }),
    prisma.teacher.findFirst({
      where: { id: input.teacherId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    input.subjectId
      ? prisma.subject.findFirst({
          where: { id: input.subjectId, schoolId: ctx.schoolId },
          select: { id: true },
        })
      : Promise.resolve({ id: "" }),
    input.roomId
      ? prisma.room.findFirst({
          where: { id: input.roomId, schoolId: ctx.schoolId, status: "ACTIVE" },
          select: { id: true },
        })
      : Promise.resolve({ id: "" }),
  ]);

  if (!year || !classroom || !teacher || !subject || !room) {
    return "NOT_FOUND";
  }
  if (year.status === "CLOSED") return "YEAR_CLOSED";
  return null;
}

// ---------- Créneaux récurrents ----------

export async function createSchedule(
  ctx: SchoolCtx,
  input: {
    academicYearId: string;
    classroomId: string;
    teacherId: string;
    subjectId?: string;
    roomId?: string;
    weekday: Weekday;
    startMin: number;
    endMin: number;
    validFrom: string;
    validUntil?: string;
  },
): Promise<SchedulesResult<{ id: string }>> {
  if (!(input.startMin >= 0 && input.endMin > input.startMin && input.endMin <= 1440)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const validFrom = new Date(input.validFrom);
  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (Number.isNaN(validFrom.getTime()) || (validUntil && validUntil < validFrom)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const refError = await assertRefs(ctx, {
    academicYearId: input.academicYearId,
    classroomId: input.classroomId,
    teacherId: input.teacherId,
    subjectId: input.subjectId,
    roomId: input.roomId,
  });
  if (refError) return { ok: false, error: refError };

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const conflicts = await findScheduleConflicts(tx, ctx, {
          ...input,
          roomId: input.roomId ?? null,
          validFrom,
          validUntil,
        });
        if (conflicts.length > 0) return { conflicts };

        const row = await tx.courseSchedule.create({
          data: {
            schoolId: ctx.schoolId,
            academicYearId: input.academicYearId,
            classroomId: input.classroomId,
            teacherId: input.teacherId,
            subjectId: input.subjectId || null,
            roomId: input.roomId || null,
            weekday: input.weekday,
            startMin: input.startMin,
            endMin: input.endMin,
            validFrom,
            validUntil,
          },
          select: { id: true },
        });
        return { row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("conflicts" in created) return conflictError(created.conflicts ?? []);

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "schedule.create",
      entity: "CourseSchedule",
      entityId: created.row.id,
      metadata: {
        classroomId: input.classroomId,
        weekday: input.weekday,
        startMin: input.startMin,
        endMin: input.endMin,
      },
    });

    return { ok: true, result: { id: created.row.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateSchedule(
  ctx: SchoolCtx,
  scheduleId: string,
  input: {
    weekday?: Weekday;
    startMin?: number;
    endMin?: number;
    teacherId?: string;
    subjectId?: string | null;
    roomId?: string | null;
    validFrom?: string;
    validUntil?: string | null;
    status?: "ACTIVE" | "ARCHIVED";
  },
): Promise<SchedulesResult> {
  const current = await prisma.courseSchedule.findFirst({
    where: { id: scheduleId, schoolId: ctx.schoolId },
    select: {
      id: true,
      classroomId: true,
      teacherId: true,
      roomId: true,
      weekday: true,
      startMin: true,
      endMin: true,
      validFrom: true,
      validUntil: true,
      academicYear: { select: { status: true } },
    },
  });
  if (!current) return { ok: false, error: "NOT_FOUND" };
  if (current.academicYear.status === "CLOSED") {
    return { ok: false, error: "YEAR_CLOSED" };
  }

  if (input.teacherId) {
    const t = await prisma.teacher.findFirst({
      where: { id: input.teacherId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!t) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.subjectId) {
    const s = await prisma.subject.findFirst({
      where: { id: input.subjectId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!s) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.roomId) {
    const r = await prisma.room.findFirst({
      where: { id: input.roomId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!r) return { ok: false, error: "NOT_FOUND" };
  }

  const next = {
    weekday: input.weekday ?? current.weekday,
    startMin: input.startMin ?? current.startMin,
    endMin: input.endMin ?? current.endMin,
    teacherId: input.teacherId ?? current.teacherId,
    roomId:
      input.roomId !== undefined ? input.roomId || null : current.roomId,
    validFrom: input.validFrom ? new Date(input.validFrom) : current.validFrom,
    validUntil:
      input.validUntil !== undefined
        ? input.validUntil
          ? new Date(input.validUntil)
          : null
        : current.validUntil,
  };
  if (next.endMin <= next.startMin) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    const res = await prisma.$transaction(
      async (tx) => {
        if (input.status !== "ARCHIVED") {
          const conflicts = await findScheduleConflicts(tx, ctx, {
            classroomId: current.classroomId,
            teacherId: next.teacherId,
            roomId: next.roomId,
            weekday: next.weekday,
            startMin: next.startMin,
            endMin: next.endMin,
            validFrom: next.validFrom,
            validUntil: next.validUntil,
            excludeScheduleId: scheduleId,
          });
          if (conflicts.length > 0) return { conflicts };
        }

        await tx.courseSchedule.update({
          where: { id: scheduleId },
          data: {
            weekday: next.weekday,
            startMin: next.startMin,
            endMin: next.endMin,
            teacherId: next.teacherId,
            roomId: next.roomId,
            validFrom: next.validFrom,
            validUntil: next.validUntil,
            ...(input.subjectId !== undefined
              ? { subjectId: input.subjectId || null }
              : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
          select: { id: true },
        });
        return { done: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("conflicts" in res) return conflictError(res.conflicts ?? []);

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "schedule.update",
      entity: "CourseSchedule",
      entityId: scheduleId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Séances ----------

export async function createSession(
  ctx: SchoolCtx,
  input: {
    classroomId: string;
    teacherId: string;
    academicYearId?: string;
    subjectId?: string;
    roomId?: string;
    date: string;
    startMin: number;
    endMin: number;
    scheduleId?: string;
  },
): Promise<SchedulesResult<{ id: string }>> {
  const parsedDate = parseDay(input.date);
  if (!parsedDate || !(input.endMin > input.startMin && input.endMin <= 1440)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const date = parsedDate;

  const classroom = await prisma.classroom.findFirst({
    where: { id: input.classroomId, schoolId: ctx.schoolId },
    select: { id: true, academicYearId: true },
  });
  if (!classroom) return { ok: false, error: "NOT_FOUND" };

  const academicYearId = input.academicYearId ?? classroom.academicYearId;
  const refError = await assertRefs(ctx, {
    academicYearId,
    classroomId: input.classroomId,
    teacherId: input.teacherId,
    subjectId: input.subjectId,
    roomId: input.roomId,
  });
  if (refError) return { ok: false, error: refError };

  try {
    const res = await prisma.$transaction(
      async (tx) => {
        const conflicts = await findSessionConflicts(tx, ctx, {
          classroomId: input.classroomId,
          teacherId: input.teacherId,
          roomId: input.roomId ?? null,
          date,
          startMin: input.startMin,
          endMin: input.endMin,
          excludeScheduleId: input.scheduleId,
        });
        if (conflicts.length > 0) return { conflicts };

        const row = await tx.courseSession.create({
          data: {
            schoolId: ctx.schoolId,
            scheduleId: input.scheduleId || null,
            academicYearId,
            classroomId: input.classroomId,
            teacherId: input.teacherId,
            subjectId: input.subjectId || null,
            roomId: input.roomId || null,
            date,
            startMin: input.startMin,
            endMin: input.endMin,
          },
          select: { id: true },
        });
        return { row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("conflicts" in res) return conflictError(res.conflicts ?? []);

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "session.create",
      entity: "CourseSession",
      entityId: res.row.id,
      metadata: {
        classroomId: input.classroomId,
        date: date.toISOString().slice(0, 10),
      },
    });

    return { ok: true, result: { id: res.row.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/** Matérialise une séance réelle à partir d'un créneau récurrent pour une date. */
export async function ensureSessionFromSchedule(
  ctx: SchoolCtx,
  scheduleId: string,
  dateStr: string,
): Promise<SchedulesResult<{ id: string }>> {
  const schedule = await prisma.courseSchedule.findFirst({
    where: { id: scheduleId, schoolId: ctx.schoolId },
    select: {
      id: true,
      classroomId: true,
      teacherId: true,
      subjectId: true,
      roomId: true,
      academicYearId: true,
      weekday: true,
      startMin: true,
      endMin: true,
      validFrom: true,
      validUntil: true,
      status: true,
    },
  });
  if (!schedule || schedule.status !== "ACTIVE") {
    return { ok: false, error: "NOT_FOUND" };
  }

  const parsedDate = parseDay(dateStr);
  if (!parsedDate) return { ok: false, error: "INVALID_INPUT" };
  const date = parsedDate;
  if (weekdayOf(date) !== schedule.weekday) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  // Comparaison en dates (YYYY-MM-DD) pour éviter les décalages de fuseau
  const dateIso = date.toISOString().slice(0, 10);
  const fromIso = schedule.validFrom.toISOString().slice(0, 10);
  const untilIso = schedule.validUntil
    ? schedule.validUntil.toISOString().slice(0, 10)
    : null;
  if (dateIso < fromIso || (untilIso !== null && dateIso > untilIso)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const existing = await prisma.courseSession.findFirst({
    where: { scheduleId, date },
    select: { id: true, status: true },
  });
  if (existing) {
    return existing.status === "CANCELLED"
      ? { ok: false, error: "NOT_FOUND" }
      : { ok: true, result: { id: existing.id } };
  }

  try {
    const res = await prisma.$transaction(
      async (tx) => {
        const conflicts = await findSessionConflicts(tx, ctx, {
          classroomId: schedule.classroomId,
          teacherId: schedule.teacherId,
          roomId: schedule.roomId,
          date,
          startMin: schedule.startMin,
          endMin: schedule.endMin,
          excludeScheduleId: scheduleId,
        });
        if (conflicts.length > 0) return { conflicts };

        const row = await tx.courseSession.create({
          data: {
            schoolId: ctx.schoolId,
            scheduleId,
            academicYearId: schedule.academicYearId,
            classroomId: schedule.classroomId,
            teacherId: schedule.teacherId,
            subjectId: schedule.subjectId,
            roomId: schedule.roomId,
            date,
            startMin: schedule.startMin,
            endMin: schedule.endMin,
          },
          select: { id: true },
        });
        return { row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("conflicts" in res) return conflictError(res.conflicts ?? []);
    return { ok: true, result: { id: res.row.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function moveSession(
  ctx: SchoolCtx,
  sessionId: string,
  input: { date: string; startMin: number; endMin: number },
): Promise<SchedulesResult> {
  const session = await prisma.courseSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: {
      id: true,
      scheduleId: true,
      classroomId: true,
      teacherId: true,
      roomId: true,
      status: true,
    },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };
  if (session.status === "CANCELLED") return { ok: false, error: "INVALID_INPUT" };

  const parsedDate = parseDay(input.date);
  if (!parsedDate || !(input.endMin > input.startMin && input.endMin <= 1440)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const date = parsedDate;

  try {
    const res = await prisma.$transaction(
      async (tx) => {
        const conflicts = await findSessionConflicts(tx, ctx, {
          classroomId: session.classroomId,
          teacherId: session.teacherId,
          roomId: session.roomId,
          date,
          startMin: input.startMin,
          endMin: input.endMin,
          excludeSessionId: sessionId,
          excludeScheduleId: session.scheduleId ?? undefined,
        });
        if (conflicts.length > 0) return { conflicts };

        await tx.courseSession.update({
          where: { id: sessionId },
          data: {
            date,
            startMin: input.startMin,
            endMin: input.endMin,
            status: "PLANNED" satisfies SessionStatus,
          },
          select: { id: true },
        });
        return { done: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("conflicts" in res) return conflictError(res.conflicts ?? []);

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "session.move",
      entity: "CourseSession",
      entityId: sessionId,
      metadata: { date: input.date, startMin: input.startMin },
    });

    return { ok: true, result: undefined };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function setSessionStatus(
  ctx: SchoolCtx,
  sessionId: string,
  status: "PLANNED" | "DONE" | "CANCELLED" | "POSTPONED",
  cancellationReason?: string,
): Promise<SchedulesResult> {
  const session = await prisma.courseSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.courseSession.update({
      where: { id: sessionId },
      data: {
        status,
        cancellationReason:
          status === "CANCELLED" || status === "POSTPONED"
            ? cancellationReason || null
            : null,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: `session.${status.toLowerCase()}`,
      entity: "CourseSession",
      entityId: sessionId,
      metadata: { reason: cancellationReason ?? null },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function replaceSessionTeacher(
  ctx: SchoolCtx,
  sessionId: string,
  newTeacherId: string,
): Promise<SchedulesResult> {
  const session = await prisma.courseSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: {
      id: true,
      scheduleId: true,
      classroomId: true,
      roomId: true,
      date: true,
      startMin: true,
      endMin: true,
      status: true,
    },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };
  if (session.status === "CANCELLED") return { ok: false, error: "INVALID_INPUT" };

  const teacher = await prisma.teacher.findFirst({
    where: { id: newTeacherId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!teacher) return { ok: false, error: "NOT_FOUND" };

  try {
    const res = await prisma.$transaction(
      async (tx) => {
        const conflicts = await findSessionConflicts(tx, ctx, {
          classroomId: session.classroomId,
          teacherId: newTeacherId,
          roomId: session.roomId,
          date: session.date,
          startMin: session.startMin,
          endMin: session.endMin,
          excludeSessionId: sessionId,
          excludeScheduleId: session.scheduleId ?? undefined,
        });
        if (conflicts.length > 0) return { conflicts };

        await tx.courseSession.update({
          where: { id: sessionId },
          data: { teacherId: newTeacherId },
          select: { id: true },
        });
        return { done: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("conflicts" in res) return conflictError(res.conflicts ?? []);

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "session.replaceTeacher",
      entity: "CourseSession",
      entityId: sessionId,
      metadata: { newTeacherId },
    });

    return { ok: true, result: undefined };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Cahier de textes ----------

export async function upsertSessionContent(
  ctx: SchoolCtx,
  sessionId: string,
  input: {
    theme?: string;
    chapter?: string;
    objective?: string;
    content?: string;
    homework?: string;
    notes?: string;
  },
): Promise<SchedulesResult> {
  const session = await prisma.courseSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };

  const data = {
    theme: input.theme || null,
    chapter: input.chapter || null,
    objective: input.objective || null,
    content: input.content || null,
    homework: input.homework || null,
    notes: input.notes || null,
  };

  try {
    await prisma.courseContent.upsert({
      where: { sessionId },
      create: { sessionId, ...data },
      update: data,
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "courseContent.upsert",
      entity: "CourseContent",
      entityId: sessionId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Lecture : emploi du temps d'une semaine ----------

export type TimetableSlot = {
  source: "SCHEDULE" | "SESSION";
  id: string;
  scheduleId?: string;
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  startMin: number;
  endMin: number;
  classroomId: string;
  classroomName: string;
  subjectName: string | null;
  teacherId: string;
  teacherName: string;
  roomName: string | null;
  status: SessionStatus | null; // null = créneau planifié non matérialisé
};

/** Lundi (minuit UTC) de la semaine contenant `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7)); // lundi
  return d;
}

export async function getWeekTimetable(
  ctx: { schoolId: string },
  filters: {
    weekStart: Date;
    academicYearId?: string;
    classroomId?: string;
    levelId?: string;
    teacherId?: string;
    subjectId?: string;
    roomId?: string;
  },
): Promise<TimetableSlot[]> {
  const ws = new Date(
    Date.UTC(
      filters.weekStart.getUTCFullYear(),
      filters.weekStart.getUTCMonth(),
      filters.weekStart.getUTCDate(),
    ),
  );
  const we = new Date(ws.getTime() + 7 * 86400000);

  const [schedules, sessions] = await Promise.all([
    prisma.courseSchedule.findMany({
      where: {
        schoolId: ctx.schoolId,
        status: "ACTIVE",
        academicYearId: filters.academicYearId,
        classroomId: filters.classroomId,
        teacherId: filters.teacherId,
        subjectId: filters.subjectId,
        roomId: filters.roomId,
        ...(filters.levelId
          ? { classroom: { levelId: filters.levelId } }
          : {}),
        validFrom: { lt: we },
        OR: [{ validUntil: null }, { validUntil: { gte: ws } }],
      },
      select: {
        id: true,
        weekday: true,
        startMin: true,
        endMin: true,
        validFrom: true,
        validUntil: true,
        classroomId: true,
        classroom: { select: { name: true } },
        subject: { select: { name: true } },
        teacherId: true,
        teacher: { select: { firstName: true, lastName: true } },
        room: { select: { name: true } },
      },
    }),
    prisma.courseSession.findMany({
      where: {
        schoolId: ctx.schoolId,
        date: { gte: ws, lt: we },
        academicYearId: filters.academicYearId,
        classroomId: filters.classroomId,
        teacherId: filters.teacherId,
        subjectId: filters.subjectId,
        roomId: filters.roomId,
        ...(filters.levelId
          ? { classroom: { levelId: filters.levelId } }
          : {}),
      },
      select: {
        id: true,
        scheduleId: true,
        date: true,
        startMin: true,
        endMin: true,
        status: true,
        movedToDate: true,
        classroomId: true,
        classroom: { select: { name: true } },
        subject: { select: { name: true } },
        teacherId: true,
        teacher: { select: { firstName: true, lastName: true } },
        room: { select: { name: true } },
      },
    }),
  ]);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // Séances liées à un créneau, par (scheduleId, date) pour remplacer le slot
  const sessionBySchedule = new Map<string, (typeof sessions)[number]>();
  const standaloneSessions: typeof sessions = [];
  for (const s of sessions) {
    if (s.scheduleId) {
      sessionBySchedule.set(`${s.scheduleId}|${fmt(s.date)}`, s);
    } else {
      standaloneSessions.push(s);
    }
  }

  const slots: TimetableSlot[] = [];

  for (const s of schedules) {
    const dayOffset = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ].indexOf(s.weekday);
    if (dayOffset === -1) continue;
    const date = new Date(ws.getTime() + dayOffset * 86400000);
    const dateIso = fmt(date);
    if (dateIso < fmt(s.validFrom)) continue;
    if (s.validUntil && dateIso > fmt(s.validUntil)) continue;

    const override = sessionBySchedule.get(`${s.id}|${fmt(date)}`);
    if (override) {
      if (override.status !== "CANCELLED") {
        slots.push({
          source: "SESSION",
          id: override.id,
          scheduleId: s.id,
          date: fmt(override.movedToDate ?? override.date),
          weekday: s.weekday,
          startMin: override.startMin,
          endMin: override.endMin,
          classroomId: override.classroomId,
          classroomName: override.classroom.name,
          subjectName: override.subject?.name ?? s.subject?.name ?? null,
          teacherId: override.teacherId,
          teacherName: `${override.teacher.lastName} ${override.teacher.firstName}`,
          roomName: override.room?.name ?? s.room?.name ?? null,
          status: override.status,
        });
      }
      continue;
    }

    slots.push({
      source: "SCHEDULE",
      id: s.id,
      scheduleId: s.id,
      date: fmt(date),
      weekday: s.weekday,
      startMin: s.startMin,
      endMin: s.endMin,
      classroomId: s.classroomId,
      classroomName: s.classroom.name,
      subjectName: s.subject?.name ?? null,
      teacherId: s.teacherId,
      teacherName: `${s.teacher.lastName} ${s.teacher.firstName}`,
      roomName: s.room?.name ?? null,
      status: null,
    });
  }

  for (const s of standaloneSessions) {
    slots.push({
      source: "SESSION",
      id: s.id,
      date: fmt(s.movedToDate ?? s.date),
      weekday: weekdayOf(s.movedToDate ?? s.date),
      startMin: s.startMin,
      endMin: s.endMin,
      classroomId: s.classroomId,
      classroomName: s.classroom.name,
      subjectName: s.subject?.name ?? null,
      teacherId: s.teacherId,
      teacherName: `${s.teacher.lastName} ${s.teacher.firstName}`,
      roomName: s.room?.name ?? null,
      status: s.status,
    });
  }

  return slots.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin,
  );
}
