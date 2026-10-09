import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

type Result = {
  createdRoles: number;
  createdMemberships: number;
  skippedPlatformUsers: number;
  skippedNoSchool: number;
  skippedAlreadyMember: number;
};

async function main() {
  const res: Result = {
    createdRoles: 0,
    createdMemberships: 0,
    skippedPlatformUsers: 0,
    skippedNoSchool: 0,
    skippedAlreadyMember: 0,
  };

  const schools = await prisma.school.findMany({ select: { id: true } });

  const adminRoleBySchoolId = new Map<string, string>();

  for (const s of schools) {
    const existing = await prisma.role.findFirst({
      where: {
        name: "ADMIN_SCHOOL",
        scope: "SCHOOL",
        schoolId: s.id,
      },
      select: { id: true },
    });

    if (existing) {
      adminRoleBySchoolId.set(s.id, existing.id);
      continue;
    }

    const created = await prisma.role.create({
      data: {
        name: "ADMIN_SCHOOL",
        scope: "SCHOOL",
        schoolId: s.id,
        description: "Administrateur établissement",
      },
      select: { id: true },
    });

    res.createdRoles += 1;
    adminRoleBySchoolId.set(s.id, created.id);
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      schoolId: true,
      userRoles: {
        select: {
          role: {
            select: {
              scope: true,
              name: true,
            },
          },
        },
      },
    },
  });

  for (const u of users) {
    if (!u.schoolId) {
      res.skippedNoSchool += 1;
      continue;
    }

    const isPlatform = u.userRoles.some((ur) => ur.role.scope === "PLATFORM");
    if (isPlatform) {
      res.skippedPlatformUsers += 1;
      continue;
    }

    const already = await prisma.schoolMembership.findFirst({
      where: {
        schoolId: u.schoolId,
        userId: u.id,
      },
      select: { id: true },
    });

    if (already) {
      res.skippedAlreadyMember += 1;
      continue;
    }

    const roleId = adminRoleBySchoolId.get(u.schoolId);
    if (!roleId) {
      throw new Error(`Missing ADMIN_SCHOOL role for schoolId=${u.schoolId}`);
    }

    await prisma.schoolMembership.create({
      data: {
        schoolId: u.schoolId,
        userId: u.id,
        roleId,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    res.createdMemberships += 1;
  }

  console.log(JSON.stringify(res, null, 2));
}

main()
  .catch((e) => {
    console.error("BACKFILL_MEMBERSHIPS_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
