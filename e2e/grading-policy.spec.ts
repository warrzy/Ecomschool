import { test, expect } from "@playwright/test";

/**
 * P3 — interface des règles de notation.
 * Vérifie la structure du formulaire, la notice intégrée, les erreurs
 * compréhensibles et l'affichage de la liste des politiques.
 */
test.describe("Règles de notation — interface", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("le formulaire est sectionné et les champs libellés", async ({ page }) => {
    await page.goto("/app/grading-policy");
    await expect(
      page.getByRole("heading", { name: /règles de notation/i }).or(
        page.getByText("Règles de notation", { exact: true }).first(),
      ),
    ).toBeVisible();

    // Sections
    for (const s of [
      "Portée",
      "Barème, seuil et arrondi",
      "Notes non saisies",
      "Classement",
      "Mentions et pondération annuelle",
    ]) {
      await expect(page.getByText(s, { exact: true })).toBeVisible();
    }

    // Libellés reliés aux champs (accessibilité)
    await expect(page.getByLabel(/année scolaire/i)).toBeVisible();
    await expect(page.getByLabel(/^barème/i)).toBeVisible();
    await expect(page.getByLabel(/seuil de réussite/i)).toBeVisible();
    await expect(page.getByLabel(/^mentions/i)).toBeVisible();
    await expect(page.getByLabel(/pondération annuelle/i)).toBeVisible();
  });

  test("le bouton notice est présent et la notice s'ouvre", async ({ page }) => {
    await page.goto("/app/grading-policy");
    const link = page.getByRole("link", {
      name: /comment fonctionnent les règles de notation/i,
    });
    await expect(link).toBeVisible();
    await link.click();
    const notice = page.locator("details#notice");
    // Le résumé est le bouton qui ouvre la notice
    await notice.locator("summary").click();
    await expect(notice).toHaveAttribute("open", "");
    // Contenu de la notice : concepts réels du moteur
    for (const concept of [
      "Portée et priorité",
      "Barème et coefficients",
      "Arrondi et décimales",
      "Notes manquantes, absences et dispenses",
      "Seuil de réussite",
      "Classement et ex æquo",
      "Mentions",
      "Pondération annuelle",
      "Versions et historique",
    ]) {
      await expect(notice.getByText(concept, { exact: true })).toBeVisible();
    }
  });

  test("format de mentions invalide → message compréhensible", async ({ page }) => {
    await page.goto("/app/grading-policy");
    await page.getByLabel(/année scolaire/i).selectOption({ index: 1 });
    await page.getByLabel(/^mentions/i).fill("format-incorrect-sans-deux-points");
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await page.waitForURL(/error=INVALID_MENTIONS/);
    await expect(
      page.getByText(/format des mentions invalide/i),
    ).toContainText(/libellé:seuil/i);
  });

  test("pondération avec période inconnue → message compréhensible", async ({
    page,
  }) => {
    await page.goto("/app/grading-policy");
    await page.getByLabel(/année scolaire/i).selectOption({ index: 1 });
    await page.getByLabel(/pondération annuelle/i).fill("Période inexistante:2");
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await page.waitForURL(/error=INVALID_WEIGHTS/);
    await expect(page.getByText(/pondération annuelle invalide/i)).toBeVisible();
  });

  test("la liste affiche les politiques avec statut et version", async ({
    page,
  }) => {
    await page.goto("/app/grading-policy");
    await expect(page.getByText("Politiques configurées")).toBeVisible();
    // Soit des politiques avec badge Active, soit l'état vide documenté
    const badge = page.locator("tbody span", { hasText: "Active" });
    const empty = page.getByText(/règles par défaut s.appliquent/i);
    const hasBadge = (await badge.count()) > 0;
    if (hasBadge) {
      await expect(badge.first()).toBeVisible();
      await expect(page.getByText(/^v\d+$/).first()).toBeVisible();
    } else {
      await expect(empty).toBeVisible();
    }
  });
});

test.describe("Règles de notation — accès restreint", () => {
  test.use({ storageState: "e2e/.auth/demoTeacher.json" });

  test("l'enseignant n'a pas accès à la page", async ({ page }) => {
    await page.goto("/app/grading-policy");
    await page.waitForURL(/\/app(\?|$)/, { timeout: 30000 });
    expect(page.url()).not.toContain("grading-policy");
  });
});
