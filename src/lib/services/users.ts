import { prisma } from "@/lib/db/prisma";
import { getSchoolAssignableRole } from "@/lib/permissions/rbac";
import { hashPassword } from "@/lib/auth/password";

export type ServiceError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EMAIL_TAKEN"
  | "CANNOT_TARGET_SELF"
  | "CANNOT_TARGET_PLATFORM_USER"
  | "INVALID_ROLE"
  | "CREATE_FAILED"
  | "UPDATE_FAILED"
  | "DELETE_FAILED";

export type ServiceResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ServiceError };

type SchoolCtx = { userId: string; schoolId: string };

async function targetMembershipInSchool(input: {
  userId: string;
  schoolId: string;
}) {
  return prisma.schoolMembership.findFirst({
    where: { userId: input.userId, schoolId: input.schoolId },
    select: { id: true, status: true, roleId: true },
  });
}

async function targetHasPlatformRole(userId: string) {
  const count = await prisma.userRole.count({
    where: { userId, role: { scope: "PLATFORM" } },
  });
  return count > 0;
}

export async function listSchoolUsers(
  ctx: SchoolCtx,
  opts: { q?: string; sort: "email" | "createdAt"; dir: "asc" | "desc" },
) {
  const memberships = await prisma.schoolMembership.findMany({
    where: {
      schoolId: ctx.schoolId,
      user: {
        userRoles: { none: { role: { scope: "PLATFORM" } } },
        ...(opts.q
          ? {
              OR: [
                { email: { contains: opts.q, mode: "insensitive" } },
                { firstName: { contains: opts.q, mode: "insensitive" } },
                { lastName: { contains: opts.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    },
    orderBy:
      opts.sort === "email"
        ? { user: { email: opts.dir } }
        : { user: { createdAt: opts.dir } },
    select: {
      id: true,
      status: true,
      role: { select: { name: true } },
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  return memberships;
}

export async function createSchoolUser(
  ctx: SchoolCtx,
  input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    status: "ACTIVE" | "DISABLED";
    roleId: string;
  },
): Promise<ServiceResult<{ id: string }>> {
  const role = await getSchoolAssignableRole({
    roleId: input.roleId,
    schoolId: ctx.schoolId,
  });
  if (!role) return { ok: false, error: "INVALID_ROLE" };

  const existing = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "EMAIL_TAKEN" };

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        schoolId: ctx.schoolId,
        email: input.email.toLowerCase().trim(),
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: input.status,
        memberships: {
          create: [
            {
              schoolId: ctx.schoolId,
              roleId: role.id,
              status: "ACTIVE",
            },
          ],
        },
      },
      select: { id: true },
    });

    return { ok: true, result: { id: user.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateSchoolUser(
  ctx: SchoolCtx,
  input: {
    id: string;
    email: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    status: "ACTIVE" | "DISABLED";
    roleId?: string;
  },
): Promise<ServiceResult> {
  if (input.id === ctx.userId && input.status === "DISABLED") {
    return { ok: false, error: "CANNOT_TARGET_SELF" };
  }

  const membership = await targetMembershipInSchool({
    userId: input.id,
    schoolId: ctx.schoolId,
  });
  if (!membership) return { ok: false, error: "NOT_FOUND" };

  if (await targetHasPlatformRole(input.id)) {
    return { ok: false, error: "CANNOT_TARGET_PLATFORM_USER" };
  }

  let roleId: string | undefined;
  if (input.roleId) {
    const role = await getSchoolAssignableRole({
      roleId: input.roleId,
      schoolId: ctx.schoolId,
    });
    if (!role) return { ok: false, error: "INVALID_ROLE" };
    roleId = role.id;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.id },
        data: {
          email: input.email.toLowerCase().trim(),
          firstName: input.firstName,
          lastName: input.lastName,
          status: input.status,
          ...(input.password
            ? { passwordHash: await hashPassword(input.password) }
            : {}),
        },
        select: { id: true },
      });

      if (roleId) {
        await tx.schoolMembership.update({
          where: { id: membership.id },
          data: { roleId },
          select: { id: true },
        });
      }
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function removeSchoolUser(
  ctx: SchoolCtx,
  userId: string,
): Promise<ServiceResult> {
  if (userId === ctx.userId) {
    return { ok: false, error: "CANNOT_TARGET_SELF" };
  }

  const membership = await targetMembershipInSchool({
    userId,
    schoolId: ctx.schoolId,
  });
  if (!membership) return { ok: false, error: "NOT_FOUND" };

  if (await targetHasPlatformRole(userId)) {
    return { ok: false, error: "CANNOT_TARGET_PLATFORM_USER" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.schoolMembership.deleteMany({
        where: { userId, schoolId: ctx.schoolId },
      });

      await tx.userRole.deleteMany({
        where: { userId, role: { scope: "SCHOOL" } },
      });

      const remaining = await tx.schoolMembership.count({
        where: { userId },
      });

      if (remaining === 0) {
        await tx.user.delete({ where: { id: userId } });
      } else {
        await tx.user.updateMany({
          where: { id: userId, schoolId: ctx.schoolId },
          data: { schoolId: null },
        });
      }
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "DELETE_FAILED" };
  }
}
