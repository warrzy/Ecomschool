/**
 * Lot F2-D2 — Bootstrap idempotent des permissions d'inscription.
 *
 * Nouvelles clés fines (option O1 validée) :
 *   student.create    créer une fiche élève (sans modifier/archiver)
 *   enrollment.create inscrire/réinscrire (sans transférer/retirer)
 *
 * Attribution :
 *   CASHIER + FINANCE_MANAGER : student.read, student.create,
 *     enrollment.read, enrollment.create, classroom.read
 *   ADMIN_SCHOOL : student.create, enrollment.create (additif,
 *     les .manage existants sont conservés).
 *
 * Aucune migration Prisma — les permissions sont des lignes de données.
 * Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/f2/bootstrap-registration-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = ["student.create", "enrollment.create"] as const;

const ROLE_KEYS: Record<string, readonly string[]> = {
  CASHIER: [
    "student.read",
    "student.create",
    "enrollment.read",
    "enrollment.create",
    "classroom.read",
  ],
  FINANCE_MANAGER: [
    "student.read",
    "student.create",
    "enrollment.read",
    "enrollment.create",
    "classroom.read",
  ],
  // Additif : l'admin garde .manage ; ces clés lui ouvrent le guichet
  // dont les actions sont gardées par les permissions fines.
  ADMIN_SCHOOL: ["student.create", "enrollment.create"],
};

async function main() {
  const dryRun = process.argv.includes("--check");

  if (!dryRun) {
    await prisma.permission.createMany({
      data: NEW_KEYS.map((key) => ({ key })),
      skipDuplicates: true,
    });
  }

  const wanted = [...new Set(Object.values(ROLE_KEYS).flat())];
  const permissions = await prisma.permission.findMany({
    where: { key: { in: wanted } },
    select: { id: true, key: true },
  });
  const missing = wanted.filter(
    (k) => !permissions.some((p) => p.key === k),
  );
  if (missing.length) {
    throw new Error(`Permissions introuvables : ${missing.join(", ")}`);
  }
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const report: Record<string, unknown> = {};
  for (const [roleName, keys] of Object.entries(ROLE_KEYS)) {
    const roles = await prisma.role.findMany({
      where: { name: roleName, scope: "SCHOOL" },
      select: { id: true },
    });
    let linked = 0;
    if (!dryRun) {
      for (const role of roles) {
        const res = await prisma.rolePermission.createMany({
          data: keys.map((k) => ({
            roleId: role.id,
            permissionId: idByKey.get(k)!,
          })),
          skipDuplicates: true,
        });
        linked += res.count;
      }
    }
    report[roleName] = { roles: roles.length, granted: keys, linked };
  }

  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
}

main()
  .catch((e) => {
    console.error("F2D2_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
