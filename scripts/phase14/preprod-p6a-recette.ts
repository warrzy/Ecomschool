import "dotenv/config";
import { mkdirSync } from "node:fs";
import { chromium, type Page, type BrowserContext } from "@playwright/test";

/**
 * Recette préprod P6a — navigation mobile, libellés français, pages
 * système, non-régression imports/exports. Lecture seule, aucune
 * écriture métier (aucune donnée créée ni supprimée).
 *
 * Usage (depuis le poste local) :
 *   set -a; . /tmp/p6a-env.txt; set +a     # SEED_DEMO_PASSWORD + PREPROD_PLATFORM_ADMIN_*
 *   npx tsx scripts/phase14/preprod-p6a-recette.ts
 */

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const PLAT_EMAIL = process.env.PREPROD_PLATFORM_ADMIN_EMAIL ?? "admin@ecom-school.local";
const PLAT_PW = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD ?? PW;
if (!PW) {
  console.error("SEED_DEMO_PASSWORD manquant — arrêt.");
  process.exit(1);
}

const MOBILE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };
const SHOTS = "docs/recette/p6a";
mkdirSync(SHOTS, { recursive: true });

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(ctx: BrowserContext, email: string, password = PW!) {
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

const menuButton = (page: Page) =>
  page.locator('button[aria-controls="mobile-nav-panel"]');
const navPanel = (page: Page) =>
  page.getByRole("dialog", { name: /navigation principale/i });

/** Flux complet : ouverture → aria/scroll/focus → Échap → lien. */
async function mobileFlow(name: string, page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const trigger = menuButton(page);
  const visible = await trigger.isVisible().catch(() => false);
  check(`${name} : bouton burger visible`, visible);
  if (!visible) return;

  check(
    `${name} : aria-expanded=false au départ`,
    (await trigger.getAttribute("aria-expanded")) === "false",
  );
  await trigger.click();
  const panel = navPanel(page);
  const panelVisible = await panel.isVisible().catch(() => false);
  check(`${name} : panneau ouvert`, panelVisible);
  if (!panelVisible) return;

  check(
    `${name} : aria-expanded=true`,
    (await trigger.getAttribute("aria-expanded")) === "true",
  );
  const overflow = await page.evaluate(() => document.body.style.overflow);
  check(`${name} : défilement bloqué`, overflow === "hidden", overflow);
  const focusInPanel = await page.evaluate(
    () =>
      !!document.activeElement &&
      document.getElementById("mobile-nav-panel")?.contains(document.activeElement),
  );
  check(`${name} : focus déplacé dans le panneau`, focusInPanel === true);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check(`${name} : Échap ferme`, (await navPanel(page).count()) === 0);
  check(`${name} : focus rendu au bouton`, await trigger.evaluate((el) => el === document.activeElement));

  // Réouverture puis clic sur un lien : navigation + fermeture.
  // (On vise un lien vers une autre page que la courante.)
  await trigger.click();
  await navPanel(page).waitFor({ state: "visible" });
  const before = new URL(page.url()).pathname;
  const links = navPanel(page).getByRole("link");
  const hrefs = await links.evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  const idx = hrefs.findIndex((h) => h !== before);
  await links.nth(idx === -1 ? 0 : idx).click();
  await page.waitForTimeout(1200);
  check(
    `${name} : lien navigue et ferme le panneau`,
    (await navPanel(page).count()) === 0 &&
      (idx === -1 || page.url().includes(hrefs[idx])),
    `${hrefs[idx]} → ${page.url()}`,
  );
  const restored = await page.evaluate(() => document.body.style.overflow);
  check(`${name} : défilement restauré`, restored !== "hidden");
}

async function main() {
  const browser = await chromium.launch();

  // ---------- MOBILE 390px : /app administrateur ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: MOBILE });
    try {
      const page = await login(ctx, "admin@demo.local");
      await mobileFlow("mobile /app (admin)", page, "/app");

      // Overlay : clic hors panneau.
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      await menuButton(page).click();
      await navPanel(page).waitFor({ state: "visible" });
      await page.mouse.click(370, 300);
      await page.waitForTimeout(400);
      check("mobile /app : clic extérieur ferme", (await navPanel(page).count()) === 0);

      // Sections + RBAC dans le panneau.
      await menuButton(page).click();
      const panel = navPanel(page);
      for (const s of ["Pilotage", "Établissement", "Pédagogie", "Finances", "Administration"]) {
        check(
          `mobile /app : section « ${s} »`,
          (await panel.locator("div.uppercase", { hasText: s }).count()) === 1,
        );
      }
      check(
        "mobile /app : lien Élèves présent",
        (await panel.getByRole("link", { name: "Élèves", exact: true }).count()) === 1,
      );
      await page.screenshot({ path: `${SHOTS}/mobile-app-nav.png`, fullPage: true });
      await page.keyboard.press("Escape");
      await page.close();
    } catch (e) {
      check("mobile /app (admin)", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- MOBILE : /platform propriétaire ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: MOBILE });
    try {
      const page = await login(ctx, PLAT_EMAIL, PLAT_PW!);
      await mobileFlow("mobile /platform", page, "/platform");
      await page.goto("/platform", { waitUntil: "domcontentloaded" });
      await menuButton(page).click();
      await navPanel(page).waitFor({ state: "visible" });
      await page.screenshot({ path: `${SHOTS}/mobile-platform-nav.png`, fullPage: true });
      await page.close();
    } catch (e) {
      check("mobile /platform", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- MOBILE : /teacher enseignant ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: MOBILE });
    try {
      const page = await login(ctx, "enseignant@demo.local");
      await mobileFlow("mobile /teacher", page, "/teacher");
      await page.goto("/teacher", { waitUntil: "domcontentloaded" });
      await menuButton(page).click();
      await navPanel(page).waitFor({ state: "visible" });
      // RBAC mobile enseignant : aucun lien finances/admin.
      const panel = navPanel(page);
      for (const hidden of ["Finances", "Utilisateurs", "Règles de notation"]) {
        check(
          `mobile /teacher : « ${hidden} » absent`,
          (await panel.getByRole("link", { name: hidden, exact: true }).count()) === 0,
        );
      }
      await page.screenshot({ path: `${SHOTS}/mobile-teacher-nav.png`, fullPage: true });
      await page.close();
    } catch (e) {
      check("mobile /teacher", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- MOBILE : caissier (RBAC strict) ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: MOBILE });
    try {
      const page = await login(ctx, "caissier@demo.local");
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      await menuButton(page).click();
      const panel = navPanel(page);
      await panel.waitFor({ state: "visible" });
      check(
        "mobile caissier : Finances visible",
        (await panel.getByRole("link", { name: "Finances", exact: true }).count()) === 1,
      );
      for (const hidden of ["Élèves", "Utilisateurs", "Messagerie", "Enseignants"]) {
        check(
          `mobile caissier : « ${hidden} » absent`,
          (await panel.getByRole("link", { name: hidden, exact: true }).count()) === 0,
        );
      }
      await page.close();
    } catch (e) {
      check("mobile caissier", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- TABLETTE 768px : bascule desktop ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: TABLET });
    try {
      const page = await login(ctx, "admin@demo.local");
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      check(
        "tablette 768 : sidebar visible",
        await page.locator("aside").first().isVisible(),
      );
      check(
        "tablette 768 : burger masqué",
        !(await menuButton(page).isVisible().catch(() => false)),
      );
      await page.close();
    } catch (e) {
      check("tablette 768", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- DESKTOP : admin ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    try {
      const page = await login(ctx, "admin@demo.local");
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      check(
        "desktop : burger masqué",
        !(await menuButton(page).isVisible().catch(() => false)),
      );
      const aside = page.locator("aside").first();
      for (const s of ["Pilotage", "Établissement", "Pédagogie", "Finances", "Administration"]) {
        check(
          `desktop : section « ${s} »`,
          (await aside.locator("div.uppercase", { hasText: s }).count()) === 1,
        );
      }
      check(
        "desktop : champ « Rechercher… » supprimé",
        (await page.getByPlaceholder("Rechercher...").count()) === 0,
      );
      const dashText = await page.locator("body").innerText();
      check(
        "desktop : pas de placeholder « Module à venir »",
        !/Module à venir|Phase 2/i.test(dashText),
      );
      check(
        "desktop admin : compteurs finances visibles (finance.read)",
        /Encaissé/.test(dashText),
      );
      await page.screenshot({ path: `${SHOTS}/desktop-app-dashboard.png`, fullPage: true });

      // Libellés d'erreur.
      await page.goto("/app/students?error=MATRICULE_TAKEN", { waitUntil: "domcontentloaded" });
      let body = await page.locator("body").innerText();
      check(
        "erreur MATRICULE_TAKEN traduite",
        body.includes("Ce matricule est déjà attribué") && !body.includes("MATRICULE_TAKEN"),
      );
      await page.goto("/app/students?error=CODE_INCONNU_XYZ", { waitUntil: "domcontentloaded" });
      body = await page.locator("body").innerText();
      check(
        "erreur inconnue → message générique",
        /Une erreur est survenue/.test(body) && !body.includes("CODE_INCONNU_XYZ"),
      );

      // Statuts traduits.
      await page.goto("/app/students", { waitUntil: "domcontentloaded" });
      body = await page.locator("tbody").innerText().catch(() => "");
      check(
        "élèves : statut traduit (pas de cellule ACTIVE brute)",
        body.includes("Actif") && !/^\s*ACTIVE\s*$/m.test(body),
      );
      await page.goto("/app/academic-years", { waitUntil: "domcontentloaded" });
      body = await page.locator("tbody").innerText().catch(() => "");
      check(
        "années : statuts traduits (pas de DRAFT/CLOSED bruts)",
        !/^\s*(DRAFT|CLOSED)\s*$/m.test(body),
      );

      // Lien Retour sur une fiche élève (id via l'UI).
      await page.goto("/app/students", { waitUntil: "domcontentloaded" });
      const detail = page.locator('tbody a[href^="/app/students/"]').first();
      const href = await detail.getAttribute("href");
      if (href) {
        await page.goto(href, { waitUntil: "domcontentloaded" });
        const retour = page.locator('a[href="/app/students"]').filter({ hasText: /retour/i });
        check("fiche élève : lien Retour → /app/students", (await retour.count()) > 0);
      } else {
        check("fiche élève : lien Retour", false, "aucun élève trouvé");
      }

      // 404 française.
      await page.goto("/app/chemin-inexistant-p6a", { waitUntil: "domcontentloaded" });
      check(
        "404 française sous /app",
        await page.getByRole("heading", { name: "Page introuvable" }).isVisible().catch(() => false),
      );
      await page.close();
    } catch (e) {
      check("desktop admin", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- DESKTOP : caissier ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    try {
      const page = await login(ctx, "caissier@demo.local");
      await page.goto("/app/fees", { waitUntil: "domcontentloaded" });
      check(
        "caissier : « Comptes élèves » visible",
        (await page.getByRole("link", { name: "Comptes élèves", exact: true }).count()) === 1,
      );
      for (const name of ["Journal des paiements", "Impayés", "Configuration"]) {
        check(
          `caissier : « ${name} » absent`,
          (await page.getByRole("link", { name, exact: true }).count()) === 0,
        );
      }
      await page.screenshot({ path: `${SHOTS}/desktop-fees-cashier.png`, fullPage: true });

      // Compteurs finances visibles (finance.read légitime) mais pas de
      // liens vers les rapports interdits.
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();
      check("caissier : dashboard sans « Module à venir »", !/Module à venir/i.test(body));

      // 403 française.
      await page.goto("/app/users", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      check(
        "caissier → /app/users : page 403 française",
        page.url().includes("/app/forbidden") &&
          (await page.getByRole("heading", { name: "Accès refusé" }).count()) === 1,
        page.url(),
      );
      await page.screenshot({ path: `${SHOTS}/desktop-forbidden.png`, fullPage: true });
      // Accès directs aux pages finance hors permission.
      for (const path of ["/app/fees/payments", "/app/fees/unpaid", "/app/fees/settings"]) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(600);
        check(
          `caissier → ${path} : refusé`,
          !page.url().startsWith(BASE + path),
          page.url(),
        );
      }
      await page.close();
    } catch (e) {
      check("desktop caissier", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- DESKTOP : responsable financier ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    try {
      const page = await login(ctx, "finance@demo.local");
      await page.goto("/app/fees", { waitUntil: "domcontentloaded" });
      for (const name of ["Journal des paiements", "Impayés"]) {
        check(
          `finance : « ${name} » visible`,
          (await page.getByRole("link", { name, exact: true }).count()) === 1,
        );
      }
      await page.close();
    } catch (e) {
      check("desktop finance", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- DESKTOP : enseignant (dashboard sans finances) ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    try {
      const page = await login(ctx, "enseignant@demo.local");
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();
      check(
        "enseignant : aucune donnée financière au dashboard",
        !/Encaissé|Solde restant/.test(body),
      );
      await page.close();
    } catch (e) {
      check("desktop enseignant", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- PLATFORM_SALES : 403 plateforme ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    try {
      const page = await login(ctx, "commercial@ecom-school.local");
      await page.goto("/platform/schools", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      check(
        "sales → /platform/schools : 403 française",
        page.url().includes("/platform/forbidden") &&
          (await page.getByRole("heading", { name: "Accès refusé" }).count()) === 1,
        page.url(),
      );
      await page.close();
    } catch (e) {
      check("sales 403", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- NON-RÉGRESSION P5 : endpoints export/import ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    try {
      const page = await login(ctx, "admin@demo.local");
      const endpoints: [string, RegExp | null][] = [
        ["/app/students/export?format=csv", /csv/],
        ["/app/students/export?format=xlsx", /spreadsheet|octet/],
        ["/app/students/import/template?format=csv", /csv/],
        ["/app/enrollments/export?format=csv", /csv/],
        ["/app/teachers/export?format=csv", /csv/],
        ["/app/fees/payments/export?format=csv", /csv/],
        ["/app/report-cards/export?format=csv", /csv/],
      ];
      for (const [path, ct] of endpoints) {
        const res = await ctx.request.get(`${BASE}${path}`, { maxRedirects: 0 });
        const ok =
          res.status() === 200 &&
          (!ct || ct.test(res.headers()["content-type"] ?? ""));
        check(`endpoint ${path}`, ok, `HTTP ${res.status()} ${res.headers()["content-type"] ?? ""}`);
      }
      // Impayés : le paramètre year est obligatoire — on reprend le lien
      // d'export réel affiché sur la page (contient l'année courante).
      await page.goto("/app/fees/unpaid", { waitUntil: "domcontentloaded" });
      const unpaidHref = await page
        .locator('a[href*="/app/fees/unpaid/export"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (unpaidHref) {
        const res = await ctx.request.get(`${BASE}${unpaidHref}`, { maxRedirects: 0 });
        check("endpoint impayés (lien réel de la page)", res.status() === 200, `HTTP ${res.status()} ${unpaidHref}`);
      } else {
        check("endpoint impayés (lien réel de la page)", false, "lien d'export introuvable");
      }
      // Modèle notes : id récupéré via la liste des évaluations.
      await page.goto("/app/grades", { waitUntil: "domcontentloaded" });
      const gradeLink = await page
        .locator('a[href^="/app/grades/"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (gradeLink) {
        const res = await ctx.request.get(`${BASE}${gradeLink}/import/template?format=csv`, {
          maxRedirects: 0,
        });
        check("modèle d'import notes servi", res.status() === 200, `HTTP ${res.status()}`);
      } else {
        check("modèle d'import notes servi", false, "aucune évaluation trouvée");
      }
      // Liens assistant/export sur la page élèves.
      await page.goto("/app/students", { waitUntil: "domcontentloaded" });
      check(
        "page élèves : lien assistant d'import",
        (await page.getByRole("link", { name: /assistant d.import/i }).count()) === 1,
      );
      await page.close();
    } catch (e) {
      check("non-régression P5", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- Portails parent / élève ----------
  for (const [email, path, label] of [
    ["parent@demo.local", "/parent", "portail parent"],
    ["eleve@demo.local", "/student", "portail élève"],
  ] as const) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: MOBILE });
    try {
      const page = await login(ctx, email);
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      check(`${label} : chargé`, res?.status() === 200, `HTTP ${res?.status()}`);
      await page.close();
    } catch (e) {
      check(label, false, String(e).slice(0, 120));
    }
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== RECETTE P6a PREPROD : ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("RECETTE ÉCHOUÉE:", e);
  process.exit(1);
});
