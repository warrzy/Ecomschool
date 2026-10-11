import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { GuardianRelation } from "@prisma/client";

export type GuardiansError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "ALREADY_LINKED"
  | "CREATE_FAILED"
  | "UPDATE_FAILED"
  | "DELETE_FAILED";

export type GuardiansResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: GuardiansError };

type SchoolCtx = { userId: string; schoolId: string };

export async function listGuardians(
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
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.guardian.count({ where }),
    prisma.guardian.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        address: true,
        status: true,
        _count: { select: { students: true } },
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getGuardian(ctx: SchoolCtx, guardianId: string) {
  return prisma.guardian.findFirst({
    where: { id: guardianId, schoolId: ctx.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      address: true,
      status: true,
      createdAt: true,
      students: {
        select: {
          id: true,
          relation: true,
          student: {
            select: { id: true, matricule: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
}

export async function createGuardian(
  ctx: SchoolCtx,
  input: {
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    address?: string;
  },
): Promise<GuardiansResult<{ id: string }>> {
  try {
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: ctx.schoolId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        email: input.email?.toLowerCase() || null,
        address: input.address || null,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "guardian.create",
      entity: "Guardian",
      entityId: guardian.id,
      metadata: { name: `${input.lastName} ${input.firstName}` },
    });

    return { ok: true, result: { id: guardian.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateGuardian(
  ctx: SchoolCtx,
  guardianId: string,
  input: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    address?: string;
    status?: "ACTIVE" | "ARCHIVED";
  },
): Promise<GuardiansResult> {
  const guardian = await prisma.guardian.findFirst({
    where: { id: guardianId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!guardian) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.guardian.update({
      where: { id: guardianId },
      data: {
        ...(input.firstName !== undefined
          ? { firstName: input.firstName }
          : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.email !== undefined
          ? { email: input.email.toLowerCase() || null }
          : {}),
        ...(input.address !== undefined
          ? { address: input.address || null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "guardian.update",
      entity: "Guardian",
      entityId: guardianId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- Links ----------

export async function linkGuardianToStudent(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    guardianId: string;
    relation: GuardianRelation;
  },
): Promise<GuardiansResult<{ id: string }>> {
  const [student, guardian] = await Promise.all([
    prisma.student.findFirst({
      where: { id: input.studentId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.guardian.findFirst({
      where: { id: input.guardianId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
  ]);
  if (!student || !guardian) return { ok: false, error: "NOT_FOUND" };

  const existing = await prisma.studentGuardian.findFirst({
    where: {
      studentId: input.studentId,
      guardianId: input.guardianId,
      relation: input.relation,
    },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "ALREADY_LINKED" };

  try {
    const link = await prisma.studentGuardian.create({
      data: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        guardianId: input.guardianId,
        relation: input.relation,
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "studentGuardian.link",
      entity: "StudentGuardian",
      entityId: link.id,
      metadata: {
        studentId: input.studentId,
        guardianId: input.guardianId,
        relation: input.relation,
      },
    });

    return { ok: true, result: { id: link.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function unlinkGuardian(
  ctx: SchoolCtx,
  linkId: string,
): Promise<GuardiansResult> {
  const link = await prisma.studentGuardian.findFirst({
    where: { id: linkId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!link) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.studentGuardian.delete({ where: { id: linkId } });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "studentGuardian.unlink",
      entity: "StudentGuardian",
      entityId: linkId,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "DELETE_FAILED" };
  }
}
