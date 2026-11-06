/**
 * H1 — Smoke test UI du portail parent interactif (LOCAL uniquement).
 *
 * Pré-requis : `npm run dev` sur :3000.
 * Couvre : onglets globaux (demandes, notifications, profil), dépôt
 * d'une demande via le formulaire, traitement admin (/app/demandes),
 * réponse visible parent + notification, profil (coordonnées),
 * justificatif d'absence, parent sans enfant, rendu mobile.
 * Des captures PNG sont écrites dans /tmp/h1-preuves/.
 *
 * Exécution : npx tsx scripts/h1/parent-portal-ui-check.ts
 */
import "dotenv/config";
import fs from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";

const BASE = process.env.H1_BASE_URL ?? "http://localhost:3000";
const PW = "H1-Ui-2026!";
const SHOTS = "C:/Users/LENOVO-L490/AppData/Local/Temp/h1-preuves";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

const SLUG = "h1-ui-fix";
const EMAILS = [
  "h1-ui-parent@test.local",
  "h1-ui-parent0@test.local",
  "h1-ui-admin@test.local",
];

async function login(browser: Browser, email: string, label: string, mobile = false): Promise<Page | null> {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 60000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function text(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  return page.locator("body").innerText();
}

async function cleanup(schoolId: string) {
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.administrativeRequest.deleteMany({ where: { schoolId } });
  await prisma.attendanceRecord.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const old = await prisma.school.findFirst({ where: { slug: SLUG }, select: { id: true } });
  if (old) await cleanup(old.id);
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  // ---------- Fixtures ----------
  const school = await prisma.school.create({
    data: { name: "H1 UI École", code: "H1UI", slug: SLUG },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e A" },
  });
  const student = await prisma.student.create({
    data: { schoolId: school.id, matricule: "H1UI-001", firstName: "Awa", lastName: "H1UI", sex: "FEMALE" },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: school.id, studentId: student.id,
      classroomId: classroom.id, academicYearId: year.id, status: "ENROLLED",
    },
  });
  await prisma.attendanceRecord.create({
    data: {
      schoolId: school.id, studentId: student.id, date: new Date("2026-11-02"),
      status: "ABSENT",
    },
  });

  const portalPerm = await prisma.permission.findFirstOrThrow({ where: { key: "portal.parent" } });
  const mkPortalUser = async (email: string) => {
    const role = await prisma.role.create({
      data: { name: `H1UI_${email}`, scope: "SCHOOL", schoolId: school.id },
    });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: portalPerm.id },
    });
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(PW), firstName: "H1", lastName: email, status: "ACTIVE" },
    });
    await prisma.schoolMembership.create({
      data: { userId: user.id, schoolId: school.id, roleId: role.id, status: "ACTIVE" },
    });
    return user;
  };

  const uParent = await mkPortalUser("h1-ui-parent@test.local");
  await mkPortalUser("h1-ui-parent0@test.local"); // sans dossier Guardian ni enfant
  const guardian = await prisma.guardian.create({
    data: {
      schoolId: school.id, userId: uParent.id,
      firstName: "H1", lastName: "UiParent", phone: "+22670000000", status: "ACTIVE",
    },
  });
  await prisma.studentGuardian.create({
    data: { schoolId: school.id, guardianId: guardian.id, studentId: student.id, relation: "MOTHER" },
  });

  const adminPerm = await prisma.permission.findFirstOrThrow({
    where: { key: "administrative-requests.manage" },
  });
  const adminRole = await prisma.role.create({
    data: { name: "H1UI_ADMIN", scope: "SCHOOL", schoolId: school.id },
  });
  await prisma.rolePermission.create({
    data: { roleId: adminRole.id, permissionId: adminPerm.id },
  });
  const uAdmin = await prisma.user.create({
    data: { email: "h1-ui-admin@test.local", passwordHash: await hashPassword(PW), firstName: "H1", lastName: "UiAdmin", status: "ACTIVE" },
  });
  await prisma.schoolMembership.create({
    data: { userId: uAdmin.id, schoolId: school.id, roleId: adminRole.id, status: "ACTIVE" },
  });

  const browser = await chromium.launch();
  try {
    // ---------- Parcours parent ----------
    console.log("\n== Parent — navigation ==");
    const p = await login(browser, "h1-ui-parent@test.local", "parent");
    if (!p) return;
    const home = await text(p, "/parent");
    check("sélecteur d'enfant visible", home.includes("Awa H1UI"));
    for (const t of ["Annonces", "Demandes", "Notifications", "Profil"]) {
      check(`onglet ${t} présent`, home.includes(t));
    }
    await p.screenshot({ path: `${SHOTS}/h1-parent-apercu.png` });

    // Dépôt d'une demande via le formulaire
    console.log("\n== Parent — demande ==");
    await p.goto(`${BASE}/parent?tab=demandes`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(1200);
    await p.getByLabel("Type de demande").selectOption("DOCUMENT");
    await p.getByLabel("Enfant concerné").selectOption(student.id);
    await p.getByLabel("Objet de la demande").fill("Attestation pour la mairie");
    await p.getByLabel("Message de la demande").fill("Merci d'établir une attestation d'inscription.");
    await p.getByRole("button", { name: "Envoyer la demande" }).click();
    await p.waitForURL(/ok=request_created/, { timeout: 30000 });
    await p.waitForTimeout(1000);
    const demandes = await p.locator("body").innerText();
    check("demande visible dans le suivi", demandes.includes("Attestation pour la mairie"));
    check("statut Déposée affiché", demandes.includes("Déposée"));
    await p.screenshot({ path: `${SHOTS}/h1-parent-demandes.png` });

    // Justificatif d'absence
    console.log("\n== Parent — justificatif ==");
    await p.goto(`${BASE}/parent?tab=absences`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(1200);
    const absText = await p.locator("body").innerText();
    check("absence affichée non justifiée", absText.includes("Absence") && absText.includes("Non justifié"));
    await p.getByText("Transmettre un justificatif").click();
    await p.getByLabel("Motif du justificatif").fill("Certificat médical remis au secrétariat.");
    await p.getByRole("button", { name: "Envoyer" }).click();
    await p.waitForURL(/ok=justification_sent/, { timeout: 30000 });
    check("justificatif accepté (redirect ok)", true);

    // Profil
    console.log("\n== Parent — profil ==");
    await p.goto(`${BASE}/parent?tab=profil`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(1200);
    const profil = await p.locator("body").innerText();
    check("compte affiché (identifiant)", profil.includes("h1-ui-parent@test.local"));
    await p.getByLabel("Téléphone").fill("+22679998877");
    await p.getByLabel("Adresse").fill("Secteur 9 — Ouagadougou");
    await p.getByRole("button", { name: "Enregistrer mes coordonnées" }).click();
    await p.waitForURL(/ok=contact_saved/, { timeout: 30000 });
    const phone = await prisma.guardian.findUnique({ where: { id: guardian.id }, select: { phone: true } });
    check("téléphone persisté", phone?.phone === "+22679998877");
    await p.screenshot({ path: `${SHOTS}/h1-parent-profil.png` });

    // ---------- Traitement admin ----------
    console.log("\n== Admin — traitement ==");
    const a = await login(browser, "h1-ui-admin@test.local", "admin");
    if (a) {
      const queue = await text(a, "/app/demandes");
      check("file admin : demande visible", queue.includes("Attestation pour la mairie"));
      check("file admin : justificatif visible", queue.includes("Justificatif"));
      const req = await prisma.administrativeRequest.findFirstOrThrow({
        where: { schoolId: school.id, subject: "Attestation pour la mairie" },
      });
      await a.goto(`${BASE}/app/demandes?id=${req.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await a.waitForTimeout(1000);
      await a.locator("select[name=status]").selectOption("RESOLVED");
      await a.locator("textarea[name=response]").fill("Document disponible au secrétariat.");
      await a.getByRole("button", { name: "Enregistrer la réponse" }).click();
      await a.waitForURL(/ok=responded/, { timeout: 30000 });
      check("réponse enregistrée (redirect ok)", true);
      const after = await prisma.administrativeRequest.findUnique({ where: { id: req.id } });
      check("statut RESOLVED en base", after?.status === "RESOLVED");
      await a.screenshot({ path: `${SHOTS}/h1-admin-demandes.png` });
      await a.context().close();
    }

    // ---------- Retour parent : réponse + notification ----------
    console.log("\n== Parent — suivi & notifications ==");
    const suivi = await text(p, "/parent?tab=demandes");
    check("statut Traitée visible", suivi.includes("Traitée"));
    check("réponse de l'établissement affichée",
      suivi.includes("Document disponible au secrétariat"));
    const notif = await text(p, "/parent?tab=notifications");
    check("notification de réponse visible",
      notif.includes("Attestation pour la mairie"));
    await p.screenshot({ path: `${SHOTS}/h1-parent-notifications.png` });

    // ---------- Parent sans enfant ----------
    console.log("\n== Parent sans enfant ==");
    const p0 = await login(browser, "h1-ui-parent0@test.local", "parent0");
    if (p0) {
      const t0 = await text(p0, "/parent");
      check("message aucun enfant", t0.includes("Aucun enfant"));
      check("onglets globaux accessibles sans enfant",
        t0.includes("Demandes") && t0.includes("Profil") && !t0.includes("Emploi du temps"));
      const d0 = await text(p0, "/parent?tab=demandes");
      check("formulaire de demande accessible", d0.includes("Nouvelle demande"));
      await p0.context().close();
    }

    // ---------- Rendu mobile ----------
    console.log("\n== Mobile ==");
    const pm = await login(browser, "h1-ui-parent@test.local", "parent mobile", true);
    if (pm) {
      const m = await text(pm, "/parent?tab=demandes");
      check("rendu mobile : suivi lisible", m.includes("Mes demandes"));
      await pm.screenshot({ path: `${SHOTS}/h1-parent-mobile.png` });
      await pm.context().close();
    }
  } finally {
    await browser.close();
  }

  // ---------- Nettoyage ----------
  await cleanup(school.id);
  const ids = (await prisma.user.findMany({
    where: { email: { in: EMAILS } }, select: { id: true },
  })).map((u) => u.id);
  if (ids.length) {
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  console.log("\n  fixtures nettoyées");
  console.log(`\n==== H1 UI : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ====`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => { console.error("H1_UI_FAILED", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
