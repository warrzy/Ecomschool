import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { hashPassword } from "@/lib/auth/password";
import type { SchoolType, AcademicPeriodType, SchoolStatus } from "@prisma/client";

type ServiceError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EMAIL_TAKEN"
  | "UPDATE_FAILED"
  | "CREATE_FAILED";

export type SchoolResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ServiceError };

// ---------- Platform side ----------

export async function platformListSchools(opts: {
  q?: string;
  status?: SchoolStatus;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const where = {
    ...(opts.q
      ? {
          OR: [
            { name: { contains: opts.q, mode: "insensitive" as const } },
            { code: { contains: opts.q, mode: "insensitive" as const } },
            { city: { contains: opts.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(opts.status ? { status: opts.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        status: true,
        type: true,
        createdAt: true,
        _count: { select: { memberships: true, academicYears: true } },
      },
    }),
    prisma.school.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export async function platformGetSchool(id: string) {
  const school = await prisma.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      slug: true,
      address: true,
      city: true,
      country: true,
      phone: true,
      email: true,
      website: true,
      currency: true,
      timezone: true,
      locale: true,
      status: true,
      type: true,
      schoolSystem: true,
      logoUrl: true,
      createdAt: true,
      memberships: {
        select: {
          id: true,
          status: true,
          role: { select: { name: true } },
          user: {
            select: { id: true, email: true, firstName: true, lastName: true, status: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      academicYears: {
        select: { id: true, name: true, isCurrent: true, status: true },
        orderBy: { startDate: "desc" },
      },
      _count: { select: { memberships: true, users: true, academicYears: true } },
    },
  });
  return school;
}

export async function platformUpdateSchool(
  actorId: string,
  id: string,
  input: {
    name?: string;
    code?: string;
    address?: string | null;
    city?: string | null;
    country?: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    type?: SchoolType | null;
    schoolSystem?: AcademicPeriodType | null;
    logoUrl?: string | null;
  },
): Promise<SchoolResult> {
  const existing = await prisma.school.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.school.update({
      where: { id },
      data: input,
      select: { id: true },
    });

    await logAudit({
      actorId,
      schoolId: id,
      action: "school.update",
      entity: "School",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function platformSetSchoolStatus(
  actorId: string,
  id: string,
  status: SchoolStatus,
): Promise<SchoolResult> {
  const existing = await prisma.school.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  try {
    await prisma.school.update({
      where: { id },
      data: { status },
      select: { id: true },
    });

    await logAudit({
      actorId,
      schoolId: id,
      action: status === "ACTIVE" ? "school.activate" : "school.suspend",
      entity: "School",
      entityId: id,
      metadata: { from: existing.status, to: status },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function platformCreateSchoolAdmin(
  actorId: string,
  schoolId: string,
  input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
): Promise<SchoolResult<{ userId: string }>> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) return { ok: false, error: "NOT_FOUND" };

  const role = await prisma.role.findFirst({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };

  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "EMAIL_TAKEN" };

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        schoolId,
        email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: "ACTIVE",
        memberships: {
          create: [
            { schoolId, roleId: role.id, status: "ACTIVE" },
          ],
        },
      },
      select: { id: true },
    });

    await logAudit({
      actorId,
      schoolId,
      action: "school.admin.create",
      entity: "User",
      entityId: user.id,
      metadata: { email },
    });

    return { ok: true, result: { userId: user.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

// ---------- School side ----------

export async function updateMySchool(
  ctx: { userId: string; schoolId: string },
  input: {
    name?: string;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    type?: SchoolType | null;
    schoolSystem?: AcademicPeriodType | null;
    logoUrl?: string | null;
    settings?: unknown;
  },
): Promise<SchoolResult> {
  try {
    await prisma.school.update({
      where: { id: ctx.schoolId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.schoolSystem !== undefined
          ? { schoolSystem: input.schoolSystem }
          : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.settings !== undefined
          ? { settings: input.settings as object }
          : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "school.update",
      entity: "School",
      entityId: ctx.schoolId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function getMySchool(schoolId: string) {
  return prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      code: true,
      slug: true,
      address: true,
      city: true,
      country: true,
      phone: true,
      email: true,
      website: true,
      status: true,
      type: true,
      schoolSystem: true,
      logoUrl: true,
      settings: true,
    },
  });
}
