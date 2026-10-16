import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const PLATFORM_KEYS = [
  "platform.plans.read",
  "platform.plans.manage",
  "platform.subscriptions.read",
  "platform.subscriptions.manage",
  "platform.invoices.read",
  "platform.invoices.manage",
  "platform.payments.manage",
  "platform.modules.manage",
  "platform.monitoring.read",
  "platform.monitoring.manage",
];

export const MODULE_CATALOG = [
  { code: "ADMINISTRATION", name: "Administration scolaire", description: "Paramètres, années scolaires, utilisateurs" },
  { code: "STUDENTS", name: "Gestion des élèves", description: "Dossiers élèves, parents, inscriptions" },
  { code: "TEACHERS", name: "Gestion des enseignants", description: "Enseignants et affectations" },
  { code: "CLASSES_SUBJECTS", name: "Classes et matières", description: "Niveaux, classes, matières, coefficients" },
  { code: "SCHEDULES", name: "Emplois du temps", description: "Créneaux, séances, salles" },
  { code: "ATTENDANCE", name: "Présences et absences", description: "Appels, absences, retards, justifications" },
  { code: "GRADES", name: "Évaluations et notes", description: "Évaluations, saisie, moyennes" },
  { code: "REPORT_CARDS", name: "Bulletins", description: "Calculs, classements, bulletins PDF" },
  { code: "PARENT_PORTAL", name: "Portail parents", description: "Consultation parent" },
  { code: "STUDENT_PORTAL", name: "Portail élèves", description: "Consultation élève" },
  { code: "FINANCE", name: "Finances scolaires", description: "Frais, encaissements, reçus, impayés" },
  { code: "COMMUNICATION", name: "Communication", description: "Annonces et notifications internes" },
  { code: "REPORTS", name: "Rapports et statistiques", description: "Indicateurs et tableaux de bord" },
] as const;

const PLANS: {
  code: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxStudents: number | null;
  maxUsers: number | null;
  trialDays: number;
  modules: string[];
}[] = [
  {
    code: "ESSENTIEL",
    name: "Essentiel",
    description: "Gestion administrative de base",
    monthlyPrice: 15000,
    yearlyPrice: 150000,
    maxStudents: 300,
    maxUsers: 15,
    trialDays: 30,
    modules: ["ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS"],
  },
  {
    code: "PROFESSIONNEL",
    name: "Professionnel",
    description: "Vie scolaire et résultats",
    monthlyPrice: 30000,
    yearlyPrice: 300000,
    maxStudents: 1000,
    maxUsers: 50,
    trialDays: 30,
    modules: [
      "ADMINISTRATION",
      "STUDENTS",
      "TEACHERS",
      "CLASSES_SUBJECTS",
      "SCHEDULES",
      "ATTENDANCE",
      "GRADES",
      "REPORT_CARDS",
    ],
  },
  {
    code: "PREMIUM",
    name: "Premium",
    description: "Offre complète avec portails et finances",
    monthlyPrice: 50000,
    yearlyPrice: 500000,
    maxStudents: null,
    maxUsers: null,
    trialDays: 30,
    modules: MODULE_CATALOG.map((m) => m.code),
  },
];

async function ensureRole(name: string, description: string) {
  const existing = await prisma.role.findFirst({
    where: { name, scope: "PLATFORM", schoolId: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.role.create({
    data: { name, scope: "PLATFORM", schoolId: null, description },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  // ---- Permissions plateforme ----
  await prisma.permission.createMany({
    data: PLATFORM_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });
  const permissions = await prisma.permission.findMany({
    where: { key: { in: PLATFORM_KEYS } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
  const grant = async (roleId: string, keys: string[]) => {
    await prisma.rolePermission.createMany({
      data: keys.map((k) => ({ roleId, permissionId: idByKey.get(k)! })),
      skipDuplicates: true,
    });
  };

  const ownerRoles = await prisma.role.findMany({
    where: { name: "PLATFORM_OWNER", scope: "PLATFORM" },
    select: { id: true },
  });
  for (const r of ownerRoles) await grant(r.id, PLATFORM_KEYS);

  const salesRoleId = await ensureRole(
    "PLATFORM_SALES",
    "Gestionnaire commercial ECOM-TOUCH (rôle système)",
  );
  await grant(salesRoleId, [
    "platform.plans.read",
    "platform.subscriptions.read",
    "platform.subscriptions.manage",
    "platform.invoices.read",
    "platform.invoices.manage",
    "platform.payments.manage",
    "platform.modules.manage",
  ]);

  // ---- Catalogue de modules ----
  for (const m of MODULE_CATALOG) {
    await prisma.platformModule.upsert({
      where: { code: m.code },
      update: { name: m.name, description: m.description },
      create: { code: m.code, name: m.name, description: m.description },
    });
  }

  // ---- Offres par défaut ----
  const modules = await prisma.platformModule.findMany({ select: { id: true, code: true } });
  const moduleId = new Map(modules.map((m) => [m.code, m.id]));
  for (const p of PLANS) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        description: p.description,
        monthlyPrice: p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
        maxStudents: p.maxStudents,
        maxUsers: p.maxUsers,
        trialDays: p.trialDays,
      },
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        monthlyPrice: p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
        maxStudents: p.maxStudents,
        maxUsers: p.maxUsers,
        trialDays: p.trialDays,
      },
    });
    await prisma.planModule.createMany({
      data: p.modules
        .map((code) => moduleId.get(code))
        .filter((id): id is string => !!id)
        .map((mId) => ({ planId: plan.id, moduleId: mId })),
      skipDuplicates: true,
    });
  }

  console.log(JSON.stringify({ permissions: PLATFORM_KEYS.length, modules: MODULE_CATALOG.length, plans: PLANS.length, salesRoleId }));
}

main()
  .catch((e) => {
    console.error("PHASE8_BOOTSTRAP_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
