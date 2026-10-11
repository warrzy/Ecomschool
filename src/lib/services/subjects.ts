import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type SubjectsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "ALREADY_ASSIGNED"
  | "CREATE_FAILED"
  | "UPDATE_FAILED"
  | "DELETE_FAILED";

export type SubjectsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: SubjectsError };

type SchoolCtx = { userId: string; schoolId: string };

export async function listSubjects(
  ctx: SchoolCtx,
  filters: {
    status?: "ACTIVE" | "ARCHIVED";
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const q = filters.q?.trim();

  const where = {
    schoolId: ctx.schoolId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { code: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.subject.count({ where }),
    prisma.subject.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        _count: {
          select: { levelAssignments: true, classAssignments: true },
        },
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getSubject(ctx: SchoolCtx, subjectId: string) {
  return prisma.subject.findFirst({
    where: { id: subjectId, schoolId: ctx.schoolId },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      levelAssignments: {
        orderBy: { level: { order: "asc" } },
        select: {
          id: true,
          coefficient: true,
          level: { select: { id: true, name: true } },
        },
      },
      classAssignments: {
        orderBy: { classroom: { name: "asc" } },
        select: {
          id: true,
          coefficient: true,
          classroom: {
            select: {
              id: true,
              name: true,
              academicYear: { select: { name: true, isCurrent: true } },
            },
          },
          teacher: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
}

export async function createSubject(
  ctx: SchoolCtx,
  input: { name: string; code?: string },
): Promise<SubjectsResult<{ id: string }>> {
  try {
    const subject = await prisma.subject.create({
      data: {
        schoolId: ctx.schoolId,
        name: input.name,
        code: input.code || null,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "subject.create",
      entity: "Subject",
      entityId: subject.id,
      metadata: { name: input.name },
    });

    return { ok: true, result: { id: subject.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateSubject(
  ctx: SchoolCtx,
  subjectId: string,
  input: { name?: string; code?: string; status?: "ACTIVE" | "ARCHIVED" },
): Promise<SubjectsResult> {
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!subject) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.subject.update({
      where: { id: subjectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "subject.update",
      entity: "Subject",
      entityId: subjectId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Level coefficients ----------

export async function setLevelCoefficient(
  ctx: SchoolCtx,
  input: { subjectId: string; levelId: string; coefficient: number },
): Promise<SubjectsResult<{ id: string }>> {
  if (!(input.coefficient > 0)) return { ok: false, error: "INVALID_INPUT" };

  const [subject, level] = await Promise.all([
    prisma.subject.findFirst({
      where: { id: input.subjectId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.level.findFirst({
      where: { id: input.levelId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
  ]);
  if (!subject || !level) return { ok: false, error: "NOT_FOUND" };

  try {
    const row = await prisma.levelSubject.upsert({
      where: {
        levelId_subjectId: {
          levelId: input.levelId,
          subjectId: input.subjectId,
        },
      },
      create: {
        schoolId: ctx.schoolId,
        levelId: input.levelId,
        subjectId: input.subjectId,
        coefficient: input.coefficient,
      },
      update: { coefficient: input.coefficient },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "levelSubject.set",
      entity: "LevelSubject",
      entityId: row.id,
      metadata: {
        levelId: input.levelId,
        subjectId: input.subjectId,
        coefficient: input.coefficient,
      },
    });

    return { ok: true, result: { id: row.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function removeLevelCoefficient(
  ctx: SchoolCtx,
  levelSubjectId: string,
): Promise<SubjectsResult> {
  const row = await prisma.levelSubject.findFirst({
    where: { id: levelSubjectId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.levelSubject.delete({ where: { id: levelSubjectId } });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "levelSubject.remove",
      entity: "LevelSubject",
      entityId: levelSubjectId,
    });
    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "DELETE_FAILED" };
  }
}

// ---------- Classroom coefficients + teacher ----------

export async function setClassroomSubject(
  ctx: SchoolCtx,
  input: {
    classroomId: string;
    subjectId: string;
    coefficient: number;
    teacherId?: string;
  },
): Promise<SubjectsResult<{ id: string }>> {
  if (!(input.coefficient > 0)) return { ok: false, error: "INVALID_INPUT" };

  const [classroom, subject, teacher] = await Promise.all([
    prisma.classroom.findFirst({
      where: { id: input.classroomId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.subject.findFirst({
      where: { id: input.subjectId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    input.teacherId
      ? prisma.teacher.findFirst({
          where: { id: input.teacherId, schoolId: ctx.schoolId },
          select: { id: true },
        })
      : Promise.resolve({ id: "" }),
  ]);
  if (!classroom || !subject || !teacher) {
    return { ok: false, error: "NOT_FOUND" };
  }

  try {
    const row = await prisma.classroomSubject.upsert({
      where: {
        classroomId_subjectId: {
          classroomId: input.classroomId,
          subjectId: input.subjectId,
        },
      },
      create: {
        schoolId: ctx.schoolId,
        classroomId: input.classroomId,
        subjectId: input.subjectId,
        teacherId: input.teacherId || null,
        coefficient: input.coefficient,
      },
      update: {
        coefficient: input.coefficient,
        ...(input.teacherId !== undefined
          ? { teacherId: input.teacherId || null }
          : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "classroomSubject.set",
      entity: "ClassroomSubject",
      entityId: row.id,
      metadata: {
        classroomId: input.classroomId,
        subjectId: input.subjectId,
        coefficient: input.coefficient,
        teacherId: input.teacherId ?? null,
      },
    });

    return { ok: true, result: { id: row.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function removeClassroomSubject(
  ctx: SchoolCtx,
  classroomSubjectId: string,
): Promise<SubjectsResult> {
  const row = await prisma.classroomSubject.findFirst({
    where: { id: classroomSubjectId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.classroomSubject.delete({ where: { id: classroomSubjectId } });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "classroomSubject.remove",
      entity: "ClassroomSubject",
      entityId: classroomSubjectId,
    });
    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "DELETE_FAILED" };
  }
}
