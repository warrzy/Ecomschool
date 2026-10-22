/**
 * Lot G2-B — Bootstrap idempotent des permissions d'admission.
 *
 * Nouvelles clés :
 *   admissions.read    consulter campagnes et dossiers
 *   admissions.review  instruire : passer en revue, demander des
 *                      compléments, consulter les pièces de candidature
 *                      (porte dédiée — documents.manage seul ne suffit pas)
 *   admissions.decide  décisions d'admission (G2-C)
 *   admissions.manage  créer/configurer/ouvrir/fermer les campagnes,
 *                      régénérer un code de suivi compromis
 *   admissions.convert convertir une candidature admise en inscription
 *                      définitive (G2-D) — compose avec enrollment.create,
 *                      student.create et guardian.manage ; n'accorde
 *                      aucun droit financier en dehors de ce parcours
 *
 * Attribution : ADMIN_SCHOOL uniquement (les écoles créent leurs propres
 * rôles d'instruction si besoin — un « secrétaire admissions » type aurait
 * read+review+documents.read pour le téléchargement interne).
 *
 * Non mappées dans PERMISSION_MODULE : comme les autres briques socles,
 * pas de changement d'abonnement à ce stade.
 * Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/g2/bootstrap-admissions-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = [
  "admissions.read",
  "admissions.review",
  "admissions.decide",
  "admissions.manage",
  "admissions.convert",
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
    console.error("G2B_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
