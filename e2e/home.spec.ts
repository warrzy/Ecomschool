import { test, expect } from "@playwright/test";

/**
 * E2E — landing page commerciale `/`.
 * Couvre : accès public et authentifié (sans redirection), « Mon espace »,
 * navigation vers /tarifs et /inscription, ancres, onglets personas,
 * carrousel, FAQ, plans réellement commercialisables, mobile et
 * prefers-reduced-motion.
 */

test.describe("Landing page /", () => {
  test("accessible anonymement, sans redirection", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    expect(page.url()).toMatch(/\/$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /pilotez votre établissement scolaire/i,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: /se connecter/i }),
    ).toBeVisible();
  });

  test("connecté (école) : / reste affichée, « Mon espace » → /app", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: "e2e/.auth/demoAdmin.json",
    });
    const page = await ctx.newPage();
    await page.goto("/");
    expect(page.url()).toMatch(/\/$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /pilotez votre établissement/i,
      }),
    ).toBeVisible();
    const espace = page.getByRole("link", { name: /mon espace/i });
    await expect(espace).toBeVisible();
    await expect(espace).toHaveAttribute("href", "/app");
    await ctx.close();
  });

  test("connecté (plateforme) : « Mon espace » → /platform", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: "e2e/.auth/platform.json",
    });
    const page = await ctx.newPage();
    await page.goto("/");
    const espace = page.getByRole("link", { name: /mon espace/i });
    await expect(espace).toBeVisible();
    await expect(espace).toHaveAttribute("href", "/platform");
    await ctx.close();
  });

  test("CTA hero → /inscription, lien comparer → /tarifs", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /inscrire mon établissement/i })
      .first()
      .click();
    await page.waitForURL(/\/inscription/);
    await page.goto("/");
    await page
      .getByRole("link", { name: /comparer les offres/i })
      .click();
    await page.waitForURL(/\/tarifs/);
  });

  test("ancre « Découvrir les fonctionnalités » → section visible", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /découvrir les fonctionnalités/i })
      .click();
    await expect(page.locator("#fonctionnalites")).toBeInViewport();
    await expect(
      page.getByRole("heading", {
        name: /tous les modules dont votre établissement/i,
      }),
    ).toBeVisible();
  });

  test("teaser tarifs : seules les formules commerciales, sans « Recommandé »", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.locator("#tarifs");
    await section.scrollIntoViewIfNeeded();
    for (const name of ["Essentiel", "Professionnel", "Premium"]) {
      await expect(
        section.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    // Aucun plan technique P8-*/P9-* affiché.
    await expect(section.getByText(/P[89]-/)).toHaveCount(0);
    // Pas de badge arbitraire.
    await expect(page.getByText(/recommandé/i)).toHaveCount(0);
  });

  test("onglets personas : bascule admin → parent", async ({ page }) => {
    await page.goto("/");
    await page.locator("#profils").scrollIntoViewIfNeeded();
    await expect(
      page.getByText(/pilotez tout l'établissement/i),
    ).toBeVisible();
    await page.getByRole("tab", { name: /parent/i }).click();
    await expect(
      page.getByText(/suivez la scolarité de vos enfants/i),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /parent/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("carrousel : navigation suivant/précédent", async ({ page }) => {
    await page.goto("/");
    await page.locator("#apercu").scrollIntoViewIfNeeded();
    const next = page.getByRole("button", { name: /capture suivante/i });
    const prev = page.getByRole("button", { name: /capture précédente/i });
    await expect(prev).toBeDisabled();
    await next.click();
    await expect(prev).toBeEnabled();
    await prev.click();
    await expect(prev).toBeDisabled();
  });

  test("FAQ : accordéon accessible", async ({ page }) => {
    await page.goto("/");
    await page.locator("#faq").scrollIntoViewIfNeeded();
    const q = page.getByRole("button", {
      name: /le paiement se fait-il en ligne/i,
    });
    await q.click();
    await expect(q).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText(/aucun paiement en ligne|s'effectue directement/i).first(),
    ).toBeVisible();
  });

  test("mobile : hero et CTA utilisables", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 800 },
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /pilotez votre établissement/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /inscrire mon établissement/i }).first(),
    ).toBeVisible();
    await ctx.close();
  });

  test("prefers-reduced-motion : contenu visible sans animation", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    // Les blocs reveal doivent être visibles immédiatement (CSS force opacity 1).
    await page.locator("#fonctionnalites").scrollIntoViewIfNeeded();
    const heading = page.getByRole("heading", {
      name: /tous les modules dont votre établissement/i,
    });
    await expect(heading).toBeVisible();
    const opacity = await heading.evaluate(
      (el) => getComputedStyle(el).opacity,
    );
    expect(opacity).toBe("1");
    await ctx.close();
  });

  test("footer : liens produit et contact présents", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(
      footer.getByRole("link", { name: /fonctionnalités/i }),
    ).toBeVisible();
    await expect(
      footer.getByRole("link", { name: /^tarifs$/i }),
    ).toBeVisible();
    await expect(
      footer.getByRole("link", { name: /inscrire mon établissement/i }),
    ).toBeVisible();
    await expect(footer.getByText(/ECOM-TOUCH/i).first()).toBeVisible();
  });
});
