import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const PHASE4_KEYS = [
  "rooms.read",
  "rooms.manage",
  "schedules.read",
  "schedules.manage",
  "schedules.print",
  "sessions.read",
  "sessions.manage",
  "coursecontent.manage",
  "attendance.read",
  "attendance.manage",
  "attendance.justify",
  "reports.attendance",
];

const TEACHER_KEYS = [
  "school.read",
  "academic.read",
  "classroom.read",
  "student.read",
  "subject.read",
  "rooms.read",
  "schedules.read",
  "schedules.print",
  "sessions.read",
  "attendance.read",
  "attendance.manage",
  "coursecontent.manage",
];

async function main() {
  await prisma.permission.createMany({
    data: PHASE4_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const allKeys = [...new Set([...PHASE4_KEYS, ...TEACHER_KEYS])];
  const permissions = await prisma.permission.findMany({
    where: { key: { in: allKeys } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const adminRoles = await prisma.role.findMany({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL" },
    select: { id: true },
  });
  for (const role of adminRoles) {
    await prisma.rolePermission.createMany({
      data: PHASE4_KEYS.map((k) => ({
        roleId: role.id,
        permissionId: idByKey.get(k)!,
      })),
      skipDuplicates: true,
    });
  }

  const teacherRoles = await prisma.role.findMany({
    where: { name: "TEACHER", scope: "SCHOOL" },
    select: { id: true },
  });
  for (const role of teacherRoles) {
    await prisma.rolePermission.createMany({
      data: TEACHER_KEYS.map((k) => ({
        roleId: role.id,
        permissionId: idByKey.get(k)!,
      })),
      skipDuplicates: true,
    });
  }

  console.log(
    JSON.stringify({
      phase4Keys: PHASE4_KEYS.length,
      adminRoles: adminRoles.length,
      teacherRoles: teacherRoles.length,
    }),
  );
}

main()
  .catch((e) => {
    console.error("PHASE4_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
