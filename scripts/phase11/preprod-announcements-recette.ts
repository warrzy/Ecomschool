import "dotenv/config";
import { execSync } from "node:child_process";
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { prisma } from "@/lib/db/prisma";
import {
  deleteAnnouncement,
  publishAnnouncement,
  unarchiveAnnouncement,
} from "@/lib/services/announcements";

/**
 * Recette préprod du lot P4 — cycle de vie des annonces.
 * Données de test ISOLÉES (titres préfixés P4R-<ts>) : les annonces métier
 * existantes ne sont jamais modifiées. En fin de recette, les annonces de
 * test jamais publiées sont supprimées ; celles publiées (non supprimables
 * par conception) sont archivées.
 * Le cron P2 réel est invoqué une fois via SSH pour vérifier la publication
 * programmée — aucun fournisseur externe (email/SMS/WhatsApp) n'est appelé.
 *
 * Usage (poste local, tunnel SSH BDD ouvert + E2E_BASE_URL) :
 *   set -a; . /tmp/p4env.txt; set +a
 *   E2E_BASE_URL=https://preprod.ecomschool.fr npx tsx scripts/phase11/preprod-announcements-recette.ts
 */

const BASE = (process.env.E2E_BASE_URL ?? "https://preprod.ecomschool.fr").replace(/\/$/, "");
const PW = process.env.SEED_DEMO_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET;
if (!PW || !CRON_SECRET) {
  console.error("SEED_DEMO_PASSWORD / CRON_SECRET manquants — arrêt.");
  process.exit(1);
}

const TS = Date.now().toString(36);
const T = (s: string) => `P4R ${s} ${TS}`;

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

const notifCount = (userId: string) =>
  prisma.notification.count({
    where: { userId, type: "ANNOUNCEMENT" },
  });

const find = (schoolId: string, title: string) =>
  prisma.announcement.findFirstOrThrow({ where: { schoolId, title } });

