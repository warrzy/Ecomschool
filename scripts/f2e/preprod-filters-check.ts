/**
 * Recette préprod F2-E (lecture seule) — filtres élèves + export de la sélection.
 * Aucune écriture : seules des pages et des exports GET sont consommés.
 * Comptes démo préprod : SEED_DEMO_PASSWORD (fourni via .p6b-env.local).
 *
 * Usage : npx tsx scripts/f2e/preprod-filters-check.ts
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".p6b-env.local", override: true });
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.F2_PREPROD_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

async function login(email: string, label: string): Promise<Page | null> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
    await page.waitForTimeout(2500);
    await page.getByLabel(/email|e-mail/i).fill(email);
    await page.getByLabel(/mot de passe/i).fill(PW!);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 90000 });
    return page;
  } catch {
    note(`${label} : connexion impossible`);
    await browser.close();
    return null;
  }
}

(async () => {
  if (!PW) { console.error("SEED_DEMO_PASSWORD manquant."); process.exit(1); }
  console.log(`== F2-E préprod lecture seule — ${BASE} ==`);

  const page = await login("admin@demo.local", "admin");
  if (!page) { console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`); process.exit(1); }
  try {
    // 1. Page et nouveaux contrôles
    await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    check("page élèves : selects année+classe (filtre + export)",
      (await page.locator('select[name="year"]').count()) >= 2 &&
      (await page.locator('select[name="classroom"]').count()) >= 2);
    check("statut « Tous » + case Historique + Réinitialiser + Exporter la liste",
      (await page.locator('select[name="status"] option[value="ALL"]').count()) >= 1 &&
      (await page.locator('input[name="hist"]').count()) >= 1 &&
      (await page.getByRole("link", { name: /réinitialiser/i }).count()) >= 1 &&
      (await page.getByRole("button", { name: /exporter la liste/i }).count()) >= 1);

    // 2. Filtre année + classe via URL (lecture seule)
    const yearOpt = await page.locator('form:has(input[name="q"]) select[name="year"] option:not([value=""])').first().getAttribute("value");
    const clsOpt = await page.locator('form:has(input[name="q"]) select[name="classroom"] option:not([value=""])').first().getAttribute("value");
    if (!yearOpt || !clsOpt) {
      note("pas de couple année/classe exploitable en préprod");
    } else {
      const qs = `year=${yearOpt}&classroom=${clsOpt}&status=ACTIVE`;
      await page.goto(`${BASE}/app/students?${qs}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const body = await page.locator("body").innerText();
      const m = body.match(/(\d+) élève/);
      const total = m ? Number(m[1]) : -1;
      check(`filtre année+classe actifs : ${total} élève(s), URL conservée`,
        total >= 0 && page.url().includes("classroom="));

      // 3. Export CSV de la même sélection — comptage identique
      const csv = await page.context().request.get(`${BASE}/app/students/export?format=csv&${qs}`);
      check("export CSV sélection : HTTP 200", csv.ok());
      const csvLines = (await csv.text()).trim().split("\n").length;
      check(`effectif affiché (${total}) = lignes exportées (${csvLines - 1})`,
        total >= 0 && csvLines - 1 === total);

      // 4. Export historique : superset de l'effectif actuel
      const csvH = await page.context().request.get(`${BASE}/app/students/export?format=csv&${qs}&hist=1`);
      const histLines = csvH.ok() ? (await csvH.text()).trim().split("\n").length - 1 : -1;
      check(`export historique (${histLines}) ≥ effectif actuel (${total})`, histLines >= total);

      // 5. Export XLSX
      const xlsx = await page.context().request.get(`${BASE}/app/students/export?format=xlsx&${qs}`);
      check("export XLSX sélection : HTTP 200 + zip",
        xlsx.ok() && (await xlsx.body()).subarray(0, 2).toString() === "PK");

      // 6. Recherche interne à la sélection
      await page.goto(`${BASE}/app/students?${qs}&q=zzz-inexistant`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      check("recherche sans résultat : message dédié",
        (await page.locator("body").innerText()).includes("Aucun élève ne correspond"));
    }

    // 7. Responsive mobile : la ligne de filtres reste utilisable
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    check("mobile 390px : filtres visibles et actionnables",
      await page.locator('form:has(input[name="q"]) select[name="year"]').isVisible() &&
      await page.getByRole("button", { name: /^filtrer$/i }).first().isVisible());
  } catch (e) {
    fail++; console.log(`  FAIL exception : ${(e as Error).message.slice(0, 160)}`);
  } finally {
    await page.context().browser()?.close();
  }

  // 8. Isolation : compte d'une seconde école s'il est joignable
  const other = await login("admin@lycee-horizon-recette.test", "école 2");
  if (other) {
    const res = await other.context().request.get(`${BASE}/app/students/export?format=csv&q=demo`);
    const txt = res.ok() ? await res.text() : "";
    check("isolation : export école 2 sans élève de l'école démo", res.ok() && !/demo/i.test(txt));
    await other.context().browser()?.close();
  }

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
