/**
 * RH — Bootstrap idempotent des permissions ressources humaines.
 *   hr.read     consultation du personnel (fiches, contrats, soldes)
 *   hr.manage   création/modification employés, contrats, avenants, sorties
 *   payroll.read    bulletins/états de paie (RH-3+)
 *   payroll.manage  runs de paie, rectifications (RH-3+)
 * Attribution : ADMIN_SCHOOL : tout ; HR_MANAGER (rôle global créé si absent) : hr.* seulement
 *   — séparation des fonctions : le RH ne voit pas la paie sans payroll.*.
 * Exécution : npx tsx scripts/rh1/bootstrap-hr-permissions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const NEW_KEYS = ["hr.read", "hr.manage", "payroll.read", "payroll.manage"] as const;
const ROLE_KEYS: Record<string, readonly string[]> = {
  ADMIN_SCHOOL: NEW_KEYS,
  HR_MANAGER: ["hr.read", "hr.manage"],
};

async function main() {
  await prisma.permission.createMany({ data: NEW_KEYS.map((key) => ({ key })), skipDuplicates: true });
  const permissions = await prisma.permission.findMany({ where: { key: { in: [...NEW_KEYS] } }, select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
  for (const [roleName, keys] of Object.entries(ROLE_KEYS)) {
    if (roleName === "HR_MANAGER") {
      await prisma.role.createMany({
        data: { name: "HR_MANAGER", scope: "SCHOOL", schoolId: null },
        skipDuplicates: true,
      }).catch(() => {});
    }
    const roles = await prisma.role.findMany({ where: { name: roleName, scope: "SCHOOL" }, select: { id: true } });
    let linked = 0;
    for (const role of roles) {
      const r = await prisma.rolePermission.createMany({
        data: keys.map((k) => ({ roleId: role.id, permissionId: idByKey.get(k)! })),
        skipDuplicates: true,
      });
      linked += r.count;
    }
    console.log(`${roleName}: ${linked} permission(s) liée(s) sur ${roles.length} rôle(s)`);
  }
  console.log("Bootstrap RH terminé.");
}
main().finally(() => prisma.$disconnect());
