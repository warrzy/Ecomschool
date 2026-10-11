import { prisma } from "@/lib/db/prisma";

export async function userIsPlatformOwner(userId: string) {
  const count = await prisma.userRole.count({
    where: {
      userId,
      role: {
        name: "PLATFORM_OWNER",
        scope: "PLATFORM",
      },
    },
  });

  return count > 0;
}

export async function userHasPlatformRole(userId: string) {
  const count = await prisma.userRole.count({
    where: {
      userId,
      role: { scope: "PLATFORM" },
    },
  });

  return count > 0;
}

export async function getActiveUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, status: "ACTIVE" },
    select: { id: true, status: true },
  });
}

/**
 * Rattachement effectif de l'utilisateur : première membership ACTIVE.
 * Remplace la lecture de `User.schoolId` (champ legacy en cours de retrait).
 */
export async function getActiveSchoolId(userId: string) {
  const m = await prisma.schoolMembership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { schoolId: true },
  });
  return m?.schoolId ?? null;
}

export async function getActiveMembership(input: {
  userId: string;
  schoolId: string;
}) {
  return prisma.schoolMembership.findFirst({
    where: {
      userId: input.userId,
      schoolId: input.schoolId,
      status: "ACTIVE",
      role: {
        scope: "SCHOOL",
        OR: [{ schoolId: null }, { schoolId: input.schoolId }],
      },
    },
    select: {
      id: true,
      roleId: true,
      role: { select: { id: true, name: true, scope: true, schoolId: true } },
    },
  });
}

export async function userHasPlatformPermission(input: {
  userId: string;
  permissionKey: string;
}) {
  const count = await prisma.userRole.count({
    where: {
      userId: input.userId,
      user: { status: "ACTIVE" },
      role: {
        scope: "PLATFORM",
        rolePermissions: {
          some: {
            permission: { key: input.permissionKey },
          },
        },
      },
    },
  });

  return count > 0;
}

export async function userHasSchoolPermission(input: {
  userId: string;
  schoolId: string;
  permissionKey: string;
}) {
  const count = await prisma.schoolMembership.count({
    where: {
      userId: input.userId,
      schoolId: input.schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: {
        scope: "SCHOOL",
        OR: [{ schoolId: null }, { schoolId: input.schoolId }],
        rolePermissions: {
          some: {
            permission: { key: input.permissionKey },
          },
        },
      },
    },
  });

  return count > 0;
}

export async function getSchoolAssignableRole(input: {
  roleId: string;
  schoolId: string;
}) {
  return prisma.role.findFirst({
    where: {
      id: input.roleId,
      scope: "SCHOOL",
      OR: [{ schoolId: null }, { schoolId: input.schoolId }],
    },
    select: { id: true, name: true, scope: true, schoolId: true },
  });
}

export async function listSchoolAssignableRoles(schoolId: string) {
  return prisma.role.findMany({
    where: {
      scope: "SCHOOL",
      OR: [{ schoolId: null }, { schoolId }],
    },
    orderBy: [{ schoolId: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, schoolId: true },
  });
}
