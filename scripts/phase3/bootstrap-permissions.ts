import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const SCHOOL_PERMISSION_KEYS = [
  "school.read",
  "school.manage",
  "user.read",
  "user.manage",
  "academic.read",
  "academic.manage",
  "classroom.read",
  "classroom.manage",
  "teacher.read",
  "teacher.manage",
  "student.read",
  "student.manage",
  "guardian.read",
  "guardian.manage",
  "enrollment.read",
  "enrollment.manage",
  "subject.read",
  "subject.manage",
  "attendance.read",
  "attendance.manage",
  "grade.read",
  "grade.manage",
  "finance.read",
  "finance.manage",
];

const TEACHER_PERMISSION_KEYS = [
  "school.read",
  "academic.read",
  "classroom.read",
  "student.read",
  "subject.read",
];

async function main() {
  await prisma.permission.createMany({
    data: SCHOOL_PERMISSION_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany({
    where: { key: { in: SCHOOL_PERMISSION_KEYS } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const adminRoles = await prisma.role.findMany({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL" },
    select: { id: true, schoolId: true },
  });

  for (const role of adminRoles) {
    await prisma.rolePermission.createMany({
      data: SCHOOL_PERMISSION_KEYS.map((k) => ({
        roleId: role.id,
        permissionId: idByKey.get(k)!,
      })),
      skipDuplicates: true,
    });
  }

  const teacherRole = await prisma.role.findFirst({
    where: { name: "TEACHER", scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const teacherRoleId =
    teacherRole?.id ??
    (
      await prisma.role.create({
        data: {
          name: "TEACHER",
          scope: "SCHOOL",
          schoolId: null,
          description: "Enseignant (rôle système)",
        },
        select: { id: true },
      })
    ).id;

  await prisma.rolePermission.createMany({
    data: TEACHER_PERMISSION_KEYS.map((k) => ({
      roleId: teacherRoleId,
      permissionId: idByKey.get(k)!,
    })),
    skipDuplicates: true,
  });

  console.log(
    JSON.stringify(
      {
        permissions: SCHOOL_PERMISSION_KEYS.length,
        adminRolesUpdated: adminRoles.length,
        teacherRoleId,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error("PHASE3_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
