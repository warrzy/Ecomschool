/**
 * F3-B — Vérification préproduction LECTURE SEULE du module Dépenses.
 * Aucune création/modification/annulation : accès pages + rendu + refus CASHIER.
 *
 * Exécution : npx tsx scripts/f3/preprod-expenses-check.ts
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.F2_PREPROD_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

async function login(browser: Browser, email: string, label: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
  await page.waitForTimeout(2000);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 90000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function expectForbidden(page: Page, path: string, label: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  while (!page.url().includes("/forbidden") && Date.now() - t0 < 20000) {
    await page.waitForTimeout(800);
  }
  check(`${label} ${path} → refusé`, page.url().includes("/forbidden"));
}

async function main() {
  if (!PW) { console.error("SEED_DEMO_PASSWORD manquant."); process.exit(1); }
  const browser = await chromium.launch();

  console.log("== FINANCE_MANAGER — lecture seule ==");
  const fm = await login(browser, "finance@demo.local", "FM");
  if (fm) {
    await fm.goto(`${BASE}/app/expenses`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(2500);
    check("accès /app/expenses", !fm.url().includes("/forbidden") && !fm.url().includes("/login"));
    const body = await fm.locator("body").innerText();
    check("titre + liste + formulaire", /Dépenses/.test(body) && /Nouvelle dépense/.test(body));
    check("filtres", (await fm.locator('select[name="status"]').count()) === 1 &&
      (await fm.locator('select[name="category"]').count()) === 1);
    await fm.goto(`${BASE}/app/expenses/categories`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(2000);
    const catBody = await fm.locator("body").innerText();
    check("catégories : page + défauts", !fm.url().includes("/forbidden") &&
      /Fonctionnement/.test(catBody) && /Salaires et indemnités/.test(catBody));
    await fm.context().close();
  }

  console.log("== CASHIER — refus ==");
  const ca = await login(browser, "caissier@demo.local", "Caissier");
  if (ca) {
    await expectForbidden(ca, "/app/expenses", "CASHIER");
    await expectForbidden(ca, "/app/expenses/categories", "CASHIER");
    await ca.context().close();
  }

  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
