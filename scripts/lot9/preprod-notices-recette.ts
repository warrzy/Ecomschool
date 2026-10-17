/**
 * Lot 9 — recette préproduction : notices d'utilisation intégrées.
 * Lecture seule. Vérifie présence, ouverture/fermeture, affichage mobile,
 * adaption aux rôles (aucune info plateforme côté établissement).
 *
 * Usage local :
 *   set -a; . ./.p6b-env.local; set +a
 *   npx tsx scripts/lot9/preprod-notices-recette.ts
 */
import { chromium, type Browser } from "playwright";

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const PLAT_EMAIL = process.env.PREPROD_PLATFORM_ADMIN_EMAIL;
const PLAT_PW = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD;
if (!PW || !PLAT_EMAIL || !PLAT_PW) {
  console.error("SEED_DEMO_PASSWORD / PREPROD_PLATFORM_ADMIN_* manquants.");
  process.exit(1);
}

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const states = new Map<string, unknown>();
async function session(browser: Browser, email: string, password: string) {
  if (!states.has(email)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.getByLabel(/e-?mail/i).first().fill(email);
    await page.getByLabel(/mot de passe/i).fill(password);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    states.set(email, await ctx.storageState());
    await ctx.close();
  }
  return states.get(email);
}

async function newPage(
  browser: Browser,
  email: string,
  password: string,
  viewport?: { width: number; height: number },
) {
  const ctx = await browser.newContext({
    storageState: (await session(browser, email, password)) as never,
    ...(viewport ? { viewport } : {}),
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function checkNotice(
  browser: Browser,
  email: string,
  password: string,
  path: string,
  expectText: RegExp,
  label: string,
  isPlatform = false,
) {
  const { ctx, page } = await newPage(browser, email, password);
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    const details = page.locator("details#notice");
    const present = (await details.count()) > 0;
    ok(`${label} : bloc notice présent`, present);
    if (!present) return;
    await details.locator("summary").click(); // innerText : contenu visible
    const text = await details.innerText();
    ok(`${label} : contenu attendu`, expectText.test(text), text.slice(0, 60));
    // Ouverture / fermeture
    const open0 = await details.evaluate((d) => (d as HTMLDetailsElement).open);
    await details.locator("summary").click();
    const open1 = await details.evaluate((d) => (d as HTMLDetailsElement).open);
    await details.locator("summary").click();
    const open2 = await details.evaluate((d) => (d as HTMLDetailsElement).open);
    ok(`${label} : ouverture/fermeture`, open0 && !open1 && open2, `${open0}/${open1}/${open2}`);
    // Lien d'aide vers l'ancre
    const link = page.locator('a[href="#notice"]');
    ok(`${label} : lien « Comment ça marche ? »`, (await link.count()) > 0);
    // Aucune info réservée plateforme côté école
    if (!isPlatform) {
      const body = await page.innerText("body");
      ok(
        `${label} : pas de contenu plateforme exposé`,
        !/DRYRUN|WHATSAPP_DRY_RUN|graph\.facebook|Meta Business|platform\./i.test(body),
      );
    }
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch();

  // ---------- Espace établissement (admin démo) ----------
  await checkNotice(browser, "admin@demo.local", PW!, "/app/users",
    /rôles|permissions/i, "app/users");
  await checkNotice(browser, "admin@demo.local", PW!, "/app/students/import",
    /CSV|XLSX|2 Mo|import/i, "app/students/import");
  await checkNotice(browser, "admin@demo.local", PW!, "/app/subscription",
    /abonnement|offre|changement|validation commerciale/i, "app/subscription");

  // Notices préexistantes toujours là
  await checkNotice(browser, "admin@demo.local", PW!, "/app/announcements",
    /brouillon|publi|archiv/i, "app/announcements");
  await checkNotice(browser, "admin@demo.local", PW!, "/app/grading-policy",
    /barème|coefficient|arrondi/i, "app/grading-policy");

  // ---------- Plateforme ----------
  await checkNotice(browser, PLAT_EMAIL!, PLAT_PW!, "/platform/administrators",
    /plateforme|commercial|rôle/i, "platform/administrators", true);
  await checkNotice(browser, "commercial@ecom-school.local", PW!, "/platform/subscriptions",
    /cycle de vie|validation|offre/i, "platform/subscriptions", true);
  await checkNotice(browser, "commercial@ecom-school.local", PW!, "/platform/profile",
    /notification|WhatsApp|consentement/i, "platform/profile", true);

  // ---------- Mobile 390px : notice utilisable ----------
  {
    const { ctx, page } = await newPage(browser, "admin@demo.local", PW!, {
      width: 390,
      height: 844,
    });
    await page.goto(`${BASE}/app/users`, { waitUntil: "load" });
    const details = page.locator("details#notice");
    await details.locator("summary").click();
    const box = await details.boundingBox();
    const vw = page.viewportSize()!.width;
    ok("mobile : notice ouverte tient dans le viewport",
      !!box && box.width <= vw + 1);
    const link = page.locator('a[href="#notice"]');
    ok("mobile : lien d'aide visible", await link.isVisible());
    await ctx.close();
  }

  await browser.close();
  console.log(`\n===== ${pass} PASS / ${fail} FAIL =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
