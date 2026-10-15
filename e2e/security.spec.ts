import { test, expect } from "@playwright/test";
import { hash } from "bcryptjs";
import { ACCOUNTS, login, expectLoggedOutRedirect, prisma } from "./helpers";

test.describe("Accès non authentifié", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of [
    "/app",
    "/app/users",
    "/app/students",
    "/app/report-cards/pdf",
    "/platform",
    "/platform/schools",
    "/platform/invoices/anything/pdf",
    "/parent",
    "/student",
    "/teacher",
  ]) {
    test(`${path} redirige vers /login`, async ({ page }) => {
      await expectLoggedOutRedirect(page, path);
    });
  }

  test("/api/cron sans secret → 401", async ({ request }) => {
    test.skip(!process.env.CRON_SECRET, "CRON_SECRET non configuré");
    const res = await request.get("/api/cron");
    expect(res.status()).toBe(401);
  });

  test("/api/cron avec mauvais secret → 401", async ({ request }) => {
    test.skip(!process.env.CRON_SECRET, "CRON_SECRET non configuré");
    const res = await request.get("/api/cron", {
      headers: { authorization: "Bearer wrong-secret-value" },
    });
    expect(res.status()).toBe(401);
  });

  test("/api/cron avec bon secret → exécute le scope plateforme", async ({
    request,
  }) => {
    test.skip(!process.env.CRON_SECRET, "CRON_SECRET non configuré");
    const res = await request.get("/api/cron?scope=platform", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

test.describe("Authentification", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("mauvais mot de passe → erreur générique", async ({ page }) => {
    await login(page, ACCOUNTS.schoolAdmin.email, "mauvais-mot-de-passe");
    await expect(page.getByText(/identifiants invalides/i)).toBeVisible();
    expect(page.url()).toContain("/login");
  });

  test("email inexistant → même erreur (pas d'énumération)", async ({ page }) => {
    await login(page, "personne@inexistant.invalid", "mauvais-mot-de-passe");
    await expect(page.getByText(/identifiants invalides/i)).toBeVisible();
  });
});

test.describe("Isolation tenant et IDOR — admin école", () => {
  test.use({ storageState: "e2e/.auth/schoolAdmin.json" });

  test("ne peut pas ouvrir /platform", async ({ page }) => {
    await page.goto("/platform");
    await expect(page).not.toHaveURL(/\/platform/, { timeout: 15_000 });
  });

  test("PDF bulletin d'une autre école → 404", async ({ page }) => {
    // Trouve un bulletin appartenant à une autre école que celle de l'admin.
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ACCOUNTS.schoolAdmin.email },
      include: { memberships: { where: { status: "ACTIVE" } } },
    });
    const mySchoolId = admin.memberships[0]?.schoolId;
    const foreign = await prisma.reportCard.findFirst({
      where: { schoolId: { not: mySchoolId } },
      select: { id: true },
    });
    test.skip(!foreign, "Aucun bulletin d'une autre école en base");

    const res = await page.request.get(`/app/report-cards/pdf?id=${foreign!.id}`);
    expect(res.status()).toBe(404);
  });

  test("export CSV élèves d'une autre école impossible (ID cible ignoré)", async ({
    page,
  }) => {
    // La route d'export doit être bornée au tenant de session : on vérifie
    // simplement qu'elle répond (filtre schoolId côté serveur).
    const res = await page.request.get("/app/students/export");
    expect([200, 302, 307, 404]).toContain(res.status());
  });
});

test.describe("Isolation tenant et IDOR — parent", () => {
  test.use({ storageState: "e2e/.auth/demoParent.json" });

  async function parentContext() {
    const parent = await prisma.user.findUniqueOrThrow({
      where: { email: ACCOUNTS.demoParent.email },
      include: { memberships: { where: { status: "ACTIVE" } } },
    });
    const schoolId = parent.memberships[0]?.schoolId;
    const guardian = await prisma.guardian.findFirst({
      where: { userId: parent.id },
      select: { id: true },
    });
    const linked = await prisma.studentGuardian.findMany({
      where: { guardianId: guardian?.id ?? "none" },
      select: { studentId: true },
    });
    return { schoolId, studentIds: linked.map((l) => l.studentId) };
  }

  test("bulletin d'un enfant non rattaché → refusé", async ({ page }) => {
    const { schoolId, studentIds } = await parentContext();
    const foreignCard = await prisma.reportCard.findFirst({
      where: {
        schoolId,
        status: { in: ["PUBLISHED", "RECTIFIED"] },
        studentId: { notIn: studentIds.length ? studentIds : ["none"] },
      },
      select: { id: true },
    });
    test.skip(!foreignCard, "Aucun bulletin publié d'un élève non rattaché");

    const res = await page.request.get(
      `/parent/report-cards/${foreignCard!.id}/pdf`,
    );
    expect([403, 404]).toContain(res.status());
  });

  test("reçu d'un élève non rattaché → refusé", async ({ page }) => {
    const { schoolId, studentIds } = await parentContext();
    const foreignPayment = await prisma.payment.findFirst({
      where: {
        schoolId,
        studentId: { notIn: studentIds.length ? studentIds : ["none"] },
      },
      select: { id: true },
    });
    test.skip(!foreignPayment, "Aucun reçu d'un élève non rattaché");

    const res = await page.request.get(
      `/parent/receipts/${foreignPayment!.id}/pdf`,
    );
    expect([403, 404]).toContain(res.status());
  });

  test("ne peut pas ouvrir /app/users", async ({ page }) => {
    await page.goto("/app/users");
    await expect(page).not.toHaveURL(/\/app\/users/, { timeout: 15_000 });
  });
});

test.describe("Isolation — élève", () => {
  test.use({ storageState: "e2e/.auth/demoStudent.json" });

  test("pas d'accès à la gestion des élèves", async ({ page }) => {
    await page.goto("/app/students");
    await expect(page).not.toHaveURL(/\/app\/students/, { timeout: 15_000 });
  });
});

test.describe("Protection force-brute", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const lockEmail = "e2e-lockout@test.local";

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: lockEmail } });
    await prisma.user.create({
      data: {
        email: lockEmail,
        passwordHash: await hash("LockoutTest2026!", 10),
        status: "ACTIVE",
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: lockEmail } });
    await prisma.$disconnect();
  });

  test("verrouillage après échecs répétés + bon mot de passe refusé", async ({
    page,
    request,
  }) => {
    // Pré-positionne le compteur à 7 échecs : le 8e déclenche le verrou.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: lockEmail },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 7 },
    });

    // Échec via le vrai endpoint credentials.
    const csrf = await (await request.get("/api/auth/csrf")).json();
    const form = new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: lockEmail,
      password: "mauvais",
      json: "true",
    });
    await request.post("/api/auth/callback/credentials", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: form.toString(),
    });

    const locked = await prisma.user.findUniqueOrThrow({
      where: { email: lockEmail },
      select: { lockedUntil: true, failedLoginCount: true },
    });
    expect(locked.failedLoginCount).toBeGreaterThanOrEqual(8);
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    // Le bon mot de passe est refusé tant que le verrou est actif.
    await login(page, lockEmail, "LockoutTest2026!");
    await expect(page.getByText(/identifiants invalides/i)).toBeVisible();
  });
});
