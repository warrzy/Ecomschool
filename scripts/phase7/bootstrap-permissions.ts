import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const PHASE7_KEYS = [
  "finance.read",
  "finance.configure",
  "finance.fees.manage",
  "finance.discounts.manage",
  "finance.payments.create",
  "finance.payments.validate",
  "finance.payments.cancel",
  "finance.receipts.read",
  "finance.receipts.print",
  "finance.reports.read",
  "finance.cash.close",
];

const FINANCE_MANAGER_KEYS = PHASE7_KEYS;

const CASHIER_KEYS = [
  "finance.read",
  "finance.payments.create",
  "finance.receipts.read",
  "finance.receipts.print",
];

async function ensureRole(name: string, description: string) {
  const existing = await prisma.role.findFirst({
    where: { name, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.role.create({
    data: { name, scope: "SCHOOL", schoolId: null, description },
    select: { id: true },
  });
  return created.id;
}

async function grant(roleId: string, keys: string[], idByKey: Map<string, string>) {
  await prisma.rolePermission.createMany({
    data: keys.map((k) => ({ roleId, permissionId: idByKey.get(k)! })),
    skipDuplicates: true,
  });
}

async function main() {
  await prisma.permission.createMany({
    data: PHASE7_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany({
    where: { key: { in: PHASE7_KEYS } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const adminRoles = await prisma.role.findMany({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL" },
    select: { id: true },
  });
  for (const role of adminRoles) await grant(role.id, PHASE7_KEYS, idByKey);

  const fmRoleId = await ensureRole(
    "FINANCE_MANAGER",
    "Gestionnaire financier (rôle système)",
  );
  const cashierRoleId = await ensureRole("CASHIER", "Caissier (rôle système)");
  await grant(fmRoleId, FINANCE_MANAGER_KEYS, idByKey);
  await grant(cashierRoleId, CASHIER_KEYS, idByKey);

  console.log(
    JSON.stringify({
      phase7Keys: PHASE7_KEYS.length,
      adminRoles: adminRoles.length,
      fmRoleId,
      cashierRoleId,
    }),
  );
}

main()
  .catch((e) => {
    console.error("PHASE7_BOOTSTRAP_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
