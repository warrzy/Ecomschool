import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../../src/lib/db/prisma";

/**
 * Lot A3 — Migration coordonnée de la matrice d'abonnements vers la cible A1.
 *
 * IDEMPOTENT — n'ajoute jamais, ne supprime rien, ne touche ni tarifs,
 * ni quotas, ni abonnements, ni overrides, ni plans non commerciaux.
 *
 * Usage :
 *   npx tsx scripts/a3/migrate-matrix-v2.ts            → dry-run (défaut)
 *   npx tsx scripts/a3/migrate-matrix-v2.ts --apply    → écriture + snapshot
 *
 * Le snapshot JSON (scripts/a3/snapshots/) alimente rollback-matrix-v2.ts.
 */

const APPLY = process.argv.includes("--apply");

/** Nouveaux modules créés par cette migration. */
const NEW_MODULES = [
  {
    code: "FINANCE_CORE",
    name: "Caisse — encaissements, reçus et impayés",
    description:
      "Consultation financière, enregistrement des encaissements, émission de reçus et suivi des impayés.",
  },
  {
    code: "FINANCE_MGMT",
    name: "Finance — configuration et supervision",
    description:
      "Paramétrage des frais, remises, validation/annulation des paiements, clôture de caisse.",
  },
] as const;

/** Contenu cible des plans commerciaux (matrice A1, fonctionnalités existantes). */
const TARGET_PLAN_MODULES: Record<string, string[]> = {
  ESSENTIEL: [
    "ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS",
    "SCHEDULES", "ATTENDANCE", "GRADES", "REPORT_CARDS", "FINANCE_CORE",
  ],
  PROFESSIONNEL: [
    "ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS",
    "SCHEDULES", "ATTENDANCE", "GRADES", "REPORT_CARDS", "FINANCE_CORE",
    "FINANCE_MGMT", "PARENT_PORTAL", "STUDENT_PORTAL", "COMMUNICATION", "REPORTS",
  ],
  PREMIUM: [
    "ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS",
    "SCHEDULES", "ATTENDANCE", "GRADES", "REPORT_CARDS", "FINANCE_CORE",
    "FINANCE_MGMT", "PARENT_PORTAL", "STUDENT_PORTAL", "COMMUNICATION", "REPORTS",
  ],
};

async function main() {
  console.log(`\n=== Migration matrice V2 — mode ${APPLY ? "ÉCRITURE" : "DRY-RUN"} ===\n`);

  // --- État initial ---
  const catalog = await prisma.platformModule.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, commercial: true, status: true },
  });
  const byCode = new Map(catalog.map((m) => [m.code, m]));
  console.log(`Catalogue : ${catalog.length} modules`);

  const targetCodes = new Set(Object.values(TARGET_PLAN_MODULES).flat());
  const missingCatalog = [...targetCodes].filter((c) => !byCode.has(c) && !NEW_MODULES.some((n) => n.code === c));
  if (missingCatalog.length) {
    console.error(`ERREUR : modules cibles absents du catalogue ET non prévus : ${missingCatalog.join(", ")}`);
    process.exit(1);
  }

  const plans = await prisma.subscriptionPlan.findMany({
    where: { code: { in: Object.keys(TARGET_PLAN_MODULES) } },
    include: { modules: { include: { module: true } } },
  });
  const skipped = plans.filter((p) => !p.commercial);
  if (skipped.length)
    console.log(`Plans non commerciaux ignorés : ${skipped.map((p) => p.code).join(", ")}`);
  const commercial = plans.filter((p) => p.commercial);
  if (commercial.length !== 3) {
    console.error(`ERREUR : ${commercial.length}/3 plans commerciaux trouvés (${commercial.map((p) => p.code).join(", ")})`);
    process.exit(1);
  }

  // --- Diff prévu ---
  const missingModules = NEW_MODULES.filter((m) => !byCode.has(m.code));
  console.log(missingModules.length
    ? `À créer : ${missingModules.map((m) => m.code).join(", ")}`
    : "Modules FINANCE_CORE / FINANCE_MGMT déjà présents (idempotent).");

  const diff: Record<string, { before: string[]; added: string[] }> = {};
  let totalAdds = 0;
  for (const plan of commercial) {
    const current = new Set(plan.modules.map((pm) => pm.module.code));
    const toAdd = TARGET_PLAN_MODULES[plan.code].filter((c) => !current.has(c));
    diff[plan.code] = { before: [...current].sort(), added: toAdd };
    totalAdds += toAdd.length;
    console.log(`\n${plan.code} (${plan.monthlyPrice} FCFA/mois)`);
    console.log(`  avant : ${diff[plan.code].before.join(", ")}`);
    console.log(`  ajout : ${toAdd.join(", ") || "rien (déjà conforme)"}`);
  }
  if (!missingModules.length && !totalAdds) {
    console.log("\nRien à faire : matrice déjà appliquée.");
    return;
  }
  if (!APPLY) {
    console.log("\nDRY-RUN — aucune écriture. Relancer avec --apply pour appliquer.");
    return;
  }

  // --- Écriture ---
  const snapshotDir = "scripts/a3/snapshots";
  mkdirSync(snapshotDir, { recursive: true });
  const snapshot = {
    at: new Date().toISOString(),
    createdModules: missingModules.map((m) => m.code),
    planModulesAdded: Object.fromEntries(
      Object.entries(diff).map(([k, v]) => [k, v.added]),
    ),
    planModulesBefore: Object.fromEntries(
      Object.entries(diff).map(([k, v]) => [k, v.before]),
    ),
  };
  const snapPath = `${snapshotDir}/plan-modules-${snapshot.at.replace(/[:.]/g, "-")}.json`;

  await prisma.$transaction(async (tx) => {
    for (const mod of NEW_MODULES) {
      await tx.platformModule.upsert({
        where: { code: mod.code },
        update: { name: mod.name, description: mod.description, commercial: true },
        create: { ...mod, commercial: true },
      });
    }
    const fresh = await tx.platformModule.findMany({ select: { id: true, code: true } });
    const idOf = new Map(fresh.map((m) => [m.code, m.id]));
    for (const plan of commercial) {
      for (const code of TARGET_PLAN_MODULES[plan.code]) {
        await tx.planModule.upsert({
          where: {
            planId_moduleId: { planId: plan.id, moduleId: idOf.get(code)! },
          },
          update: {},
          create: { planId: plan.id, moduleId: idOf.get(code)! },
        });
      }
    }
  });
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nAppliqué. Snapshot rollback : ${snapPath}`);

  // --- Vérification après ---
  const after = await prisma.subscriptionPlan.findMany({
    where: { code: { in: Object.keys(TARGET_PLAN_MODULES) }, commercial: true },
    include: { modules: { include: { module: true } } },
  });
  for (const p of after) {
    const codes = p.modules.map((m) => m.module.code).sort();
    const target = new Set(TARGET_PLAN_MODULES[p.code]);
    const missing = [...target].filter((c) => !codes.includes(c));
    console.log(`${p.code} après : ${codes.join(", ")}`);
    if (missing.length) {
      console.error(`  ERREUR : modules cibles manquants : ${missing.join(", ")}`);
      process.exitCode = 1;
    }
  }
  console.log("\nRappel : SUBSCRIPTION_MATRIX_V2=1 + redémarrage applicatif pour activer.");
}

main().finally(() => prisma.$disconnect());
