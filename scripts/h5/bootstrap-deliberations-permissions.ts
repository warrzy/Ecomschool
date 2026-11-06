/**
 * Lot H5 — Bootstrap idempotent des permissions « délibérations ».
 *
 * Nouvelles clés :
 *   deliberations.read      consultation des sessions et décisions
 *   deliberations.manage    préparation, propositions, ajustements
 *                           motivés, règles de décision
 *   deliberations.validate  validation du conseil et déverrouillage
 *                           motivé des sessions
 *   deliberations.publish   publication et dépublication contrôlée
 *
 * Attribution :
 *   ADMIN_SCHOOL  : les quatre clés.
 *   HEAD_TEACHER  : read + manage + validate (préside le conseil) ;
 *                   la publication reste un acte administratif.
 *   Autres rôles  : aucune.
 *
 * Mappées dans PERMISSION_MODULE(+V2) → REPORT_CARDS.
 * Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/h5/bootstrap-deliberations-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = [
  "deliberations.read",
  "deliberations.manage",
  "deliberations.validate",
  "deliberations.publish",
] as const;

const ROLE_KEYS: Record<string, readonly string[]> = {
  ADMIN_SCHOOL: NEW_KEYS,
  HEAD_TEACHER: [
    "deliberations.read",
    "deliberations.manage",
    "deliberations.validate",
  ],
};

async function main() {
  const dryRun = process.argv.includes("--check");

  if (!dryRun) {
    await prisma.permission.createMany({
      data: NEW_KEYS.map((key) => ({ key })),
      skipDuplicates: true,
    });
  }

  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...NEW_KEYS] } },
    select: { id: true, key: true },
  });
  const missing = NEW_KEYS.filter(
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
    console.error("H5_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
