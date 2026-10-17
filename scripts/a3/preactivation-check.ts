import "dotenv/config";
import { PERMISSION_MODULE_V2 } from "../../src/lib/services/platform/modules";
import { prisma } from "../../src/lib/db/prisma";

/**
 * Lot A3 — Vérifications préalables croisées avant activation.
 * Compare PERMISSION_MODULE_V2 (code) aux plans cibles de la migration.
 * Lecture seule.
 */

const TARGET: Record<string, Set<string>> = {
  ESSENTIEL: new Set([
    "ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS",
    "SCHEDULES", "ATTENDANCE", "GRADES", "REPORT_CARDS", "FINANCE_CORE",
  ]),
  PROFESSIONNEL: new Set([
    "ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS",
    "SCHEDULES", "ATTENDANCE", "GRADES", "REPORT_CARDS", "FINANCE_CORE",
    "FINANCE_MGMT", "PARENT_PORTAL", "STUDENT_PORTAL", "COMMUNICATION", "REPORTS",
  ]),
  PREMIUM: new Set([
    "ADMINISTRATION", "STUDENTS", "TEACHERS", "CLASSES_SUBJECTS",
    "SCHEDULES", "ATTENDANCE", "GRADES", "REPORT_CARDS", "FINANCE_CORE",
    "FINANCE_MGMT", "PARENT_PORTAL", "STUDENT_PORTAL", "COMMUNICATION", "REPORTS",
  ]),
};

async function main() {
  let bad = 0;
  const fail = (msg: string) => {
    console.log("ECART :", msg);
    bad++;
  };

  // 1. Tout module ciblé par V2 doit être couvert par PREMIUM (plan complet)
  const targets = new Set(Object.values(PERMISSION_MODULE_V2));
  for (const m of targets)
    if (!TARGET.PREMIUM.has(m)) fail(`module V2 hors PREMIUM : ${m}`);

  // 2. FINANCE_CORE = caisse uniquement (aucune supervision)
  const corePerms = Object.entries(PERMISSION_MODULE_V2)
    .filter(([, m]) => m === "FINANCE_CORE")
    .map(([p]) => p);
  const mgmtPerms = Object.entries(PERMISSION_MODULE_V2)
    .filter(([, m]) => m === "FINANCE_MGMT")
    .map(([p]) => p);
  console.log("FINANCE_CORE :", corePerms.join(", "));
  console.log("FINANCE_MGMT :", mgmtPerms.join(", "));
  for (const p of corePerms)
    if (/configure|fees\.manage|discounts|validate|cancel|cash\.close/.test(p))
      fail(`permission de supervision dans FINANCE_CORE : ${p}`);

  // 3. Toutes les permissions finance.* réelles classées CORE ou MGMT
  const dbPerms = (await prisma.permission.findMany({ select: { key: true } })).map(
    (p) => p.key,
  );
  for (const p of dbPerms.filter((k) => k.startsWith("finance."))) {
    const m = PERMISSION_MODULE_V2[p];
    if (m !== "FINANCE_CORE" && m !== "FINANCE_MGMT")
      fail(`permission finance non classée : ${p} → ${m ?? "non mappée"}`);
  }

  // 4. Modules référencés par V2 présents dans au moins un plan cible
  for (const m of targets) {
    const plans = Object.entries(TARGET).filter(([, s]) => s.has(m)).map(([k]) => k);
    if (!plans.length) fail(`module ${m} absent de tous les plans cibles`);
    else console.log(`${m} → ${plans.join(", ")}`);
  }

  console.log(bad ? `\nRESULT : ${bad} écart(s)` : "\nRESULT : correspondance exacte");
  process.exitCode = bad ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
