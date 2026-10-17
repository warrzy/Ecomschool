import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";

/**
 * Lot A3 — Simulation d'un plan sur une école via SchoolModuleOverride.
 *
 * Permet de recetter les scénarios Essentiel/Pro sur une école abonnée
 * PREMIUM sans modifier son abonnement : on désactive par override les
 * modules hors plan simulé. Réversible via --set reset.
 *
 * Usage :
 *   npx tsx scripts/a3/scenario-overrides.ts --school demo --set essentiel
 *   npx tsx scripts/a3/scenario-overrides.ts --school demo --set reset
 *   (dry-run par défaut ; --apply pour écrire)
 */

const APPLY = process.argv.includes("--apply");

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Modules à désactiver pour simuler chaque scénario (base PREMIUM). */
const SCENARIOS: Record<string, string[]> = {
  essentiel: ["FINANCE_MGMT", "PARENT_PORTAL", "STUDENT_PORTAL", "COMMUNICATION", "REPORTS"],
  // PRO cible = tout l'existant Premium (les modules avancés n'existent pas
  // encore) → aucun override nécessaire ; reset suffit.
  pro: [],
  premium: [],
};

async function main() {
  const schoolArg = arg("school") ?? "demo";
  const set = arg("set");
  if (!set || !(set === "reset" || set in SCENARIOS)) {
    console.error("Usage : --school <id|demo> --set <essentiel|pro|premium|reset> [--apply]");
    process.exit(1);
  }

  const school =
    schoolArg === "demo"
      ? await prisma.school.findFirst({
          where: {
            OR: [
              { name: { contains: "demo", mode: "insensitive" } },
              { name: { contains: "démo", mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true },
        })
      : await prisma.school.findUnique({
          where: { id: schoolArg },
          select: { id: true, name: true },
        });
  if (!school) {
    console.error(`École introuvable : ${schoolArg}`);
    process.exit(1);
  }
  console.log(`École : ${school.name} (${school.id})`);

  const sub = await prisma.schoolSubscription.findFirst({
    where: { schoolId: school.id },
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { code: true } } },
  });
  console.log(`Abonnement : ${sub ? `${sub.plan.code} (${sub.status})` : "aucun — overrides seuls s'appliquent"}`);

  const moduleCodes = new Set<string>([
    "FINANCE_MGMT", "PARENT_PORTAL", "STUDENT_PORTAL", "COMMUNICATION", "REPORTS",
  ]);
  const disable = new Set(set === "reset" ? [] : SCENARIOS[set]);
  const mods = await prisma.platformModule.findMany({
    where: { code: { in: [...moduleCodes] } },
    select: { id: true, code: true },
  });
  const modId = new Map(mods.map((m) => [m.code, m.id]));

  const planned = [...moduleCodes].map((code) => ({
    code,
    action:
      set === "reset" ? "supprimer l'override"
      : disable.has(code) ? "override = false"
      : "override = true (explicite)",
  }));
  for (const p of planned) console.log(`  ${p.code} → ${p.action}`);
  if (!modId.has("FINANCE_MGMT"))
    console.log("  INFO : FINANCE_MGMT absent du catalogue — ignoré (normal avant migration).");

  if (!APPLY) {
    console.log("\nDRY-RUN — aucune écriture. Relancer avec --apply pour appliquer.");
    return;
  }

  for (const code of moduleCodes) {
    const id = modId.get(code);
    if (!id) continue;
    if (set === "reset") {
      await prisma.schoolModuleOverride.deleteMany({
        where: { schoolId: school.id, moduleId: id },
      });
    } else {
      await prisma.schoolModuleOverride.upsert({
        where: { schoolId_moduleId: { schoolId: school.id, moduleId: id } },
        update: { enabled: disable.has(code) ? false : true, note: `recette A3 ${set}` },
        create: {
          schoolId: school.id,
          moduleId: id,
          enabled: !disable.has(code),
          note: `recette A3 ${set}`,
        },
      });
    }
  }
  const remaining = await prisma.schoolModuleOverride.findMany({
    where: { schoolId: school.id },
    include: { module: { select: { code: true } } },
  });
  console.log(
    `\nAppliqué. Overrides actifs : ${remaining.map((o) => `${o.module.code}=${o.enabled}`).join(", ") || "aucun"}`,
  );
}

main().finally(() => prisma.$disconnect());
