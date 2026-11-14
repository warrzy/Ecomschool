/**
 * Comptes de démonstration — préproduction uniquement.
 * Crée une école « ÉCOLE DÉMO VALIDATION » + 6 comptes cloisonnés :
 *   demo-admin / demo-compta / demo-rh / demo-paie / demo-enseignant / demo-parent
 *   @demo.ecomschool.test
 * Séparation des fonctions : compta ≠ RH ≠ paie (confidentialité des salaires),
 * portails enseignant (/teacher) et parent (/parent) avec leurs fiches liées.
 * Les noms de rôle TEACHER et PARENT sont exigés par les layouts des portails
 * (redirection /app → /parent, garde /teacher).
 * Idempotent (upserts). Exécution : npx tsx scripts/preprod/demo-accounts.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

const SCHOOL = { name: "ÉCOLE DÉMO VALIDATION", code: "DEMO-VAL", slug: "demo-validation" };

// M6 : les mots de passe démo ne sont plus commités — ils proviennent de
// l'environnement (DEMO_<LABEL>_PASSWORD ou DEMO_SEED_PASSWORD global).
// La garde ci-dessous interdit toute exécution hors préproduction.
function demoPassword(envSuffix: string): string {
  const v = process.env[`DEMO_${envSuffix}_PASSWORD`] ?? process.env.DEMO_SEED_PASSWORD;
  if (!v || v.length < 12)
    throw new Error(`Mot de passe démo absent/faible : définir DEMO_${envSuffix}_PASSWORD ou DEMO_SEED_PASSWORD (≥12 car.)`);
  return v;
}

const ACCOUNTS: { email: string; envSuffix: string; perms: string[]; label: string }[] = [
  { email: "demo-compta@demo.ecomschool.test", envSuffix: "COMPTA", label: "COMPTABLE_DEMO",
    perms: ["accounting.read", "accounting.manage", "accounting.export", "expenses.read", "treasury.read"] },
  { email: "demo-rh@demo.ecomschool.test", envSuffix: "RH", label: "RH_DEMO",
    perms: ["hr.read", "hr.manage"] },
  { email: "demo-paie@demo.ecomschool.test", envSuffix: "PAIE", label: "PAIE_DEMO",
    perms: ["payroll.read", "payroll.manage", "hr.read"] },
  { email: "demo-admin@demo.ecomschool.test", envSuffix: "ADMIN", label: "DEMO_ADMIN",
    perms: [
      "academic.read", "academic.manage", "student.read", "student.manage", "enrollment.read", "enrollment.manage",
      "classroom.read", "classroom.manage", "finance.read", "finance.manage", "finance.configure",
      "finance.reports.read", "announcements.read", "announcements.manage",
      "treasury.read", "expenses.read", "expenses.create",
      "accounting.read", "accounting.manage", "accounting.export",
      "hr.read", "hr.manage", "payroll.read", "payroll.manage",
    ] },
  // Portail enseignant : le layout /teacher exige roleName === "TEACHER"
  // et une fiche Teacher reliée (créée par demo-data.ts).
  { email: "demo-enseignant@demo.ecomschool.test", envSuffix: "ENSEIGNANT", label: "TEACHER",
    perms: ["schedules.read", "sessions.read", "attendance.read", "grades.read", "assessments.read", "results.read"] },
  // Portail parent : le layout /app redirige roleName === "PARENT" vers /parent,
  // qui exige la permission portal.parent + une fiche Guardian reliée.
  { email: "demo-parent@demo.ecomschool.test", envSuffix: "PARENT", label: "PARENT",
    perms: ["portal.parent", "notifications.read"] },
];

async function main() {
  // Garde anti-production : le provisioning démo exige un opt-in explicite
  // et refuse toute base dont l'URL laisse soupçonner la production.
  if (process.env.ALLOW_DEMO_SEED !== "1")
    throw new Error("Provisioning démo refusé : définir ALLOW_DEMO_SEED=1 (préproduction/isolé uniquement)");
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (/prod/i.test(dbUrl) && !/preprod|verify/i.test(dbUrl))
    throw new Error("DATABASE_URL semble pointer sur la production — arrêt.");
  const school = await prisma.school.upsert({
    where: { slug: SCHOOL.slug },
    update: {},
    create: { ...SCHOOL, status: "ACTIVE" },
  });
  console.log(`École : ${school.name} (${school.id})`);

  for (const acc of ACCOUNTS) {
    const passwordHash = await hashPassword(demoPassword(acc.envSuffix));
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
