/**
 * Lot H12 — Bootstrap idempotent des permissions « comptabilité ».
 *   accounting.read    consultation plan, journaux, écritures, balance
 *   accounting.manage  référentiel, exercices, génération, régularisation
 *   accounting.export  exports CSV (journal, grand livre, balance)
 * Attribution : ADMIN_SCHOOL et BURSAR (comptable) : les trois clés.
 * Mappées → FINANCE (V1) / FINANCE_MGMT (V2). Idempotent.
 * Exécution : npx tsx scripts/h12/bootstrap-accounting-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = [
  "accounting.read",
  "accounting.manage",
  "accounting.export",
] as const;

const ROLE_KEYS: Record<string, readonly string[]> = {
  ADMIN_SCHOOL: NEW_KEYS,
  BURSAR: NEW_KEYS,
};

async function main() {
  await prisma.permission.createMany({
    data: NEW_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });
  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...NEW_KEYS] } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
  const report: Record<string, number> = {};
  for (const [roleName, keys] of Object.entries(ROLE_KEYS)) {
    const roles = await prisma.role.findMany({
      where: { name: roleName, scope: "SCHOOL" },
      select: { id: true },
    });
    let linked = 0;
    for (const role of roles) {
      for (const key of keys) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId: role.id, permissionId: idByKey.get(key)! },
          },
          create: { roleId: role.id, permissionId: idByKey.get(key)! },
          update: {},
        });
        linked++;
      }
    }
    report[roleName] = linked;
  }
  console.log(`Bootstrap accounting : ${NEW_KEYS.join(", ")}`);
  console.log(JSON.stringify(report));
}
main().finally(() => prisma.$disconnect());
