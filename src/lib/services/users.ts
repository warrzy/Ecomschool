import { prisma } from "@/lib/db/prisma";
import { getSchoolAssignableRole } from "@/lib/permissions/rbac";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/services/audit";
import { checkLimit } from "@/lib/services/platform/modules";

export type ServiceError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EMAIL_TAKEN"
  | "CANNOT_TARGET_SELF"
  | "CANNOT_TARGET_PLATFORM_USER"
  | "LAST_ACTIVE_ADMIN"
  | "INVALID_ROLE"
  | "LIMIT_REACHED"
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

async function countActivePermissionHolders(input: {
  schoolId: string;
  permissionKey: string;
  excludeUserId?: string;
}) {
  return prisma.schoolMembership.count({
    where: {
      schoolId: input.schoolId,
      status: "ACTIVE",
      user: {
        status: "ACTIVE",
        ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      },
      role: {
        scope: "SCHOOL",
        OR: [{ schoolId: null }, { schoolId: input.schoolId }],
        rolePermissions: {
          some: { permission: { key: input.permissionKey } },
        },
      },
    },
  });
}

async function isLastActiveAdmin(input: {
  userId: string;
  schoolId: string;
  membershipId: string;
}) {
  const membership = await prisma.schoolMembership.findFirst({
    where: {
      id: input.membershipId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: {
        rolePermissions: {
          some: { permission: { key: "user.manage" } },
        },
      },
    },
    select: { id: true },
  });
  if (!membership) return false;

  const others = await countActivePermissionHolders({
    schoolId: input.schoolId,
    permissionKey: "user.manage",
    excludeUserId: input.userId,
  });
  return others === 0;
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

  // Limite commerciale d'utilisateurs (abonnement SaaS)
  const limit = await checkLimit(ctx.schoolId, "users");
  if (!limit.ok) return { ok: false, error: "LIMIT_REACHED" };

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

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "user.create",
      entity: "User",
      entityId: user.id,
      metadata: { email: input.email.toLowerCase().trim(), roleId: role.id },
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

  if (input.id === ctx.userId && input.roleId && input.roleId !== membership.roleId) {
    return { ok: false, error: "CANNOT_TARGET_SELF" };
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

  let keepsManagePermission = false;
  if (roleId !== undefined && roleId !== membership.roleId) {
    keepsManagePermission =
      (await prisma.rolePermission.count({
        where: {
          roleId,
          permission: { key: "user.manage" },
        },
      })) > 0;
  }

  const demotesOrDisables =
    input.status === "DISABLED" ||
    (roleId !== undefined &&
      roleId !== membership.roleId &&
      !keepsManagePermission);

  if (demotesOrDisables) {
    const lastAdmin = await isLastActiveAdmin({
      userId: input.id,
      schoolId: ctx.schoolId,
      membershipId: membership.id,
    });
    if (lastAdmin) return { ok: false, error: "LAST_ACTIVE_ADMIN" };
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

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "user.update",
      entity: "User",
      entityId: input.id,
      metadata: {
        status: input.status,
        ...(roleId ? { roleId } : {}),
      },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export async function platformListAdministrators() {
  return prisma.userRole.findMany({
    where: { role: { scope: "PLATFORM" } },
    orderBy: { user: { email: "asc" } },
    select: {
      id: true,
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

  const lastAdmin = await isLastActiveAdmin({
    userId,
    schoolId: ctx.schoolId,
    membershipId: membership.id,
  });
  if (lastAdmin) return { ok: false, error: "LAST_ACTIVE_ADMIN" };

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

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "user.remove",
      entity: "User",
      entityId: userId,
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "DELETE_FAILED" };
  }
}
