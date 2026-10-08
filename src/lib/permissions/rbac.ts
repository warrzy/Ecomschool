import { prisma } from "@/lib/db/prisma";

export async function userIsSuperAdmin(userId: string) {
  const count = await prisma.userRole.count({
    where: {
      userId,
      role: {
        name: "SUPER_ADMIN",
      },
    },
  });

  return count > 0;
}

export async function userHasPermission(input: {
  userId: string;
  permissionKey: string;
}) {
  const { userId, permissionKey } = input;

  const count = await prisma.userRole.count({
    where: {
      userId,
      role: {
        rolePermissions: {
          some: {
            permission: {
              key: permissionKey,
            },
          },
        },
      },
    },
  });

  return count > 0;
}
