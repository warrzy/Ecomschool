/**
 * Lot G2-A — Bootstrap idempotent des permissions documentaires.
 *
 * Nouvelles clés :
 *   documents.read    consulter/télécharger les documents dont on a le
 *                     droit objet (jamais tous les documents à lui seul)
 *   documents.upload  déposer un document
 *   documents.manage  consulter/remplacer/supprimer tous les documents
 *                     de l'établissement
 *
 * Attribution :
 *   ADMIN_SCHOOL : toutes les clés.
 *   FINANCE_MANAGER : read + upload (justificatifs de dépenses).
 *   CASHIER : aucune.
 *
 * Aucune migration Prisma — les permissions sont des lignes de données.
 * Non mappées dans PERMISSION_MODULE : brique d'infrastructure disponible
 * quel que soit le plan (pas de changement d'abonnement).
 * Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/g2/bootstrap-documents-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = [
  "documents.read",
  "documents.upload",
  "documents.manage",
] as const;

const ROLE_KEYS: Record<string, readonly string[]> = {
  ADMIN_SCHOOL: NEW_KEYS,
  FINANCE_MANAGER: ["documents.read", "documents.upload"],
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
    console.error("G2A_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
