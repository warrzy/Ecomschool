import { test, expect, type Page } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * P6a — Navigation mobile, libellés français, pages système.
 *
 * Vérifie le composant MobileNav partagé (ouverture, Échap, focus,
 * scroll-lock, filtrage RBAC), la traduction des codes d'erreur et des
 * statuts, les pages 403/404, et la non-régression des liens P5.
 */

const MOBILE = { width: 390, height: 844 };

// Le nom accessible bascule « Ouvrir » ↔ « Fermer » : localisation stable
// par aria-controls.
const menuButton = (page: Page) =>
  page.locator('button[aria-controls="mobile-nav-panel"]');
const navPanel = (page: Page) =>
  page.getByRole("dialog", { name: /navigation principale/i });

async function expectMobileMenuFlow(page: Page, url: string) {
  await page.setViewportSize(MOBILE);
  await page.goto(url);

  const trigger = menuButton(page);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  const panel = navPanel(page);
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // Le défilement du contenu est bloqué tant que le panneau est ouvert.
  await expect
    .poll(async () =>
      page.evaluate(() => document.body.style.overflow),
    )
    .toBe("hidden");

  // Le focus entre dans le panneau à l'ouverture.
  const focusedInPanel = await page.evaluate(
    () =>
      !!document.activeElement &&
      document
        .getElementById("mobile-nav-panel")
        ?.contains(document.activeElement),
  );
  expect(focusedInPanel).toBe(true);

  // Échap ferme et rend le focus au bouton déclencheur.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Réouverture : la sélection d'un lien ferme le panneau et navigue.
  await trigger.click();
  await expect(navPanel(page)).toBeVisible();
  const firstLink = navPanel(page).getByRole("link").first();
  await firstLink.click();
  await expect(navPanel(page)).toHaveCount(0);
}

test.describe("P6a — navigation mobile", () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test.describe("/app — administrateur", () => {
    test.use({ storageState: "e2e/.auth/demoAdmin.json" });

    test("menu burger : ouverture, Échap, focus, lien", async ({ page }) => {
      await expectMobileMenuFlow(page, "/app");
    });

    test("clic sur l'overlay ferme le panneau", async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await page.goto("/app");
      await menuButton(page).click();
      await expect(navPanel(page)).toBeVisible();
      // Clic à droite, hors du panneau de 288 px.
      await page.mouse.click(360, 300);
      await expect(navPanel(page)).toHaveCount(0);
    });

    test("les liens du panneau reflètent le menu filtré RBAC", async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await page.goto("/app");
      await menuButton(page).click();
      await expect(
        navPanel(page).getByRole("link", { name: "Finances", exact: true }),
      ).toHaveCount(1);
      await expect(
        navPanel(page).getByRole("link", { name: "Élèves", exact: true }),
      ).toHaveCount(1);
      // Titres de section présents dans le panneau.
      for (const section of [
        "Pilotage",
        "Établissement",
        "Pédagogie",
        "Finances",
        "Administration",
      ]) {
        await expect(
          navPanel(page).locator("div.uppercase", { hasText: section }),
        ).toHaveCount(1);
      }
    });
  });

  test.describe("/platform — propriétaire", () => {
    test.use({ storageState: "e2e/.auth/platform.json" });

    test("menu burger : ouverture, Échap, focus, lien", async ({ page }) => {
      await expectMobileMenuFlow(page, "/platform");
    });
  });

  test.describe("/teacher — enseignant", () => {
    test.use({ storageState: "e2e/.auth/demoTeacher.json" });

    test("menu burger : ouverture, Échap, focus, lien", async ({ page }) => {
      await expectMobileMenuFlow(page, "/teacher");
    });
  });

  test.describe("/app — caissier (RBAC mobile)", () => {
    test.use({ storageState: "e2e/.auth/demoCashier.json" });

    test("le panneau mobile n'expose que les liens autorisés", async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await page.goto("/app");
      await menuButton(page).click();
      const panel = navPanel(page);
      await expect(
        panel.getByRole("link", { name: "Finances", exact: true }),
      ).toHaveCount(1);
      for (const hidden of ["Élèves", "Utilisateurs", "Messagerie"]) {
        await expect(
          panel.getByRole("link", { name: hidden, exact: true }),
        ).toHaveCount(0);
      }
    });
  });
});

test.describe("P6a — navigation desktop inchangée", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("sidebar avec sections regroupées, pas de burger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(menuButton(page)).toBeHidden();
    const aside = page.locator("aside");
    for (const section of [
      "Pilotage",
      "Établissement",
      "Pédagogie",
      "Finances",
      "Administration",
    ]) {
      await expect(
        aside.locator("div.uppercase", { hasText: section }),
      ).toHaveCount(1);
    }
    // Champ de recherche décoratif retiré.
    await expect(page.getByPlaceholder("Rechercher...")).toHaveCount(0);
  });
});