async function main() {
  const demo = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
    select: { id: true },
  });
  const other = await prisma.school.findUniqueOrThrow({
    where: { code: "LYC-RECETTE" },
    select: { id: true },
  });
  const [admin, parent, teacher, student, finance] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "admin@demo.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "parent@demo.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "enseignant@demo.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "eleve@demo.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "finance@demo.local" } }),
  ]);
  const ctx = { userId: admin.id, schoolId: demo.id };

  // Annonce publiée dans l'AUTRE établissement (isolation).
  const foreign = await prisma.announcement.create({
    data: {
      schoolId: other.id,
      title: T("AUTRE-ECOLE"),
      body: "Ne doit jamais être visible côté démo.",
      audience: "ALL",
      publishedAt: new Date(),
    },
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE });
  const cleanupIds: string[] = [];

  try {
    // ---------- ADMIN : cycle de vie complet ----------
    const adminPage = await login(context, "admin@demo.local");
    await adminPage.goto("/app/announcements", { waitUntil: "domcontentloaded" });
    check(
      "admin : page rendue (notice, formulaire, filtres)",
      (await adminPage.getByText(/notice d.utilisation/i).count()) > 0 &&
        (await adminPage.getByText(/nouvelle annonce/i).count()) > 0 &&
        (await adminPage.getByRole("button", { name: /filtrer/i }).count()) > 0,
    );

    // 1) Brouillon : création
    await adminPage.getByLabel(/^titre/i).fill(T("Brouillon"));
    await adminPage.getByLabel(/^contenu/i).fill("Contenu v1 du brouillon de recette.");
    await adminPage
      .getByRole("button", { name: /enregistrer comme brouillon/i })
      .click();
    await adminPage.waitForURL(/ok=created/);
    let draft = await find(demo.id, T("Brouillon"));
    cleanupIds.push(draft.id);
    check(
      "brouillon : créé non publié",
      draft.publishedAt === null && draft.scheduledAt === null,
    );
    await adminPage.goto("/app/announcements");
    check(
      "brouillon : badge « Brouillon » + actions",
      (await adminPage
        .locator("tbody tr", { hasText: T("Brouillon") })
        .getByText(/^brouillon$/i)
        .count()) > 0 &&
        (await adminPage
          .locator("tbody tr", { hasText: T("Brouillon") })
          .getByRole("link", { name: /^modifier$/i })
          .count()) > 0,
    );

    // 2) Modification du brouillon
    await adminPage.goto(`/app/announcements?edit=${draft.id}`);
    await adminPage.getByLabel(/^titre/i).fill(T("Brouillon v2"));
    await adminPage.getByLabel(/^contenu/i).fill("Contenu v2 modifié.");
    await adminPage
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await adminPage.waitForURL(/ok=updated/);
    draft = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    check(
      "brouillon : modification persistée",
      draft.title === T("Brouillon v2") && draft.body === "Contenu v2 modifié.",
    );

    // 3) Consultation détaillée
    await adminPage.goto(`/app/announcements?view=${draft.id}`);
    check(
      "consultation : corps complet affiché",
      (await adminPage.getByText("Contenu v2 modifié.").count()) > 0 &&
        (await adminPage.getByText(/retour à la liste/i).count()) > 0,
    );

    // 4) Programmation (édition → date future)
    const future1 = new Date(Date.now() + 3 * 3600_000);
    const future2 = new Date(Date.now() + 5 * 3600_000);
    const toInput = (d: Date) => d.toISOString().slice(0, 16);
    await adminPage.goto(`/app/announcements?edit=${draft.id}`);
    await adminPage.getByLabel(/date de programmation/i).fill(toInput(future1));
    await adminPage
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await adminPage.waitForURL(/ok=updated/);
    draft = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    check(
      "programmation : scheduledAt posé",
      draft.scheduledAt !== null && draft.publishedAt === null,
    );

    // 5) Reprogrammation
    await adminPage.goto(`/app/announcements?edit=${draft.id}`);
    await adminPage.getByLabel(/date de programmation/i).fill(toInput(future2));
    await adminPage
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await adminPage.waitForURL(/ok=updated/);
    draft = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    check(
      "reprogrammation : nouvelle date persistée",
      draft.scheduledAt !== null &&
        Math.abs(draft.scheduledAt.getTime() - future2.getTime()) < 60_000,
    );

    // 6) Annulation de programmation → brouillon
    await adminPage.goto("/app/announcements");
    await adminPage
      .locator("tbody tr", { hasText: T("Brouillon v2") })
      .getByRole("button", { name: /annuler prog/i })
      .click();
    await adminPage.waitForURL(/ok=unscheduled/);
    draft = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    check(
      "annulation : retour brouillon (scheduledAt=null)",
      draft.scheduledAt === null && draft.publishedAt === null,
    );

    // 7) Date passée refusée (édition)
    await adminPage.goto(`/app/announcements?edit=${draft.id}`);
    await adminPage
      .getByLabel(/date de programmation/i)
      .fill("2020-01-01T08:00");
    await adminPage
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await adminPage.waitForURL(/error=PAST_SCHEDULE/);
    check(
      "validation : date passée refusée",
      (await adminPage.getByText(/date choisie est déjà passée/i).count()) > 0,
    );

    // 8) Publication immédiate avec confirmation (audience PARENTS)
    await adminPage.goto(`/app/announcements?edit=${draft.id}`);
    await adminPage.getByLabel(/destinataires/i).selectOption("PARENTS");
    await adminPage
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await adminPage.waitForURL(/ok=updated/);
    const notifBefore = await notifCount(parent.id);
    const teacherNotifBefore = await notifCount(teacher.id);
    await adminPage.goto(`/app/announcements?confirm=publish&id=${draft.id}`);
    check(
      "publication : panneau de confirmation avec nb destinataires",
      (await adminPage.getByText(/notifiera/i).count()) > 0,
    );
    await adminPage
      .getByRole("button", { name: /confirmer la publication/i })
      .click();
    await adminPage.waitForURL(/ok=published/);
    draft = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    const notifAfter = await notifCount(parent.id);
    const lastNotif = await prisma.notification.findFirst({
      where: { userId: parent.id, type: "ANNOUNCEMENT" },
      orderBy: { createdAt: "desc" },
    });
    check(
      "publication : publiée + parent notifié 1× (lien /app/announcements)",
      draft.publishedAt !== null &&
        notifAfter === notifBefore + 1 &&
        lastNotif?.link === "/app/announcements",
    );
    check(
      "ciblage : enseignant NON notifié pour audience PARENTS",
      (await notifCount(teacher.id)) === teacherNotifBefore,
    );

    // 9) Re-publication forcée : aucun doublon
    await adminPage.goto(`/app/announcements?confirm=publish&id=${draft.id}`);
    await adminPage
      .getByRole("button", { name: /confirmer la publication/i })
      .click();
    await adminPage.waitForURL(/ok=published/);
    check(
      "déduplication : re-publication sans notification en double",
      (await notifCount(parent.id)) === notifBefore + 1,
    );

    // 10) Publiée : contenu figé (pas de bouton Modifier)
    await adminPage.goto("/app/announcements");
    check(
      "publiée : aucune action Modifier/Supprimer exposée",
      (await adminPage
        .locator("tbody tr", { hasText: T("Brouillon v2") })
        .getByRole("link", { name: /^modifier$/i })
        .count()) === 0 &&
        (await adminPage
          .locator("tbody tr", { hasText: T("Brouillon v2") })
          .getByRole("link", { name: /^supprimer$/i })
          .count()) === 0,
    );

    // 11) Publication programmée via le cron P2 réel (annonce insérée « due »)
    const studentBefore = await notifCount(student.id);
    const cronAnn = await prisma.announcement.create({
      data: {
        schoolId: demo.id,
        title: T("Cron"),
        body: "Publication programmée — recette cron réelle.",
        audience: "STUDENTS",
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });
    cleanupIds.push(cronAnn.id);
    const cronOut = execSync(
      `ssh ecomschool-preprod "curl -fsS -o /dev/null -w '%{http_code}' -m 60 -H 'Authorization: Bearer ${CRON_SECRET}' http://127.0.0.1:3001/api/cron"`,
      { timeout: 90_000 },
    )
      .toString()
      .trim();
    const cronAfter = await prisma.announcement.findUniqueOrThrow({
      where: { id: cronAnn.id },
    });
    check(
      "cron P2 : annonce due publiée (HTTP " + cronOut + ")",
      cronOut === "200" && cronAfter.publishedAt !== null,
    );
    check(
      "cron P2 : élève notifié une fois",
      (await notifCount(student.id)) === studentBefore + 1,
    );
    // Relance cron : idempotence (aucun doublon)
    execSync(
      `ssh ecomschool-preprod "curl -fsS -o /dev/null -m 60 -H 'Authorization: Bearer ${CRON_SECRET}' http://127.0.0.1:3001/api/cron"`,
      { timeout: 90_000 },
    );
    check(
      "cron P2 : relance idempotente (pas de 2e notification)",
      (await notifCount(student.id)) === studentBefore + 1,
    );

    // 12) Archivage avec confirmation
    await adminPage.goto(`/app/announcements?confirm=archive&id=${draft.id}`);
    await adminPage
      .getByRole("button", { name: /confirmer l.archivage/i })
      .click();
    await adminPage.waitForURL(/ok=archived/);
    draft = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    check("archivage : archivedAt posé", draft.archivedAt !== null);

    // 13) Désarchivage refusé pour une publiée + suppression refusée (service)
    const unarchPub = await unarchiveAnnouncement(ctx, draft.id);
    const delPub = await deleteAnnouncement(ctx, draft.id);
    check(
      "publiée archivée : désarchivage ET suppression refusés",
      !unarchPub.ok && !delPub.ok && delPub.error === "FORBIDDEN",
    );

    // 14) Jamais publiée : archivée → désarchivée → supprimée
    const tmp = await prisma.announcement.create({
      data: {
        schoolId: demo.id,
        title: T("Temporaire"),
        body: "b",
        audience: "ALL",
        archivedAt: new Date(),
      },
    });
    const unarch = await unarchiveAnnouncement(ctx, tmp.id);
    const tmpAfter = await prisma.announcement.findUniqueOrThrow({
      where: { id: tmp.id },
    });
    check(
      "désarchivage jamais publiée → brouillon",
      unarch.ok && tmpAfter.archivedAt === null && tmpAfter.publishedAt === null,
    );
    const del = await deleteAnnouncement(ctx, tmp.id);
    const gone = await prisma.announcement.findUnique({ where: { id: tmp.id } });
    check("suppression jamais publiée : ligne supprimée", del.ok && gone === null);

    // 15) Isolation tenant : annonce d'une autre école invisible/non opérable
    await adminPage.goto(`/app/announcements?view=${foreign.id}`);
    check(
      "isolation : ?view=annonce-autre-école n'affiche rien",
      (await adminPage.getByText("Ne doit jamais être visible").count()) === 0,
    );
    const foreignPub = await publishAnnouncement(ctx, foreign.id);
    check(
      "isolation : opération sur autre école refusée",
      !foreignPub.ok && foreignPub.error === "NOT_FOUND",
    );

    // ---------- VISIBILITÉ PAR RÔLE ----------
    // Annonces publiées par audience (insérées publiées — la notification
    // n'est pas rejouée ; on teste la visibilité, pas l'envoi).
    const vis = async (aud: "ALL" | "PARENTS" | "TEACHERS" | "STUDENTS", t: string) => {
      const a = await prisma.announcement.create({
        data: {
          schoolId: demo.id,
          title: t,
          body: `Visibilité ${aud}`,
          audience: aud,
          publishedAt: new Date(),
        },
      });
      cleanupIds.push(a.id);
      return a;
    };
    await vis("ALL", T("Vis-ALL"));
    await vis("PARENTS", T("Vis-PARENTS"));
    await vis("TEACHERS", T("Vis-TEACHERS"));
    await vis("STUDENTS", T("Vis-STUDENTS"));

    const sees = async (page: Page, path: string, title: string) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      return (await page.getByText(title).count()) > 0;
    };

    const teacherPage = await login(context, "enseignant@demo.local");
    check(
      "enseignant : voit ALL + TEACHERS, pas PARENTS ; pas de formulaire",
      (await sees(teacherPage, "/app/announcements", T("Vis-ALL"))) &&
        (await sees(teacherPage, "/app/announcements", T("Vis-TEACHERS"))) &&
        !(await sees(teacherPage, "/app/announcements", T("Vis-PARENTS"))) &&
        (await teacherPage.getByText(/nouvelle annonce/i).count()) === 0,
    );

    // FINANCE_MANAGER/CASHIER n'ont pas announcements.read : aucun droit
    // annonces → la page doit être inaccessible (comportement attendu).
    const financePage = await login(context, "finance@demo.local");
    await financePage.goto("/app/announcements", {
      waitUntil: "domcontentloaded",
    });
    await financePage.waitForTimeout(1200);
    const fUrl = financePage.url();
    const fBody = await financePage.locator("body").innerText();
    check(
      "finance : sans announcements.read → page inaccessible",
      !fUrl.includes("/app/announcements") ||
        /refusé|non autorisé|introuvable|404/i.test(fBody),
      fUrl,
    );

    const parentPage = await login(context, "parent@demo.local");
    check(
      "parent : portail voit PARENTS + ALL, pas TEACHERS",
      (await sees(parentPage, "/parent?tab=annonces", T("Vis-PARENTS"))) &&
        (await sees(parentPage, "/parent?tab=annonces", T("Vis-ALL"))) &&
        !(await sees(parentPage, "/parent?tab=annonces", T("Vis-TEACHERS"))),
    );

    const studentPage = await login(context, "eleve@demo.local");
    check(
      "élève : portail voit STUDENTS + ALL, pas PARENTS",
      (await sees(studentPage, "/student?tab=annonces", T("Vis-STUDENTS"))) &&
        (await sees(studentPage, "/student?tab=annonces", T("Vis-ALL"))) &&
        !(await sees(studentPage, "/student?tab=annonces", T("Vis-PARENTS"))),
    );

    // ---------- NON-RÉGRESSION ----------
    const ok200 = async (page: Page, path: string) => {
      const r = await page.goto(path, { waitUntil: "domcontentloaded" });
      return r?.status() === 200;
    };
    check(
      "non-régression : P3 règles de notation + bulletins",
      (await ok200(adminPage, "/app/grading-policy")) &&
        (await ok200(adminPage, "/app/report-cards")),
    );
    check(
      "non-régression : portails enseignant/parent/élève",
      (await ok200(teacherPage, "/teacher")) &&
        (await ok200(parentPage, "/parent")) &&
        (await ok200(studentPage, "/student")),
    );
    const unauth = await fetch(`${BASE}/api/cron`, { method: "POST" });
    check(
      "cron : endpoint protégé sans secret",
      unauth.status === 401 || unauth.status === 403,
      `HTTP ${unauth.status}`,
    );
  } finally {
    // Nettoyage : jamais publiées → suppression ; publiées → archivage.
    for (const id of cleanupIds) {
      const a = await prisma.announcement.findUnique({ where: { id } });
      if (!a) continue;
      if (!a.publishedAt) {
        await prisma.announcement.delete({ where: { id } }).catch(() => null);
      } else if (!a.archivedAt) {
        await prisma.announcement.update({
          where: { id },
          data: { archivedAt: new Date() },
        });
      }
    }
    await prisma.announcement.delete({ where: { id: foreign.id } }).catch(() =>
      prisma.announcement.update({
        where: { id: foreign.id },
        data: { archivedAt: new Date() },
      }),
    );
    await context.close();
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
