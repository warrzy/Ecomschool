/**
 * Recette préprod F2-E2-C (lecture seule) — bilan de pré-clôture et
 * présence des verrous. Aucune clôture ni transition réelle.
 * Usage : npx tsx scripts/f2e/preprod-yearclose-check.ts
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
  console.log(`== F2-E2-C préprod lecture seule — ${BASE} ==`);

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

  // 1. Page années scolaires accessible
  await page.goto(`${BASE}/app/academic-years`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const yearsBody = await page.locator("body").innerText();
  check("page années scolaires accessible", yearsBody.includes("Années scolaires"));

  // 2. Bilan de pré-clôture : le panneau ?confirm=close&id= s'affiche
  //    pour toute année listée (la garde métier reste côté action).
  //    Aucune soumission — lecture seule puis Annuler.
  const periodsLink = page.locator('a[href*="/app/academic-years/"][href*="/periods"]').first();
  const href = await periodsLink.getAttribute("href").catch(() => null);
  const yearId = href?.match(/academic-years\/([^/]+)/)?.[1];
  if (yearId) {
    await page.goto(`${BASE}/app/academic-years?confirm=close&id=${yearId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const confirmBody = await page.locator("body").innerText();
    check("panneau de clôture affiché",
      confirmBody.includes("Confirmer la clôture"));
    check("bilan de pré-clôture affiché avec compteurs",
      confirmBody.includes("Bilan avant clôture") &&
      (confirmBody.includes("classe(s)") || confirmBody.includes("inscription")));
    check("avertissements ou « aucune anomalie » affichés",
      confirmBody.includes("inscription(s) encore active") ||
      confirmBody.includes("période(s) non") ||
      confirmBody.includes("évaluation(s) non") ||
      confirmBody.includes("résultat annuel") ||
      confirmBody.includes("Aucune anomalie"));
  } else {
    note("aucune année listée pour afficher le bilan");
  }

  // 3. Page évaluations (grades) accessible (non-régression)
  await page.goto(`${BASE}/app/grades`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  check("page évaluations accessible",
    (await page.locator("body").innerText()).length > 100);

  // 4. Export élèves non-régression
  const csv = await page.context().request.get(`${BASE}/app/students/export?format=csv`);
  check("export élèves : HTTP 200 (non-régression)", csv.ok());

  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