test.describe("P6a — liens selon les permissions", () => {
  test.describe("caissier", () => {
    test.use({ storageState: "e2e/.auth/demoCashier.json" });

    test("pas de liens Journal / Impayés / Configuration sur /app/fees", async ({
      page,
    }) => {
      await page.goto("/app/fees");
      await expect(
        page.getByRole("link", { name: "Comptes élèves" }),
      ).toHaveCount(1);
      for (const name of [
        "Journal des paiements",
        "Impayés",
        "Configuration",
      ]) {
        await expect(
          page.getByRole("link", { name, exact: true }),
        ).toHaveCount(0);
      }
    });
  });

  test.describe("responsable financier", () => {
    test.use({ storageState: "e2e/.auth/demoFinance.json" });

    test("voit Journal des paiements et Impayés", async ({ page }) => {
      await page.goto("/app/fees");
      await expect(
        page.getByRole("link", { name: "Journal des paiements", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("link", { name: "Impayés", exact: true }),
      ).toHaveCount(1);
    });
  });
});

test.describe("P6a — pages système", () => {
  test.describe("accès refusé", () => {
    test.use({ storageState: "e2e/.auth/demoCashier.json" });

    test("/app/users → page 403 française", async ({ page }) => {
      await page.goto("/app/users");
      await page.waitForURL(/\/app\/forbidden/);
      await expect(
        page.getByRole("heading", { name: "Accès refusé" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Retour au tableau de bord" }),
      ).toBeVisible();
    });
  });

  test.describe("page introuvable", () => {
    test.use({ storageState: "e2e/.auth/demoAdmin.json" });

    test("/app/chemin-inexistant → 404 français", async ({ page }) => {
      await page.goto("/app/chemin-inexistant");
      await expect(
        page.getByRole("heading", { name: "Page introuvable" }),
      ).toBeVisible();
    });
  });
});

test.describe("P6a — libellés français", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("code d'erreur traduit dans la bannière", async ({ page }) => {
    await page.goto("/app/students?error=MATRICULE_TAKEN");
    await expect(
      page.getByText("Ce matricule est déjà attribué à un autre élève."),
    ).toBeVisible();
    await expect(page.getByText("MATRICULE_TAKEN")).toHaveCount(0);
  });

  test("code d'erreur inconnu → message générique", async ({ page }) => {
    await page.goto("/app/students?error=CODE_INCONNU_XYZ");
    await expect(
      page.getByText(/Une erreur est survenue\. Réessayez/),
    ).toBeVisible();
  });

  test("statuts traduits dans les tableaux", async ({ page }) => {
    await page.goto("/app/students");
    // Aucune cellule brute ACTIVE dans la liste des élèves.
    await expect(
      page.getByRole("cell", { name: "ACTIVE", exact: true }),
    ).toHaveCount(0);
    await page.goto("/app/academic-years");
    await expect(
      page.getByRole("cell", { name: "DRAFT", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "CLOSED", exact: true }),
    ).toHaveCount(0);
  });

  test("lien Retour stable sur la fiche élève", async ({ page }) => {
    const student = await prisma.student.findFirst({
      where: { school: { code: "DEMO-ECOLE" }, status: "ACTIVE" },
      select: { id: true },
    });
    expect(student, "fixture : aucun élève démo").toBeTruthy();
    await page.goto(`/app/students/${student!.id}`);
    await page.getByRole("link", { name: "Retour", exact: true }).click();
    await page.waitForURL(/\/app\/students$/);
  });
});

test.describe("P6a — non-régression imports / exports", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  let gradeAssessmentId: string | null = null;

  test.beforeAll(async () => {
    const school = await prisma.school.findUniqueOrThrow({
      where: { code: "DEMO-ECOLE" },
    });
    const year = await prisma.academicYear.findFirstOrThrow({
      where: { schoolId: school.id, isCurrent: true },
    });
    const classroom = await prisma.classroom.findFirstOrThrow({
      where: { schoolId: school.id, academicYearId: year.id },
    });
    const subject = await prisma.subject.findFirstOrThrow({
      where: { schoolId: school.id },
    });
    const type = await prisma.assessmentType.findFirstOrThrow({
      where: { schoolId: school.id },
    });
    const a = await prisma.assessment.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        classroomId: classroom.id,
        subjectId: subject.id,
        typeId: type.id,
        title: "P6a-NR",
        date: new Date(),
        maxScore: 20,
        status: "OPEN",
      },
      select: { id: true },
    });
    gradeAssessmentId = a.id;
  });

  test.afterAll(async () => {
    if (gradeAssessmentId) {
      await prisma.assessment
        .delete({ where: { id: gradeAssessmentId } })
        .catch(() => {});
    }
  });

  test("liens import/export toujours présents (élèves)", async ({ page }) => {
    await page.goto("/app/students");
    await expect(
      page.getByRole("link", { name: /assistant d.import/i }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Exporter", exact: true }),
    ).toHaveCount(1);
  });

  test("modèle d'import élève toujours servi", async ({ page }) => {
    const res = await page.request.get("/app/students/import/template?format=csv");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("matricule");
  });

  test("modèle d'import notes toujours servi", async ({ page }) => {
    expect(gradeAssessmentId).toBeTruthy();
    const res = await page.request.get(
      `/app/grades/${gradeAssessmentId}/import/template?format=csv`,
    );
    expect(res.status()).toBe(200);
  });

  test("export élèves CSV toujours servi", async ({ page }) => {
    const res = await page.request.get("/app/students/export?format=csv");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("csv");
  });
});
