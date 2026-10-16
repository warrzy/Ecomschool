import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

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
      page
        .locator("main")
        .getByRole("heading", { name: /règles de notation/i })
        .first(),
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
    await page.getByRole("button", { name: /enregistrer et activer|enregistrer \(nouvelle version\)/i }).click();
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
    await page.getByRole("button", { name: /enregistrer et activer|enregistrer \(nouvelle version\)/i }).click();
    await page.waitForURL(/error=INVALID_WEIGHTS/);
    await expect(page.getByText(/pondération annuelle invalide/i)).toBeVisible();
  });

  test("seuil de réussite > barème → message compréhensible", async ({
    page,
  }) => {
    await page.goto("/app/grading-policy");
    await page.getByLabel(/année scolaire/i).selectOption({ index: 1 });
    await page.getByLabel(/^barème/i).fill("20");
    await page.getByLabel(/seuil de réussite/i).fill("25");
    await page.getByRole("button", { name: /enregistrer et activer|enregistrer \(nouvelle version\)/i }).click();
    await page.waitForURL(/error=SEUIL_RANGE/);
    await expect(
      page.getByText(/seuil de réussite incohérent/i),
    ).toBeVisible();
  });

  test("note minimale ≥ barème → message compréhensible", async ({ page }) => {
    await page.goto("/app/grading-policy");
    await page.getByLabel(/année scolaire/i).selectOption({ index: 1 });
    await page.getByLabel(/^barème/i).fill("20");
    await page.getByLabel(/note minimale/i).fill("20");
    await page.getByRole("button", { name: /enregistrer et activer|enregistrer \(nouvelle version\)/i }).click();
    await page.waitForURL(/error=MIN_GE_MAX/);
    await expect(page.getByText(/barème incohérent/i)).toBeVisible();
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

  test("« Modifier » préremplit le formulaire avec la politique existante", async ({
    page,
  }) => {
    await page.goto("/app/grading-policy");
    const activeRow = page.locator("tbody tr", {
      has: page.locator("span", { hasText: /^Active$/ }),
    }).first();
    const editLink = activeRow.getByRole("link", { name: /^modifier$/i });
    if ((await editLink.count()) === 0) test.skip();
    await editLink.click();
    await page.waitForURL(/edit=(.+)/);
    const policyId = new URL(page.url()).searchParams.get("edit")!;
    const policy = await prisma.gradingPolicy.findUniqueOrThrow({
      where: { id: policyId },
    });
    // Bandeau d'édition + formulaire prérempli avec les valeurs réelles
    await expect(page.getByText(/chargée \(v\d+\)/)).toBeVisible();
    await expect(page.getByLabel(/^barème/i)).toHaveValue(
      String(policy.maxScore),
    );
    await expect(page.getByLabel(/seuil de réussite/i)).toHaveValue(
      String(policy.passMark),
    );
    await expect(page.getByLabel(/année scolaire/i)).toHaveValue(
      policy.academicYearId,
    );
  });

  test("enregistrer sans changement → aucune nouvelle version", async ({
    page,
  }) => {
    await page.goto("/app/grading-policy");
    const activeRow = page.locator("tbody tr", {
      has: page.locator("span", { hasText: /^Active$/ }),
    }).first();
    const editLink = activeRow.getByRole("link", { name: /^modifier$/i });
    if ((await editLink.count()) === 0) test.skip();
    await editLink.click();
    await page.waitForURL(/edit=/);
    // Capturer la version affichée puis soumettre sans rien changer
    const banner = await page.getByText(/chargée \(v\d+\)/).textContent();
    await page.getByRole("button", { name: /enregistrer et activer|enregistrer \(nouvelle version\)/i }).click();
    await page.waitForURL(/ok=unchanged/);
    await expect(
      page.getByText(/aucune modification détectée/i),
    ).toBeVisible();
    // La version n'a pas bougé
    await editLink.click();
    await page.waitForURL(/edit=/);
    await expect(page.getByText(/chargée \(v\d+\)/)).toHaveText(banner ?? "");
  });

  test("cycle de vie : brouillon → activation avec remplacement → archivage → réactivation", async ({
    page,
  }) => {
    await page.goto("/app/grading-policy");

    // Le périmètre de la politique existante (première ligne du tableau)
    if ((await page.getByRole("link", { name: /modifier|consulter/i }).count()) === 0) {
      test.skip();
    }
    const firstRow = page.locator("tbody tr").first();
    const yearCell = (await firstRow.locator("td").first().textContent())?.trim() ?? "";
    const levelCell =
      (await firstRow.locator("td").nth(1).textContent())?.trim() ?? "";
    const isDefault = /tous/i.test(levelCell);

    // École du compte connecté (admin@demo.local)
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo.local" },
      select: { id: true },
    });
    const schoolId = (
      await prisma.schoolMembership.findFirstOrThrow({
        where: { userId: admin.id },
        select: { schoolId: true },
      })
    ).schoolId;
    const year = await prisma.academicYear.findFirstOrThrow({
      where: { name: yearCell, schoolId },
      select: { id: true },
    });
    const level = isDefault
      ? null
      : await prisma.level.findFirstOrThrow({
          where: { name: levelCell, schoolId },
          select: { id: true },
        });
    const scope = {
      schoolId,
      academicYearId: year.id,
      levelId: level?.id ?? null,
    };

    // 1. Créer un brouillon sur le même périmètre
    const yearSelect = page.getByLabel(/année scolaire/i);
    const yearOption = await yearSelect
      .locator("option")
      .evaluateAll(
        (opts, name) =>
          opts
            .find((o) => o.textContent?.trim().startsWith(name))
            ?.getAttribute("value") ?? "",
        yearCell,
      );
    await yearSelect.selectOption(yearOption);
    if (!isDefault) {
      await page.getByLabel(/niveau/i).selectOption({ label: levelCell });
    }
    await page.getByLabel(/seuil de réussite/i).fill("11");
    await page
      .getByRole("button", { name: /enregistrer comme brouillon/i })
      .click();
    await page.waitForURL(/ok=draft/);
    await expect(
      page.getByText(/brouillon enregistré/i),
    ).toBeVisible();

    const draft = await prisma.gradingPolicy.findFirstOrThrow({
      where: { ...scope, status: "DRAFT" },
    });
    const activeBefore = await prisma.gradingPolicy.findFirstOrThrow({
      where: { ...scope, status: "ACTIVE" },
    });
    expect(draft.id).not.toBe(activeBefore.id);

    // 2. Activer le brouillon → confirmation nommant la politique remplacée
    const draftRow = page.locator("tbody tr", { hasText: "Brouillon" }).first();
    await draftRow.getByRole("button", { name: /^activer$/i }).click();
    await page.waitForURL(/confirm=activate/);
    await expect(
      page.getByText(/archivera la politique actuellement active/i),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /confirmer l.activation/i })
      .click();
    await page.waitForURL(/ok=activated/);

    // Unicité : l'ancienne est archivée, une seule active reste
    const counts = await prisma.gradingPolicy.groupBy({
      by: ["status"],
      where: scope,
      _count: true,
    });
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    expect(byStatus.ACTIVE).toBe(1);
    expect((await prisma.gradingPolicy.findUnique({ where: { id: activeBefore.id } }))?.status).toBe("ARCHIVED");

    // 3. Archiver → confirmation avec règle de relais
    const activeRow = page.locator("tbody tr", {
      has: page.locator("span", { hasText: /^Active$/ }),
    }).first();
    await activeRow.getByRole("link", { name: /archiver/i }).click();
    await page.waitForURL(/confirm=archive/);
    await expect(
      page.locator("li", { hasText: /règle qui prendra le relais/i }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /confirmer l.archivage/i })
      .click();
    await page.waitForURL(/ok=archived/);
    expect(
      (await prisma.gradingPolicy.findUnique({ where: { id: draft.id } }))?.status,
    ).toBe("ARCHIVED");

    // 4. Réactiver la politique d'origine (restauration). On passe par le
    // panneau de confirmation ciblé par id : plusieurs lignes archivées
    // peuvent partager le même numéro de version.
    await page.goto(
      `/app/grading-policy?confirm=activate&id=${activeBefore.id}`,
    );
    await expect(
      page.getByText(/confirmer l.activation/i).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /confirmer l.activation/i })
      .click();
    await page.waitForURL(/ok=activated/);
    expect(
      (await prisma.gradingPolicy.findUnique({ where: { id: activeBefore.id } }))
        ?.status,
    ).toBe("ACTIVE");
  });
});

test.describe("Règles de notation — accès restreint", () => {
  test.use({ storageState: "e2e/.auth/demoTeacher.json" });

  test("l'enseignant n'a pas accès à la page", async ({ page }) => {
    await page.goto("/app/grading-policy");
    // Accès refusé : page 403 explicite (ou retour /app).
    await page.waitForURL(/\/app(\/forbidden|\?|$)/, { timeout: 30000 });
    expect(page.url()).not.toContain("grading-policy");
  });
});
