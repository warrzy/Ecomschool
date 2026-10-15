import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * E2E — comptes de démonstration par rôle.
 * Pour chaque profil : bon espace, fonctions autorisées, refus des zones
 * interdites, déconnexion. + isolation multi-tenant entre DEMO-ECOLE et
 * un autre établissement (WEND-PANGA, compte schoolAdmin existant).
 *
 * Pré-requis : `ALLOW_DEMO_SEED=1 npx tsx scripts/demo/seed-demo.ts`.
 */

test.describe("Comptes de démonstration", () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // ---------- ADMIN_SCHOOL ----------
  test.describe("administrateur d'établissement", () => {
    test.use({ storageState: "e2e/.auth/demoAdmin.json" });

    test("espace /app avec données réelles", async ({ page }) => {
      await page.goto("/app");
      await expect(page).toHaveURL(/\/app/);
      await expect(page.getByText(/démo|fictif/i).first()).toBeVisible();
      // Effectif enrichi par le seed
      await expect(page.getByText(/20/).first()).toBeVisible();
    });

    test("élèves, classes, enseignants, finances accessibles", async ({
      page,
    }) => {
      for (const path of [
        "/app/students",
        "/app/classrooms",
        "/app/teachers",
        "/app/fees",
        "/app/report-cards",
        "/app/announcements",
      ]) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(200);
        expect(page.url(), path).toContain(path);
      }
      // La liste des élèves affiche les 20 fictifs
      await page.goto("/app/students");
      await expect(page.getByText(/DEMO-0\d\d/).first()).toBeVisible();
    });

    test("admin école : pas d'accès plateforme", async ({ page }) => {
      await page.goto("/platform");
      await page.waitForTimeout(3_000);
      expect(page.url()).not.toContain("/platform");
    });

    test("déconnexion", async ({ page }) => {
      await page.goto("/app");
      // Bouton « Déconnexion » → page de confirmation NextAuth → « Sign out ».
      await page.getByRole("button", { name: /déconnexion/i }).click();
      await page.getByRole("button", { name: /sign out/i }).click();
      await page.waitForURL(/\/login/, { timeout: 30_000 });
      expect(page.url()).toContain("/login");
    });
  });

  // ---------- FINANCE_MANAGER ----------
  test.describe("responsable financier", () => {
    test.use({ storageState: "e2e/.auth/demoFinance.json" });

    test("tableau de bord financier accessible et riche", async ({ page }) => {
      const res = await page.goto("/app/fees");
      expect(res?.status()).toBe(200);
      expect(page.url()).toContain("/app/fees");
      await expect(page.getByText(/F\s?CFA/i).first()).toBeVisible();
    });

    test("pas d'accès à la gestion des élèves ni des utilisateurs", async ({
      page,
    }) => {
      for (const path of ["/app/students", "/app/users"]) {
        await page.goto(path);
        await page.waitForTimeout(3_000);
        expect(page.url(), path).not.toContain(path);
      }
    });
  });

  // ---------- CASHIER ----------
  test.describe("caissier", () => {
    test.use({ storageState: "e2e/.auth/demoCashier.json" });

    test("caisse accessible, configuration refusée", async ({ page }) => {
      const res = await page.goto("/app/fees");
      expect(res?.status()).toBe(200);
      await page.goto("/app/fees/settings");
      await page.waitForTimeout(3_000);
      expect(page.url()).not.toContain("/app/fees/settings");
    });
  });

  // ---------- TEACHER ----------
  test.describe("enseignant", () => {
    test.use({ storageState: "e2e/.auth/demoTeacher.json" });

    test("espace enseignant avec classes et évaluations", async ({ page }) => {
      const res = await page.goto("/teacher");
      expect(res?.status()).toBe(200);
      expect(page.url()).toContain("/teacher");
      await expect(page.getByText(/6e|classe|cours/i).first()).toBeVisible();
    });

    test("pas d'accès aux comptes utilisateurs ni aux finances", async ({
      page,
    }) => {
      // NB : l'enseignant a légitimement accès en lecture à /app/students.
      for (const path of ["/app/users", "/app/fees"]) {
        await page.goto(path);
        await page.waitForTimeout(3_000);
        expect(page.url(), path).not.toContain(path);
      }
    });
  });

  // ---------- PARENT ----------
  test.describe("parent", () => {
    test.use({ storageState: "e2e/.auth/demoParent.json" });

    test("portail parent : notes et infos de ses enfants", async ({ page }) => {
      const res = await page.goto("/parent");
      expect(res?.status()).toBe(200);
      await expect(
        page.getByText(/aminata|ibrahim|enfant|élève/i).first(),
      ).toBeVisible();
    });

    test("bulletin d'un élève non rattaché refusé (isolation intra-école)", async ({
      page,
    }) => {
      const parent = await prisma.user.findUniqueOrThrow({
        where: { email: "parent@demo.local" },
        select: { id: true },
      });
      const guardian = await prisma.guardian.findFirstOrThrow({
        where: { userId: parent.id },
        select: { id: true },
      });
      const linked = await prisma.studentGuardian.findMany({
        where: { guardianId: guardian.id },
        select: { studentId: true },
      });
      const foreign = await prisma.reportCard.findFirst({
        where: {
          status: { in: ["PUBLISHED", "RECTIFIED"] },
          studentId: { notIn: linked.map((l) => l.studentId) },
          student: { school: { code: "DEMO-ECOLE" } },
        },
        select: { id: true },
      });
      test.skip(!foreign, "aucun bulletin étranger publié");
      const res = await page.request.get(
        `/parent/report-cards/${foreign!.id}/pdf`,
      );
      expect([403, 404]).toContain(res.status());
    });
  });

  // ---------- STUDENT ----------
  test.describe("élève", () => {
    test.use({ storageState: "e2e/.auth/demoStudent.json" });

    test("portail élève : emploi du temps et résultats", async ({ page }) => {
      const res = await page.goto("/student");
      expect(res?.status()).toBe(200);
      await expect(
        page.getByText(/aminata|bulletin|emploi|résultat|note/i).first(),
      ).toBeVisible();
    });
  });

  // ---------- PLATFORM_SALES ----------
  test.describe("commercial plateforme", () => {
    test.use({ storageState: "e2e/.auth/platformSales.json" });

    test("espace /platform : formules et abonnements accessibles", async ({
      page,
    }) => {
      const res = await page.goto("/platform");
      expect(res?.status()).toBe(200);
      expect(page.url()).toContain("/platform");
      for (const path of ["/platform/plans", "/platform/subscriptions"]) {
        const r = await page.goto(path);
        expect(r?.status(), path).toBe(200);
        expect(page.url(), path).toContain(path);
      }
    });

    test("sans privilèges propriétaire : écoles, onboarding, demandes, admins refusés", async ({
      page,
    }) => {
      for (const path of [
        "/platform/schools",
        "/platform/onboarding",
        "/platform/signup-requests",
        "/platform/administrators",
      ]) {
        await page.goto(path);
        await page.waitForTimeout(3_000);
        // Redirection vers /platform (guard) — jamais la page demandée.
        expect(
          page.url().endsWith(path),
          `${path} doit être refusé`,
        ).toBe(false);
      }
    });

    test("pas d'accès aux espaces école", async ({ page }) => {
      await page.goto("/app");
      await page.waitForTimeout(3_000);
      expect(page.url()).not.toContain("/app");
    });
  });

  // ---------- Isolation inter-établissements ----------
  test.describe("isolation multi-tenant", () => {
    test("admin DEMO-ECOLE ne voit pas un élève d'un autre établissement", async ({
      browser,
    }) => {
      const foreign = await prisma.student.findFirst({
        where: { school: { code: "WEND-PANGA" } },
        select: { id: true },
      });
      test.skip(!foreign, "aucun élève WEND-PANGA pour le test croisé");

      const ctx = await browser.newContext({
        storageState: "e2e/.auth/demoAdmin.json",
      });
      const page = await ctx.newPage();
      await page.goto(`/app/students/${foreign!.id}`);
      // Refus attendu : page 404 (statut streamé en PPR → assertion sur le DOM).
      await expect(
        page.getByText(/could not be found|introuvable|non trouvé/i).first(),
        "la fiche d'un autre tenant ne doit pas être exposée",
      ).toBeVisible();
      await ctx.close();
    });

    test("admin WEND-PANGA ne voit pas les élèves DEMO-ECOLE", async ({
      browser,
    }) => {
      const demoStudent = await prisma.student.findFirstOrThrow({
        where: { school: { code: "DEMO-ECOLE" }, matricule: "DEMO-004" },
        select: { id: true },
      });
      const ctx = await browser.newContext({
        storageState: "e2e/.auth/schoolAdmin.json",
      });
      const page = await ctx.newPage();
      await page.goto(`/app/students/${demoStudent.id}`);
      await expect(
        page.getByText(/could not be found|introuvable|non trouvé/i).first(),
        "la fiche DEMO-ECOLE ne doit pas être exposée à un autre tenant",
      ).toBeVisible();
      await ctx.close();
    });
  });
});
