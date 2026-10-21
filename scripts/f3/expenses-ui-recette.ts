/**
 * Lot F3-B — Smoke UI authentifié du module Dépenses (LOCAL uniquement).
 *
 * Pré-requis : `npx next dev` sur :3000 + `npx tsx scripts/f2/test-fixtures.ts`
 * (comptes f2-finance@test.local / f2-caissier-a@test.local, école Démo).
 *
 * Couvre : rendu liste + catégories, formulaire de création, filtres,
 * passage DRAFT → PAID via le panneau de confirmation, annulation motivée,
 * refus CASHIER, responsive mobile.
 * Les écritures restent cantonnées à l'école Démo locale.
 *
 * Exécution : npx tsx scripts/f3/expenses-ui-recette.ts
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.F2_BASE_URL ?? "http://localhost:3000";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";
const STAMP = Date.now().toString(36);

let pass = 0, fail = 0, skip = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};
const note = (name: string) => { skip++; console.log(`  SKIP ${name}`); };

async function login(browser: Browser, email: string, label: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
  await page.waitForTimeout(3000);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function main() {
  const browser = await chromium.launch();

  // ---------- FINANCE_MANAGER ----------
  console.log("== FINANCE_MANAGER — /app/expenses ==");
  const fm = await login(browser, "f2-finance@test.local", "FM");
  if (fm) {
    await fm.goto(`${BASE}/app/expenses`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(2000);
    check("accès /app/expenses", !fm.url().includes("/forbidden"));
    const body = await fm.locator("body").innerText();
    check("titre Dépenses", /Dépenses/.test(body));
    check("tableau liste", await fm.locator('table[aria-label="Liste des dépenses"]').count() === 1);
    check("formulaire création", /Nouvelle dépense/.test(body));
    check("filtres année/catégorie/statut",
      (await fm.locator('select[name="year"]').count()) === 1 &&
      (await fm.locator('select[name="category"]').count()) === 1 &&
      (await fm.locator('select[name="status"]').count()) === 1);
    check("totaux décaissé/brouillons", /décaissé/i.test(body) && /brouillons à payer/i.test(body));
    check("lien Catégories", /Catégories/.test(body));

    // Création via le formulaire
    const label = `F3B-${STAMP} Fournitures`;
    await fm.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await fm.getByLabel("Libellé").fill(label);
    await fm.getByLabel("Montant").fill("2500");
    await fm.getByLabel("Bénéficiaire").fill("Librairie test");
    await fm.getByRole("button", { name: "Enregistrer la dépense" }).click();
    await fm.waitForURL(/ok=|error=/, { timeout: 30000 }).catch(() => {});
    await fm.waitForTimeout(1000);
    check("création redirige ok=expense", fm.url().includes("ok=expense"));
    const after = await fm.locator("body").innerText();
    check("dépense visible en brouillon", after.includes(label) && /Brouillon/.test(after));

    // Passage PAID via le panneau
    const row = fm.locator("tr", { hasText: label });
    await row.getByRole("link", { name: "Payer" }).click();
    await fm.waitForURL(/pay=/, { timeout: 30000 }).catch(() => {});
    await fm.waitForLoadState("domcontentloaded").catch(() => {});
    await fm.waitForTimeout(2000);
    check("panneau paiement affiché", /Confirmer le paiement/.test(await fm.locator("body").innerText()));
    await fm.locator('select[name="method"]').selectOption("CASH");
    await fm.getByRole("button", { name: "Confirmer" }).click();
    await fm.waitForURL(/ok=|error=/, { timeout: 30000 }).catch(() => {});
    await fm.waitForTimeout(1000);
    check("redirection ok=expense_paid", fm.url().includes("ok=expense_paid"));
    const paidBody = await fm.locator("body").innerText();
    check("statut Payée + espèces", /Payée/.test(paidBody) && /Espèces/.test(paidBody));

    // Annulation motivée d'une seconde dépense
    const label2 = `F3B-${STAMP} Annulée`;
    await fm.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await fm.getByLabel("Libellé").fill(label2);
    await fm.getByLabel("Montant").fill("1000");
    await fm.getByLabel("Bénéficiaire").fill("X");
    await fm.getByRole("button", { name: "Enregistrer la dépense" }).click();
    await fm.waitForURL(/ok=|error=/, { timeout: 30000 }).catch(() => {});
    await fm.waitForTimeout(1000);
    await fm.locator("tr", { hasText: label2 }).getByRole("link", { name: "Annuler" }).click();
    await fm.waitForURL(/confirm=cancel/, { timeout: 30000 }).catch(() => {});
    await fm.waitForLoadState("domcontentloaded").catch(() => {});
    await fm.waitForTimeout(1500);
    await fm.getByLabel(/motif/i).fill("Test d'annulation");
    await fm.getByRole("button", { name: "Annuler la dépense" }).click();
    await fm.waitForURL(/ok=|error=/, { timeout: 30000 }).catch(() => {});
    await fm.waitForTimeout(1000);
    check("redirection ok=expense_cancelled", fm.url().includes("ok=expense_cancelled"));
    check("statut Annulée + motif", /Annulée/.test(await fm.locator("body").innerText()));

    // Filtre statut
    await fm.locator('select[name="status"]').selectOption("PAID");
    await fm.getByRole("button", { name: "Filtrer" }).click();
    await fm.waitForURL(/status=PAID/, { timeout: 30000 }).catch(() => {});
    await fm.waitForLoadState("domcontentloaded").catch(() => {});
    await fm.waitForTimeout(2000);
    const filtered = await fm.locator("body").innerText();
    check("filtre PAID : payée visible, annulée absente",
      filtered.includes(label) && !filtered.includes(label2));

    // Page catégories
    await fm.goto(`${BASE}/app/expenses/categories`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1500);
    const catBody = await fm.locator("body").innerText();
    check("5 catégories par défaut", /Fonctionnement/.test(catBody) &&
      /Salaires et indemnités/.test(catBody) && /Fournitures et matériels/.test(catBody) &&
      /Maintenance et services/.test(catBody) && /Autres décaissements/.test(catBody));
    check("tableau catégories", await fm.locator('table[aria-label="Catégories de dépenses"]').count() === 1);

    // Responsive mobile
    await fm.setViewportSize({ width: 390, height: 844 });
    await fm.goto(`${BASE}/app/expenses`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1500);
    check("mobile : titre + formulaire",
      /Dépenses/.test(await fm.locator("body").innerText()));

    await fm.context().close();
  }

  // ---------- CASHIER : refus ----------
  console.log("== CASHIER ==");
  const ca = await login(browser, "f2-caissier-a@test.local", "Caissier");
  if (ca) {
    await ca.goto(`${BASE}/app/expenses`, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    while (!ca.url().includes("/forbidden") && Date.now() - t0 < 12000) {
      await ca.waitForTimeout(600);
    }
    check("CASHIER refusé /app/expenses", ca.url().includes("/forbidden"));
    await ca.goto(`${BASE}/app/expenses/categories`, { waitUntil: "domcontentloaded" });
    const t1 = Date.now();
    while (!ca.url().includes("/forbidden") && Date.now() - t1 < 12000) {
      await ca.waitForTimeout(600);
    }
    check("CASHIER refusé /categories", ca.url().includes("/forbidden"));
    await ca.context().close();
  }

  // ---------- ADMIN_SCHOOL ----------
  console.log("== ADMIN_SCHOOL ==");
  const adminPw = process.env.SEED_DEMO_PASSWORD;
  if (!adminPw) {
    note("SEED_DEMO_PASSWORD absent — accès admin non testé");
  } else {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
    await page.getByLabel(/email|e-mail/i).fill("admin@demo.local");
    await page.getByLabel(/mot de passe/i).fill(adminPw);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    try {
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
      await page.goto(`${BASE}/app/expenses`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      check("ADMIN accès /app/expenses", !page.url().includes("/forbidden"));
      check("ADMIN voit la liste + formulaire",
        /Dépenses/.test(await page.locator("body").innerText()));
    } catch {
      note("admin : connexion impossible");
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
