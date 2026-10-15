import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * P1 — Navigation filtrée par permissions effectives.
 *
 * Chaque entrée de `appNav`/`platformNav` porte la clé de permission exigée
 * par sa page cible ; le menu doit refléter exactement ce que le rôle peut
 * ouvrir (les gardes serveur restent la sécurité réelle).
 *
 * Pré-requis : `ALLOW_DEMO_SEED=1 npx tsx scripts/demo/seed-demo.ts`.
 */

function navLink(page: import("@playwright/test").Page, name: string) {
  return page.locator("aside").getByRole("link", { name, exact: true });
}

async function expectNav(
  page: import("@playwright/test").Page,
  url: string,
  visible: string[],
  hidden: string[],
) {
  await page.goto(url);
  for (const name of visible) {
    await expect(navLink(page, name), `menu visible : ${name}`).toHaveCount(1);
  }
  for (const name of hidden) {
    await expect(navLink(page, name), `menu masqué : ${name}`).toHaveCount(0);
  }
}

test.describe("P1 — menus filtrés par rôle", () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // ---------- ADMIN_SCHOOL : tout le menu ----------
  test.describe("administrateur d'établissement", () => {
    test.use({ storageState: "e2e/.auth/demoAdmin.json" });

    test("voit l'intégralité des modules", async ({ page }) => {
      await expectNav(
        page,
        "/app",
        [
          "Tableau de bord", "Années scolaires", "Élèves", "Parents",
          "Inscriptions", "Enseignants", "Niveaux", "Classes", "Matières",
          "Salles", "Emplois du temps", "Notes", "Moyennes", "Bulletins",
          "Règles de notation", "Absences & retards", "Annonces",
          "Messagerie", "Notifications", "Finances", "Utilisateurs",
          "Mon abonnement", "Paramètres",
        ],
        [],
      );
    });

    test("formulaire de changement d'offre visible (bug SCHOOL_ADMIN corrigé)", async ({
      page,
    }) => {
      await page.goto("/app/subscription");
      await expect(
        page.getByText(/Demander un changement d'offre|Demande en attente/),
      ).toBeVisible();
    });
  });

  // ---------- TEACHER : périmètre pédagogique uniquement ----------
  test.describe("enseignant", () => {
    test.use({ storageState: "e2e/.auth/demoTeacher.json" });

    test("voit ses modules pédagogiques, pas les modules admin", async ({
      page,
    }) => {
      await expectNav(
        page,
        "/app",
        [
          "Tableau de bord", "Années scolaires", "Élèves", "Niveaux",
          "Classes", "Matières", "Salles", "Emplois du temps", "Notes",
          "Moyennes", "Bulletins", "Absences & retards", "Annonces",
          "Notifications", "Mon abonnement", "Paramètres",
        ],
        [
          "Parents", "Inscriptions", "Enseignants", "Règles de notation",
          "Messagerie", "Finances", "Utilisateurs",
        ],
      );
    });

    test("URL directe : admin financier, utilisateurs et règles de notation refusés", async ({
      page,
    }) => {
      for (const path of [
        "/app/users",
        "/app/fees",
        "/app/fees/settings",
        "/app/grading-policy",
        "/app/messages",
      ]) {
        await page.goto(path);
        await page.waitForTimeout(3_000);
        expect(page.url(), path).not.toContain(path);
      }
    });

    test("accès légitimes conservés : notes, notifications, /teacher", async ({
      page,
    }) => {
      for (const path of ["/app/grades", "/app/notifications", "/teacher"]) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(200);
        expect(page.url(), path).toContain(path);
      }
    });
  });

  // ---------- FINANCE_MANAGER : finances + notifications ----------
  test.describe("responsable financier", () => {
    test.use({ storageState: "e2e/.auth/demoFinance.json" });

    test("voit Finances, pas les modules pédagogiques ni admin", async ({
      page,
    }) => {
      await expectNav(
        page,
        "/app",
        ["Tableau de bord", "Notifications", "Finances"],
        [
          "Élèves", "Enseignants", "Notes", "Bulletins", "Utilisateurs",
          "Mon abonnement", "Paramètres", "Règles de notation",
        ],
      );
    });
  });

  // ---------- CASHIER : caisse uniquement ----------
  test.describe("caissier", () => {
    test.use({ storageState: "e2e/.auth/demoCashier.json" });

    test("voit Finances, pas le reste", async ({ page }) => {
      await expectNav(
        page,
        "/app",
        ["Tableau de bord", "Notifications", "Finances"],
        ["Élèves", "Utilisateurs", "Règles de notation", "Messagerie"],
      );
    });

    test("pas d'accès à l'espace enseignant", async ({ page }) => {
      await page.goto("/teacher");
      await page.waitForTimeout(3_000);
      expect(page.url()).not.toContain("/teacher");
    });
  });

  // ---------- PARENT / STUDENT : jamais /app ----------
  test.describe("parent", () => {
    test.use({ storageState: "e2e/.auth/demoParent.json" });

    test("redirigé vers /parent, sans sidebar école", async ({ page }) => {
      await page.goto("/app");
      await page.waitForURL(/\/parent/, { timeout: 30_000 });
    });
  });

  test.describe("élève", () => {
    test.use({ storageState: "e2e/.auth/demoStudent.json" });

    test("redirigé vers /student, sans sidebar école", async ({ page }) => {
      await page.goto("/app");
      await page.waitForURL(/\/student/, { timeout: 30_000 });
    });
  });

  // ---------- PLATFORM_OWNER : tout le menu plateforme ----------
  test.describe("propriétaire plateforme", () => {
    test.use({ storageState: "e2e/.auth/platform.json" });

    test("voit l'intégralité des modules plateforme", async ({ page }) => {
      await expectNav(
        page,
        "/platform",
        [
          "Vue générale", "Établissements", "Demandes",
          "Création établissement", "Administrateurs", "Modules", "Offres",
          "Abonnements", "Factures", "Supervision", "Automatisations",
          "Audit", "Assistance",
        ],
        [],
      );
    });
  });

  // ---------- PLATFORM_SALES : périmètre commercial ----------
  test.describe("commercial plateforme", () => {
    test.use({ storageState: "e2e/.auth/platformSales.json" });

    test("voit les fonctions commerciales, pas les fonctions propriétaire", async ({
      page,
    }) => {
      await expectNav(
        page,
        "/platform",
        ["Vue générale", "Modules", "Offres", "Abonnements", "Factures"],
        [
          "Établissements", "Demandes", "Création établissement",
          "Administrateurs", "Supervision", "Automatisations", "Audit",
          "Assistance",
        ],
      );
    });
  });
});
