import "dotenv/config";
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { prisma } from "@/lib/db/prisma";

/**
 * Recette préprod du lot P1 — navigation filtrée par permissions.
 * Lecture seule sur les données ; aucune écriture.
 * Usage (sur le serveur) :
 *   npx tsx scripts/phase11/preprod-nav-recette.ts
 * Variables : DATABASE_URL, SEED_DEMO_PASSWORD (shared/.env).
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

/** Libellés de la sidebar (<aside>) actuellement rendus. */
async function navLabels(page: Page): Promise<string[]> {
  return page.locator("aside nav a").allInnerTexts();
}

async function expectNav(
  name: string,
  page: Page,
  url: string,
  visible: string[],
  hidden: string[],
) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const labels = (await navLabels(page)).map((t) => t.trim());
  const missing = visible.filter((v) => !labels.includes(v));
  const leaked = hidden.filter((h) => labels.includes(h));
  check(
    `${name} : menus`,
    missing.length === 0 && leaked.length === 0,
    missing.length || leaked.length
      ? `manquants=[${missing}] indésirables=[${leaked}]`
      : `${visible.length} visibles, ${hidden.length} masqués`,
  );
}

/** Renvoie true si l'accès est refusé (redirection ou 404/403). */
async function denied(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
  if (!page.url().startsWith(BASE + path)) return true;
  const body = await page.locator("body").innerText();
  return /404|not found|introuvable|accès refusé|non autorisé/i.test(body);
}

async function hasRetour(page: Page, path: string, href: string) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (res?.status() !== 200) {
    check(`Retour présent : ${path}`, false, `HTTP ${res?.status()}`);
    return;
  }
  const count = await page
    .locator(`a[href="${href}"]`)
    .filter({ hasText: /retour/i })
    .count();
  check(`Retour présent : ${path} → ${href}`, count > 0);
}

