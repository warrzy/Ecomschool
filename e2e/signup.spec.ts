import { test, expect, type Page } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * E2E — parcours public d'inscription : /tarifs → /inscription → PENDING.
 * Vérifie aussi les protections : honeypot, throttle IP, anti-doublon,
 * aucune création School/User, consultation plateforme.
 */

const TAG = `E2E${Date.now().toString(36)}`;

async function fillForm(page: Page, data: {
  schoolName: string;
  contactEmail: string;
  contactName?: string;
}) {
  await page.getByLabel(/nom de l'établissement/i).fill(data.schoolName);
  await page.getByLabel(/ville/i).fill("Ouagadougou");
  await page.getByLabel(/nom complet/i).fill(data.contactName ?? "Resp Test");
  await page
    .locator("#contactEmail")
    .fill(data.contactEmail);
  await page.getByLabel(/téléphone/i).first().fill("70000000");
}

test.describe("Parcours public d'inscription", () => {
  test.afterAll(async () => {
    await prisma.schoolSignupRequest.deleteMany({
      where: { contactEmail: { contains: TAG.toLowerCase() } },
    });
    await prisma.$disconnect();
  });

  test.describe.configure({ mode: "serial" });

  test("tarifs : page publique avec les plans réels", async ({ page }) => {
    const res = await page.goto("/tarifs");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /tarifs/i })).toBeVisible();
    // Les 3 formules réelles de la base.
    for (const name of ["Essentiel", "Professionnel", "Premium"]) {
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByText(/F CFA/).first()).toBeVisible();
    await expect(page.getByText(/\/mois/).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /choisir cette formule/i }).first(),
    ).toBeVisible();
  });

  test("choisir une formule → inscription présélectionnée", async ({ page }) => {
    await page.goto("/tarifs");
    await page
      .locator('a[href="/inscription?plan=PROFESSIONNEL"]')
      .click();
    await page.waitForURL(/\/inscription\?plan=PROFESSIONNEL/);
    await expect(page.locator("#planCode")).toHaveValue("PROFESSIONNEL");
  });

  test("soumission valide → PENDING, aucun School/User créé", async ({
    page,
  }) => {
    const email = `${TAG}-valid@test.local`.toLowerCase();
    const [schoolsBefore, usersBefore] = await Promise.all([
      prisma.school.count(),
      prisma.user.count(),
    ]);

    await page.goto("/inscription");
    await fillForm(page, { schoolName: `École ${TAG}`, contactEmail: email });
    await page.locator("#planCode").selectOption("PREMIUM");
    await page.getByRole("button", { name: /envoyer ma demande/i }).click();
    await expect(page.getByText(/demande envoyée/i)).toBeVisible({
      timeout: 30_000,
    });

    const req = await prisma.schoolSignupRequest.findFirst({
      where: { contactEmail: email },
      include: { requestedPlan: true },
    });
    expect(req, "demande enregistrée").toBeTruthy();
    expect(req!.status).toBe("PENDING");
    expect(req!.requestedPlan?.code, "plan demandé conservé").toBe("PREMIUM");

    expect(await prisma.school.count(), "aucun School créé").toBe(schoolsBefore);
    expect(await prisma.user.count(), "aucun User créé").toBe(usersBefore);
  });

  test("email responsable invalide → erreur ciblée", async ({ page }) => {
    await page.goto("/inscription");
    await fillForm(page, {
      schoolName: `École ${TAG} Inv`,
      contactEmail: "pas-un-email",
    });
    // Court-circuite la validation HTML5 pour atteindre la validation serveur.
    await page.locator("#contactEmail").evaluate((el) => el.removeAttribute("type"));
    await page.getByRole("button", { name: /envoyer ma demande/i }).click();
    await expect(page.getByText(/contactEmail/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("anti-doublon : même email → DUPLICATE", async ({ page }) => {
    const email = `${TAG}-valid@test.local`.toLowerCase();
    await page.goto("/inscription");
    await fillForm(page, {
      schoolName: `École ${TAG} Bis`,
      contactEmail: email,
    });
    await page.getByRole("button", { name: /envoyer ma demande/i }).click();
    await expect(page.getByText(/déjà en cours/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("honeypot rempli → faux succès, aucun enregistrement", async ({
    page,
  }) => {
    const email = `${TAG}-bot@test.local`.toLowerCase();
    await page.goto("/inscription");
    await fillForm(page, {
      schoolName: `École ${TAG} Bot`,
      contactEmail: email,
    });
    // Le honeypot est hors écran : injecter la valeur côté DOM (comme un bot).
    await page
      .locator("#companyUrl")
      .evaluate((el) => ((el as HTMLInputElement).value = "https://spam.example"));
    await page.getByRole("button", { name: /envoyer ma demande/i }).click();
    await expect(page.getByText(/demande envoyée/i)).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await prisma.schoolSignupRequest.count({ where: { contactEmail: email } }),
      "aucun enregistrement pour le bot",
    ).toBe(0);
  });

  test("demande PENDING visible dans /platform/signup-requests", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: "e2e/.auth/platform.json",
    });
    const page = await ctx.newPage();
    await page.goto("/platform/signup-requests?status=PENDING");
    await expect(page.getByText(`École ${TAG}`, { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Premium", { exact: true }).first()).toBeVisible();
    await ctx.close();
  });

  test("/platform/signup-requests protégé pour un anonyme", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/platform/signup-requests");
    await page.waitForURL(/\/login/, { timeout: 60_000 });
    expect(page.url()).toContain("/login");
    await ctx.close();
  });

  // DERNIER test : épuise le throttle mémoire (5/30 s par IP).
  test("throttle : rafale de soumissions → RATE_LIMITED", async ({ page }) => {
    let limited = false;
    for (let i = 0; i < 8 && !limited; i++) {
      await page.goto("/inscription");
      await fillForm(page, {
        schoolName: `École ${TAG} Flood${i}`,
        contactEmail: `${TAG}-f${i}@test.local`.toLowerCase(),
      });
      await page.getByRole("button", { name: /envoyer ma demande/i }).click();
      const msg = page.getByText(/trop de demandes|demande envoyée/i);
      await expect(msg.first()).toBeVisible({ timeout: 30_000 });
      limited = await page.getByText(/trop de demandes/i).isVisible();
    }
    expect(limited, "le throttle IP a bloqué la rafale").toBe(true);
  });
});
