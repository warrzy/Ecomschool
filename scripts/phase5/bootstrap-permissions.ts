import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const PHASE5_KEYS = [
  "assessments.read",
  "assessments.create",
  "assessments.manage",
  "grades.read",
  "grades.enter",
  "grades.update",
  "grades.validate",
  "grades.calculate",
  "results.read",
  "results.validate",
  "results.publish",
  "reportcards.read",
  "reportcards.generate",
  "reportcards.validate",
  "reportcards.publish",
  "reportcards.print",
  "gradingpolicy.manage",
];

// Enseignant : consultation évaluations/résultats/bulletins, création
// d'évaluations et saisie de notes dans son périmètre d'affectation.
const TEACHER_KEYS = [
  "assessments.read",
  "assessments.create",
  "grades.read",
  "grades.enter",
  "results.read",
  "reportcards.read",
  "reportcards.print",
];

async function main() {
  await prisma.permission.createMany({
    data: PHASE5_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const allKeys = [...new Set([...PHASE5_KEYS, ...TEACHER_KEYS])];
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
      data: PHASE5_KEYS.map((k) => ({
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
      phase5Keys: PHASE5_KEYS.length,
      adminRoles: adminRoles.length,
      teacherRoles: teacherRoles.length,
    }),
  );
}

main()
  .catch((e) => {
    console.error("PHASE5_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