async function main() {
  // IDs réels de DEMO-ECOLE pour les pages détail (lecture seule)
  const demoSchool = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
    select: { id: true },
  });
  const [student, assessment, session, foreignStudent] = await Promise.all([
    prisma.student.findFirstOrThrow({
      where: { schoolId: demoSchool.id },
      select: { id: true, matricule: true },
    }),
    prisma.assessment.findFirstOrThrow({
      where: { schoolId: demoSchool.id },
      select: { id: true },
    }),
    prisma.courseSession.findFirstOrThrow({
      where: { schoolId: demoSchool.id },
      select: { id: true },
    }),
    // Élève d'un autre établissement (isolation inter-tenant) — peut être null.
    prisma.student.findFirst({
      where: { schoolId: { not: demoSchool.id } },
      select: { id: true },
    }),
  ]);

  const browser = await chromium.launch();

  // ---------- ADMIN_SCHOOL ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "admin@demo.local");
      await expectNav("admin école", page, "/app", [
        "Tableau de bord", "Années scolaires", "Élèves", "Parents",
        "Inscriptions", "Enseignants", "Niveaux", "Classes", "Matières",
        "Salles", "Emplois du temps", "Notes", "Moyennes", "Bulletins",
        "Règles de notation", "Absences & retards", "Annonces",
        "Messagerie", "Notifications", "Finances", "Utilisateurs",
        "Mon abonnement", "Paramètres",
      ], []);

      // Formulaire de demande de changement d'offre (bug SCHOOL_ADMIN corrigé)
      await page.goto("/app/subscription", { waitUntil: "domcontentloaded" });
      const formVisible =
        (await page.getByText(/Demander un changement d'offre/i).count()) > 0 ||
        (await page.getByText(/Demande en attente/i).count()) > 0;
      check("admin école : formulaire ou demande en attente visible", formVisible);

      // Boutons Retour
      await hasRetour(page, `/app/fees/accounts/${student.id}`, "/app/fees/accounts");
      await hasRetour(page, `/app/grades/${assessment.id}`, "/app/grades");
      await hasRetour(page, "/app/fees/unpaid", "/app/fees");
      await hasRetour(page, "/app/fees/settings", "/app/fees");
      await hasRetour(page, `/app/sessions/${session.id}`, "/app/schedules");

      // Isolation : liste élèves = DEMO-ECOLE uniquement
      await page.goto("/app/students", { waitUntil: "domcontentloaded" });
      const rows = await page.locator("tbody").innerText().catch(() => "");
      check(
        "isolation : /app/students ne contient que des matricules DEMO-",
        /DEMO-\d+/.test(rows),
        `${student.matricule} attendu`,
      );
      if (foreignStudent) {
        check(
          "isolation : fiche élève d'un autre établissement refusée",
          await denied(page, `/app/students/${foreignStudent.id}`),
        );
      }
      check("admin école → /platform refusé", await denied(page, "/platform"));
      await page.close();
    } catch (e) {
      check("admin école", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- TEACHER ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "enseignant@demo.local");
      await expectNav(
        "enseignant",
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
      for (const [path, label] of [
        ["/app/users", "teacher → /app/users refusé"],
        ["/app/fees", "teacher → /app/fees refusé"],
        ["/app/grading-policy", "teacher → /app/grading-policy refusé"],
        ["/app/messages", "teacher → /app/messages refusé"],
      ] as const) {
        check(label, await denied(page, path));
      }
      // Accès pédagogiques légitimes
      for (const [path, label] of [
        ["/app/grades", "teacher → /app/grades autorisé"],
        ["/app/notifications", "teacher → /app/notifications autorisé"],
        ["/teacher", "teacher → /teacher autorisé"],
      ] as const) {
        const res = await page.goto(path, { waitUntil: "domcontentloaded" });
        check(
          label,
          res?.status() === 200 && page.url().startsWith(BASE + path),
          `${res?.status()} ${page.url()}`,
        );
      }
      await page.close();
    } catch (e) {
      check("enseignant", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- FINANCE_MANAGER ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "finance@demo.local");
      await expectNav(
        "responsable financier",
        page,
        "/app",
        ["Tableau de bord", "Notifications", "Finances"],
        [
          "Élèves", "Enseignants", "Notes", "Bulletins", "Utilisateurs",
          "Règles de notation", "Messagerie",
        ],
      );
      for (const [path, label] of [
        ["/app/students", "finance → /app/students refusé"],
        ["/app/users", "finance → /app/users refusé"],
        ["/teacher", "finance → /teacher refusé"],
      ] as const) {
        check(label, await denied(page, path));
      }
      const res = await page.goto("/app/fees", { waitUntil: "domcontentloaded" });
      check(
        "finance → /app/fees autorisé",
        res?.status() === 200 && page.url().startsWith(`${BASE}/app/fees`),
      );
      await page.close();
    } catch (e) {
      check("responsable financier", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- CASHIER ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "caissier@demo.local");
      await expectNav(
        "caissier",
        page,
        "/app",
        ["Tableau de bord", "Notifications", "Finances"],
        ["Élèves", "Utilisateurs", "Règles de notation", "Messagerie"],
      );
      check("cashier → /app/fees/settings refusé", await denied(page, "/app/fees/settings"));
      check("cashier → /teacher refusé", await denied(page, "/teacher"));
      const res = await page.goto("/app/fees", { waitUntil: "domcontentloaded" });
      check(
        "cashier → /app/fees autorisé",
        res?.status() === 200 && page.url().startsWith(`${BASE}/app/fees`),
      );
      await page.close();
    } catch (e) {
      check("caissier", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  // ---------- PARENT / STUDENT : redirections ----------
  for (const [email, portal, label] of [
    ["parent@demo.local", "/parent", "parent → /app redirige /parent"],
    ["eleve@demo.local", "/student", "élève → /app redirige /student"],
  ] as const) {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, email);
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      check(label, page.url().startsWith(BASE + portal), page.url());
      await page.close();
    } catch (e) {
      check(label, false, String(e).slice(0, 120));
    }
    await ctx.close();
  }

  // ---------- PLATFORM_SALES ----------
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    try {
      const page = await login(ctx, "commercial@ecom-school.local");
      await expectNav(
        "commercial plateforme",
        page,
        "/platform",
        ["Vue générale", "Modules", "Offres", "Abonnements", "Factures"],
        [
          "Établissements", "Demandes", "Création établissement",
          "Administrateurs", "Supervision", "Automatisations", "Audit",
          "Assistance",
        ],
      );
      for (const [path, label] of [
        ["/platform/schools", "sales → /platform/schools refusé"],
        ["/platform/signup-requests", "sales → demandes refusé"],
        ["/platform/administrators", "sales → administrateurs refusé"],
        ["/app", "sales → /app refusé"],
      ] as const) {
        check(label, await denied(page, path));
      }
      await page.close();
    } catch (e) {
      check("commercial plateforme", false, String(e).slice(0, 160));
    }
    await ctx.close();
  }

  await browser.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== RECETTE P1 PREPROD : ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("RECETTE ÉCHOUÉE:", e);
  process.exit(1);
});
