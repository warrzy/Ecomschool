import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

/**
 * Provisionnement ciblé : crée la permission `platform.monitoring.manage`
 * et l'attribue aux rôles PLATFORM_OWNER uniquement.
 *
 * Pourquoi ce script plutôt que `bootstrap.ts` complet ?
 * Le bootstrap fait des `upsert` sur les plans et modules : il ÉCRASE les
 * champs (prix, limites, libellés) avec les valeurs par défaut. Si les offres
 * ont été personnalisées en préproduction, un bootstrap complet annulerait
 * ces réglages. Ce script ne touche QUE la permission manquante.
 *
 * Idempotent : createMany skipDuplicates — rejouable sans risque.
 * N'écrit ni compte, ni mot de passe, ni abonnement, ni suppression.
 *
 * Exécution préproduction :
 *   cd /chemin/app && DATABASE_URL=<preprod> npx tsx scripts/phase8/grant-monitoring-manage.ts
 */

const KEY = "platform.monitoring.manage";

async function main() {
  await prisma.permission.createMany({
    data: [{ key: KEY }],
    skipDuplicates: true,
  });
  const perm = await prisma.permission.findUniqueOrThrow({
    where: { key: KEY },
    select: { id: true },
  });

  // Attribution limitée aux rôles propriétaires plateforme — jamais aux rôles
  // commerciaux ni école.
  const owners = await prisma.role.findMany({
    where: { name: "PLATFORM_OWNER", scope: "PLATFORM", schoolId: null },
    select: { id: true },
  });
  const grant = await prisma.rolePermission.createMany({
    data: owners.map((r) => ({ roleId: r.id, permissionId: perm.id })),
    skipDuplicates: true,
  });

  console.log(
    JSON.stringify({
      permission: KEY,
      ownerRoles: owners.length,
      granted: grant.count,
    }),
  );
}

main()
  .catch((e) => {
    console.error("GRANT_MONITORING_MANAGE_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
