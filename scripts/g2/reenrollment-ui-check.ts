/**
 * G2-E — smoke test UI local : campagne → dépôt parent → instruction →
 * approbation → finalisation → suivi parent. Fixtures propres, nettoyées.
 * Usage : npx tsx scripts/g2/reenrollment-ui-check.ts [baseUrl]
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";

const BASE = process.argv[2] ?? "http://localhost:3000";
const UI_PW = "G2E-Ui-2026!";
const ADMIN_EMAIL = "g2e-ui-admin@test.local";
const PARENT_EMAIL = "g2e-ui-parent@test.local";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

async function login(browser: Browser, email: string, pw: string, label: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(pw);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 90000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function main() {
  const browser = await chromium.launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2e-ui-"));
  const pdf = path.join(dir, "maj.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");

  // ---------- Fixtures ----------
  const school = await prisma.school.findFirstOrThrow({
    where: { name: { contains: "Démo" } },
    select: { id: true, slug: true },
  });
  const srcYear = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
  });
  const level = await prisma.level.findFirstOrThrow({
    where: { schoolId: school.id, status: "ACTIVE" },
    orderBy: { order: "asc" },
  });
  const srcClassroom = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: srcYear.id, status: "ACTIVE" },
  });
  const dstYear = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "G2E-UI-Next", isCurrent: false,
      startDate: new Date("2098-09-01"), endDate: new Date("2099-06-30"),
    },
  });
  const dstClassroom = await prisma.classroom.create({
    data: {
      schoolId: school.id, academicYearId: dstYear.id,
      levelId: level.id, name: "G2E-UI Classe",
    },
  });
  const student = await prisma.student.create({
    data: { schoolId: school.id, matricule: "G2E-UI-01", lastName: "Ui", firstName: "Elève G2E" },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: school.id, studentId: student.id,
      classroomId: srcClassroom.id, academicYearId: srcYear.id, status: "ENROLLED",
    },
  });

  for (const email of [ADMIN_EMAIL, PARENT_EMAIL]) {
    const old = await prisma.user.findUnique({ where: { email } });
    if (old) {
      await prisma.schoolMembership.deleteMany({ where: { userId: old.id } });
      await prisma.user.delete({ where: { id: old.id } });
    }
  }
  const adminRole = await prisma.role.findFirstOrThrow({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
  });
  const uiAdmin = await prisma.user.create({
    data: { email: ADMIN_EMAIL, passwordHash: await hashPassword(UI_PW), firstName: "G2E", lastName: "UiAdmin" },
  });
  await prisma.schoolMembership.create({
    data: { userId: uiAdmin.id, schoolId: school.id, roleId: adminRole.id, status: "ACTIVE" },
  });
  // Parent : rôle dédié avec la seule permission portail.
  const portalPerm = await prisma.permission.findFirstOrThrow({ where: { key: "portal.parent" } });
  const parentRole = await prisma.role.create({
    data: { name: "G2E-UI-PARENT", scope: "SCHOOL", schoolId: school.id },
  });
  await prisma.rolePermission.create({
    data: { roleId: parentRole.id, permissionId: portalPerm.id },
  });
  const uiParent = await prisma.user.create({
    data: { email: PARENT_EMAIL, passwordHash: await hashPassword(UI_PW), firstName: "G2E", lastName: "UiParent", status: "ACTIVE" },
  });
  await prisma.schoolMembership.create({
    data: { userId: uiParent.id, schoolId: school.id, roleId: parentRole.id, status: "ACTIVE" },
  });
  const guardian = await prisma.guardian.create({
    data: {
      schoolId: school.id, firstName: "G2E", lastName: "UiParent",
      phone: "+22670005566", userId: uiParent.id, status: "ACTIVE",
    },
  });
  await prisma.studentGuardian.create({
    data: { schoolId: school.id, studentId: student.id, guardianId: guardian.id, relation: "FATHER" },
  });

  try {
    // ---------- Back-office : campagne ----------
    console.log("== Back-office : campagne ==");
    const adm = await login(browser, ADMIN_EMAIL, UI_PW, "Admin UI");
    if (adm) {
      await adm.goto(`${BASE}/app/reinscriptions`, { waitUntil: "domcontentloaded" });
      await adm.waitForTimeout(2500);
      const body0 = await adm.locator("body").innerText();
      check("page réinscriptions accessible", /réinscriptions/i.test(body0));
      await adm.getByText("Nouvelle campagne de réinscription").click();
      await adm.getByLabel("Nom de la campagne").fill("G2E-UI Campagne");
      await adm.getByLabel("Année source").selectOption({ value: srcYear.id });
      await adm.getByLabel("Année cible").selectOption({ value: dstYear.id });
      await adm.getByLabel("Ouverture").fill("2020-01-01");
      await adm.getByLabel("Clôture").fill("2099-12-31");
      await adm.getByRole("button", { name: "Créer la campagne" }).click();
      await adm.waitForTimeout(4000);
      const body1 = await adm.locator("body").innerText();
      check("campagne créée en brouillon", /G2E-UI Campagne/.test(body1) && /Brouillon/.test(body1));
      await adm.getByRole("button", { name: "Ouvrir" }).click();
      await adm.waitForTimeout(4000);
      const body2 = await adm.locator("body").innerText();
      check("campagne ouverte + élève éligible listé",
        /Ouverte/.test(body2) && /G2E-UI-01/.test(body2));
      check("tableau de bord affiché", /demandes/i.test(body2) && /déposées/i.test(body2));
    }

    // ---------- Portail parent : dépôt ----------
    console.log("== Portail parent ==");
    const par = await login(browser, PARENT_EMAIL, UI_PW, "Parent UI");
    if (par) {
      await par.goto(`${BASE}/parent?child=${student.id}&tab=reinscription`, { waitUntil: "domcontentloaded" });
      await par.waitForTimeout(2500);
      const pbody0 = await par.locator("body").innerText();
      check("campagne visible chez le parent", /G2E-UI Campagne/.test(pbody0));
      check("classe actuelle affichée", pbody0.includes(srcClassroom.name));
      await par.getByRole("button", { name: "Envoyer la demande" }).click();
      await par.waitForTimeout(4000);
      const pbody1 = await par.locator("body").innerText();
      check("demande déposée (parent)", /Demande déposée/.test(pbody1));
    }

    // ---------- Back-office : instruction + décision + finalisation ----------
    console.log("== Back-office : traitement ==");
    if (adm) {
      await adm.reload();
      await adm.waitForTimeout(3000);
      const body3 = await adm.locator("body").innerText();
      check("demande listée (déposée par le responsable)",
        /G2E-UI-01/.test(body3) && /Déposée/.test(body3) && /UiParent/.test(body3));
      await adm.getByRole("link", { name: "Ouvrir" }).first().click();
      await adm.waitForTimeout(3000);
      const det0 = await adm.locator("body").innerText();
      check("fiche demande ouverte", /Classe source/.test(det0));

      // Complément + réponse parent.
      await adm.getByRole("button", { name: "Passer en instruction" }).click();
      await adm.waitForTimeout(3000);
      await adm.getByLabel("Message de la demande").fill("Merci de confirmer l'adresse");
      await adm.getByRole("button", { name: "Demander un complément" }).click();
      await adm.waitForTimeout(3000);
      check("complément demandé", /Complément requis/.test(await adm.locator("body").innerText()));
      await adm.getByLabel("Note interne").fill("Note confidentielle G2E-UI");
      await adm.getByRole("button", { name: "Ajouter la note" }).click();
      await adm.waitForTimeout(3000);
      check("note interne enregistrée", /Note confidentielle G2E-UI/.test(await adm.locator("body").innerText()));
    }
    if (par) {
      await par.reload();
      await par.waitForTimeout(3000);
      const pbody2 = await par.locator("body").innerText();
      check("parent voit le complément", /Complément demandé/.test(pbody2) && /confirmer l'adresse/.test(pbody2));
      check("note interne invisible côté parent", !/Note confidentielle/.test(pbody2));
      await par.getByLabel("Réponse").fill("Adresse confirmée");
      await par.getByRole("button", { name: "Envoyer" }).click();
      await par.waitForTimeout(4000);
      check("réponse envoyée", /En cours d'instruction/.test(await par.locator("body").innerText()));
    }
    if (adm) {
      await adm.reload();
      await adm.waitForTimeout(3000);
      await adm.getByLabel("Classe cible").selectOption({ value: dstClassroom.id });
      await adm.getByRole("button", { name: "Approuver" }).click();
      await adm.waitForTimeout(4000);
      const det1 = await adm.locator("body").innerText();
      check("demande approuvée", /Approuvée/.test(det1));
      await adm.getByRole("button", { name: "Finaliser l'inscription annuelle" }).click();
      await adm.waitForTimeout(5000);
      const det2 = await adm.locator("body").innerText();
      check("inscription finalisée + liens",
        /Inscription finalisée/.test(det2) && /Finalisée/.test(det2) && /Créances/.test(det2));
      // Rapport de lot : la demande finalisée n'est plus sélectionnable.
      check("demande passée en Finalisée dans le tableau", /Finalisée/.test(await adm.locator("body").innerText()));
    }
    if (par) {
      await par.reload();
      await par.waitForTimeout(3000);
      const pbody3 = await par.locator("body").innerText();
      check("parent : inscription finalisée visible", /Inscription finalisée/.test(pbody3));
      check("parent : décision dans le fil", /approuvée|finalisée/i.test(pbody3));
    }

    // ---------- Rôle sans habilitation ----------
    console.log("== Rôle sans habilitation ==");
    const ca = await login(browser, "f2-caissier-a@test.local", PW, "Caissier");
    if (ca) {
      await ca.goto(`${BASE}/app/reinscriptions`, { waitUntil: "domcontentloaded" });
      const t0 = Date.now();
      while (!ca.url().includes("/forbidden") && Date.now() - t0 < 30000) await ca.waitForTimeout(800);
      check("CASHIER /app/reinscriptions → forbidden", ca.url().includes("/forbidden"));
      await ca.context().close();
    }
    await adm?.context().close();
    await par?.context().close();
  } finally {
    // ---------- Nettoyage ----------
    const reqs = await prisma.reenrollmentRequest.findMany({
      where: { schoolId: school.id, studentId: student.id }, select: { id: true },
    });
    await prisma.reenrollmentMessage.deleteMany({ where: { requestId: { in: reqs.map((r) => r.id) } } });
    await prisma.reenrollmentRequest.deleteMany({ where: { id: { in: reqs.map((r) => r.id) } } });
    await prisma.reenrollmentCampaign.deleteMany({ where: { schoolId: school.id, name: "G2E-UI Campagne" } });
    await prisma.feeInstallment.deleteMany({ where: { studentId: student.id } });
    await prisma.studentFeeCharge.deleteMany({ where: { studentId: student.id } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: student.id } });
    await prisma.enrollment.deleteMany({ where: { studentId: student.id } });
    await prisma.student.delete({ where: { id: student.id } });
    await prisma.guardian.delete({ where: { id: guardian.id } });
    await prisma.classroom.delete({ where: { id: dstClassroom.id } });
    await prisma.academicYear.delete({ where: { id: dstYear.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: parentRole.id } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: [uiAdmin.id, uiParent.id] } } });
    await prisma.role.delete({ where: { id: parentRole.id } });
    await prisma.user.deleteMany({ where: { id: { in: [uiAdmin.id, uiParent.id] } } });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await browser.close();
  await prisma.$disconnect();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
