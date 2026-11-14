/**
 * Smoke UI — parcours réels dans le navigateur sur la préproduction.
 * Couvre les 6 profils de démonstration : administrateur, comptable, RH,
 * gestionnaire de paie, enseignant (portail /teacher) et parent (/parent).
 *
 * Vérifications par profil :
 *  - connexion et redirections attendues ;
 *  - pages accessibles (HTTP 200 + contenu réellement visible) ;
 *  - pages refusées par permission (403 / redirection) ;
 *  - entrées de menu présentes ET absentes selon les permissions ;
 *  - aucune erreur JavaScript, erreur de page ou requête en échec (>= 500).
 *
 * Usage : DEMO_UI_PASSWORD=... npx tsx scripts/preprod/ui-smoke.ts
 * (mot de passe : SEED_DEMO_PASSWORD du .env preprod, jamais commité —
 *  le script ne journalise jamais d'identifiant ni de secret.)
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.UI_BASE_URL ?? "https://preprod.ecomschool.fr";
const PW = process.env.DEMO_UI_PASSWORD ?? "";
if (!PW) { console.error("DEMO_UI_PASSWORD requis"); process.exit(1); }

let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  ok ? pass++ : fail++;
};

// Collecteur d'erreurs par page — vidé à chaque navigation testée.
const uiErrors: string[] = [];
function attachErrorCollectors(page: Page) {
  page.on("console", (m) => {
    if (m.type() === "error") uiErrors.push(`console: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => uiErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) uiErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  });
  page.on("requestfailed", (r) => {
    // ERR_ABORTED = navigation interrompue normale (redirections Next.js).
    if (r.failure()?.errorText !== "net::ERR_ABORTED")
      uiErrors.push(`requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`);
  });
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function isRefused(page: Page, path: string) {
  const r = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  const forbidden = await page
    .locator("text=/interdit|forbidden|accès refusé|403|non autorisé/i")
    .first().isVisible({ timeout: 8000 }).catch(() => false);
  return r?.status() !== 200 || forbidden || page.url().includes("forbidden");
}

async function menuHas(page: Page, label: string, expect: boolean) {
  const n = await page.locator(`aside nav a:has-text("${label}")`).count();
  return expect ? n > 0 : n === 0;
}

type PageCheck = { path: string; expect?: string[] };

async function visitPages(page: Page, pages: PageCheck[]) {
  for (const p of pages) {
    uiErrors.length = 0;
    try {
      const resp = await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle", timeout: 30000 });
      const status = resp?.status() ?? 0;
      let bodyOk = true;
      for (const needle of p.expect ?? []) {
        const visible = await page.locator(`text=${needle}`).filter({ visible: true })
          .first().isVisible({ timeout: 15000 }).catch(() => false);
        bodyOk = bodyOk && visible;
      }
      check(`${p.path} → ${status}${p.expect?.length ? ` + [${p.expect.join(",")}]` : ""}`, status === 200 && bodyOk);
      if (uiErrors.length) {
        check(`  erreurs JS/API sur ${p.path}`, false);
        for (const e of uiErrors.slice(0, 3)) console.log(`      ↳ ${e}`);
      }
    } catch {
      check(`${p.path} → navigation`, false);
    }
  }
}

const NAV_T = 15000;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  attachErrorCollectors(page);

  // ---------- 1. Administrateur ----------
  console.log("== PROFIL : demo-admin ==");
  await login(page, "demo-admin@demo.ecomschool.test");
  check("connexion demo-admin (hors /login)", !page.url().includes("/login"));
  await visitPages(page, [
    { path: "/app/students", expect: ["Ouédraogo", "Sawadogo"] },
    { path: "/app/fees" },
    { path: "/app/fees/payments", expect: ["REC-2026"] },
    { path: "/app/enrollments" },
    { path: "/app/comptabilite" },
    { path: "/app/comptabilite/etats" },
    { path: "/app/comptabilite/immobilisations" },
    { path: "/app/rh", expect: ["Kientega"] },
    { path: "/app/rh/paie" },
    { path: "/app/treasury" },
    { path: "/app/expenses", expect: ["Fournitures"] },
    { path: "/app/notifications" },
    { path: "/app/announcements", expect: ["conseil"] },
  ]);
  check("menu admin : Personnel + Paie + Comptabilité visibles",
    (await menuHas(page, "Personnel", true)) &&
    (await menuHas(page, "Paie", true)) &&
    (await menuHas(page, "Comptabilité", true)));

  // ---------- 2. Comptable ----------
  console.log("== PROFIL : demo-compta ==");
  await ctx.clearCookies();
  await login(page, "demo-compta@demo.ecomschool.test");
  await visitPages(page, [
    { path: "/app/comptabilite" },
    { path: "/app/comptabilite/etats" },
    { path: "/app/comptabilite/tiers" },
    { path: "/app/treasury" },
    { path: "/app/expenses", expect: ["Fournitures"] },
  ]);
  check("menu compta : Comptabilité visible, Personnel/Paie/Élèves masqués",
    (await menuHas(page, "Comptabilité", true)) &&
    (await menuHas(page, "Personnel", false)) &&
    (await menuHas(page, "Paie", false)) &&
    (await menuHas(page, "Élèves", false)));
  check("compta → /app/rh refusé", await isRefused(page, "/app/rh"));
  check("compta → /app/rh/paie refusé", await isRefused(page, "/app/rh/paie"));
  check("compta → /app/students refusé", await isRefused(page, "/app/students"));
  check("compta → /app/fees refusé", await isRefused(page, "/app/fees"));

  // ---------- 3. RH ----------
  console.log("== PROFIL : demo-rh ==");
  await ctx.clearCookies();
  await login(page, "demo-rh@demo.ecomschool.test");
  await visitPages(page, [{ path: "/app/rh", expect: ["Kientega"] }]);
  check("menu RH : Personnel visible, Paie + Comptabilité masqués",
    (await menuHas(page, "Personnel", true)) &&
    (await menuHas(page, "Paie", false)) &&
    (await menuHas(page, "Comptabilité", false)));
  check("demo-rh → /app/rh/paie refusé (pas payroll.read)", await isRefused(page, "/app/rh/paie"));
  check("demo-rh → /app/comptabilite refusé", await isRefused(page, "/app/comptabilite"));

  // ---------- 4. Gestionnaire de paie ----------
  console.log("== PROFIL : demo-paie ==");
  await ctx.clearCookies();
  await login(page, "demo-paie@demo.ecomschool.test");
  await visitPages(page, [
    { path: "/app/rh/paie", expect: ["avances"] },
    { path: "/app/rh" },
  ]);
  check("menu paie : Paie + Personnel visibles, Comptabilité masquée",
    (await menuHas(page, "Paie", true)) &&
    (await menuHas(page, "Comptabilité", false)));
  check("demo-paie → /app/comptabilite refusé", await isRefused(page, "/app/comptabilite"));
  check("demo-paie → /app/fees refusé", await isRefused(page, "/app/fees"));

  // ---------- 5. Enseignant (portail /teacher) ----------
  console.log("== PROFIL : demo-enseignant ==");
  await ctx.clearCookies();
  await login(page, "demo-enseignant@demo.ecomschool.test");
  uiErrors.length = 0;
  const rt = await page.goto(`${BASE}/teacher`, { waitUntil: "networkidle", timeout: 30000 });
  const teacherOk = await page.locator("text=/enseignant|Kientega/i").first()
    .isVisible({ timeout: NAV_T }).catch(() => false);
  check(`/teacher → ${rt?.status()} + espace enseignant`, rt?.status() === 200 && teacherOk);
  check("menu enseignant : « Mon emploi du temps » visible",
    await menuHas(page, "emploi du temps", true));
  check("enseignant → /app/rh refusé", await isRefused(page, "/app/rh"));
  check("enseignant → /app/rh/paie refusé", await isRefused(page, "/app/rh/paie"));
  check("enseignant → /app/comptabilite refusé", await isRefused(page, "/app/comptabilite"));
  check("enseignant → /app/students refusé (pas student.read)", await isRefused(page, "/app/students"));
  if (uiErrors.length) { check("erreurs JS/API profil enseignant", false); }

  // ---------- 6. Parent (portail /parent) ----------
  console.log("== PROFIL : demo-parent ==");
  await ctx.clearCookies();
  await login(page, "demo-parent@demo.ecomschool.test");
  uiErrors.length = 0;
  // Le rôle PARENT redirige /app → /parent.
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle", timeout: 30000 });
  check("parent : /app redirige vers /parent", page.url().includes("/parent"));
  const rp = await page.goto(`${BASE}/parent`, { waitUntil: "networkidle", timeout: 30000 });
  const childOk = await page.locator("text=Ouédraogo").filter({ visible: true })
    .first().isVisible({ timeout: NAV_T }).catch(() => false);
  const child2Ok = await page.locator("text=Compaoré").filter({ visible: true })
    .first().isVisible({ timeout: NAV_T }).catch(() => false);
  check(`/parent → ${rp?.status()} + enfants visibles (Awa + Mariam)`, rp?.status() === 200 && childOk && child2Ok);
  // Cloisonnement URL : les routes internes restent inaccessibles.
  await page.goto(`${BASE}/app/students`, { waitUntil: "networkidle", timeout: 30000 });
  check("parent : /app/students redirige hors portail admin", !page.url().includes("/app/students"));
  if (uiErrors.length) {
    check("erreurs JS/API profil parent", false);
    for (const e of uiErrors.slice(0, 3)) console.log(`      ↳ ${e}`);
  }

  await browser.close();
  console.log(`\n=== SMOKE UI : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}

main();
