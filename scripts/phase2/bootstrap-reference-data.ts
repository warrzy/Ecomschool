import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

type Summary = {
  createdPermissions: number;
  ensuredRoles: number;
  createdRolePermissions: number;
  rolesUpdated: number;
};

async function main() {
  const summary: Summary = {
    createdPermissions: 0,
    ensuredRoles: 0,
    createdRolePermissions: 0,
    rolesUpdated: 0,
  };

  const schoolPermissionKeys = [
    "school.read",
    "school.manage",
    "user.read",
    "user.manage",
  ];

  const platformPermissionKeys = [
    "platform.schools.read",
    "platform.schools.manage",
    "platform.users.manage",
    "platform.audit.read",
    "platform.support.access",
  ];

  const allKeys = [...new Set([...schoolPermissionKeys, ...platformPermissionKeys])];

  const beforeCount = await prisma.permission.count({ where: { key: { in: allKeys } } });

  await prisma.permission.createMany({
    data: allKeys.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const afterCount = await prisma.permission.count({ where: { key: { in: allKeys } } });
  summary.createdPermissions = afterCount - beforeCount;

  const permissions = await prisma.permission.findMany({
    where: { key: { in: allKeys } },
    select: { id: true, key: true },
  });

  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const ensurePlatformOwner = async () => {
    const existing = await prisma.role.findFirst({
      where: { name: "PLATFORM_OWNER", scope: "PLATFORM", schoolId: null },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await prisma.role.create({
      data: {
        name: "PLATFORM_OWNER",
        scope: "PLATFORM",
        description: "Platform owner ECOM-SCHOOL",
      },
      select: { id: true },
    });

    summary.ensuredRoles += 1;
    return created.id;
  };

  const ensureSystemAdminSchool = async () => {
    const existing = await prisma.role.findFirst({
      where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await prisma.role.create({
      data: {
        name: "ADMIN_SCHOOL",
        scope: "SCHOOL",
        schoolId: null,
        description: "Administrateur établissement (système)",
      },
      select: { id: true },
    });

    summary.ensuredRoles += 1;
    return created.id;
  };

  const platformOwnerRoleId = await ensurePlatformOwner();
  await ensureSystemAdminSchool();

  const upsertRolePermissions = async (roleId: string, keys: string[]) => {
    const permissionIds = keys.map((k) => {
      const id = permissionIdByKey.get(k);
      if (!id) throw new Error(`Missing Permission for key=${k}`);
      return id;
    });

    const existing = await prisma.rolePermission.count({
      where: { roleId, permission: { key: { in: keys } } },
    });

    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });

    const after = await prisma.rolePermission.count({
      where: { roleId, permission: { key: { in: keys } } },
    });

    summary.createdRolePermissions += after - existing;
  };

  await upsertRolePermissions(platformOwnerRoleId, [...schoolPermissionKeys, ...platformPermissionKeys]);

  const adminSchoolRoles = await prisma.role.findMany({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL" },
    select: { id: true },
  });

  for (const r of adminSchoolRoles) {
    await upsertRolePermissions(r.id, schoolPermissionKeys);
    summary.rolesUpdated += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error("BOOTSTRAP_REFERENCE_DATA_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
