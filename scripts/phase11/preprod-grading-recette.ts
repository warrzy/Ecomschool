import "dotenv/config";
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { prisma } from "@/lib/db/prisma";

/**
 * Recette préprod du lot P3 — cycle de vie des politiques de notation.
 * Le cycle brouillon→activation→archivage→réactivation s'exécute sur un
 * périmètre ISOLÉ (un niveau sans politique propre) et se termine avec
 * toutes les politiques de test ARCHIVÉES : la politique par défaut de
 * l'année utilisée pour la recette n'est jamais modifiée.
 *
 * Usage (sur le serveur, dans la release courante) :
 *   npx tsx scripts/phase11/preprod-grading-recette.ts
 * Variables : DATABASE_URL, SEED_DEMO_PASSWORD, CRON_SECRET (shared/.env).
 */

const BASE = (process.env.E2E_BASE_URL ?? "https://preprod.ecomschool.fr").replace(/\/$/, "");
const PW = process.env.SEED_DEMO_PASSWORD;
if (!PW) {
  console.error("SEED_DEMO_PASSWORD manquant — arrêt.");
  process.exit(1);
}

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

async function denied(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
  if (!page.url().startsWith(BASE + path)) return true;
  const body = await page.locator("body").innerText();
  return /404|not found|introuvable|accès refusé|non autorisé/i.test(body);
}

const scope = { schoolId: "", academicYearId: "", levelId: "" };
const activeCount = () =>
  prisma.gradingPolicy.count({ where: { ...scope, status: "ACTIVE" } });

async function fillPolicyForm(
  page: Page,
  yearLabel: string,
  levelLabel: string | null,
  passMark: string,
) {
  const yearSelect = page.getByLabel(/année scolaire/i);
  const value = await yearSelect
    .locator("option")
    .evaluateAll(
      (opts, name) =>
        opts.find((o) => o.textContent?.trim().startsWith(name))
          ?.getAttribute("value") ?? "",
      yearLabel,
    );
  await yearSelect.selectOption(value);
  if (levelLabel) {
    await page.getByLabel(/niveau/i).selectOption({ label: levelLabel });
  }
  await page.getByLabel(/seuil de réussite/i).fill(passMark);
}

