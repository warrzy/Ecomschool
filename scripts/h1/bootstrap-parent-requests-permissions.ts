/**
 * Lot H1 — Bootstrap idempotent de la permission « demandes
 * administratives des parents ».
 *
 * Nouvelle clé :
 *   administrative-requests.manage   consultation et traitement des
 *                                    demandes déposées par les parents
 *                                    (statut + réponse — traitement
 *                                    humain, jamais automatique)
 *
 * Attribution :
 *   ADMIN_SCHOOL : la clé (traitement = acte administratif).
 *   Autres rôles : aucune.
 *
 * Mappée dans PERMISSION_MODULE(+V2) → ADMINISTRATION.
 * Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/h1/bootstrap-parent-requests-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = ["administrative-requests.manage"] as const;

const ROLE_KEYS: Record<string, readonly string[]> = {
  ADMIN_SCHOOL: NEW_KEYS,
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
    console.error("H1_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
