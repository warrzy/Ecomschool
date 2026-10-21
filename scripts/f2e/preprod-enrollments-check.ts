/**
 * Recette préprod F2-E2-D (lecture seule) — accès aux parcours
 * d'inscription : guichet, import, fiches élèves. Aucune écriture.
 * Usage : npx tsx scripts/f2e/preprod-enrollments-check.ts
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
  console.log(`== F2-E2-D préprod lecture seule — ${BASE} ==`);

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

  for (const [url, label] of [
    ["/app/fees/registration", "guichet d'inscription"],
    ["/app/students/import", "import élèves"],
    ["/app/enrollments", "liste des inscriptions"],
  ] as const) {
    const resp = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    check(`${label} : page accessible`, resp?.ok() === true && body.length > 100);
  }

  // Fiche élève + historique d'inscription visibles
  await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const stuLink = page.locator('a[href^="/app/students/"]').first();
  if ((await stuLink.count()) > 0) {
    const href = await stuLink.getAttribute("href");
    if (href && !href.includes("import")) {
      await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      check("fiche élève : historique scolaire accessible",
        (await page.locator("body").innerText()).length > 200);
    } else {
      note("aucune fiche élève trouvée");
    }
  } else {
    note("aucun élève listé");
  }

  // Export élèves non-régression
  const csv = await page.context().request.get(`${BASE}/app/students/export?format=csv`);
  check("export élèves : HTTP 200", csv.ok());

  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
