import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

async function main() {
  const seedPassword = process.env.SEED_TEST_PASSWORD;
  if (!seedPassword) {
    throw new Error("SEED_TEST_PASSWORD is required to run the seed in phase 2");
  }

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
            schoolId: school.id,
          },
          {
            name: "Trimestre 2",
            number: 2,
            startDate: new Date("2027-01-01T00:00:00.000Z"),
            endDate: new Date("2027-03-31T23:59:59.000Z"),
            type: "TRIMESTER",
            schoolId: school.id,
          },
          {
            name: "Trimestre 3",
            number: 3,
            startDate: new Date("2027-04-01T00:00:00.000Z"),
            endDate: new Date("2027-07-31T23:59:59.000Z"),
            type: "TRIMESTER",
            schoolId: school.id,
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

  const existingSuperAdminRole = await prisma.role.findFirst({
    where: {
      name: "PLATFORM_OWNER",
      scope: "PLATFORM",
      schoolId: null,
    },
  });

  const superAdminRole =
    existingSuperAdminRole ??
    (await prisma.role.create({
      data: {
        name: "PLATFORM_OWNER",
        scope: "PLATFORM",
        description: "Platform owner ECOM-SCHOOL",
      },
    }));

  const allPermissions = await prisma.permission.findMany({
    where: { key: { in: permissions } },
    select: { id: true },
  });

  const existingAdminSchoolRole = await prisma.role.findFirst({
    where: {
      name: "ADMIN_SCHOOL",
      scope: "SCHOOL",
      schoolId: school.id,
    },
    select: { id: true },
  });

  const adminSchoolRole =
    existingAdminSchoolRole ??
    (await prisma.role.create({
      data: {
        name: "ADMIN_SCHOOL",
        scope: "SCHOOL",
        schoolId: school.id,
        description: "Administrateur établissement",
      },
      select: { id: true },
    }));

  await prisma.rolePermission.createMany({
    data: allPermissions.map((p: { id: string }) => ({
      roleId: adminSchoolRole.id,
      permissionId: p.id,
    })),
    skipDuplicates: true,
  });

  const schoolAdminPasswordHash = await hashPassword(seedPassword);

  const schoolAdminUser = await prisma.user.upsert({
    where: { email: "school-admin@ecom-school.local" },
    update: {
      passwordHash: schoolAdminPasswordHash,
      status: "ACTIVE",
      schoolId: school.id,
    },
    create: {
      schoolId: school.id,
      email: "school-admin@ecom-school.local",
      passwordHash: schoolAdminPasswordHash,
      firstName: "School",
      lastName: "Admin",
      status: "ACTIVE",
      userRoles: {
        create: [{ roleId: adminSchoolRole.id }],
      },
    },
    select: { id: true },
  });

  await prisma.schoolMembership.upsert({
    where: {
      schoolId_userId: {
        schoolId: school.id,
        userId: schoolAdminUser.id,
      },
    },
    update: {
      roleId: adminSchoolRole.id,
      status: "ACTIVE",
    },
    create: {
      schoolId: school.id,
      userId: schoolAdminUser.id,
      roleId: adminSchoolRole.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  await prisma.rolePermission.createMany({
    data: allPermissions.map((p: { id: string }) => ({
      roleId: superAdminRole.id,
      permissionId: p.id,
    })),
    skipDuplicates: true,
  });

  const adminPasswordHash = await hashPassword(seedPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@ecom-school.local" },
    update: {
      passwordHash: adminPasswordHash,
      status: "ACTIVE",
    },
    create: {
      schoolId: school.id,
      email: "admin@ecom-school.local",
      passwordHash: adminPasswordHash,
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
    schoolAdminUserId: schoolAdminUser.id,
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
