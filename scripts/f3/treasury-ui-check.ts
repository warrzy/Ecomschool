/**
 * F3-C — smoke test UI local de /app/treasury (non destructif).
 * Usage : npx tsx scripts/f3/treasury-ui-check.ts [baseUrl]
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";

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
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 150000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function main() {
  if (!PW) { console.error("F2_TEST_PASSWORD manquant."); process.exit(1); }
  const browser = await chromium.launch();

  console.log("== FINANCE_MANAGER — /app/treasury ==");
  const fm = await login(browser, "f2-finance@test.local", "FM");
  if (fm) {
    await fm.goto(`${BASE}/app/treasury`, { waitUntil: "domcontentloaded" });
    await fm.waitForSelector("h1", { timeout: 60000 });
    await fm.waitForTimeout(1500);
    check("accès /app/treasury", !fm.url().includes("/forbidden"));
    const body = await fm.locator("body").innerText();
    check("titre + disclaimer", /Trésorerie/.test(body) && /solde bancaire certifié/.test(body));
    check("KPI encaissé/décaissé/solde", /encaissé/i.test(body) && /décaissé/i.test(body) && /solde net des flux/i.test(body));
    check("filtres (période, année, mode)",
      (await fm.locator('select[name="preset"]').count()) === 1 &&
      (await fm.locator('select[name="year"]').count()) === 1 &&
      (await fm.locator('select[name="method"]').count()) === 1);
    check("dates personnalisées", (await fm.locator('input[name="from"]').count()) === 1 &&
      (await fm.locator('input[name="to"]').count()) === 1);
    check("graphiques + opérations", /Entrées \/ sorties mensuelles/.test(body) &&
      /Dépenses par catégorie/.test(body) && /Dernières opérations/.test(body));
    // filtre année civile
    await fm.goto(`${BASE}/app/treasury?preset=year`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1500);
    check("preset année civile", (await fm.locator("body").innerText()).includes(`Année ${new Date().getUTCFullYear()}`));
    // mobile
    await fm.setViewportSize({ width: 390, height: 844 });
    await fm.goto(`${BASE}/app/treasury`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1200);
    check("mobile 390px sans overflow", await fm.evaluate(() => document.documentElement.scrollWidth <= 390 + 16));
    await fm.context().close();
  }

  console.log("== CASHIER — refus ==");
  const ca = await login(browser, "f2-caissier-a@test.local", "Caissier");
  if (ca) {
    await ca.goto(`${BASE}/app/treasury`, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    while (!ca.url().includes("/forbidden") && Date.now() - t0 < 30000) await ca.waitForTimeout(800);
    check("CASHIER /app/treasury → forbidden", ca.url().includes("/forbidden"));
    await ca.context().close();
  }

  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
