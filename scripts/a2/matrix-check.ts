/**
 * Lot A2 — Matrice de tests permissions × modules × plans (lecture seule).
 *
 * Simule permissionCoveredByEntitlements() sur les données réelles (rôles,
 * permissions, plans, catalogue) pour vérifier la future matrice V2 avant
 * activation. Aucune écriture en base.
 *
 * Exécution : npx tsx scripts/a2/matrix-check.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  PERMISSION_MODULE,
  PERMISSION_MODULE_V2,
} from "../../src/lib/services/platform/modules";

// Modules créés lors de l'activation coordonnée (absents du catalogue actuel).
const PENDING_MODULES = new Set(["FINANCE_CORE", "FINANCE_MGMT"]);

const ALWAYS_IN_SUSPENSION = new Set(["portal.parent", "portal.student"]);
const isRead = (k: string) =>
  k.endsWith(".read") || k.endsWith(".print") || ALWAYS_IN_SUSPENSION.has(k);

type EntOpts = {
  planModules: Set<string> | null; // null = pas d'abonnement
  active: boolean;
  overrides?: Map<string, boolean>;
};

/** Replique exacte de permissionCoveredByEntitlements(). */
function covered(map: Record<string, string>, perm: string, o: EntOpts) {
  if (o.planModules === null) return true;
  if (!o.active) return isRead(perm);
  const code = map[perm];
  if (!code) return true;
  const ov = o.overrides?.get(code);
  if (ov !== undefined) return ov && o.active;
  return o.planModules.has(code);
}

