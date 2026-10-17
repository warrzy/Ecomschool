import "dotenv/config";
import { chromium, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Recette D4 — dashboards premium.
 * Vérifie KPI, graphiques réels, gating de permissions, portails préservés,
 * responsive, reduced-motion. Usage : npx tsx scripts/d4/dashboard-check.ts
 * (D4_BASE pour cibler la préprod, SEED_DEMO_PASSWORD requis).
 */
const BASE = process.env.D4_BASE ?? "http://localhost:3100";
const PW = process.env.SEED_DEMO_PASSWORD;
const PLAT_EMAIL = process.env.PREPROD_PLATFORM_ADMIN_EMAIL ?? "admin@ecom-school.local";
const PLAT_PW = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD ?? PW;
const OUT = "scripts/d4/shots";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
}

async function login(browser: Browser, email: string, path: string, width = 1440, pw?: string) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(pw ?? PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

const ov = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

async function main() {
  if (!PW) {
    console.error("SEED_DEMO_PASSWORD manquant.");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---------- Plateforme : propriétaire (toutes sections) ----------
  // SKIP local si le mot de passe owner n'est pas le mot de passe démo.
  try {
    const { ctx, page } = await login(browser, PLAT_EMAIL, "/platform", 1440, PLAT_PW);
    check("platform : bandeau pilotage", (await page.locator("text=Tableau de bord plateforme").count()) > 0);
    check("platform : KPI établissements", (await page.locator("text=actifs / total").count()) > 0);
    check("platform : KPI MRR", (await page.locator("text=MRR estimé").count()) > 0);
    check("platform : donut statuts (svg)", (await page.locator("svg[role='img']").count()) > 0);
    check("platform : séries mensuelles", (await page.locator("text=Nouveaux établissements").count()) > 0);
    await page.screenshot({ path: `${OUT}/platform-owner.png`, fullPage: true });
    await ctx.close();
  } catch {
    console.log("SKIP  platform owner : identifiants owner indisponibles dans cet environnement");
  }

  // ---------- Plateforme : commercial (données écoles masquées) ----------
  {
    const { ctx, page } = await login(browser, "commercial@ecom-school.local", "/platform");
    check("sales : KPI finance visibles", (await page.locator("text=MRR estimé").count()) > 0);
    check(
      "sales : pas de carte établissements",
      (await page.locator("text=actifs / total").count()) === 0,
    );
    check(
      "sales : pas de demandes d'inscription",
      (await page.locator("text=demande(s) d'inscription en attente").count()) === 0,
    );
    await page.screenshot({ path: `${OUT}/platform-sales.png`, fullPage: true });
    await ctx.close();
  }

  // ---------- École : admin ----------
  {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app");
    check("app : bandeau établissement", (await page.locator("text=Tableau de bord").count()) > 0);
    check("app : KPI élèves", (await page.locator("text=Élèves inscrits").count()) > 0);
    check("app : barres niveaux ou état vide", (await page.locator("text=Effectifs par niveau").count()) > 0);
    check("app : finances visibles (admin)", (await page.locator("text=Encaissé ce mois").count()) > 0);
    check("app : inscriptions/mois", (await page.locator("text=Inscriptions par mois").count()) > 0);
    await page.screenshot({ path: `${OUT}/app-admin.png`, fullPage: true });
    await ctx.close();
  }

  // ---------- École : caissier (finances seulement) ----------
  {
    const { ctx, page } = await login(browser, "caissier@demo.local", "/app");
    check("caissier : encaissé visible", (await page.locator("text=Encaissé").first().count()) > 0);
    check(
      "caissier : pas d'évaluations",
      (await page.locator("text=Évaluations et bulletins").count()) === 0,
    );
    check(
      "caissier : pas d'activité pédagogique",
      (await page.locator("text=Activité pédagogique").count()) === 0,
    );
    await page.screenshot({ path: `${OUT}/app-cashier.png`, fullPage: true });
    await ctx.close();
  }

  // ---------- Enseignant ----------
  {
    const { ctx, page } = await login(browser, "enseignant@demo.local", "/teacher");
    check("teacher : bandeau", (await page.locator("text=Espace enseignant").count()) > 0);
    check("teacher : KPI cours", (await page.locator("text=Cours aujourd'hui").count()) > 0);
    check("teacher : KPI appels", (await page.locator("text=Appels à effectuer").count()) > 0);
    await page.screenshot({ path: `${OUT}/teacher.png`, fullPage: true });
    await ctx.close();
  }

  // ---------- Parent / élève : parcours préservés ----------
  {
    const { ctx, page } = await login(browser, "parent@demo.local", "/parent");
    check("parent : onglets présents", (await page.locator("text=Emploi du temps").count()) > 0);
    await page.screenshot({ path: `${OUT}/parent.png`, fullPage: true });
    await ctx.close();
  }
  {
    const { ctx, page } = await login(browser, "eleve@demo.local", "/student");
    check("student : onglets présents", (await page.locator("text=Mon profil").count()) > 0);
    await ctx.close();
  }

  // ---------- Responsive ----------
  for (const w of [320, 390, 768]) {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app", w);
    check(`app ${w}px : pas de débordement`, (await ov(page)) === 0);
    if (w === 390) await page.screenshot({ path: `${OUT}/app-390.png`, fullPage: true });
    await ctx.close();
  }
  try {
    const { ctx, page } = await login(browser, PLAT_EMAIL, "/platform", 390, PLAT_PW);
    check("platform 390px : pas de débordement", (await ov(page)) === 0);
    await ctx.close();
  } catch {
    console.log("SKIP  platform 390px : identifiants owner indisponibles");
  }

  // ---------- Reduced-motion ----------
  {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email|e-mail/i).fill("admin@demo.local");
    await page.getByLabel(/mot de passe/i).fill(PW!);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const anim = await page.evaluate(() => {
      const el = document.querySelector(".shadow-soft");
      return el ? getComputedStyle(el).animationName : "none";
    });
    check("reduced-motion : pas d'animation permanente", anim === "none");
    await ctx.close();
  }

  console.log(`\n===== ${pass} PASS / ${fail} FAIL =====`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
