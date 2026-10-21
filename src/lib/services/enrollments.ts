import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { checkLimit } from "@/lib/services/platform/modules";
import type { EnrollmentStatus, Prisma } from "@prisma/client";

export type EnrollmentsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "YEAR_CLOSED"
  | "CLASSROOM_ARCHIVED"
  | "ALREADY_ENROLLED"
  | "CROSS_YEAR"
  | "NO_CURRENT_YEAR"
  | "STUDENT_INACTIVE"
  | "LIMIT_REACHED"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type EnrollmentsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: EnrollmentsError };

type SchoolCtx = { userId: string; schoolId: string };

/** Violation d'unicité PostgreSQL remontée par Prisma (P2002). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

export async function listEnrollments(
  ctx: SchoolCtx,
  filters: {
    academicYearId?: string;
    classroomId?: string;
    status?: EnrollmentStatus;
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
    ...(filters.academicYearId
      ? { academicYearId: filters.academicYearId }
      : {}),
    ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(q
      ? {
          student: {
            OR: [
              { matricule: { contains: q, mode: "insensitive" as const } },
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      orderBy: { enrolledAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        enrolledAt: true,
        leftAt: true,
        status: true,
        student: {
          select: {
            id: true,
            matricule: true,
            firstName: true,
            lastName: true,
            sex: true,
          },
        },
        classroom: {
          select: { id: true, name: true, level: { select: { name: true } } },
        },
        academicYear: { select: { id: true, name: true, isCurrent: true } },
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function enrollStudent(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    classroomId: string;
    academicYearId?: string;
  },
  tx?: Prisma.TransactionClient,
): Promise<EnrollmentsResult<{ id: string }>> {
  const db = tx ?? prisma;
  let academicYearId = input.academicYearId;
  if (!academicYearId) {
    const current = await db.academicYear.findFirst({
      where: { schoolId: ctx.schoolId, isCurrent: true },
      select: { id: true },
    });
    if (!current) return { ok: false, error: "NO_CURRENT_YEAR" };
    academicYearId = current.id;
  }

  const [student, classroom, year] = await Promise.all([
    db.student.findFirst({
      where: { id: input.studentId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    }),
    db.classroom.findFirst({
      where: { id: input.classroomId, schoolId: ctx.schoolId },
      select: { id: true, academicYearId: true, status: true },
    }),
    db.academicYear.findFirst({
      where: { id: academicYearId, schoolId: ctx.schoolId },
      select: { id: true, status: true },
    }),
  ]);

  if (!student || !classroom || !year) return { ok: false, error: "NOT_FOUND" };
  if (student.status !== "ACTIVE") {
    return { ok: false, error: "STUDENT_INACTIVE" };
  }
  if (year.status === "CLOSED") return { ok: false, error: "YEAR_CLOSED" };
  if (classroom.status === "ARCHIVED") {
    return { ok: false, error: "CLASSROOM_ARCHIVED" };
  }
  if (classroom.academicYearId !== academicYearId) {
    return { ok: false, error: "CROSS_YEAR" };
  }

  // Une seule inscription ENROLLED par élève et par année — contrôle métier
  // systématique, doublé par l'index unique partiel
  // Enrollment_active_per_year_key (filet transactionnel, P2002 ci-dessous).
  // Le réglage School.settings.allowMultipleEnrollments est volontairement
  // inopérant : l'index rendait toute seconde inscription active impossible,
  // le réglage « true » produisait un CREATE_FAILED incompréhensible (E2-D).
  const existing = await db.enrollment.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      academicYearId,
      status: "ENROLLED",
    },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "ALREADY_ENROLLED" };

  // Limite commerciale d'élèves (abonnement SaaS)
  const limit = await checkLimit(ctx.schoolId, "students", tx);
  if (!limit.ok) return { ok: false, error: "LIMIT_REACHED" };

  try {
    const enrollment = await db.enrollment.create({
      data: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        classroomId: input.classroomId,
        academicYearId,
        status: "ENROLLED",
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "enrollment.create",
      entity: "Enrollment",
      entityId: enrollment.id,
      metadata: {
        studentId: input.studentId,
        classroomId: input.classroomId,
        academicYearId,
      },
      tx,
    });

    return { ok: true, result: { id: enrollment.id } };
  } catch (e) {
    // Course entre deux inscriptions concurrentes : l'index unique partiel
    // a tranché — on convertit en erreur métier compréhensible.
    if (isUniqueViolation(e)) return { ok: false, error: "ALREADY_ENROLLED" };
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function transferStudent(
  ctx: SchoolCtx,
  input: { enrollmentId: string; toClassroomId: string },
): Promise<EnrollmentsResult<{ id: string }>> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: input.enrollmentId, schoolId: ctx.schoolId },
    select: {
      id: true,
      studentId: true,
      academicYearId: true,
      status: true,
    },
  });
  if (!enrollment) return { ok: false, error: "NOT_FOUND" };
  if (enrollment.status !== "ENROLLED") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const target = await prisma.classroom.findFirst({
    where: { id: input.toClassroomId, schoolId: ctx.schoolId },
    select: { id: true, academicYearId: true, status: true },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  if (target.status === "ARCHIVED") {
    return { ok: false, error: "CLASSROOM_ARCHIVED" };
  }
  if (target.academicYearId !== enrollment.academicYearId) {
    return { ok: false, error: "CROSS_YEAR" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "TRANSFERRED", leftAt: new Date() },
        select: { id: true },
      });
      return tx.enrollment.create({
        data: {
          schoolId: ctx.schoolId,
          studentId: enrollment.studentId,
          classroomId: input.toClassroomId,
          academicYearId: enrollment.academicYearId,
          status: "ENROLLED",
        },
        select: { id: true },
      });
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "enrollment.transfer",
      entity: "Enrollment",
      entityId: created.id,
      metadata: {
        fromEnrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        toClassroomId: input.toClassroomId,
      },
    });

    return { ok: true, result: { id: created.id } };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "ALREADY_ENROLLED" };
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function closeEnrollment(
  ctx: SchoolCtx,
  input: { enrollmentId: string; status: "WITHDRAWN" | "COMPLETED" },
): Promise<EnrollmentsResult> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: input.enrollmentId, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!enrollment) return { ok: false, error: "NOT_FOUND" };
  if (enrollment.status !== "ENROLLED") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: input.status, leftAt: new Date() },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: `enrollment.${input.status.toLowerCase()}`,
      entity: "Enrollment",
      entityId: enrollment.id,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
