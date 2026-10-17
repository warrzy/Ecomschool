import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";

/**
 * Lot A3 — Recette authentifiée de la matrice d'abonnements V2.
 *
 * Vérifie les accès autorisés ET interdits par profil × scénario de plan.
 * Lecture seule : aucune soumission de formulaire, aucun paiement, aucune
 * suppression, aucun envoi.
 *
 * Prérequis : SUBSCRIPTION_MATRIX_V2=1 actif + PlanModule migré +
 * scenario-overrides.ts --set <scénario> appliqué sur l'école de démo.
 *
 * Usage :
 *   A3_BASE=https://preprod.ecomschool.fr npx tsx scripts/a3/subscription-recette.ts --scenario essentiel
 *   (scénarios : essentiel | pro | premium | platform | all — défaut all)
 *
 * Comptes : SEED_DEMO_PASSWORD pour les comptes démo, env A3_*_EMAIL /
 * PREPROD_PLATFORM_ADMIN_* pour les autres. Comptes absents → SKIP explicite.
 */

const BASE = process.env.A3_BASE ?? "http://localhost:3100";
const PW = process.env.SEED_DEMO_PASSWORD;
const scenario = process.argv.includes("--scenario")
  ? process.argv[process.argv.indexOf("--scenario") + 1]
  : "all";

let pass = 0;
let fail = 0;
let skip = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}
function note(name: string) {
  skip++;
  console.log(`  SKIP ${name}`);
}

async function tryLogin(
  browser: Browser,
  email: string,
  pw: string | undefined,
  label: string,
): Promise<Page | null> {
  if (!pw) {
    note(`${label} : identifiants absents`);
    return null;
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(pw);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  } catch {
    note(`${label} : connexion impossible (${email})`);
    await ctx.close();
    return null;
  }
  return page;
}

async function expectAccess(page: Page, path: string, allowed: boolean, label: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const forbidden = page.url().includes("/forbidden");
  check(`${label} ${path} → ${allowed ? "autorisé" : "refusé"}`, forbidden === !allowed);
}

const ACCOUNTS = {
  admin: process.env.A3_ADMIN_EMAIL ?? "admin@demo.local",
  teacher: process.env.A3_TEACHER_EMAIL ?? "enseignant@demo.local",
  cashier: process.env.A3_CASHIER_EMAIL ?? "caissier@demo.local",
  finance: process.env.A3_FINANCE_EMAIL ?? "",
  parent: process.env.A3_PARENT_EMAIL ?? "parent@demo.local",
  student: process.env.A3_STUDENT_EMAIL ?? "eleve@demo.local",
  owner: process.env.PREPROD_PLATFORM_ADMIN_EMAIL ?? "",
  sales: process.env.A3_SALES_EMAIL ?? "commercial@ecom-school.local",
};

// [chemin, autorisé] par rôle et par scénario
const ESSENTIEL: Record<string, Array<[string, boolean]>> = {
  admin: [
    ["/app/students", true], ["/app/classrooms", true], ["/app/teachers", true],
    ["/app/users", true], ["/app/schedules", true], ["/app/attendance", true],
    ["/app/grades", true], ["/app/report-cards", true],
    ["/app/fees/payments", true], ["/app/fees/unpaid", true], ["/app/fees/receipts", true],
    ["/app/fees/settings", false], ["/app/announcements", false], ["/app/messages", false],
  ],
  teacher: [
    ["/teacher", true], ["/app/attendance", true], ["/app/schedules", true],
    ["/app/grades", true], ["/app/fees", false], ["/app/users", false],
  ],
  cashier: [
    ["/app/fees/payments", true], ["/app/fees", true],
    ["/app/fees/settings", false], ["/app/students", false], ["/app/announcements", false],
  ],
  finance: [["/app/fees/settings", false], ["/app/fees/payments", true]],
  parent: [["/parent", false]],
  student: [["/student", false]],
};

const PRO: Record<string, Array<[string, boolean]>> = {
  admin: [
    ["/app/fees/settings", true], ["/app/announcements", true], ["/app/messages", true],
    ["/app/fees/payments", true], ["/app/schedules", true], ["/app/report-cards", true],
  ],
  teacher: [["/app/attendance", true], ["/app/fees", false]],
  cashier: [["/app/fees/payments", true], ["/app/fees/settings", false], ["/app/students", false]],
  finance: [["/app/fees/settings", true], ["/app/fees/unpaid", true], ["/app/students", false]],
  parent: [["/parent", true]],
  student: [["/student", true]],
};

const PLATFORM_CHECKS: Array<{ key: keyof typeof ACCOUNTS; path: string; allowed: boolean }> = [
  { key: "owner", path: "/platform/schools", allowed: true },
  { key: "owner", path: "/platform/signup-requests", allowed: true },
  { key: "owner", path: "/platform/plans", allowed: true },
  { key: "owner", path: "/platform/modules", allowed: true },
  { key: "sales", path: "/platform/subscriptions", allowed: true },
  { key: "sales", path: "/platform/invoices", allowed: true },
  { key: "sales", path: "/platform/schools", allowed: false },
  { key: "sales", path: "/platform/signup-requests", allowed: false },
];

async function runScenario(browser: Browser, name: string, table: Record<string, Array<[string, boolean]>>) {
  console.log(`\n== Scénario ${name.toUpperCase()} ==`);
  for (const [role, pages] of Object.entries(table)) {
    const email = ACCOUNTS[role as keyof typeof ACCOUNTS];
    if (!email) {
      note(`${name} × ${role} : pas de compte configuré`);
      continue;
    }
    const page = await tryLogin(browser, email, PW, `${name} × ${role}`);
    if (!page) continue;
    for (const [path, allowed] of pages) await expectAccess(page, path, allowed, `${role}`);
    await page.context().close();
  }
}

async function main() {
  if (!PW) {
    console.error("SEED_DEMO_PASSWORD manquant.");
    process.exit(1);
  }
  const browser = await chromium.launch();
  console.log(`Base : ${BASE} — scénario : ${scenario}`);

  if (scenario === "all" || scenario === "essentiel") await runScenario(browser, "essentiel", ESSENTIEL);
  if (scenario === "all" || scenario === "pro") await runScenario(browser, "pro", PRO);
  if (scenario === "all" || scenario === "premium") await runScenario(browser, "premium", PRO); // premium = tout autorisé (mêmes attentes que pro aujourd'hui)

  if (scenario === "all" || scenario === "platform") {
    console.log("\n== Plateforme ==");
    const ownerPw = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD;
    for (const { key, path, allowed } of PLATFORM_CHECKS) {
      const page = await tryLogin(
        browser,
        ACCOUNTS[key],
        key === "owner" ? ownerPw ?? PW : PW,
        `platform × ${key}`,
      );
      if (!page) continue;
      await expectAccess(page, path, allowed, key);
      await page.context().close();
    }
  }

  await browser.close();
  console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exitCode = fail ? 1 : 0;
}

main();
