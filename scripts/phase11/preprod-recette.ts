import "dotenv/config";
import { chromium, type Page, type BrowserContext } from "@playwright/test";

/**
 * Recette réelle de préproduction (https://preprod.ecomschool.fr).
 * Ne supprime aucune donnée ; ne soumet qu'une demande d'inscription FICTIVE.
 * Mot de passe démo via SEED_DEMO_PASSWORD (jamais codé en dur).
 * Usage : E2E_BASE_URL=https://preprod.ecomschool.fr npx tsx scripts/phase11/preprod-recette.ts
 */

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.SEED_DEMO_PASSWORD;
const OTHER_RC = process.env.OTHER_REPORTCARD_ID ?? "";

if (!PW) {
  console.error("SEED_DEMO_PASSWORD manquant — arrêt.");
  process.exit(1);
}

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const ACCOUNTS: { email: string; portal: string; expectText?: RegExp }[] = [
  { email: "admin@demo.local", portal: "/app", expectText: /démo ecom/i },
  { email: "enseignant@demo.local", portal: "/teacher" },
  { email: "finance@demo.local", portal: "/app" },
  { email: "caissier@demo.local", portal: "/app" },
  { email: "parent@demo.local", portal: "/parent" },
  { email: "eleve@demo.local", portal: "/student" },
  { email: "commercial@ecom-school.local", portal: "/platform" },
];

async function login(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

/** Renvoie true si l'accès est refusé (redirection ou 404). */
async function denied(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
  const url = page.url();
  if (!url.startsWith(BASE + path)) return true; // redirigé ailleurs
  const body = await page.locator("body").innerText();
  return /404|not found|introuvable|accès refusé|non autorisé/i.test(body);
}

async function main() {
  const browser = await chromium.launch();

  // ---------- Public ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    const res = await page.goto("/", { waitUntil: "networkidle" });
    check("GET / anonyme", res?.status() === 200, `HTTP ${res?.status()}`);
    check(
      "hero présent",
      await page.getByRole("heading", { level: 1 }).isVisible(),
    );
    check(
      "CTA Inscrire mon établissement",
      (await page.getByRole("link", { name: /inscrire mon établissement/i }).count()) > 0,
    );
    // Carrousel
    const nextBtn = page.getByRole("button", { name: /suivant|next/i }).first();
    check("carrousel : bouton suivant", await nextBtn.isVisible().catch(() => false));
    check(
      "aucune erreur console (landing)",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(" | ") || undefined,
    );

    await page.goto("/tarifs", { waitUntil: "networkidle" });
    const planLinks = await page.locator('a[href^="/inscription?plan="]').count();
    check("/tarifs : 3 formules commerciales", planLinks === 3, `${planLinks} cartes`);
    check(
      "/tarifs : aucun badge « Recommandé »",
      (await page.getByText(/recommand/i).count()) === 0,
    );

    // Soumission réelle d'une demande fictive
    await page.goto("/inscription?plan=PROFESSIONNEL", { waitUntil: "networkidle" });
    await page.locator("#schoolName").fill("Lycée Horizon Recette (fictif)");
    await page.locator("#city").fill("Ouagadougou");
    await page.locator("#phone").fill("+226 70 00 00 00");
    await page.locator("#email").fill("contact@lycee-horizon-recette.test");
    await page.locator("#contactName").fill("Directeur Recette");
    await page.locator("#contactEmail").fill("directeur@lycee-horizon-recette.test");
    await page.locator("#note").fill("Demande de recette préproduction — données fictives.");
    await page.getByRole("button", { name: /envoyer|soumettre|inscription/i }).last().click();
    await page.waitForTimeout(2500);
    const confirmVisible = await page
      .getByText(/reçue|confirm|merci|enregistr/i)
      .first()
      .isVisible()
      .catch(() => false);
    check("/inscription : demande fictive soumise + confirmation", confirmVisible);
    await ctx.close();
  }

  // ---------- Comptes démo ----------
  for (const acc of ACCOUNTS) {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, acc.email);
      // Post-login : / est publique → on clique « Mon espace » (header)
      // pour rejoindre le portail, parcours réel de l'utilisateur connecté.
      if (!page.url().startsWith(BASE + acc.portal)) {
        const espace = page.getByRole("link", { name: /mon espace/i }).first();
        await espace.click();
        await page.waitForURL((u) => u.pathname.startsWith(acc.portal), {
          timeout: 30_000,
        });
      }
      const url = page.url();
      check(`login ${acc.email} → Mon espace → ${acc.portal}`, url.startsWith(BASE + acc.portal), url);
      if (acc.expectText) {
        check(
          `${acc.email} : contenu attendu`,
          (await page.getByText(acc.expectText).count()) > 0,
        );
      }
      // Landing accessible sans redirection quand connecté
      await page.goto("/", { waitUntil: "domcontentloaded" });
      check(
        `${acc.email} : / reste public`,
        new URL(page.url()).pathname === "/",
      );
      await page.close();
    } catch (e) {
      check(`login ${acc.email}`, false, String(e).slice(0, 120));
    }
    await ctx.close();
  }

  // ---------- Refus de permissions ----------
  const probes: { email: string; path: string; label: string }[] = [
    { email: "commercial@ecom-school.local", path: "/app", label: "sales → /app refusé" },
    { email: "commercial@ecom-school.local", path: "/platform/schools", label: "sales → /platform/schools refusé" },
    { email: "commercial@ecom-school.local", path: "/platform/signup-requests", label: "sales → /platform/signup-requests refusé" },
    { email: "commercial@ecom-school.local", path: "/platform/administrators", label: "sales → /platform/administrators refusé" },
    { email: "enseignant@demo.local", path: "/app/users", label: "teacher → /app/users refusé" },
    { email: "enseignant@demo.local", path: "/app/fees", label: "teacher → /app/fees refusé" },
    { email: "caissier@demo.local", path: "/app/fees/settings", label: "cashier → /app/fees/settings refusé" },
    { email: "parent@demo.local", path: "/app/users", label: "parent → /app/users refusé" },
    { email: "eleve@demo.local", path: "/app/students", label: "student → /app/students refusé" },
    { email: "admin@demo.local", path: "/platform", label: "admin école → /platform refusé" },
  ];
  // Regrouper les sondes par compte (une session par compte)
  const byAccount = new Map<string, typeof probes>();
  for (const p of probes) {
    const arr = byAccount.get(p.email) ?? [];
    arr.push(p);
    byAccount.set(p.email, arr);
  }
  for (const [email, list] of byAccount) {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, email);
      for (const p of list) {
        check(p.label, await denied(page, p.path));
      }
      // Isolation intra-école : bulletin d'un élève non rattaché
      if (email === "parent@demo.local" && OTHER_RC) {
        const res = await ctx.request.get(`${BASE}/parent/report-cards/${OTHER_RC}/pdf`);
        check(
          "parent → bulletin élève non rattaché refusé",
          res.status() === 403 || res.status() === 404,
          `HTTP ${res.status()}`,
        );
      }
      await page.close();
    } catch (e) {
      for (const p of list) check(p.label, false, String(e).slice(0, 100));
    }
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== RECETTE PREPROD : ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("RECETTE ÉCHOUÉE:", e);
  process.exit(1);
});
