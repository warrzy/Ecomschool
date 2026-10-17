import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Recette D6 — validation finale ECOM-SCHOOL V2 (site public + structure).
 * Ne soumet aucun formulaire réel. Usage :
 * D6_BASE=https://preprod.ecomschool.fr npx tsx scripts/d6/final-acceptance.ts
 */
const BASE = process.env.D6_BASE ?? "http://localhost:3100";
const OUT = "scripts/d6/shots";

let pass = 0;
let fail = 0;
const anomalies: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    anomalies.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL  ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---------- Accueil ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const html = await page.content();
    check("accueil : hero présent", html.includes("hero") || html.includes("<h1"));
    check("accueil : photos locales /photos/", (await page.locator('img[src*="photos"]').count()) > 0);
    check(
      "accueil : images avec alt",
      (await page.locator("img:not([alt])").count()) === 0,
    );
    check(
      "accueil : lien tarifs dans la nav",
      (await page.locator('a[href="/tarifs"]').count()) > 0,
    );
    check(
      "accueil : CTA inscription",
      (await page.locator('a[href*="/inscription"]').count()) > 0,
    );
    check(
      "accueil : parcours en étapes",
      /parcours|étape|comment démarrer/i.test(html),
    );
    check("accueil : FAQ ou ressources", html.toLowerCase().includes("faq") || html.toLowerCase().includes("ressources"));
    // Liens internes sans cible morte évidente
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href")!)
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    const uniq = [...new Set(hrefs)];
    let dead = 0;
    for (const h of uniq.filter((x) => !x.includes("#") && !x.includes("?"))) {
      const r = await page.request.get(`${BASE}${h}`);
      if (r.status() >= 500) dead++;
    }
    check("accueil : aucun lien interne en erreur 5xx", dead === 0);
    await ctx.close();
  }

  // ---------- Tarifs dynamiques ----------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/tarifs`, { waitUntil: "domcontentloaded" });
    const txt = await page.locator("body").innerText();
    check("tarifs : montants FCFA affichés", /F\s?CFA|FCFA/i.test(txt));
    check(
      "tarifs : offres multiples",
      (await page.locator('a[href*="inscription?plan"]').count()) >= 2,
    );
    await page.screenshot({ path: `${OUT}/tarifs-1440.png`, fullPage: true });
    await page.context().close();
  }

  // ---------- Inscription (sans soumission) ----------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE}/inscription`, { waitUntil: "domcontentloaded" });
    const fields = await page.locator("input, select, textarea").count();
    check("inscription : formulaire présent", fields >= 5);
    check(
      "inscription : honeypot anti-spam présent",
      (await page.locator("input[name='website']").count()) > 0,
    );
    check(
      "inscription : bouton de soumission présent (non cliqué)",
      (await page.locator("button[type=submit], button:has-text('nscrire'), button:has-text('Envoyer')").count()) > 0,
    );
    const ov = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("inscription 390 : pas de débordement", ov === 0);
    await page.screenshot({ path: `${OUT}/inscription-390.png`, fullPage: true });
    await page.context().close();
  }

  // ---------- Login ----------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    check(
      "login : champs email + mot de passe",
      (await page.locator("input[type=email], input[type=text]").count()) > 0 &&
        (await page.locator("input[type=password]").count()) === 1,
    );
    check(
      "login : bouton brand",
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("button")).some((b) =>
          b.className.includes("bg-brand-600"),
        ),
      ),
    );
    await page.context().close();
  }

  // ---------- Accessibilité : focus visible ----------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Tab");
    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const s = getComputedStyle(el);
      return s.outlineWidth !== "0px" || s.boxShadow !== "none" || el.className.includes("focus");
    });
    check("accueil : focus clavier visible", visible);
    await page.context().close();
  }

  console.log(`\nD6 public : ${pass} PASS / ${fail} FAIL`);
  if (anomalies.length) {
    console.log("Anomalies :");
    anomalies.forEach((a) => console.log(`  - ${a}`));
  }
  await browser.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
