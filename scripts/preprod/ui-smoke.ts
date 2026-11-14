/**
 * Smoke UI — parcours réel dans le navigateur sur la préproduction.
 * Connexion démo + visite des pages clés par rôle, assertions de contenu.
 *
 * Usage : DEMO_UI_PASSWORD=... npx tsx scripts/preprod/ui-smoke.ts
 * (mot de passe : SEED_DEMO_PASSWORD du .env preprod, jamais commité)
 */
import { chromium } from "playwright";

const BASE = process.env.UI_BASE_URL ?? "https://preprod.ecomschool.fr";
const PW = process.env.DEMO_UI_PASSWORD ?? "";
if (!PW) { console.error("DEMO_UI_PASSWORD requis"); process.exit(1); }

let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  ok ? pass++ : fail++;
};

const PAGES: { path: string; expect: string[] }[] = [
  { path: "/app/students", expect: ["Ouédraogo", "Sawadogo"] },
  { path: "/app/fees", expect: [] },
  { path: "/app/fees/payments", expect: ["REC-2026"] },
  { path: "/app/enrollments", expect: [] },
  { path: "/app/comptabilite", expect: [] },
  { path: "/app/comptabilite/etats", expect: [] },
  { path: "/app/comptabilite/immobilisations", expect: [] },
  { path: "/app/rh", expect: ["Kientega"] },
  { path: "/app/rh/paie", expect: [] },
  { path: "/app/treasury", expect: [] },
  { path: "/app/expenses", expect: ["Fournitures"] },
  { path: "/app/notifications", expect: [] },
  { path: "/app/announcements", expect: ["conseil"] },
];

async function login(page: import("playwright").Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  console.log("== Connexion demo-admin ==");
  await login(page, "demo-admin@demo.ecomschool.test");
  check("connexion demo-admin (hors /login)", !page.url().includes("/login"));

  console.log("== Parcours /app (admin démo) ==");
  for (const p of PAGES) {
    try {
      const resp = await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle", timeout: 30000 });
      const status = resp?.status() ?? 0;
      let bodyOk = true;
      for (const needle of p.expect) {
        // Cherche un élément réellement visible (ignore les <option> de selects).
        const visible = await page.locator(`text=${needle}`).filter({ visible: true }).first().isVisible({ timeout: 15000 }).catch(() => false);
        bodyOk = bodyOk && visible;
      }
      check(`${p.path} → ${status}${p.expect.length ? ` + contenu [${p.expect.join(",")}]` : ""}`, status === 200 && bodyOk);
    } catch (e) {
      check(`${p.path} → navigation`, false);
    }
  }

  console.log("== Cloisonnement des rôles ==");
  // demo-rh (hr.*, pas payroll.*) : /app/rh/paie doit être refusé.
  await ctx.clearCookies();
  await login(page, "demo-rh@demo.ecomschool.test");
  const r1 = await page.goto(`${BASE}/app/rh/paie`, { waitUntil: "networkidle" });
  const forbidden1 = (await page.locator("text=/interdit|forbidden|accès refusé|403/i").first().isVisible({ timeout: 8000 }).catch(() => false));
  check("demo-rh → /app/rh/paie refusé (pas payroll.read)", r1?.status() !== 200 || forbidden1 || page.url().includes("forbidden"));
  await page.goto(`${BASE}/app/rh`, { waitUntil: "networkidle" });
  const rhOk = await page.locator("text=Kientega").first().isVisible({ timeout: 15000 }).catch(() => false);
  check("demo-rh → /app/rh voit les employés", rhOk);

  await browser.close();
  console.log(`\n=== SMOKE UI : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}

main();
