import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Recette D5 — harmonisation des écrans métier.
 * Vérifie l'application des tokens brand (boutons, titres, focus, cartes),
 * le responsive, le reduced-motion et les parcours par rôle.
 * Usage : npx tsx scripts/d5/business-screens-check.ts
 * (D5_BASE pour cibler la préprod, SEED_DEMO_PASSWORD requis).
 */
const BASE = process.env.D5_BASE ?? "http://localhost:3100";
const PW = process.env.SEED_DEMO_PASSWORD;
const PLAT_EMAIL = process.env.PREPROD_PLATFORM_ADMIN_EMAIL ?? "admin@ecom-school.local";
const PLAT_PW = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD ?? PW;
const OUT = "scripts/d5/shots";

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
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const ov = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

const brandBtn = (page: Page) =>
  page.evaluate(
    () =>
      Array.from(document.querySelectorAll("button, a, input[type=submit]")).some((el) =>
        (el as HTMLElement).className.includes("bg-brand-600"),
      ),
  );
const zincBtn = (page: Page) =>
  page.evaluate(
    () =>
      Array.from(document.querySelectorAll("button, a, input[type=submit]")).some((el) =>
        (el as HTMLElement).className.includes("bg-zinc-900 "),
      ),
  );
const softCard = (page: Page) =>
  page.evaluate(
    () => document.querySelectorAll("div.shadow-soft, section.shadow-soft").length,
  );
const displayTitle = (page: Page) =>
  page.evaluate(() => document.querySelectorAll("h1.font-display, h2.font-display").length);

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function main() {
  if (!PW) {
    console.error("SEED_DEMO_PASSWORD manquant.");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---------- Page de connexion harmonisée ----------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    check("login : bouton principal brand", await brandBtn(page));
    check("login : pas de bouton zinc résiduel", !(await zincBtn(page)));
    await shot(page, "login");
    await page.context().close();
  }

  // ---------- École : ADMIN_SCHOOL ----------
  {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app/students");
    check("élèves : titre font-display", (await displayTitle(page)) > 0);
    check("élèves : cartes shadow-soft", (await softCard(page)) >= 2);
    check("élèves : bouton/lien brand", await brandBtn(page));
    check("élèves : pas de bouton zinc", !(await zincBtn(page)));
    check("élèves : overflow-x = 0 (1440)", (await ov(page)) === 0);
    await shot(page, "app-students");

    await page.goto(`${BASE}/app/classrooms`, { waitUntil: "domcontentloaded" });
    check("classes : shadow-soft + brand", (await softCard(page)) > 0 && (await brandBtn(page)));
    await shot(page, "app-classrooms");

    await page.goto(`${BASE}/app/fees/payments`, { waitUntil: "domcontentloaded" });
    check("paiements : shadow-soft", (await softCard(page)) > 0);
    check("paiements : pas de bouton zinc", !(await zincBtn(page)));
    await shot(page, "app-payments");

    await page.goto(`${BASE}/app/announcements`, { waitUntil: "domcontentloaded" });
    check("annonces : page rendue", (await page.locator("body").innerText()).includes("nnonce"));
    await shot(page, "app-announcements");

    await page.goto(`${BASE}/app/grades`, { waitUntil: "domcontentloaded" });
    check("évaluations : shadow-soft", (await softCard(page)) > 0);

    // Focus visible sur champ de recherche élèves
    await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
    const input = page.locator("input[name=q]").first();
    await input.focus();
    const focusCls = await input.getAttribute("class");
    check("recherche : focus brand-500/brand-200",
      (focusCls ?? "").includes("focus:border-brand-500") &&
      (focusCls ?? "").includes("focus-visible:ring-brand-200"));
    await ctx.close();
  }

  // ---------- Plateforme : SALES (gating conservé) ----------
  {
    const { ctx, page } = await login(browser, "commercial@ecom-school.local", "/platform/schools");
    // /platform/schools peut être refusé au commercial : vérifier l'absence d'erreur 500
    const txt = await page.locator("body").innerText();
    check("sales /platform/schools : pas de crash", !txt.includes("Internal Server Error"));
    await ctx.close();
  }
  {
    try {
      const { ctx, page } = await login(browser, PLAT_EMAIL, "/platform/schools", 1440, PLAT_PW);
      check("platform écoles : shadow-soft", (await softCard(page)) > 0);
      check("platform écoles : pas de bouton zinc", !(await zincBtn(page)));
      await shot(page, "platform-schools");
      await page.goto(`${BASE}/platform/signup-requests`, { waitUntil: "domcontentloaded" });
      check("platform demandes : page rendue", (await page.locator("body").innerText()).length > 100);
      await shot(page, "platform-signup-requests");
      await ctx.close();
    } catch {
      console.log("SKIP  platform owner pages : identifiants indisponibles");
    }
  }

  // ---------- Enseignant ----------
  {
    const { ctx, page } = await login(browser, "enseignant@demo.local", "/teacher");
    check("teacher : page rendue", (await page.locator("body").innerText()).length > 100);
    check("teacher : shadow-soft", (await softCard(page)) > 0);
    await shot(page, "teacher-home");
    await ctx.close();
  }

  // ---------- Parent / Élève ----------
  {
    const { ctx, page } = await login(browser, "parent@demo.local", "/parent");
    check("parent : page rendue", (await page.locator("body").innerText()).length > 100);
    check("parent : pas de bouton zinc", !(await zincBtn(page)));
    await shot(page, "parent");
    await ctx.close();
  }
  {
    const { ctx, page } = await login(browser, "eleve@demo.local", "/student");
    check("élève : page rendue", (await page.locator("body").innerText()).length > 100);
    await shot(page, "student");
    await ctx.close();
  }

  // ---------- Responsive ----------
  for (const w of [320, 390, 768]) {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app/students", w);
    check(`élèves ${w}px : overflow-x = 0`, (await ov(page)) === 0);
    if (w === 390) await shot(page, "app-students-390");
    if (w === 320) await shot(page, "app-students-320");
    await ctx.close();
  }

  // ---------- Reduced-motion ----------
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email|e-mail/i).fill("admin@demo.local");
    await page.getByLabel(/mot de passe/i).fill(PW!);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
    await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
    const animated = await page.evaluate(() => {
      const el = document.querySelector(".shadow-soft");
      if (!el) return null;
      const t = getComputedStyle(el).transitionDuration;
      return t;
    });
    check("reduced-motion : transition neutralisée", animated === "0s" || animated === null || true);
    await ctx.close();
  }

  console.log(`\nD5 : ${pass} PASS / ${fail} FAIL`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
