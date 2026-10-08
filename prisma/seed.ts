import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const school = await prisma.school.upsert({
    where: { code: "WEND-PANGA" },
    update: {},
    create: {
      name: "Complexe Scolaire Wend-Panga",
      code: "WEND-PANGA",
      slug: "wend-panga",
      city: "Ouagadougou",
      country: "BF",
      currency: "XOF",
      timezone: "Africa/Ouagadougou",
      locale: "fr",
      status: "ACTIVE",
    },
  });

  await prisma.academicYear.upsert({
    where: {
      schoolId_name: {
        schoolId: school.id,
        name: "2026-2027",
      },
    },
    update: {
      isCurrent: true,
      status: "ACTIVE",
    },
    create: {
      schoolId: school.id,
      name: "2026-2027",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2027-07-31T23:59:59.000Z"),
      isCurrent: true,
      status: "ACTIVE",
      periods: {
        create: [
          {
            name: "Trimestre 1",
            number: 1,
            startDate: new Date("2026-10-01T00:00:00.000Z"),
            endDate: new Date("2026-12-31T23:59:59.000Z"),
            type: "TRIMESTER",
          },
          {
            name: "Trimestre 2",
            number: 2,
            startDate: new Date("2027-01-01T00:00:00.000Z"),
            endDate: new Date("2027-03-31T23:59:59.000Z"),
            type: "TRIMESTER",
          },
          {
            name: "Trimestre 3",
            number: 3,
            startDate: new Date("2027-04-01T00:00:00.000Z"),
            endDate: new Date("2027-07-31T23:59:59.000Z"),
            type: "TRIMESTER",
          },
        ],
      },
    },
  });

  const permissions = [
    "school.read",
    "school.manage",
    "user.read",
    "user.manage",
  ];

  await prisma.permission.createMany({
    data: permissions.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const superAdminRole = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: {},
    create: {
      name: "SUPER_ADMIN",
      description: "Super admin plateforme ECOM-SCHOOL",
    },
  });

  const allPermissions = await prisma.permission.findMany({
    where: { key: { in: permissions } },
    select: { id: true },
  });

  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({
      roleId: superAdminRole.id,
      permissionId: p.id,
    })),
    skipDuplicates: true,
  });

  const adminUser = await prisma.user.upsert({
    where: {
      schoolId_email: {
        schoolId: school.id,
        email: "admin@ecom-school.local",
      },
    },
    update: {},
    create: {
      schoolId: school.id,
      email: "admin@ecom-school.local",
      passwordHash: "CHANGE_ME",
      firstName: "Admin",
      lastName: "ECOM-SCHOOL",
      status: "ACTIVE",
      userRoles: {
        create: [{ roleId: superAdminRole.id }],
      },
    },
    select: { id: true },
  });

  console.log("Seed completed", {
    schoolId: school.id,
    adminUserId: adminUser.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
