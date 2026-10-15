import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * P4 — module annonces : cycle de vie, ciblage, permissions.
 * Les données sont créées dans l'école démo avec des titres préfixés E2E
 * et nettoyées en fin de test lorsque possible.
 */

const SUFFIX = Date.now().toString(36);
const T = (s: string) => `E2E ${s} ${SUFFIX}`;

async function demoSchoolId() {
  const s = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
    select: { id: true },
  });
  return s.id;
}

async function userIdOf(email: string) {
  return (
    await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })
  ).id;
}

/** Date locale "YYYY-MM-DDThh:mm" dans le futur pour <input datetime-local>. */
function futureLocal(days = 7) {
  const d = new Date(Date.now() + days * 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T08:00`;
}

test.describe("Annonces — administration", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("interface : formulaire libellé, notice, filtres, badges", async ({
    page,
  }) => {
    await page.goto("/app/announcements");
    await expect(page.getByLabel(/^titre/i)).toBeVisible();
    await expect(page.getByLabel(/^contenu/i)).toBeVisible();
    await expect(page.getByLabel(/destinataires/i)).toBeVisible();
    await expect(page.getByLabel(/date de programmation/i)).toBeVisible();
    for (const b of [
      /enregistrer comme brouillon/i,
      /programmer la publication/i,
      /enregistrer et publier/i,
    ]) {
      await expect(page.getByRole("button", { name: b })).toBeVisible();
    }
    // Notice
    const notice = page.locator("details#notice");
    await notice.locator("summary").click();
    await expect(notice).toHaveAttribute("open", "");
    for (const c of ["Cycle de vie", "Modification", "Destinataires", "Archivage et suppression"]) {
      await expect(notice.getByText(c, { exact: true })).toBeVisible();
    }
    // Filtres
    await expect(page.getByLabel(/^statut$/i)).toBeVisible();
    await expect(page.getByLabel(/^audience$/i)).toBeVisible();
  });

  test("brouillon : création, modification, consultation", async ({ page }) => {
    const schoolId = await demoSchoolId();
    await page.goto("/app/announcements");
    await page.getByLabel(/^titre/i).fill(T("Brouillon"));
    await page.getByLabel(/^contenu/i).fill("Contenu de test brouillon.");
    await page.getByLabel(/destinataires/i).selectOption("PARENTS");
    await page
      .getByRole("button", { name: /enregistrer comme brouillon/i })
      .click();
    await page.waitForURL(/ok=created/);

    const draft = await prisma.announcement.findFirstOrThrow({
      where: { schoolId, title: T("Brouillon") },
    });
    expect(draft.publishedAt).toBeNull();
    expect(draft.scheduledAt).toBeNull();
    expect(draft.archivedAt).toBeNull();

    // Consultation détaillée
    const row = page.locator("tbody tr", { hasText: T("Brouillon") });
    await row.getByRole("link", { name: T("Brouillon") }).click();
    await page.waitForURL(/view=/);
    await expect(page.getByText("Contenu de test brouillon.")).toBeVisible();
    await page.getByRole("link", { name: /retour à la liste/i }).click();

    // Modification
    await page
      .locator("tbody tr", { hasText: T("Brouillon") })
      .getByRole("link", { name: /^modifier$/i })
      .click();
    await page.waitForURL(/edit=/);
    await page.getByLabel(/^titre/i).fill(T("Brouillon modifié"));
    await page
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await page.waitForURL(/ok=updated/);
    const updated = await prisma.announcement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(updated.title).toBe(T("Brouillon modifié"));
    expect(updated.publishedAt).toBeNull();

    await prisma.announcement.delete({ where: { id: draft.id } });
  });

  test("programmation : création, annulation, reprogrammation", async ({
    page,
  }) => {
    const schoolId = await demoSchoolId();
    await page.goto("/app/announcements");
    await page.getByLabel(/^titre/i).fill(T("Programmée"));
    await page.getByLabel(/^contenu/i).fill("Annonce programmée.");
    await page.getByLabel(/date de programmation/i).fill(futureLocal());
    await page
      .getByRole("button", { name: /programmer la publication/i })
      .click();
    await page.waitForURL(/ok=scheduled/);

    const ann = await prisma.announcement.findFirstOrThrow({
      where: { schoolId, title: T("Programmée") },
    });
    expect(ann.scheduledAt).not.toBeNull();
    expect(ann.publishedAt).toBeNull();

    // Annulation → brouillon
    await page
      .locator("tbody tr", { hasText: T("Programmée") })
      .getByRole("button", { name: /annuler prog/i })
      .click();
    await page.waitForURL(/ok=unscheduled/);
    const unsched = await prisma.announcement.findUniqueOrThrow({
      where: { id: ann.id },
    });
    expect(unsched.scheduledAt).toBeNull();

    // Reprogrammation via édition
    await page
      .locator("tbody tr", { hasText: T("Programmée") })
      .getByRole("link", { name: /^modifier$/i })
      .click();
    await page.waitForURL(/edit=/);
    await page.getByLabel(/date de programmation/i).fill(futureLocal(14));
    await page
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await page.waitForURL(/ok=updated/);
    expect(
      (await prisma.announcement.findUniqueOrThrow({ where: { id: ann.id } }))
        .scheduledAt,
    ).not.toBeNull();

    // Date passée refusée
    await page
      .locator("tbody tr", { hasText: T("Programmée") })
      .getByRole("link", { name: /^modifier$/i })
      .click();
    await page.waitForURL(/edit=/);
    await page.getByLabel(/date de programmation/i).fill("2020-01-01T08:00");
    await page
      .getByRole("button", { name: /enregistrer les modifications/i })
      .click();
    await page.waitForURL(/error=PAST_SCHEDULE/);
    await expect(page.getByText(/date choisie est déjà passée/i)).toBeVisible();

    await prisma.announcement.delete({ where: { id: ann.id } });
  });

  test("publication : confirmation, notification ciblée, pas de doublon", async ({
    page,
  }) => {
    const schoolId = await demoSchoolId();
    const parentId = await userIdOf("parent@demo.local");
    const teacherId = await userIdOf("enseignant@demo.local");
    const before = await prisma.notification.count({
      where: { userId: parentId, type: "ANNOUNCEMENT" },
    });
    const beforeTeacher = await prisma.notification.count({
      where: { userId: teacherId, type: "ANNOUNCEMENT" },
    });

    await page.goto("/app/announcements");
    await page.getByLabel(/^titre/i).fill(T("Cible parents"));
    await page.getByLabel(/^contenu/i).fill("Annonce ciblée parents.");
    await page.getByLabel(/destinataires/i).selectOption("PARENTS");
    await page
      .getByRole("button", { name: /enregistrer et publier/i })
      .click();
    await page.waitForURL(/ok=published/);

    const ann = await prisma.announcement.findFirstOrThrow({
      where: { schoolId, title: T("Cible parents") },
    });
    expect(ann.publishedAt).not.toBeNull();
    expect(ann.schoolId).toBe(schoolId); // isolation : école démo uniquement

    // Ciblage : le parent est notifié, pas l'enseignant
    expect(
      await prisma.notification.count({
        where: { userId: parentId, type: "ANNOUNCEMENT" },
      }),
    ).toBe(before + 1);
    expect(
      await prisma.notification.count({
        where: { userId: teacherId, type: "ANNOUNCEMENT" },
      }),
    ).toBe(beforeTeacher);

    // Re-publication forcée (URL de confirmation) → idempotente, pas de doublon
    await page.goto(`/app/announcements?confirm=publish&id=${ann.id}`);
    await page
      .getByRole("button", { name: /confirmer la publication/i })
      .click();
    await page.waitForURL(/ok=published/);
    expect(
      await prisma.notification.count({
        where: { userId: parentId, type: "ANNOUNCEMENT" },
      }),
    ).toBe(before + 1);

    // La confirmation de publication affiche le nombre de destinataires
    // (sur une seconde annonce brouillon)
    await page.goto("/app/announcements");
    await page.getByLabel(/^titre/i).fill(T("Confirm"));
    await page.getByLabel(/^contenu/i).fill("x");
    await page
      .getByRole("button", { name: /enregistrer comme brouillon/i })
      .click();
    await page.waitForURL(/ok=created/);
    await page
      .locator("tbody tr", { hasText: T("Confirm") })
      .getByRole("link", { name: /publier/i })
      .click();
    await page.waitForURL(/confirm=publish/);
    await expect(page.getByText(/notifiera/i)).toBeVisible();
    await page
      .getByRole("button", { name: /confirmer la publication/i })
      .click();
    await page.waitForURL(/ok=published/);

    await prisma.announcement.deleteMany({
      where: { schoolId, title: { in: [T("Cible parents"), T("Confirm")] } },
    });
  });

  test("archivage avec confirmation ; désarchivage réservé aux jamais-publiées", async ({
    page,
  }) => {
    const schoolId = await demoSchoolId();
    // Annonce jamais publiée
    const never = await prisma.announcement.create({
      data: {
        schoolId,
        title: T("Jamais publiée"),
        body: "b",
        audience: "ALL",
      },
    });
    // Annonce publiée
    const pub = await prisma.announcement.create({
      data: {
        schoolId,
        title: T("Publiée"),
        body: "b",
        audience: "ALL",
        publishedAt: new Date(),
      },
    });

    await page.goto("/app/announcements");
    // Archiver la publiée → confirmation
    await page
      .locator("tbody tr", { hasText: T("Publiée") })
      .getByRole("link", { name: /archiver/i })
      .click();
    await page.waitForURL(/confirm=archive/);
    await expect(page.getByText(/retirera des portails/i)).toBeVisible();
    await page
      .getByRole("button", { name: /confirmer l.archivage/i })
      .click();
    await page.waitForURL(/ok=archived/);
    expect(
      (await prisma.announcement.findUniqueOrThrow({ where: { id: pub.id } }))
        .archivedAt,
    ).not.toBeNull();

    // La publiée archivée n'a PAS de bouton Désarchiver
    const pubRow = page.locator("tbody tr", { hasText: T("Publiée") });
    await expect(pubRow.getByText("Archivée", { exact: true })).toBeVisible();
    expect(await pubRow.getByRole("button", { name: /désarchiver/i }).count()).toBe(0);

    // La jamais-publiée : archiver puis désarchiver → redevient brouillon
    await page
      .locator("tbody tr", { hasText: T("Jamais publiée") })
      .getByRole("link", { name: /archiver/i })
      .click();
    await page.waitForURL(/confirm=archive/);
    await page
      .getByRole("button", { name: /confirmer l.archivage/i })
      .click();
    await page.waitForURL(/ok=archived/);
    await page
      .locator("tbody tr", { hasText: T("Jamais publiée") })
      .getByRole("button", { name: /désarchiver/i })
      .click();
    await page.waitForURL(/ok=unarchived/);
    const un = await prisma.announcement.findUniqueOrThrow({
      where: { id: never.id },
    });
    expect(un.archivedAt).toBeNull();
    expect(un.publishedAt).toBeNull();

    await prisma.announcement.deleteMany({
      where: { id: { in: [never.id, pub.id] } },
    });
  });

  test("suppression : autorisée si jamais publiée, refusée sinon", async ({
    page,
  }) => {
    const schoolId = await demoSchoolId();
    const draft = await prisma.announcement.create({
      data: { schoolId, title: T("À effacer"), body: "b", audience: "ALL" },
    });
    const pub = await prisma.announcement.create({
      data: {
        schoolId,
        title: T("Publiée non supprimable"),
        body: "b",
        audience: "ALL",
        publishedAt: new Date(),
      },
    });

    await page.goto("/app/announcements");
    // Suppression du brouillon → confirmation irréversible
    await page
      .locator("tbody tr", { hasText: T("À effacer") })
      .getByRole("link", { name: /^supprimer$/i })
      .click();
    await page.waitForURL(/confirm=delete/);
    await expect(
      page.getByText(/confirmer la suppression définitive/i),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /supprimer définitivement/i })
      .click();
    await page.waitForURL(/ok=deleted/);
    expect(
      await prisma.announcement.findUnique({ where: { id: draft.id } }),
    ).toBeNull();

    // Suppression forcée par URL sur une publiée → refus serveur FORBIDDEN
    await page.goto(`/app/announcements?confirm=delete&id=${pub.id}`);
    await page
      .getByRole("button", { name: /supprimer définitivement/i })
      .click();
    await page.waitForURL(/error=FORBIDDEN/);
    await expect(page.getByText(/suppression refusée/i)).toBeVisible();
    expect(
      await prisma.announcement.findUnique({ where: { id: pub.id } }),
    ).not.toBeNull();

    await prisma.announcement.delete({ where: { id: pub.id } });
  });

  test("filtres statut et audience", async ({ page }) => {
    const schoolId = await demoSchoolId();
    await prisma.announcement.create({
      data: {
        schoolId,
        title: T("Filtre brouillon"),
        body: "b",
        audience: "TEACHERS",
      },
    });
    await page.goto("/app/announcements?status=draft&audience=TEACHERS");
    await expect(
      page.locator("tbody tr", { hasText: T("Filtre brouillon") }),
    ).toBeVisible();
    // Le filtre publié masque le brouillon
    await page.goto("/app/announcements?status=published");
    expect(
      await page
        .locator("tbody tr", { hasText: T("Filtre brouillon") })
        .count(),
    ).toBe(0);
    await prisma.announcement.deleteMany({
      where: { schoolId, title: T("Filtre brouillon") },
    });
  });
});

test.describe("Annonces — visibilité enseignant", () => {
  test.use({ storageState: "e2e/.auth/demoTeacher.json" });

  test("enseignant : lecture seule filtrée par audience", async ({ page }) => {
    const schoolId = await demoSchoolId();
    await prisma.announcement.createMany({
      data: [
        {
          schoolId,
          title: T("Pour enseignants"),
          body: "b",
          audience: "TEACHERS",
          publishedAt: new Date(),
        },
        {
          schoolId,
          title: T("Pour parents"),
          body: "CORPS-PARENT-UNIQUE",
          audience: "PARENTS",
          publishedAt: new Date(),
        },
        {
          schoolId,
          title: T("Brouillon caché"),
          body: "b",
          audience: "TEACHERS",
        },
      ],
    });
    await page.goto("/app/announcements");
    // L'enseignant voit l'annonce TEACHERS publiée, pas les autres
    await expect(
      page.locator("tbody tr", { hasText: T("Pour enseignants") }),
    ).toBeVisible();
    expect(
      await page.locator("tbody tr", { hasText: T("Pour parents") }).count(),
    ).toBe(0);
    expect(
      await page.locator("tbody tr", { hasText: T("Brouillon caché") }).count(),
    ).toBe(0);
    // Pas de formulaire ni d'actions de gestion
    expect(await page.getByLabel(/^titre/i).count()).toBe(0);
    expect(await page.getByRole("link", { name: /^modifier$/i }).count()).toBe(0);
    // Consultation directe d'une annonce hors audience → non listée
    const forbidden = await prisma.announcement.findFirstOrThrow({
      where: { schoolId, title: T("Pour parents") },
    });
    await page.goto(`/app/announcements?view=${forbidden.id}`);
    // Le panneau de consultation n'affiche pas le corps hors audience
    await expect(
      page.getByText("CORPS-PARENT-UNIQUE"),
    ).toHaveCount(0);
    await prisma.announcement.deleteMany({
      where: {
        schoolId,
        title: {
          in: [T("Pour enseignants"), T("Pour parents"), T("Brouillon caché")],
        },
      },
    });
  });
});

test.describe("Annonces — portail parent", () => {
  test.use({ storageState: "e2e/.auth/demoParent.json" });

  test("parent : annonce PARENTS publiée visible sur son portail", async ({
    page,
  }) => {
    const schoolId = await demoSchoolId();
    await prisma.announcement.create({
      data: {
        schoolId,
        title: T("Annonce parents"),
        body: "Information pour les parents.",
        audience: "PARENTS",
        publishedAt: new Date(),
      },
    });
    await page.goto("/parent?tab=annonces");
    await expect(page.getByText(T("Annonce parents"))).toBeVisible();
    await prisma.announcement.deleteMany({
      where: { schoolId, title: T("Annonce parents") },
    });
  });
});
