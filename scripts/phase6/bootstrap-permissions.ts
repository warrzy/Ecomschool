import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const PHASE6_KEYS = [
  "portal.manage",
  "portal.parent",
  "portal.student",
  "announcements.read",
  "announcements.manage",
  "notifications.read",
];

const ADMIN_KEYS = [
  "portal.manage",
  "announcements.read",
  "announcements.manage",
  "notifications.read",
];

const TEACHER_KEYS = ["announcements.read"];

const PARENT_KEYS = ["portal.parent", "announcements.read"];
const STUDENT_KEYS = ["portal.student", "announcements.read"];

async function ensureRole(name: string, description: string) {
  const existing = await prisma.role.findFirst({
    where: { name, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.role.create({
    data: { name, scope: "SCHOOL", schoolId: null, description },
    select: { id: true },
  });
  return created.id;
}

async function grant(roleId: string, keys: string[], idByKey: Map<string, string>) {
  await prisma.rolePermission.createMany({
    data: keys.map((k) => ({ roleId, permissionId: idByKey.get(k)! })),
    skipDuplicates: true,
  });
}

async function main() {
  await prisma.permission.createMany({
    data: PHASE6_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany({
    where: { key: { in: PHASE6_KEYS } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const adminRoles = await prisma.role.findMany({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL" },
    select: { id: true },
  });
  for (const role of adminRoles) await grant(role.id, ADMIN_KEYS, idByKey);

  const teacherRoles = await prisma.role.findMany({
    where: { name: "TEACHER", scope: "SCHOOL" },
    select: { id: true },
  });
  for (const role of teacherRoles) await grant(role.id, TEACHER_KEYS, idByKey);

  const parentRoleId = await ensureRole("PARENT", "Parent / tuteur (rôle système)");
  const studentRoleId = await ensureRole("STUDENT", "Élève (rôle système)");
  await grant(parentRoleId, PARENT_KEYS, idByKey);
  await grant(studentRoleId, STUDENT_KEYS, idByKey);

  console.log(
    JSON.stringify({
      phase6Keys: PHASE6_KEYS.length,
      adminRoles: adminRoles.length,
      teacherRoles: teacherRoles.length,
      parentRoleId,
      studentRoleId,
    }),
  );
}

main()
  .catch((e) => {
    console.error("PHASE6_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
