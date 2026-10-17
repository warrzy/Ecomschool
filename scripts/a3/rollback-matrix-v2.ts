import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../../src/lib/db/prisma";

/**
 * Lot A3 — Rollback de la migration matrice V2.
 *
 * Restaure les associations PlanModule d'avant migration (snapshot) et
 * archive les modules FINANCE_CORE / FINANCE_MGMT (RecordStatus.ARCHIVED —
 * jamais de suppression, des overrides peuvent les référencer).
 *
 * ORDRE : passer d'abord SUBSCRIPTION_MATRIX_V2="" et redémarrer
 * l'application, PUIS lancer ce script (sous V1 les nouvelles lignes
 * PlanModule sont inertes — les retirer ensuite n'a aucun effet visible).
 *
 * Usage :
 *   npx tsx scripts/a3/rollback-matrix-v2.ts --snapshot scripts/a3/snapshots/plan-modules-<ts>.json
 *   (ajouter --apply pour écrire ; dry-run par défaut)
 */

const APPLY = process.argv.includes("--apply");
const snapIdx = process.argv.indexOf("--snapshot");
const snapPath = snapIdx >= 0 ? process.argv[snapIdx + 1] : undefined;

type Snapshot = {
  at: string;
  createdModules: string[];
  planModulesAdded: Record<string, string[]>;
  planModulesBefore: Record<string, string[]>;
};

async function main() {
  if (!snapPath) {
    console.error("Usage : --snapshot <fichier> [--apply]");
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(snapPath, "utf8")) as Snapshot;
  console.log(`\n=== Rollback matrice V2 — ${APPLY ? "ÉCRITURE" : "DRY-RUN"} ===`);
  console.log(`Snapshot du ${snap.at} ; modules créés : ${snap.createdModules.join(", ") || "aucun"}\n`);

  const plans = await prisma.subscriptionPlan.findMany({
    where: { code: { in: Object.keys(snap.planModulesAdded) } },
    include: { modules: { include: { module: true } } },
  });

  for (const plan of plans) {
    const before = new Set(snap.planModulesBefore[plan.code] ?? []);
    const added = new Set(snap.planModulesAdded[plan.code] ?? []);
    const toRemove = plan.modules.filter((pm) => added.has(pm.module.code));
    const extra = plan.modules.filter(
      (pm) => !before.has(pm.module.code) && !added.has(pm.module.code),
    );
    console.log(`${plan.code} : ${toRemove.length} association(s) à retirer (${toRemove.map((pm) => pm.module.code).join(", ") || "aucune"})`);
    if (extra.length)
      console.log(`  INFO associations postérieures au snapshot conservées : ${extra.map((pm) => pm.module.code).join(", ")}`);

    if (APPLY && toRemove.length) {
      await prisma.planModule.deleteMany({
        where: { id: { in: toRemove.map((pm) => pm.id) } },
      });
    }
  }

  // Désactivation des modules créés (jamais de delete : overrides possibles).
  const created = await prisma.platformModule.findMany({
    where: { code: { in: snap.createdModules } },
    select: { id: true, code: true, status: true },
  });
  for (const m of created) {
    console.log(`Module ${m.code} : status ${m.status} → ARCHIVED`);
    if (APPLY)
      await prisma.platformModule.update({
        where: { id: m.id },
        data: { status: "ARCHIVED" },
      });
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — aucune écriture. Relancer avec --apply pour appliquer.");
    return;
  }

  // Vérification post-rollback
  console.log("\nÉtat après rollback :");
  const after = await prisma.subscriptionPlan.findMany({
    where: { code: { in: Object.keys(snap.planModulesAdded) } },
    include: { modules: { include: { module: true } } },
  });
  let ok = true;
  for (const p of after) {
    const codes = p.modules.map((m) => m.module.code).sort();
    const expected = (snap.planModulesBefore[p.code] ?? []).slice().sort();
    const match = JSON.stringify(codes) === JSON.stringify(expected);
    console.log(`  ${p.code} : ${match ? "conforme au snapshot" : `diff — ${codes.join(", ")}`}`);
    if (!match) ok = false;
  }
  console.log(ok ? "\nRollback conforme." : "\nATTENTION : écarts avec le snapshot (voir ci-dessus).");
  console.log("Vérifier que SUBSCRIPTION_MATRIX_V2 est vide puis redémarrer l'application.");
}

main().finally(() => prisma.$disconnect());