// Matrice cible A1 simulée (PlanModule futur).
const TARGET_PLANS: Record<string, Set<string>> = {
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

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function main() {
  const catalog = new Set(
    (await prisma.platformModule.findMany({ select: { code: true } })).map((m) => m.code),
  );
  const dbPerms = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key),
  );
  const roles = await prisma.role.findMany({
    where: { scope: "SCHOOL", schoolId: null },
    include: { rolePermissions: { include: { permission: true } } },
  });
  const plans = await prisma.subscriptionPlan.findMany({
    where: { commercial: true },
    include: { modules: { include: { module: true } } },
  });

  const rolePerms = new Map(
    roles.map((r) => [r.name, r.rolePermissions.map((rp) => rp.permission.key)]),
  );

  // ---------- 1. Cohérence de la carte V2 ----------
  console.log("\n== 1. Cohérence PERMISSION_MODULE_V2 ==");
  const unknownTargets = Object.values(PERMISSION_MODULE_V2).filter(
    (c) => !catalog.has(c) && !PENDING_MODULES.has(c),
  );
  check("toutes les cibles V2 existent ou sont prévues", unknownTargets.length === 0,
    `inconnues: ${[...new Set(unknownTargets)].join(",")}`);
  const realMapped = Object.keys(PERMISSION_MODULE_V2).filter((k) => dbPerms.has(k));
  console.log(`  INFO ${realMapped.length}/${dbPerms.size} permissions réelles mappées`);
  const dead = Object.keys(PERMISSION_MODULE_V2).filter((k) => !dbPerms.has(k));
  console.log(`  INFO clés V2 sans Permission DB (prévues/mortes): ${dead.join(", ") || "aucune"}`);
  const realUnmapped = [...dbPerms].filter(
    (k) => !k.startsWith("platform.") && !PERMISSION_MODULE_V2[k],
  );
  console.log(`  INFO permissions école non mappées (toujours libres): ${realUnmapped.join(", ") || "aucune"}`);

  // ---------- 2. V1 vs V2 sur les plans ACTUELS : pertes attendues = finance uniquement ----------
  // ---------- 2. Invariant : après activation coordonnée, aucune perte d'accès ----------
  // (V1 + plans actuels) ⊆ (V2 + plans cibles). Les permissions mortes —
  // définies en base mais jamais vérifiées par le code — sont exclues.
  const DEAD_PERMS = new Set([
    "grade.read", "grade.manage", "reports.attendance",
    "finance.manage", "notifications.read", "messages.read", "preferences.read",
  ]);
  console.log("\n== 2. Invariant V1+plans actuels ⊆ V2+plans cibles ==");
  for (const plan of plans) {
    const pm = new Set(plan.modules.map((m) => m.module.code));
    const target = TARGET_PLANS[plan.code];
    if (!target) {
      check(`${plan.code} : plan cible défini`, false, "non prévu dans TARGET_PLANS");
      continue;
    }
    for (const [roleName, perms] of rolePerms) {
      const losses = perms.filter(
        (p) =>
          !DEAD_PERMS.has(p) &&
          covered(PERMISSION_MODULE, p, { planModules: pm, active: true }) &&
          !covered(PERMISSION_MODULE_V2, p, { planModules: target, active: true }),
      );
      check(
        `${plan.code} × ${roleName} : aucune perte après activation coordonnée`,
        losses.length === 0,
        `pertes: ${losses.join(",")}`,
      );
    }
  }
  // Rapport informatif : pertes si le flag était activé AVANT la mise à jour PlanModule.
  console.log("\n== 2b. Risque si flag activé sans mise à jour PlanModule (info) ==");
  for (const plan of plans) {
    const pm = new Set(plan.modules.map((m) => m.module.code));
    const allPerms = [...new Set([...rolePerms.values()].flat())];
    const losses = allPerms.filter(
      (p) =>
        covered(PERMISSION_MODULE, p, { planModules: pm, active: true }) &&
        !covered(PERMISSION_MODULE_V2, p, { planModules: pm, active: true }),
    );
    console.log(`  ${plan.code} : ${losses.length ? losses.join(", ") : "aucune perte"}`);
  }

  // ---------- 3. Matrice cible × profils ----------
  console.log("\n== 3. Simulation matrice cible A1 ==");
  const exp: Array<[string, string, string, boolean]> = [
    // [rôle, plan, permission, attendu]
    ["ADMIN_SCHOOL", "ESSENTIEL", "student.manage", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "schedules.manage", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "attendance.manage", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "grades.enter", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "reportcards.publish", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "finance.payments.create", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "finance.receipts.print", true],
    ["ADMIN_SCHOOL", "ESSENTIEL", "finance.cash.close", false],
    ["ADMIN_SCHOOL", "ESSENTIEL", "announcements.manage", false],
    ["ADMIN_SCHOOL", "ESSENTIEL", "portal.manage", true],
    ["ADMIN_SCHOOL", "PROFESSIONNEL", "finance.cash.close", true],
    ["ADMIN_SCHOOL", "PROFESSIONNEL", "announcements.manage", true],
    ["ADMIN_SCHOOL", "PROFESSIONNEL", "messages.manage", true],
    ["TEACHER", "ESSENTIEL", "attendance.manage", true],
    ["TEACHER", "ESSENTIEL", "assessments.create", true],
    ["TEACHER", "ESSENTIEL", "grades.enter", true],
    ["TEACHER", "ESSENTIEL", "coursecontent.manage", true],
    ["TEACHER", "ESSENTIEL", "schedules.print", true],
    ["CASHIER", "ESSENTIEL", "finance.payments.create", true],
    ["CASHIER", "ESSENTIEL", "finance.receipts.print", true],
    ["CASHIER", "ESSENTIEL", "finance.payments.validate", false],
    ["CASHIER", "PROFESSIONNEL", "finance.payments.create", true],
    ["FINANCE_MANAGER", "PROFESSIONNEL", "finance.discounts.manage", true],
    ["FINANCE_MANAGER", "PROFESSIONNEL", "finance.cash.close", true],
    ["FINANCE_MANAGER", "ESSENTIEL", "finance.configure", false],
    ["PARENT", "ESSENTIEL", "portal.parent", false],
    ["PARENT", "PROFESSIONNEL", "portal.parent", true],
    ["STUDENT", "ESSENTIEL", "portal.student", false],
    ["STUDENT", "PROFESSIONNEL", "portal.student", true],
    ["PARENT", "PROFESSIONNEL", "announcements.read", true],
  ];
  for (const [role, plan, perm, expected] of exp) {
    const perms = rolePerms.get(role);
    if (!perms) {
      check(`${role}×${plan} ${perm}`, false, "rôle absent de la base");
      continue;
    }
    if (!perms.includes(perm)) {
      check(`${role}×${plan} ${perm}`, expected === false, "permission absente du rôle");
      continue;
    }
    const got = covered(PERMISSION_MODULE_V2, perm, {
      planModules: TARGET_PLANS[plan],
      active: true,
    });
    check(`${role}×${plan} ${perm} = ${expected}`, got === expected, `obtenu ${got}`);
  }

  // ---------- 4. Suspension / overrides / sans abonnement ----------
  console.log("\n== 4. États d'abonnement ==");
  const premium = TARGET_PLANS.PREMIUM;
  check("suspendu : écriture bloquée",
    !covered(PERMISSION_MODULE_V2, "finance.payments.create", { planModules: premium, active: false }));
  check("suspendu : lecture autorisée",
    covered(PERMISSION_MODULE_V2, "student.read", { planModules: premium, active: false }));
  check("suspendu : portail parent conservé",
    covered(PERMISSION_MODULE_V2, "portal.parent", { planModules: premium, active: false }));
  check("sans abonnement : fail-open conservé (V2 aussi)",
    covered(PERMISSION_MODULE_V2, "finance.cash.close", { planModules: null, active: true }));
  check("override désactivé : STUDENTS retiré bloque student.manage",
    !covered(PERMISSION_MODULE_V2, "student.manage", {
      planModules: premium, active: true, overrides: new Map([["STUDENTS", false]]),
    }));
  check("override activé : FINANCE_MGMT ajouté à Essentiel ouvre cash.close",
    covered(PERMISSION_MODULE_V2, "finance.cash.close", {
      planModules: TARGET_PLANS.ESSENTIEL, active: true, overrides: new Map([["FINANCE_MGMT", true]]),
    }));
  check("override désactivé sur module absent du plan : reste bloqué",
    !covered(PERMISSION_MODULE_V2, "announcements.manage", {
      planModules: TARGET_PLANS.ESSENTIEL, active: true, overrides: new Map([["COMMUNICATION", false]]),
    }));

  console.log(`\n=== Résultat : ${pass} PASS / ${fail} FAIL ===`);
  process.exitCode = fail ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
