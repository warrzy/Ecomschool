/**
 * Comptes de démonstration — préproduction uniquement.
 * Crée une école « ÉCOLE DÉMO VALIDATION » + 3 comptes cloisonnés :
 *   demo-compta / demo-rh / demo-paie @demo.ecomschool.test
 * Séparation des fonctions : compta ≠ RH ≠ paie (confidentialité des salaires).
 * Idempotent (upserts). Exécution : npx tsx scripts/preprod/demo-accounts.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

const SCHOOL = { name: "ÉCOLE DÉMO VALIDATION", code: "DEMO-VAL", slug: "demo-validation" };
const ACCOUNTS: { email: string; password: string; perms: string[]; label: string }[] = [
  { email: "demo-compta@demo.ecomschool.test", password: "Demo-Compta-2026!", label: "COMPTABLE_DEMO",
    perms: ["accounting.read", "accounting.manage", "accounting.export", "expenses.read", "treasury.read"] },
  { email: "demo-rh@demo.ecomschool.test", password: "Demo-Rh-2026!", label: "RH_DEMO",
    perms: ["hr.read", "hr.manage"] },
  { email: "demo-paie@demo.ecomschool.test", password: "Demo-Paie-2026!", label: "PAIE_DEMO",
    perms: ["payroll.read", "payroll.manage", "hr.read"] },
];

async function main() {
  const school = await prisma.school.upsert({
    where: { slug: SCHOOL.slug },
    update: {},
    create: { ...SCHOOL, status: "ACTIVE" },
  });
  console.log(`École : ${school.name} (${school.id})`);

  for (const acc of ACCOUNTS) {
    const passwordHash = await hashPassword(acc.password);
    const user = await prisma.user.upsert({
      where: { email: acc.email },
      update: { passwordHash },
      create: { email: acc.email, firstName: "Démo", lastName: acc.label.replace(/_/g, " "), passwordHash },
    });
    const role = (await prisma.role.findFirst({
      where: { scope: "SCHOOL", schoolId: school.id, name: acc.label },
    })) ?? (await prisma.role.create({
      data: { name: acc.label, scope: "SCHOOL", schoolId: school.id },
    }));
    const perms = await prisma.permission.findMany({ where: { key: { in: acc.perms } }, select: { id: true, key: true } });
    const missing = acc.perms.filter((k) => !perms.some((p) => p.key === k));
    if (missing.length) console.warn(`  ⚠ permissions absentes : ${missing.join(", ")} (bootstrap requis)`);
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true,
    });
    const membership = await prisma.schoolMembership.findFirst({ where: { userId: user.id, schoolId: school.id } });
    if (membership) {
      await prisma.schoolMembership.update({ where: { id: membership.id }, data: { roleId: role.id, status: "ACTIVE" } });
    } else {
      await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, roleId: role.id } });
    }
    console.log(`  ${acc.email} → rôle ${acc.label} (${perms.length} permissions)`);
  }
  console.log("Comptes de démonstration prêts.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
