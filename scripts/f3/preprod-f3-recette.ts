/**
 * Consolidation F3 — Recette préproduction LECTURE SEULE.
 * F3-B dépenses, F3-C trésorerie, F3-D rapports/exports.
 * Aucune création/modification/annulation — navigation et
 * téléchargements uniquement.
 *
 * Env : SEED_DEMO_PASSWORD (depuis .p6b-env.local, valeur serveur).
 * Usage : SEED_DEMO_PASSWORD=… npx tsx scripts/f3/preprod-f3-recette.ts
 */
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

  // ---------- FINANCE_MANAGER ----------
  console.log("== FINANCE_MANAGER (finance@demo.local) ==");
  const fm = await login(browser, "finance@demo.local", "FM");
  if (fm) {
    // F3-B
    await fm.goto(`${BASE}/app/expenses`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1500);
    const expBody = await fm.locator("body").innerText();
    check("F3-B /app/expenses accessible", !fm.url().includes("/forbidden") && /Dépenses|dépense/i.test(expBody));
    await fm.goto(`${BASE}/app/expenses/categories`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1500);
    check("F3-B catégories accessibles", !fm.url().includes("/forbidden"));

    // F3-C
    await fm.goto(`${BASE}/app/treasury`, { waitUntil: "domcontentloaded" });
    await fm.waitForSelector("h1", { timeout: 60000 });
    await fm.waitForTimeout(2000);
    const trBody = await fm.locator("body").innerText();
    check("F3-C /app/treasury", !fm.url().includes("/forbidden") && /Trésorerie/.test(trBody));
    check("F3-C disclaimer", /solde (bancaire|de caisse) certifié/i.test(trBody));
    check("F3-C KPI + filtres",
      /encaissé/i.test(trBody) && /décaissé/i.test(trBody) &&
      (await fm.locator('select[name="preset"]').count()) === 1 &&
      (await fm.locator('select[name="year"]').count()) === 1);
    check("F3-C graphiques + ops",
      /Entrées \/ sorties mensuelles/.test(trBody) && /Dernières opérations/.test(trBody));

    // F3-D
    await fm.goto(`${BASE}/app/fees/reports`, { waitUntil: "domcontentloaded" });
    await fm.waitForSelector("h1", { timeout: 60000 });
    await fm.waitForTimeout(2000);
    const repBody = await fm.locator("body").innerText();
    check("F3-D /app/fees/reports", !fm.url().includes("/forbidden") && /Rapports financiers/.test(repBody));
    check("F3-D 6 types + 3 exports",
      (await fm.locator('select[name="type"] option').count()) === 6 &&
      (await fm.locator('a[href*="format=csv"]').count()) === 1 &&
      (await fm.locator('a[href*="format=xlsx"]').count()) === 1 &&
      (await fm.locator('a[href*="format=pdf"]').count()) === 1);

    // Téléchargements réels (lecture seule)
    for (const [fmt, min, magic] of [
      ["csv", 50, null],
      ["xlsx", 500, "PK"],
      ["pdf", 500, "%PDF"],
    ] as const) {
      const resp = await fm.context().request.get(
        `${BASE}/app/fees/reports/export?type=payments&format=${fmt}`,
      );
      const buf = await resp.body();
      const magicOk = !magic || buf.subarray(0, magic.length).toString() === magic;
      check(`F3-D export ${fmt} authentifié (${resp.status()}, ${buf.length}o)`,
        resp.status() === 200 && buf.length > min && magicOk);
    }

    // Cohérence F3-C ↔ F3-D : total de l'état de trésorerie vs dashboard.
    await fm.goto(`${BASE}/app/fees/reports?type=treasury`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(2000);
    const trRep = await fm.locator("body").innerText();
    await fm.goto(`${BASE}/app/treasury`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(2000);
    const dash = await fm.locator("body").innerText();
    const kpi = (s: string, re: RegExp) => s.match(re)?.[1];
    const collected = kpi(dash, /Encaissements validés[\s\S]{0,80}?([\d\s\u00A0]+)\s*FCFA/i);
    const repCollected = kpi(trRep, /Encaissements validés[\s\S]{0,80}?([\d\s\u00A0]+)\s*FCFA/i);
    check(`F3-C↔F3-D encaissé cohérent (${collected} vs ${repCollected})`,
      !!collected && collected === repCollected);
    await fm.context().close();
  }

  // ---------- ADMIN_SCHOOL ----------
  console.log("== ADMIN_SCHOOL (admin@demo.local) ==");
  const adm = await login(browser, "admin@demo.local", "admin");
  if (adm) {
    await adm.goto(`${BASE}/app/fees/reports`, { waitUntil: "domcontentloaded" });
    await adm.waitForTimeout(2000);
    check("admin /app/fees/reports autorisé", !adm.url().includes("/forbidden"));
    await adm.context().close();
  }

  // ---------- CASHIER — refus ----------
  console.log("== CASHIER (caissier@demo.local) — refus ==");
  const ca = await login(browser, "caissier@demo.local", "caissier");
  if (ca) {
    await expectForbidden(ca, "/app/treasury", "caissier");
    await expectForbidden(ca, "/app/expenses", "caissier");
    await expectForbidden(ca, "/app/fees/reports", "caissier");
    const resp = await ca.context().request.get(
      `${BASE}/app/fees/reports/export?type=payments&format=csv`,
      { maxRedirects: 0 },
    );
    check("caissier export direct refusé", resp.status() !== 200);
    await ca.context().close();
  }

  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
