/**
 * Lot G4 — Bootstrap idempotent des permissions documents administratifs.
 *
 * Nouvelles clés :
 *   administrative-docs.read   historique + téléchargement des
 *                              documents émis (attestation, certificat,
 *                              carte scolaire)
 *   administrative-docs.issue  émission, révocation, réémission
 *
 * Attribution :
 *   ADMIN_SCHOOL : les deux clés (émission = acte administratif).
 *   Autres rôles : aucune — un caissier ou enseignant n'émet pas.
 *
 * Mappées dans PERMISSION_MODULE(+V2) → ADMINISTRATION : la fonction
 * suit l'abonnement de l'école comme les autres modules métier.
 * Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/g4/bootstrap-admin-docs-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = [
  "administrative-docs.read",
  "administrative-docs.issue",
] as const;

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
    console.error("G4_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
