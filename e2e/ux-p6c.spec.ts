import { test, expect, type Page } from "@playwright/test";

/**
 * P6c — Accessibilité et responsive.
 * Vérifie : un h1 par page, labels associés, tableaux nommés avec scope,
 * Escape/trap des panneaux de confirmation, absence de débordement
 * horizontal aux quatre résolutions.
 */

const WIDTHS = [320, 390, 768, 1440] as const;

const APP_PAGES = [
  "/app",
  "/app/students",
  "/app/enrollments",
  "/app/fees",
  "/app/fees/payments",
  "/app/fees/unpaid",
  "/app/fees/settings",
  "/app/grades",
  "/app/report-cards",
  "/app/messages",
  "/app/users",
  "/app/academic-years",
  "/app/subscription",
] as const;

const PLATFORM_PAGES = [
  "/platform",
  "/platform/schools",
  "/platform/invoices",
  "/platform/automations",
] as const;

async function docOverflow(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
}

async function h1Count(page: Page) {
  return page.locator("h1:visible").count();
}

/* ------------------------------------------------------------------ */
/* Responsive : aucun débordement horizontal global                    */
/* ------------------------------------------------------------------ */

test.describe("P6c — responsive /app", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  for (const w of WIDTHS) {
    test(`aucun débordement global à ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 844 });
      for (const path of APP_PAGES) {
        await page.goto(path, { waitUntil: "load" });
        const over = await docOverflow(page);
        expect(over, `${path} déborde de ${over}px à ${w}px`).toBe(0);
      }
    });
  }
});

test.describe("P6c — responsive /platform", () => {
  test.use({ storageState: "e2e/.auth/platform.json" });

  for (const w of WIDTHS) {
    test(`aucun débordement global à ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 844 });
      for (const path of PLATFORM_PAGES) {
        await page.goto(path, { waitUntil: "load" });
        const over = await docOverflow(page);
        expect(over, `${path} déborde de ${over}px à ${w}px`).toBe(0);
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/* Titres : un h1 visible par page                                     */
/* ------------------------------------------------------------------ */

test.describe("P6c — hiérarchie des titres", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("un h1 unique sur les pages principales /app", async ({ page }) => {
    for (const path of APP_PAGES) {
      await page.goto(path, { waitUntil: "load" });
      // Attendre le h1 : le contenu dynamique PPR peut arriver après domcontentloaded
      await page.locator("h1:visible").first().waitFor({ state: "visible" });
      const n = await h1Count(page);
      expect(n, `${path} a ${n} h1 visibles`).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Tableaux : scope sur en-têtes + nom accessible                      */
/* ------------------------------------------------------------------ */

test.describe("P6c — tableaux accessibles", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("tous les th ont scope, toutes les tables ont un nom", async ({
    page,
  }) => {
    for (const path of APP_PAGES) {
      await page.goto(path, { waitUntil: "load" });
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll("table").forEach((t, i) => {
          // Ignorer les tables hors écran (artefacts internes de rendu).
          if (t.offsetParent === null) return;
          const named =
            t.getAttribute("aria-label") ||
            t.getAttribute("aria-labelledby") ||
            t.querySelector("caption");
          if (!named) out.push(`table[${i}] sans nom`);
          t.querySelectorAll("th").forEach((th) => {
            if (!th.getAttribute("scope")) out.push("th sans scope");
          });
        });
        return out;
      });
      expect(bad, `${path} : ${bad.join("; ")}`).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Formulaires : champs nommés                                         */
/* ------------------------------------------------------------------ */

test.describe("P6c — champs de formulaire nommés", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("tous les champs visibles ont un nom accessible", async ({ page }) => {
    for (const path of APP_PAGES) {
      await page.goto(path, { waitUntil: "load" });
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        document
          .querySelectorAll("input, select, textarea")
          .forEach((el) => {
            const t = (el as HTMLElement);
            if (
              t.getAttribute("type") === "hidden" ||
              t.offsetParent === null ||
              t.closest('[aria-hidden="true"]')
            )
              return;
            const id = t.getAttribute("id");
            const named =
              t.getAttribute("aria-label") ||
              t.getAttribute("aria-labelledby") ||
              t.getAttribute("title") ||
              (id && document.querySelector(`label[for="${id}"]`)) ||
              t.closest("label");
            if (!named)
              out.push(`${t.tagName} name=${t.getAttribute("name") ?? "?"}`);
          });
        return out;
      });
      expect(bad, `${path} : ${bad.join("; ")}`).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* ConfirmPanel : Escape, focus trap, retour focus                     */
/* ------------------------------------------------------------------ */

test.describe("P6c — ConfirmPanel clavier", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("Escape ferme le panneau sans exécuter l'action", async ({ page }) => {
    // Panneau de suppression du compte caissier de démonstration.
    await page.goto("/app/users");
    const row = page.locator("tr", { hasText: "caissier@demo.local" });
    const del = row.getByRole("link", { name: /supprimer/i });
    const href = await del.getAttribute("href");
    expect(href).toContain("confirm=");
    await del.click();
    const p = page.getByRole("alertdialog");
    await expect(p).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(p).not.toBeVisible();
    // Toujours sur la liste, utilisateur toujours présent
    await expect(row).toBeVisible();
    expect(page.url()).not.toContain("confirm=");
  });

  test("Tab reste capturé dans le panneau", async ({ page }) => {
    await page.goto("/app/users");
    const row = page.locator("tr", { hasText: "caissier@demo.local" });
    await row.getByRole("link", { name: /supprimer/i }).click();
    const p = page.getByRole("alertdialog");
    await expect(p).toBeVisible();
    // Le focus démarre dans le panneau
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            !!document.activeElement?.closest('[role="alertdialog"]'),
        ),
      )
      .toBe(true);
    // Plusieurs Tab : le focus ne quitte jamais le panneau
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () =>
          !!document.activeElement?.closest('[role="alertdialog"]'),
      );
      expect(inside).toBe(true);
    }
    await page.keyboard.press("Escape");
  });

  test("le focus revient au déclencheur après annulation", async ({ page }) => {
    await page.goto("/app/users");
    const row = page.locator("tr", { hasText: "caissier@demo.local" });
    const del = row.getByRole("link", { name: /supprimer/i });
    await del.click();
    const p = page.getByRole("alertdialog");
    await expect(p).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(p).not.toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement ===
            document.querySelector('a[href*="confirm=delete"]'),
        ),
      )
      .toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Bannières ARIA                                                      */
/* ------------------------------------------------------------------ */

test.describe("P6c — bannières d'état", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("succès annoncé via role=status", async ({ page }) => {
    await page.goto("/app/students?ok=updated");
    await expect(page.getByRole("status")).toContainText("Modification");
  });

  test("erreur annoncée via role=alert", async ({ page }) => {
    await page.goto("/app/students?error=FORBIDDEN");
    // Le route announcer interne de Next possède aussi role=alert :
    // on vise la bannière métier.
    await expect(
      page.getByRole("alert").filter({ hasText: /autorisée|erreur/i }),
    ).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */
/* Compteur de créances : libellé distinguant créé/existant            */
/* ------------------------------------------------------------------ */

test.describe("P6c — message de génération de créances", () => {
  test.use({ storageState: "e2e/.auth/demoFinance.json" });

  test("le message distingue nouvelles et existantes", async ({ page }) => {
    await page.goto("/app/fees?ok=charges&count=3&existing=7");
    const banner = page.getByRole("status");
    await expect(banner).toContainText("nouvelle");
    await expect(banner).toContainText("existante");
    await expect(banner).toContainText("aucun doublon");
  });
});
