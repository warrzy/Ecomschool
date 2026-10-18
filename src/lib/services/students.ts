import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { Prisma } from "@prisma/client";

export type StudentsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "MATRICULE_TAKEN"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type StudentsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: StudentsError };

type SchoolCtx = { userId: string; schoolId: string };

const studentSelect = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  sex: true,
  birthDate: true,
  birthPlace: true,
  photoUrl: true,
  address: true,
  phone: true,
  email: true,
  status: true,
  createdAt: true,
} as const;

export async function listStudents(
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
            { matricule: { contains: q, mode: "insensitive" as const } },
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: studentSelect,
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getStudent(ctx: SchoolCtx, studentId: string) {
  return prisma.student.findFirst({
    where: { id: studentId, schoolId: ctx.schoolId },
    select: {
      ...studentSelect,
      guardians: {
        select: {
          id: true,
          relation: true,
          guardian: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
        },
      },
      enrollments: {
        orderBy: { enrolledAt: "desc" },
        select: {
          id: true,
          enrolledAt: true,
          leftAt: true,
          status: true,
          classroom: {
            select: {
              id: true,
              name: true,
              level: { select: { name: true } },
            },
          },
          academicYear: { select: { name: true, isCurrent: true } },
        },
      },
    },
  });
}

export type StudentInput = {
  matricule: string;
  firstName: string;
  lastName: string;
  sex?: "MALE" | "FEMALE";
  birthDate?: string;
  birthPlace?: string;
  photoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
};

function toStudentData(ctx: SchoolCtx, input: StudentInput) {
  const birthDate = input.birthDate ? new Date(input.birthDate) : null;
  return {
    schoolId: ctx.schoolId,
    matricule: input.matricule.trim(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    sex: input.sex ?? null,
    birthDate:
      birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate : null,
    birthPlace: input.birthPlace?.trim() || null,
    photoUrl: input.photoUrl?.trim() || null,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
  };
}

export async function createStudent(
  ctx: SchoolCtx,
  input: StudentInput,
  tx?: Prisma.TransactionClient,
): Promise<StudentsResult<{ id: string }>> {
  const db = tx ?? prisma;
  const existing = await db.student.findFirst({
    where: { schoolId: ctx.schoolId, matricule: input.matricule.trim() },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "MATRICULE_TAKEN" };

  try {
    const student = await db.student.create({
      data: toStudentData(ctx, input),
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "student.create",
      entity: "Student",
      entityId: student.id,
      metadata: { matricule: input.matricule.trim() },
      tx,
    });

    return { ok: true, result: { id: student.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateStudent(
  ctx: SchoolCtx,
  studentId: string,
  input: Omit<Partial<StudentInput>, "sex"> & {
    status?: "ACTIVE" | "ARCHIVED";
    /** `null` = effacement explicite du sexe (import `__EFFACER__`). */
    sex?: "MALE" | "FEMALE" | null;
  },
  tx?: Prisma.TransactionClient,
): Promise<StudentsResult> {
  const db = tx ?? prisma;
  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!student) return { ok: false, error: "NOT_FOUND" };

  if (input.matricule) {
    const dup = await db.student.findFirst({
      where: {
        schoolId: ctx.schoolId,
        matricule: input.matricule.trim(),
        id: { not: studentId },
      },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "MATRICULE_TAKEN" };
  }

  try {
    await db.student.update({
      where: { id: studentId },
      data: {
        ...(input.matricule !== undefined
          ? { matricule: input.matricule.trim() }
          : {}),
        ...(input.firstName !== undefined
          ? { firstName: input.firstName.trim() }
          : {}),
        ...(input.lastName !== undefined
          ? { lastName: input.lastName.trim() }
          : {}),
        ...(input.sex !== undefined ? { sex: input.sex } : {}),
        ...(input.birthDate !== undefined
          ? {
              birthDate: input.birthDate
                ? new Date(input.birthDate)
                : null,
            }
          : {}),
        ...(input.birthPlace !== undefined
          ? { birthPlace: input.birthPlace.trim() || null }
          : {}),
        ...(input.photoUrl !== undefined
          ? { photoUrl: input.photoUrl.trim() || null }
          : {}),
        ...(input.address !== undefined
          ? { address: input.address.trim() || null }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
        ...(input.email !== undefined
          ? { email: input.email.trim().toLowerCase() || null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "student.update",
      entity: "Student",
      entityId: studentId,
      metadata: { fields: Object.keys(input) },
      tx,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

