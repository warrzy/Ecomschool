import { prisma } from "@/lib/db/prisma";

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
