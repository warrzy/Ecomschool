/**
 * Lot G2-E — Bootstrap idempotent des permissions de réinscription.
 *
 * Nouvelles clés :
 *   reenrollments.read    consulter campagnes et demandes de réinscription
 *   reenrollments.review  instruire : vérifier, demander des compléments,
 *                         consulter les pièces déposées (porte dédiée)
 *   reenrollments.decide  approuver/refuser une demande, choisir la
 *                         progression et la classe cible
 *   reenrollments.manage  créer/configurer/ouvrir/fermer les campagnes
 *
 * La finalisation (création de l'inscription + créances) exige en plus
 * `enrollment.create` — compose, n'accorde aucun droit financier seul.
 *
 * Attribution : ADMIN_SCHOOL uniquement (les écoles créent leurs propres
 * rôles si besoin). Idempotent : ré-exécutable sans doublons.
 *
 * Exécution : npx tsx scripts/g2/bootstrap-reenrollments-permissions.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";

const NEW_KEYS = [
  "reenrollments.read",
  "reenrollments.review",
  "reenrollments.decide",
  "reenrollments.manage",
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

  const report: Record<string, { roles: number; granted: string[]; linked: number }> = {};
  for (const [roleName, keys] of Object.entries(ROLE_KEYS)) {
    const roles = await prisma.role.findMany({
      where: { name: roleName, scope: "SCHOOL", schoolId: null },
      select: { id: true },
    });
    let linked = 0;
    for (const role of roles) {
      const res = await prisma.rolePermission.createMany({
        data: keys
          .map((k) => permissions.find((p) => p.key === k))
          .filter((p): p is { id: string; key: string } => !!p)
          .map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      linked += res.count;
    }
    report[roleName] = { roles: roles.length, granted: [...keys], linked };
  }

  console.log(JSON.stringify({ dryRun, permissions: permissions.map((p) => p.key), ...report }, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
