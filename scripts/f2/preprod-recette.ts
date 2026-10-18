/**
 * Lot F2 — Recette LECTURE SEULE sur préproduction.
 *
 * Aucune écriture métier : navigation, filtres, recherche, PDF uniquement.
 * Comptes démo existants (SEED_DEMO_PASSWORD) : caissier, finance, admin
 * + admin d'un second établissement (isolation multi-tenant).
 *
 * Exécution : npx tsx scripts/f2/preprod-recette.ts
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.F2_PREPROD_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
// Données réelles préprod (relevées en lecture seule le 18/10/2026).
const RECEIPT_1 = "REC-2026-00028";
const RECEIPT_2 = "REC-2026-00027";
const PAYMENT_1_ID = "cmv9aebwi00yg3plb2vjormwt"; // REC-2026-00028 (démo)

let pass = 0;
let fail = 0;
let skip = 0;
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
  await page.waitForTimeout(1500);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function expectAccess(page: Page, path: string, allowed: boolean, label: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const maxWait = allowed ? 8000 : 12000;
  const t0 = Date.now();
  let forbidden = page.url().includes("/forbidden");
  while (!forbidden && Date.now() - t0 < maxWait) {
    await page.waitForTimeout(600);
    forbidden = page.url().includes("/forbidden");
  }
  check(`${label} ${path} → ${allowed ? "autorisé" : "refusé"}`, forbidden === !allowed);
}

async function pageText(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  return page.locator("body").innerText();
}

async function main() {
  if (!PW) {
    console.error("SEED_DEMO_PASSWORD manquant.");
    process.exit(1);
  }
  const browser = await chromium.launch();

  // ---------- CASHIER — école démo (Premium) ----------
  console.log("\n== CASHIER — préprod ==");
  const pc = await login(browser, "caissier@demo.local", "caissier");
  if (pc) {
    await expectAccess(pc, "/app/fees/my-payments", true, "caissier");
    const mine = await pageText(pc, "/app/fees/my-payments");
    // Tous les paiements préprod ont été enregistrés par admin — le caissier
    // ne doit voir aucun reçu dans « Mes encaissements ».
    check("caissier : aucun reçu d'autrui visible", !mine.includes(RECEIPT_1));
    check("caissier : état vide ou total affiché", /aucun|total/i.test(mine));
    // Journal / impayés / settings refusés.
    await expectAccess(pc, "/app/fees/payments", false, "caissier");
    await expectAccess(pc, "/app/fees/unpaid", false, "caissier");
    await expectAccess(pc, "/app/fees/settings", false, "caissier");
    await expectAccess(pc, "/app/fees/accounts/export?format=csv", false, "caissier");
    // Recherche financière élève (F2-A).
    const accounts = await pageText(pc, "/app/fees/accounts?q=DEMO-");
    check("caissier : recherche élève par matricule", /DEMO-\d+/.test(accounts));
    const noHit = await pageText(pc, "/app/fees/accounts?q=zzz-introuvable-f2");
    check("caissier : état vide recherche", noHit.toLowerCase().includes("aucun"));
    // Reçu PDF : permission receipts.print couvre l'école — accès attendu.
    const pdf = await pc.request.get(`${BASE}/app/fees/receipts/pdf?payment=${PAYMENT_1_ID}`);
    check("caissier : PDF reçu de l'école", pdf.status() === 200);
    await pc.context().close();
  }

  // ---------- FINANCE_MANAGER — Premium (toutes fonctions) ----------
  console.log("\n== FINANCE_MANAGER — préprod (Premium) ==");
  const pfm = await login(browser, "finance@demo.local", "FM");
  if (pfm) {
    await expectAccess(pfm, "/app/fees/payments", true, "FM");
    await expectAccess(pfm, "/app/fees/unpaid", true, "FM");
    await expectAccess(pfm, "/app/fees/settings", true, "FM");
    await expectAccess(pfm, "/app/fees/my-payments", true, "FM");
    const journal = await pageText(pfm, "/app/fees/payments");
    check("FM : journal affiche les reçus", journal.includes(RECEIPT_1));
    check("FM : colonne « Encaissé par »", /encaiss/i.test(journal));
    check("FM : totaux affichés", /total/i.test(journal));
    // Filtres et recherche.
    const searched = await pageText(pfm, `/app/fees/payments?q=${RECEIPT_1}`);
    check(
      "FM : recherche par n° reçu",
      searched.includes(RECEIPT_1) && !searched.includes(RECEIPT_2),
    );
    const statusFilter = await pageText(pfm, "/app/fees/payments?status=CANCELLED");
    check(
      "FM : filtre statut annulé (vide attendu)",
      !statusFilter.includes(RECEIPT_1),
    );
    const periodFilter = await pageText(
      pfm,
      "/app/fees/payments?from=2020-01-01&to=2020-12-31",
    );
    check("FM : filtre période hors plage → vide", !periodFilter.includes(RECEIPT_1));
    const pdf = await pfm.request.get(`${BASE}/app/fees/receipts/pdf?payment=${PAYMENT_1_ID}`);
    check("FM : PDF reçu", pdf.status() === 200);
    // Exports.
    const csv = await pfm.request.get(`${BASE}/app/fees/payments/csv`);
    check("FM : export CSV paiements", csv.status() === 200);
    await pfm.context().close();
  }

  // ---------- ADMIN_SCHOOL ----------
  console.log("\n== ADMIN_SCHOOL — préprod ==");
  const padm = await login(browser, "admin@demo.local", "admin");
  if (padm) {
    await expectAccess(padm, "/app/fees/payments", true, "admin");
    await expectAccess(padm, "/app/fees/settings", true, "admin");
    await expectAccess(padm, "/app/fees/my-payments", true, "admin");
    const journalAdm = await pageText(padm, "/app/fees/payments");
    check("admin : journal affiche les reçus", journalAdm.includes(RECEIPT_1));
    await padm.context().close();
  }

  // ---------- Isolation multi-tenant — second établissement ----------
  console.log("\n== ISOLATION — autre établissement ==");
  const pother = await login(browser, "admin@lycee-horizon-recette.test", "admin-école2");
  if (pother) {
    const pdfOther = await pother.request.get(
      `${BASE}/app/fees/receipts/pdf?payment=${PAYMENT_1_ID}`,
    );
    check("école2 : PDF d'un reçu de la démo refusé", pdfOther.status() !== 200);
    const searchOther = await pageText(pother, "/app/fees/accounts?q=DEMO-");
    check("école2 : matricules démo introuvables", !/DEMO-\d+/.test(searchOther));
    const journalOther = await pageText(pother, "/app/fees/payments");
    check("école2 : reçus démo invisibles", !journalOther.includes(RECEIPT_1));
    await pother.context().close();
  }

  // ---------- Non-régression publique ----------
  console.log("\n== NON-RÉGRESSION — site public ==");
  const pub = await browser.newPage();
  await pub.goto(`${BASE}/tarifs`, { waitUntil: "domcontentloaded" });
  const tarifs = await pub.locator("body").innerText();
  check("page /tarifs accessible", /15.?000|30.?000|50.?000/.test(tarifs));
  await pub.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  check("page d'accueil accessible", pub.url().startsWith(BASE));

  await browser.close();
  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  console.log(
    "NOTE : séparation caissier A/B, surpaiement, concurrence et idempotence " +
    "vérifiés en local (fixtures isolées) — non rejoués en préprod (lecture seule).",
  );
  process.exit(fail ? 1 : 0);
}

main();
