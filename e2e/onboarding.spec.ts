import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * E2E — création d'établissement via /platform/onboarding.
 * Vérifie la correction INVALID_INPUT : normalisation des champs,
 * messages par champ, doublons explicites, transaction atomique.
 */
test.describe("Onboarding établissement", () => {
  test.use({ storageState: "e2e/.auth/platform.json" });

  const school = {
    name: "École Test E2E",
    code: "E2ETEST",
    slug: "e2e-test",
    adminEmail: "e2e-school-admin@test.local",
  };

  async function fillValid(page: import("@playwright/test").Page) {
    await page.getByLabel(/^nom$/i).first().fill(school.name);
    await page.getByLabel(/code/i).fill(school.code);
    await page.getByLabel(/slug/i).fill(school.slug);
    await page.getByLabel(/^début$/i).fill("2026-09-01");
    await page.getByLabel(/^fin$/i).fill("2027-06-30");
    await page.getByLabel(/email admin/i).fill(school.adminEmail);
    await page.getByLabel(/mot de passe admin/i).fill("TestOnboarding2026");
    await page.getByLabel(/prénom/i).fill("Test");
    await page.getByLabel(/^nom$/i).last().fill("Admin");
  }

  test.afterEach(async () => {
    // Nettoyage : supprime l'établissement de test créé.
    const s = await prisma.school.findFirst({ where: { code: school.code } });
    if (s) {
      const user = await prisma.user.findUnique({
        where: { email: school.adminEmail },
      });
      if (user) {
        await prisma.schoolMembership.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.academicPeriod.deleteMany({ where: { schoolId: s.id } });
      await prisma.academicYear.deleteMany({ where: { schoolId: s.id } });
      await prisma.school.delete({ where: { id: s.id } });
    }
  });

  test("création valide : école + année + admin rattachés", async ({ page }) => {
    await page.goto("/platform/onboarding");
    await fillValid(page);
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText(/créé avec succès/i)).toBeVisible({
      timeout: 60_000,
    });

    const s = await prisma.school.findFirst({
      where: { code: school.code },
      include: { academicYears: true },
    });
    expect(s, "école créée").toBeTruthy();
    expect(s!.status).toBe("ACTIVE");
    expect(s!.academicYears.length).toBe(1);
    expect(s!.academicYears[0].isCurrent).toBe(true);

    const periods = await prisma.academicPeriod.count({
      where: { schoolId: s!.id },
    });
    expect(periods, "3 trimestres créés").toBe(3);

    const admin = await prisma.user.findUnique({
      where: { email: school.adminEmail },
      include: { memberships: { include: { role: true } } },
    });
    expect(admin, "compte admin créé").toBeTruthy();
    expect(admin!.status).toBe("ACTIVE");
    expect(
      admin!.memberships.some(
        (m) => m.schoolId === s!.id && m.role.name === "ADMIN_SCHOOL",
      ),
      "admin rattaché avec le rôle ADMIN_SCHOOL",
    ).toBe(true);
  });

  test("code avec espaces → erreur ciblée sur le champ code", async ({
    page,
  }) => {
    await page.goto("/platform/onboarding");
    await fillValid(page);
    await page.getByLabel(/code/i).fill("EC E2E");
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText(/champ : code/i)).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await prisma.school.count({ where: { code: "EC E2E" } }),
      "aucune création partielle",
    ).toBe(0);
  });

  test("mot de passe faible → erreur ciblée sur adminPassword", async ({
    page,
  }) => {
    await page.goto("/platform/onboarding");
    await fillValid(page);
    await page.getByLabel(/mot de passe admin/i).fill("court");
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText(/adminPassword/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("code dupliqué → CODE_TAKEN explicite", async ({ page }) => {
    // École existante en base (seed) : récupère son code.
    const existing = await prisma.school.findFirst({ select: { code: true } });
    test.skip(!existing, "aucune école en base de test");
    await page.goto("/platform/onboarding");
    await fillValid(page);
    await page.getByLabel(/code/i).fill(existing!.code);
    await page.getByLabel(/slug/i).fill("slug-unique-e2e");
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText(/déjà utilisé/i)).toBeVisible({
      timeout: 30_000,
    });
    await prisma.school
      .findFirst({ where: { slug: "slug-unique-e2e" } })
      .then(async (s) => {
        if (s) await prisma.school.delete({ where: { id: s.id } });
      });
  });
});
