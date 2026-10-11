import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { createSchoolUser } from "@/lib/services/users";

export type TeachersError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "ALREADY_LINKED"
  | "CREATE_FAILED"
  | "UPDATE_FAILED"
  | "DELETE_FAILED";

export type TeachersResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: TeachersError };

type SchoolCtx = { userId: string; schoolId: string };

export async function listTeachers(
  ctx: SchoolCtx,
  filters: {
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
    ...(filters.status ? { status: filters.status } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.teacher.count({ where }),
    prisma.teacher.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        userId: true,
        _count: { select: { assignments: true, headOfClassrooms: true } },
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getTeacher(ctx: SchoolCtx, teacherId: string) {
  return prisma.teacher.findFirst({
    where: { id: teacherId, schoolId: ctx.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
      userId: true,
      user: { select: { email: true, status: true } },
      headOfClassrooms: {
        select: { id: true, name: true, academicYear: { select: { name: true } } },
      },
      assignments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          classroom: {
            select: {
              id: true,
              name: true,
              level: { select: { name: true } },
            },
          },
          subject: { select: { id: true, name: true } },
          academicYear: { select: { id: true, name: true, isCurrent: true } },
        },
      },
    },
  });
}

export async function createTeacher(
  ctx: SchoolCtx,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  },
): Promise<TeachersResult<{ id: string }>> {
  try {
    const teacher = await prisma.teacher.create({
      data: {
        schoolId: ctx.schoolId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email?.toLowerCase() || null,
        phone: input.phone || null,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "teacher.create",
      entity: "Teacher",
      entityId: teacher.id,
      metadata: { name: `${input.lastName} ${input.firstName}` },
    });

    return { ok: true, result: { id: teacher.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateTeacher(
  ctx: SchoolCtx,
  teacherId: string,
  input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    status?: "ACTIVE" | "ARCHIVED";
  },
): Promise<TeachersResult> {
  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!teacher) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.email !== undefined
          ? { email: input.email.toLowerCase() || null }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "teacher.update",
      entity: "Teacher",
      entityId: teacherId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Assignments ----------

export async function assignTeacher(
  ctx: SchoolCtx,
  input: {
    teacherId: string;
    classroomId: string;
    subjectId?: string;
    academicYearId: string;
  },
): Promise<TeachersResult<{ id: string }>> {
  const [teacher, classroom, subject, year] = await Promise.all([
    prisma.teacher.findFirst({
      where: { id: input.teacherId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.classroom.findFirst({
      where: {
        id: input.classroomId,
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
      },
      select: { id: true },
    }),
    input.subjectId
      ? prisma.subject.findFirst({
          where: { id: input.subjectId, schoolId: ctx.schoolId },
          select: { id: true },
        })
      : Promise.resolve({ id: "" }),
    prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    }),
  ]);

  if (!teacher || !classroom || !subject || !year) {
    return { ok: false, error: "NOT_FOUND" };
  }

  try {
    const assignment = await prisma.teachingAssignment.create({
      data: {
        schoolId: ctx.schoolId,
        teacherId: input.teacherId,
        classroomId: input.classroomId,
        subjectId: input.subjectId || null,
        academicYearId: input.academicYearId,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "teachingAssignment.create",
      entity: "TeachingAssignment",
      entityId: assignment.id,
      metadata: {
        teacherId: input.teacherId,
        classroomId: input.classroomId,
        subjectId: input.subjectId ?? null,
      },
    });

    return { ok: true, result: { id: assignment.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function removeAssignment(
  ctx: SchoolCtx,
  assignmentId: string,
): Promise<TeachersResult> {
  const assignment = await prisma.teachingAssignment.findFirst({
    where: { id: assignmentId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!assignment) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.teachingAssignment.delete({ where: { id: assignmentId } });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "teachingAssignment.delete",
      entity: "TeachingAssignment",
      entityId: assignmentId,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "DELETE_FAILED" };
  }
}

// ---------- User account ----------

export async function activateTeacherAccount(
  ctx: SchoolCtx,
  input: { teacherId: string; password: string },
): Promise<TeachersResult<{ userId: string }>> {
  const teacher = await prisma.teacher.findFirst({
    where: { id: input.teacherId, schoolId: ctx.schoolId },
    select: { id: true, email: true, userId: true, firstName: true, lastName: true },
  });
  if (!teacher || !teacher.email) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (teacher.userId) return { ok: false, error: "ALREADY_LINKED" };

  const role = await prisma.role.findFirst({
    where: {
      scope: "SCHOOL",
      name: "TEACHER",
      OR: [{ schoolId: null }, { schoolId: ctx.schoolId }],
    },
    select: { id: true },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };

  const res = await createSchoolUser(ctx, {
    email: teacher.email,
    password: input.password,
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    status: "ACTIVE",
    roleId: role.id,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error === "EMAIL_TAKEN" ? "EMAIL_TAKEN" : "CREATE_FAILED",
    };
  }

  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { userId: res.result.id },
    select: { id: true },
  });

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "teacher.activateAccount",
    entity: "Teacher",
    entityId: teacher.id,
    metadata: { userId: res.result.id },
  });

  return { ok: true, result: { userId: res.result.id } };
}
