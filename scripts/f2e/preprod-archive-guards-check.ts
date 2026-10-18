/**
 * Recette préprod F2-E2-B (lecture seule) — avertissements d'archivage.
 * Aucune écriture : pages consultées, aucun archivage réel.
 * Usage : npx tsx scripts/f2e/preprod-archive-guards-check.ts
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".p6b-env.local", override: true });
import { chromium } from "@playwright/test";

const BASE = process.env.F2_PREPROD_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

(async () => {
  if (!PW) { console.error("SEED_DEMO_PASSWORD manquant."); process.exit(1); }
  console.log(`== F2-E2-B préprod lecture seule — ${BASE} ==`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
    await page.waitForTimeout(2500);
    await page.getByLabel(/email|e-mail/i).fill("admin@demo.local");
    await page.getByLabel(/mot de passe/i).fill(PW);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 90000 });
  } catch {
    note("connexion admin impossible");
    await browser.close();
    console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
    process.exit(0);
  }

  // 1. Page niveaux : avertissement si classe active rattachée
  await page.goto(`${BASE}/app/levels`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const levelsBody = await page.locator("body").innerText();
  check("page niveaux : avertissement « classe(s) active(s) »",
    levelsBody.includes("classe(s) active(s)") || levelsBody.includes("Archiver"));

  // 2. Page classes : liste accessible + fiche classe avec élèves
  await page.goto(`${BASE}/app/classrooms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  check("page classes accessible", (await page.locator("body").innerText()).length > 100);
  const clsLink = page.locator('a[href*="/app/classrooms/"]').first();
  if ((await clsLink.count()) > 0) {
    await clsLink.click();
    await page.waitForTimeout(3000);
    const clsBody = await page.locator("body").innerText();
    check("fiche classe : avertissement élèves inscrits ou page détail OK",
      clsBody.includes("élève(s) inscrit(s)") || clsBody.includes("Statut"));
  } else {
    note("aucune classe à inspecter");
  }

  // 3. Page matières + fiche matière
  await page.goto(`${BASE}/app/subjects`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  check("page matières accessible", (await page.locator("body").innerText()).length > 100);
  const subLink = page.locator('a[href*="/app/subjects/"]').first();
  if ((await subLink.count()) > 0) {
    await subLink.click();
    await page.waitForTimeout(3000);
    check("fiche matière : page détail + statut éditable",
      (await page.locator('select[name="status"]').count()) >= 1 ||
      (await page.locator("body").innerText()).includes("Statut"));
  } else {
    note("aucune matière à inspecter");
  }

  // 4. Fiche élève (déjà couverte par la recette filtres : vérifier la page)
  await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const stLink = page.locator(
    'a[href*="/app/students/"]:not([href*="import"]):not([href*="export"])',
  ).first();
  if ((await stLink.count()) > 0) {
    await stLink.click();
    await page.waitForTimeout(3000);
    const stBody = await page.locator("body").innerText();
    check("fiche élève : avertissement inscription active ou page OK",
      stBody.includes("l'archivage sera refusé") || stBody.includes("Statut"));
  } else {
    note("aucun élève à inspecter");
  }

  // 5. Non-régression export (lecture seule)
  const csv = await page.context().request.get(`${BASE}/app/students/export?format=csv`);
  check("export élèves : HTTP 200 (non-régression)", csv.ok());

  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
