import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type ClassesError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "YEAR_CLOSED"
  | "HAS_ENROLLED"
  | "HAS_DEPENDENCIES"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type ClassesResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ClassesError };

type SchoolCtx = { userId: string; schoolId: string };

// ---------- Levels ----------

export async function listLevels(ctx: SchoolCtx, includeArchived = false) {
  return prisma.level.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(includeArchived ? {} : { status: "ACTIVE" }),
    },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      order: true,
      status: true,
      _count: { select: { classrooms: true } },
    },
  });
}

/** Nombre de classes actives par niveau (avertissement avant archivage). */
export async function countActiveClassroomsByLevel(ctx: SchoolCtx) {
  const rows = await prisma.classroom.groupBy({
    by: ["levelId"],
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.levelId, r._count._all]));
}

export async function createLevel(
  ctx: SchoolCtx,
  input: { name: string; order: number },
): Promise<ClassesResult<{ id: string }>> {
  try {
    const level = await prisma.level.create({
      data: {
        schoolId: ctx.schoolId,
        name: input.name,
        order: input.order,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "level.create",
      entity: "Level",
      entityId: level.id,
      metadata: { name: input.name },
    });

    return { ok: true, result: { id: level.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateLevel(
  ctx: SchoolCtx,
  levelId: string,
  input: { name?: string; order?: number; status?: "ACTIVE" | "ARCHIVED" },
): Promise<ClassesResult> {
  const level = await prisma.level.findFirst({
    where: { id: levelId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!level) return { ok: false, error: "NOT_FOUND" };

  if (input.status === "ARCHIVED") {
    const activeClassrooms = await prisma.classroom.count({
      where: { levelId, schoolId: ctx.schoolId, status: "ACTIVE" },
    });
    if (activeClassrooms > 0) {
      return { ok: false, error: "HAS_DEPENDENCIES" };
    }
  }

  try {
    await prisma.level.update({
      where: { id: levelId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "level.update",
      entity: "Level",
      entityId: levelId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Classrooms ----------

export async function listClassrooms(
  ctx: SchoolCtx,
  filters: {
    academicYearId?: string;
    levelId?: string;
    status?: "ACTIVE" | "ARCHIVED";
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 20));
  const q = filters.q?.trim();

  const where = {
    schoolId: ctx.schoolId,
    ...(filters.academicYearId
      ? { academicYearId: filters.academicYearId }
      : {}),
    ...(filters.levelId ? { levelId: filters.levelId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { section: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.classroom.count({ where }),
    prisma.classroom.findMany({
      where,
      orderBy: [{ academicYear: { startDate: "desc" } }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        section: true,
        capacity: true,
        room: true,
        status: true,
        academicYear: { select: { id: true, name: true, isCurrent: true } },
        level: { select: { id: true, name: true } },
        headTeacher: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getClassroom(ctx: SchoolCtx, classroomId: string) {
  return prisma.classroom.findFirst({
    where: { id: classroomId, schoolId: ctx.schoolId },
    select: {
      id: true,
      name: true,
      section: true,
      capacity: true,
      room: true,
      status: true,
      createdAt: true,
      academicYear: {
        select: { id: true, name: true, isCurrent: true, status: true },
      },
      level: { select: { id: true, name: true } },
      headTeacher: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      _count: {
        select: { enrollments: { where: { status: "ENROLLED" } } },
      },
    },
  });
}

async function assertYearAndLevel(
  ctx: SchoolCtx,
  academicYearId: string,
  levelId: string,
) {
  const [year, level] = await Promise.all([
    prisma.academicYear.findFirst({
      where: { id: academicYearId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    }),
    prisma.level.findFirst({
      where: { id: levelId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
  ]);
  if (!year || !level) return { error: "NOT_FOUND" as const };
  if (year.status === "CLOSED") return { error: "YEAR_CLOSED" as const };
  return { error: null };
}

async function assertHeadTeacher(ctx: SchoolCtx, headTeacherId: string | null) {
  if (!headTeacherId) return true;
  const teacher = await prisma.teacher.findFirst({
    where: { id: headTeacherId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  return teacher !== null;
}

export async function createClassroom(
  ctx: SchoolCtx,
  input: {
    name: string;
    academicYearId: string;
    levelId: string;
    section?: string;
    capacity?: number;
    room?: string;
    headTeacherId?: string;
  },
): Promise<ClassesResult<{ id: string }>> {
  const check = await assertYearAndLevel(ctx, input.academicYearId, input.levelId);
  if (check.error) return { ok: false, error: check.error };
  if (!(await assertHeadTeacher(ctx, input.headTeacherId ?? null))) {
    return { ok: false, error: "NOT_FOUND" };
  }

  try {
    const classroom = await prisma.classroom.create({
      data: {
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
        levelId: input.levelId,
        headTeacherId: input.headTeacherId || null,
        name: input.name,
        section: input.section || null,
        capacity: input.capacity ?? null,
        room: input.room || null,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "classroom.create",
      entity: "Classroom",
      entityId: classroom.id,
      metadata: { name: input.name, academicYearId: input.academicYearId },
    });

    return { ok: true, result: { id: classroom.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateClassroom(
  ctx: SchoolCtx,
  classroomId: string,
  input: {
    name?: string;
    levelId?: string;
    section?: string;
    capacity?: number | null;
    room?: string;
    headTeacherId?: string | null;
    status?: "ACTIVE" | "ARCHIVED";
  },
): Promise<ClassesResult> {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId: ctx.schoolId },
    select: { id: true, academicYear: { select: { status: true } } },
  });
  if (!classroom) return { ok: false, error: "NOT_FOUND" };
  if (classroom.academicYear.status === "CLOSED") {
    return { ok: false, error: "YEAR_CLOSED" };
  }

  // Archivage bloqué tant que des élèves y sont inscrits (ENROLLED) :
  // les inscriptions historiques (TRANSFERRED/WITHDRAWN/COMPLETED) ne
  // bloquent pas — l'historique est préservé via onDelete Restrict.
  if (input.status === "ARCHIVED") {
    const enrolled = await prisma.enrollment.count({
      where: { classroomId, schoolId: ctx.schoolId, status: "ENROLLED" },
    });
    if (enrolled > 0) return { ok: false, error: "HAS_ENROLLED" };
  }

  if (input.levelId) {
    const level = await prisma.level.findFirst({
      where: { id: input.levelId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!level) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.headTeacherId) {
    if (!(await assertHeadTeacher(ctx, input.headTeacherId))) {
      return { ok: false, error: "NOT_FOUND" };
    }
  }

  try {
    await prisma.classroom.update({
      where: { id: classroomId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.levelId !== undefined ? { levelId: input.levelId } : {}),
        ...(input.section !== undefined ? { section: input.section || null } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.room !== undefined ? { room: input.room || null } : {}),
        ...(input.headTeacherId !== undefined
          ? { headTeacherId: input.headTeacherId }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "classroom.update",
      entity: "Classroom",
      entityId: classroomId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
