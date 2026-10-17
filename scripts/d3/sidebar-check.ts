import "dotenv/config";
import { chromium, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.D3_BASE ?? "http://localhost:3100";
const PW = process.env.SEED_DEMO_PASSWORD;
const OUT = "scripts/d3/shots";

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

async function login(browser: Browser, email: string, path: string, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

async function main() {
  if (!PW) {
    console.error("SEED_DEMO_PASSWORD manquant.");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---------- Établissement : sidebar développée ----------
  {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app");
    await page.waitForTimeout(1500);
    const aside = page.locator("aside[aria-label='Navigation latérale']");
    check("app : sidebar présente (desktop)", await aside.isVisible());
    check(
      "app : sections visibles",
      (await aside.locator("text=Pédagogie").count()) > 0,
    );
    check(
      "app : lien actif marqué (aria-current)",
      (await aside.locator("[aria-current='page']").count()) === 1,
    );
    await page.screenshot({ path: `${OUT}/app-expanded.png` });

    // Bascule en compact
    await page.getByRole("button", { name: /Réduire le menu/i }).click();
    await page.waitForTimeout(600);
    const width = await aside.evaluate((el) => el.getBoundingClientRect().width);
    check("app : mode compact (~72px)", width > 55 && width < 90);
    await page.screenshot({ path: `${OUT}/app-collapsed.png` });

    // Persistance après rechargement
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const width2 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    check("app : préférence persistée au rechargement", width2 > 55 && width2 < 90);

    // Tooltip au survol
    await aside.locator("a").first().hover();
    await page.waitForTimeout(300);
    const tooltip = await page.locator("[role='tooltip']:visible").count();
    check("app : tooltip visible au survol (compact)", tooltip > 0);
    await page.screenshot({ path: `${OUT}/app-collapsed-tooltip.png` });

    // Redéveloppement
    await page.getByRole("button", { name: /Développer le menu/i }).click();
    await page.waitForTimeout(600);
    const width3 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    check("app : retour développé (~256px)", width3 > 230);

    // Navigation par lien
    await aside.locator("text=Paramètres").first().click();
    await page.waitForURL("**/app/settings**", { timeout: 15000 });
    check("app : navigation Paramètres", page.url().includes("/app/settings"));
    check(
      "app : actif suit la route",
      (await aside.locator("[aria-current='page']").first().textContent())?.includes(
        "Paramètres",
      ) ?? false,
    );

    // Clavier : Tab jusqu'au bouton de bascule puis Entrée
    await page.keyboard.press("Escape");
    await aside.locator("a").first().focus();
    await page.keyboard.press("Tab");
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    check("app : navigation clavier (Tab)", focusedTag === "BUTTON" || focusedTag === "A");
    const toggle = page.getByRole("button", { name: /Réduire le menu/i });
    await toggle.focus();
    const focusedLabel = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label"),
    );
    const hasPressed = await toggle.getAttribute("aria-pressed");
    check(
      "app : bouton bascule focusable (aria-label + aria-pressed)",
      focusedLabel === "Réduire le menu" && hasPressed === "false",
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const widthKb = await aside.evaluate((el) => el.getBoundingClientRect().width);
    check("app : bascule au clavier (Enter)", widthKb < 90);
    await page.getByRole("button", { name: /Développer le menu/i }).click();
    await page.waitForTimeout(500);
    await ctx.close();
  }

  // ---------- Plateforme ----------
  {
    const { ctx, page } = await login(browser, "commercial@ecom-school.local", "/platform");
    await page.waitForTimeout(1500);
    const aside = page.locator("aside[aria-label='Navigation latérale']");
    check("platform : sidebar présente", await aside.isVisible());
    check(
      "platform : entrées autorisées visibles",
      (await aside.locator("text=Offres").count()) > 0 &&
        (await aside.locator("text=Abonnements").count()) > 0,
    );
    check(
      "platform : entrées non autorisées masquées",
      (await aside.locator("text=Demandes").count()) === 0 &&
        (await aside.locator("text=Administrateurs").count()) === 0,
    );
    await page.screenshot({ path: `${OUT}/platform.png` });
    await ctx.close();
  }

  // ---------- Enseignant ----------
  {
    const { ctx, page } = await login(browser, "enseignant@demo.local", "/teacher");
    await page.waitForTimeout(1500);
    const aside = page.locator("aside[aria-label='Navigation latérale']");
    check("teacher : sidebar présente", await aside.isVisible());
    check(
      "teacher : 3 entrées",
      (await aside.locator("nav a").count()) === 3,
    );
    await page.screenshot({ path: `${OUT}/teacher.png` });
    await ctx.close();
  }

  // ---------- Caissier : menu limité aux permissions ----------
  {
    const { ctx, page } = await login(browser, "caissier@demo.local", "/app/fees");
    await page.waitForTimeout(1500);
    const aside = page.locator("aside[aria-label='Navigation latérale']");
    check("caissier : sidebar présente", await aside.isVisible());
    check(
      "caissier : finances visibles, administration masquée",
      (await aside.locator("text=Finances").count()) > 0 &&
        (await aside.locator("text=Paramètres").count()) === 0,
    );
    await page.screenshot({ path: `${OUT}/cashier.png` });
    await ctx.close();
  }

  // ---------- Parent : parcours préservé ----------
  {
    const { ctx, page } = await login(browser, "parent@demo.local", "/parent");
    await page.waitForTimeout(1500);
    check(
      "parent : pas de sidebar (parcours préservé)",
      (await page.locator("aside[aria-label='Navigation latérale']").count()) === 0,
    );
    await page.screenshot({ path: `${OUT}/parent.png` });
    await ctx.close();
  }

  // ---------- Élève : parcours préservé ----------
  {
    const { ctx, page } = await login(browser, "eleve@demo.local", "/student");
    await page.waitForTimeout(1500);
    check(
      "student : pas de sidebar (parcours préservé)",
      (await page.locator("aside[aria-label='Navigation latérale']").count()) === 0,
    );
    await ctx.close();
  }

  // ---------- Reduced-motion : transitions neutralisées ----------
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
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const aside = page.locator("aside[aria-label='Navigation latérale']");
    const dur = await aside.evaluate((el) =>
      getComputedStyle(el).transitionDuration,
    );
    check("reduced-motion : transition de largeur neutralisée", dur === "0s" || dur === "");
    await ctx.close();
  }

  // ---------- Mobile 320 : MobileNav + pas de débordement ----------
  {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app", 320);
    await page.waitForTimeout(1200);
    const ov = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("mobile 320 : pas de débordement", ov === 0);
    await page.getByRole("button", { name: /ouvrir le menu/i }).click();
    await page.waitForTimeout(500);
    check(
      "mobile 320 : MobileNav fonctionnel",
      await page.locator("#mobile-nav-panel").isVisible(),
    );
    await page.screenshot({ path: `${OUT}/mobile-320.png` });
    await ctx.close();
  }

  // ---------- Mobile 390 : MobileNav conservé ----------
  {
    const { ctx, page } = await login(browser, "admin@demo.local", "/app", 390);
    await page.waitForTimeout(1500);
    check(
      "mobile : sidebar masquée",
      (await page.locator("aside[aria-label='Navigation latérale']:visible").count()) === 0,
    );
    await page.getByRole("button", { name: /ouvrir le menu/i }).click();
    await page.waitForTimeout(500);
    check(
      "mobile : panneau MobileNav s'ouvre",
      await page.locator("#mobile-nav-panel").isVisible(),
    );
    const ov = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("mobile : pas de débordement", ov === 0);
    await page.screenshot({ path: `${OUT}/mobile-390.png` });
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
