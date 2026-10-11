import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

const SHOTS = "docs/recette";

test.describe("Recette navigateur — captures", () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("page de connexion", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /se connecter/i }),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: true });
  });

  test.describe("plateforme ECOM-TOUCH", () => {
    test.use({ storageState: "e2e/.auth/platform.json" });

    test("dashboards plateforme", async ({ page }) => {
      test.setTimeout(300_000);
      await page.goto("/platform");
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain("/platform");
      await page.screenshot({ path: `${SHOTS}/02-platform.png`, fullPage: true });

      for (const [path, name] of [
        ["/platform/schools", "03-platform-schools"],
        ["/platform/subscriptions", "04-platform-subscriptions"],
        ["/platform/automations", "05-platform-automations"],
      ] as const) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
      }
    });
  });

  test.describe("administration scolaire", () => {
    test.use({ storageState: "e2e/.auth/demoAdmin.json" });

    test("dashboards école", async ({ page }) => {
      test.setTimeout(300_000);
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      await page.screenshot({
        path: `${SHOTS}/10-app-dashboard.png`,
        fullPage: true,
      });

      for (const [path, name] of [
        ["/app/students", "11-app-students"],
        ["/app/classrooms", "12-app-classrooms"],
        ["/app/report-cards", "13-app-report-cards"],
        ["/app/messages", "14-app-messages"],
        ["/app/notifications", "15-app-notifications"],
        ["/app/announcements", "16-app-announcements"],
      ] as const) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
      }
    });
  });

  test.describe("portail parent", () => {
    test.use({ storageState: "e2e/.auth/demoParent.json" });

    test("portail parent", async ({ page }) => {
      await page.goto("/parent");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/20-parent.png`, fullPage: true });
    });
  });

  test.describe("portail élève", () => {
    test.use({ storageState: "e2e/.auth/demoStudent.json" });

    test("accueil élève", async ({ page }) => {
      await page.goto("/student");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/21-student.png`, fullPage: true });
    });
  });

  test.describe("espace enseignant", () => {
    test.use({ storageState: "e2e/.auth/demoTeacher.json" });

    test("accueil enseignant", async ({ page }) => {
      await page.goto("/teacher");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/22-teacher.png`, fullPage: true });
    });
  });

  test.describe("mobile", () => {
    test.use({ storageState: "e2e/.auth/demoAdmin.json" });

    test("dashboard admin école en 390px", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/app");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/30-mobile-app.png`, fullPage: true });
    });
  });
});