async function main() {
  const demoSchool = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
    select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: demoSchool.id, isCurrent: true },
    select: { id: true, name: true },
  });
  // Périmètre isolé : un niveau sans politique propre (aucune ACTIVE/DRAFT).
  const level = await prisma.level.findFirstOrThrow({
    where: {
      schoolId: demoSchool.id,
      status: "ACTIVE",
      gradingPolicies: {
        none: { academicYearId: year.id, status: { in: ["ACTIVE", "DRAFT"] } },
      },
    },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
  Object.assign(scope, {
    schoolId: demoSchool.id,
    academicYearId: year.id,
    levelId: level.id,
  });
  const publishedBefore = await prisma.reportCard.count({
    where: { schoolId: demoSchool.id, publishedAt: { not: null } },
  });
  console.log(`Périmètre de test : ${year.name} / ${level.name} — bulletins publiés : ${publishedBefore}`);

  const browser = await chromium.launch();

  // ==================== ADMIN_SCHOOL ====================
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "admin@demo.local");

      // --- Interface ---
      await page.goto("/app/grading-policy", { waitUntil: "domcontentloaded" });
      const sectionsOk = (
        await Promise.all(
          [
            "Portée",
            "Barème, seuil et arrondi",
            "Notes non saisies",
            "Classement",
            "Mentions et pondération annuelle",
          ].map((s) => page.getByText(s, { exact: true }).count()),
        )
      ).every((n) => n > 0);
      check("admin : sections du formulaire", sectionsOk);
      check(
        "admin : bouton notice présent",
        (await page
          .getByRole("link", { name: /comment fonctionnent les règles de notation/i })
          .count()) > 0,
      );
      const notice = page.locator("details#notice");
      await notice.locator("summary").click();
      check(
        "admin : notice s'ouvre et documente les 3 états",
        (await notice.getByText(/brouillon/i).count()) > 0 &&
          (await notice.getByText(/archivée/i).count()) > 0,
      );

      // --- Consultation + préremplissage sur la politique par défaut ---
      const yearDefault = await prisma.gradingPolicy.findFirstOrThrow({
        where: {
          schoolId: demoSchool.id,
          academicYearId: year.id,
          levelId: null,
          status: "ACTIVE",
        },
      });
      const row = page
        .locator("tbody tr", {
          has: page.locator("span", { hasText: /^Active$/ }),
        })
        .first();
      check(
        "admin : politique active listée avec badge",
        (await row.count()) > 0,
      );
      await row.getByRole("link", { name: /^modifier$/i }).click();
      await page.waitForURL(/edit=/);
      const prefilled =
        (await page.getByLabel(/^barème/i).inputValue()) ===
          String(yearDefault.maxScore) &&
        (await page.getByLabel(/seuil de réussite/i).inputValue()) ===
          String(yearDefault.passMark);
      check("admin : modification préremplie (valeurs réelles)", prefilled);

      // Enregistrement sans changement → pas de version++
      await page
        .getByRole("button", {
          name: /enregistrer et activer|enregistrer \(nouvelle version\)/i,
        })
        .click();
      await page.waitForURL(/ok=unchanged/);
      const stillV = await prisma.gradingPolicy.findUniqueOrThrow({
        where: { id: yearDefault.id },
        select: { version: true, status: true },
      });
      check(
        "admin : sans changement → version inchangée",
        stillV.version === yearDefault.version && stillV.status === "ACTIVE",
        `v${stillV.version}`,
      );
      await page.goto("/app/grading-policy", { waitUntil: "domcontentloaded" });

      // ========== Cycle de vie sur le périmètre isolé ==========
      // 1. Création d'un brouillon
      await fillPolicyForm(page, year.name, level.name, "11");
      await page
        .getByRole("button", { name: /enregistrer comme brouillon/i })
        .click();
      await page.waitForURL(/ok=draft/);
      let draft = await prisma.gradingPolicy.findFirst({
        where: { ...scope, status: "DRAFT" },
      });
      check("cycle : brouillon créé (jamais applicable)", !!draft && (await activeCount()) === 0);

      // 2. Modification du brouillon
      await page
        .locator("tbody tr", { hasText: "Brouillon" })
        .first()
        .getByRole("link", { name: /^modifier$/i })
        .click();
      await page.waitForURL(/edit=/);
      await page.getByLabel(/seuil de réussite/i).fill("12");
      await page
        .getByRole("button", { name: /enregistrer le brouillon/i })
        .click();
      await page.waitForURL(/ok=/);
      draft = await prisma.gradingPolicy.findFirst({
        where: { ...scope, status: "DRAFT" },
      });
      check(
        "cycle : brouillon modifié (seuil 12, toujours brouillon)",
        draft?.passMark === 12 && (await activeCount()) === 0,
      );

      // 3. Activation sans conflit (périmètre vide) → directe
      await page
        .locator("tbody tr", { hasText: "Brouillon" })
        .first()
        .getByRole("button", { name: /^activer$/i })
        .click();
      await page.waitForURL(/ok=activated|confirm=activate/);
      if (page.url().includes("confirm=activate")) {
        await page
          .getByRole("button", { name: /confirmer l.activation/i })
          .click();
        await page.waitForURL(/ok=activated/);
      }
      check(
        "cycle : activation directe (aucun conflit)",
        (await activeCount()) === 1,
      );

      // 4. Remplacement contrôlé : 2e brouillon → activation → confirmation
      await page.goto("/app/grading-policy", { waitUntil: "domcontentloaded" });
      await fillPolicyForm(page, year.name, level.name, "13");
      await page
        .getByRole("button", { name: /enregistrer comme brouillon/i })
        .click();
      await page.waitForURL(/ok=draft/);
      await page
        .locator("tbody tr", { hasText: "Brouillon" })
        .first()
        .getByRole("button", { name: /^activer$/i })
        .click();
      await page.waitForURL(/confirm=activate/);
      const confirmText = await page.locator("body").innerText();
      check(
        "cycle : confirmation nomme la politique remplacée",
        /archivera la politique actuellement active/i.test(confirmText) &&
          /seuil 12/.test(confirmText),
      );
      await page
        .getByRole("button", { name: /confirmer l.activation/i })
        .click();
      await page.waitForURL(/ok=activated/);
      const statuses = await prisma.gradingPolicy.groupBy({
        by: ["status"],
        where: scope,
        _count: true,
      });
      const byStatus = Object.fromEntries(
        statuses.map((s) => [s.status, s._count]),
      );
      check(
        "cycle : remplacement transactionnel (1 ACTIVE, ≥1 ARCHIVED)",
        byStatus.ACTIVE === 1 && (byStatus.ARCHIVED ?? 0) >= 1,
        JSON.stringify(byStatus),
      );

      // 5. Archivage avec affichage de la règle de relais
      await page
        .locator("tbody tr", {
          has: page.locator("span", { hasText: /^Active$/ }),
        })
        .first()
        .getByRole("link", { name: /archiver/i })
        .click();
      await page.waitForURL(/confirm=archive/);
      const archiveText = await page.locator("body").innerText();
      check(
        "cycle : confirmation d'archivage affiche la règle de relais",
        /règle qui prendra le relais/i.test(archiveText) &&
          /politique par défaut/i.test(archiveText),
      );
      await page
        .getByRole("button", { name: /confirmer l.archivage/i })
        .click();
      await page.waitForURL(/ok=archived/);
      check(
        "cycle : archivage → relais = politique d'année (0 active niveau)",
        (await activeCount()) === 0,
      );

      // 6. Réactivation d'une archivée puis ré-archivage (état final propre)
      const archived = await prisma.gradingPolicy.findFirstOrThrow({
        where: { ...scope, status: "ARCHIVED" },
        orderBy: { updatedAt: "desc" },
      });
      await page.goto(
        `/app/grading-policy?confirm=activate&id=${archived.id}`,
        { waitUntil: "domcontentloaded" },
      );
      await page
        .getByRole("button", { name: /confirmer l.activation/i })
        .click();
      await page.waitForURL(/ok=activated/);
      check("cycle : réactivation → 1 active", (await activeCount()) === 1);
      // Remise en état : la politique de test repasse archivée, la règle
      // par défaut de l'année gouverne à nouveau le périmètre.
      await page
        .locator("tbody tr", {
          has: page.locator("span", { hasText: /^Active$/ }),
        })
        .filter({ hasText: level.name })
        .first()
        .getByRole("link", { name: /archiver/i })
        .click();
      await page.waitForURL(/confirm=archive/);
      await page
        .getByRole("button", { name: /confirmer l.archivage/i })
        .click();
      await page.waitForURL(/ok=archived/);
      check(
        "cycle : état final propre (0 active sur le périmètre de test)",
        (await activeCount()) === 0,
      );

      // --- Consultation d'une archivée ---
      await page.goto("/app/grading-policy", { waitUntil: "domcontentloaded" });
      check(
        "admin : politiques archivées consultables",
        (await page
          .locator("tbody tr", {
            has: page.locator("span", { hasText: /^Archivée$/ }),
          })
          .getByRole("link", { name: /consulter/i })
          .count()) > 0,
      );

      // --- Non-régression calculs / bulletins ---
      const r1 = await page.goto("/app/grades", { waitUntil: "domcontentloaded" });
      const r2 = await page.goto("/app/averages", { waitUntil: "domcontentloaded" });
      const r3 = await page.goto("/app/report-cards", { waitUntil: "domcontentloaded" });
      check(
        "admin : pages notes/moyennes/bulletins accessibles",
        [r1, r2, r3].every((r) => r?.ok()),
        `${r1?.status()}/${r2?.status()}/${r3?.status()}`,
      );
      const publishedAfter = await prisma.reportCard.count({
        where: { schoolId: demoSchool.id, publishedAt: { not: null } },
      });
      check(
        "admin : bulletins publiés intacts",
        publishedAfter === publishedBefore,
        `${publishedBefore} → ${publishedAfter}`,
      );
    } finally {
      await ctx.close();
    }
  }

  // ==================== TEACHER ====================
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "enseignant@demo.local");
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const labels = await page.locator("aside nav a").allInnerTexts();
      check(
        "enseignant : « Règles de notation » absent du menu",
        !labels.map((t) => t.trim()).includes("Règles de notation"),
      );
      check(
        "enseignant : accès direct refusé",
        await denied(page, "/app/grading-policy"),
      );
      const pedago = await page.goto("/teacher", {
        waitUntil: "domcontentloaded",
      });
      check(
        "enseignant : espace pédagogique fonctionnel",
        pedago?.ok() ?? false,
        `HTTP ${pedago?.status()}`,
      );
    } finally {
      await ctx.close();
    }
  }

  // ==================== PARENT / ÉLÈVE ====================
  // Les bulletins sont des PDF servis depuis les tableaux de bord.
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const parent = await login(ctx, "parent@demo.local");
      const pRes = await parent.goto("/parent?tab=bulletins", {
        waitUntil: "domcontentloaded",
      });
      const pLinks = await parent
        .locator('a[href*="/parent/report-cards/"]')
        .count();
      check(
        "parent : tableau de bord + liens bulletins",
        (pRes?.ok() ?? false) && pLinks > 0,
        `HTTP ${pRes?.status()}, ${pLinks} bulletin(s)`,
      );
      if (pLinks > 0) {
        const href = await parent
          .locator('a[href*="/parent/report-cards/"]')
          .first()
          .getAttribute("href");
        const pdf = await parent.request.get(href!);
        const buf = await pdf.body();
        check(
          "parent : bulletin PDF publié consultable (snapshot intact)",
          pdf.ok() && buf.subarray(0, 4).toString() === "%PDF",
          `HTTP ${pdf.status()}`,
        );
      }
      const student = await login(ctx, "eleve@demo.local");
      const sRes = await student.goto("/student", {
        waitUntil: "domcontentloaded",
      });
      check(
        "élève : tableau de bord accessible",
        sRes?.ok() ?? false,
        `HTTP ${sRes?.status()}`,
      );
    } finally {
      await ctx.close();
    }
  }

  // ==================== Automatisations P2 ====================
  // /api/cron : l'accès authentifié est exercé via SSH (127.0.0.1:3001).
  // Via le domaine public, toute réponse 4xx prouve la protection.
  {
    const unauth = await fetch(`${BASE}/api/cron`, { method: "POST" });
    check(
      "cron : endpoint protégé sans secret",
      unauth.status === 401 || unauth.status === 403,
      `HTTP ${unauth.status}`,
    );
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) process.exit(1);
}

main().finally(() => prisma.$disconnect());
