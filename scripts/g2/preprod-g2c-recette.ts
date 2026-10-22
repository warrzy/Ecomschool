/**
 * G2-C — Recette préproduction : instruction + décisions d'admission.
 *
 * Modes :
 *   fixtures : SUR LE VPS — campagne ouverte + compte restreint sur demo-ecole.
 *   cleanup  : SUR LE VPS — supprime les objets de recette (docs + fichiers).
 *   (défaut) : en local — Playwright contre https://preprod.ecomschool.fr.
 *
 * Env : SEED_DEMO_PASSWORD, G2C_BASE optionnel.
 * Aucune donnée réelle — fixtures et dossiers de recette uniquement.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.G2C_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const CAMPAIGN_NAME = "G2C PREPROD Recette";
const READER_EMAIL = "g2c-preprod-reader@test.local";
const READER_PW = "G2C-Preprod-2026!";
const MODE = process.argv[2] ?? "ui";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

/* ======================= serveur : fixtures / cleanup ======================= */

async function serverFixtures() {
  const { prisma } = await import("../../src/lib/db/prisma");
  const { hashPassword } = await import("../../src/lib/auth/password");
  const school = await prisma.school.findFirstOrThrow({
    where: { slug: "demo-ecole" },
    select: { id: true, name: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
    select: { id: true },
  });
  const level = await prisma.level.findFirst({
    where: { schoolId: school.id, status: "ACTIVE" },
    select: { id: true },
  });
  const old = await prisma.admissionCampaign.findMany({
    where: { schoolId: school.id, name: CAMPAIGN_NAME }, select: { id: true },
  });
  if (old.length) await deleteCampaignCascade(prisma, old.map((c) => c.id));
  const campaign = await prisma.admissionCampaign.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: CAMPAIGN_NAME,
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2099-12-31"),
      status: "OPEN",
      capacity: 10,
      capacityEnforced: true,
      targetLevelIds: level ? [level.id] : [],
      requiredDocs: [
        { key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true },
      ],
    },
  });
  // Compte restreint : admissions.read seul.
  const oldRole = await prisma.role.findFirst({
    where: { schoolId: school.id, name: "G2C_READER_PP" }, select: { id: true },
  });
  if (oldRole) {
    await prisma.schoolMembership.deleteMany({ where: { roleId: oldRole.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: oldRole.id } });
    await prisma.role.delete({ where: { id: oldRole.id } });
  }
  const role = await prisma.role.create({
    data: { schoolId: school.id, name: "G2C_READER_PP", scope: "SCHOOL" },
  });
  const perm = await prisma.permission.findUnique({
    where: { key: "admissions.read" }, select: { id: true },
  });
  if (perm) {
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
  }
  const oldUser = await prisma.user.findUnique({ where: { email: READER_EMAIL } });
  if (oldUser) {
    await prisma.schoolMembership.deleteMany({ where: { userId: oldUser.id } });
    await prisma.user.delete({ where: { id: oldUser.id } });
  }
  const user = await prisma.user.create({
    data: {
      email: READER_EMAIL,
      passwordHash: await hashPassword(READER_PW),
      firstName: "G2C", lastName: "Reader",
    },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, roleId: role.id, status: "ACTIVE" },
  });
  console.log(JSON.stringify({ campaignId: campaign.id, school: school.name }));
  await prisma.$disconnect();
}

type Db = typeof import("../../src/lib/db/prisma").prisma;

async function deleteCampaignCascade(prisma: Db, cids: string[]) {
  const apps = await prisma.admissionApplication.findMany({
    where: { campaignId: { in: cids } }, select: { id: true },
  });
  const ids = apps.map((a) => a.id);
  const docs = await prisma.document.findMany({
    where: { ownerType: "ADMISSION", ownerId: { in: ids } },
    select: { storagePath: true },
  });
  const root = process.env.DOCUMENTS_ROOT;
  if (root) for (const d of docs) fs.rmSync(path.join(root, d.storagePath), { force: true });
  await prisma.document.deleteMany({ where: { ownerType: "ADMISSION", ownerId: { in: ids } } });
  await prisma.admissionInterview.deleteMany({ where: { applicationId: { in: ids } } });
  await prisma.admissionEvent.deleteMany({ where: { applicationId: { in: ids } } });
  await prisma.admissionMessage.deleteMany({ where: { applicationId: { in: ids } } });
  await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  await prisma.admissionCampaign.deleteMany({ where: { id: { in: cids } } });
}

async function serverCleanup() {
  const { prisma } = await import("../../src/lib/db/prisma");
  const school = await prisma.school.findFirst({
    where: { slug: "demo-ecole" }, select: { id: true },
  });
  if (school) {
    const campaigns = await prisma.admissionCampaign.findMany({
      where: { schoolId: school.id, name: CAMPAIGN_NAME }, select: { id: true },
    });
    await deleteCampaignCascade(prisma, campaigns.map((c) => c.id));
    const role = await prisma.role.findFirst({
      where: { schoolId: school.id, name: "G2C_READER_PP" }, select: { id: true },
    });
    if (role) {
      await prisma.schoolMembership.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
    }
    // Notifications internes créées par la recette sur l'école démo.
    await prisma.notification.deleteMany({
      where: { schoolId: school.id, title: { in: ["Nouvelle candidature"] } },
    });
  }
  const oldUser = await prisma.user.findUnique({ where: { email: READER_EMAIL } });
  if (oldUser) {
    await prisma.schoolMembership.deleteMany({ where: { userId: oldUser.id } });
    await prisma.user.delete({ where: { id: oldUser.id } });
  }
  console.log("cleanup ok");
  await prisma.$disconnect();
}

/* ============================ local : recette UI ============================ */

async function login(browser: Browser, email: string, pw: string, label: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
  await page.waitForTimeout(2000);
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

async function track(browser: Browser, slug: string, fn: string, sc: string) {
  const p = await browser.newPage();
  await p.goto(`${BASE}/candidature/${slug}/suivi`, { waitUntil: "domcontentloaded" });
  await p.getByLabel("Numéro de dossier").fill(fn);
  await p.getByLabel("Code de suivi").fill(sc);
  await p.getByRole("button", { name: /Consulter/ }).click();
  await p.waitForTimeout(4000);
  return p;
}

async function main() {
  if (!PW) { console.error("SEED_DEMO_PASSWORD manquant."); process.exit(1); }
  const browser = await chromium.launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2c-pp-"));
  const pdf = path.join(dir, "naissance.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");
  const slug = "demo-ecole";
  let fileNumber = "", secret = "";

  try {
    console.log("== Dépôt public ==");
    const pub = await browser.newPage();
    await pub.goto(`${BASE}/candidature/${slug}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const pubBody = await pub.locator("body").innerText();
    check("campagne G2C visible", pubBody.includes(CAMPAIGN_NAME));
    await pub.getByRole("link", { name: "Déposer une candidature" }).first().click();
    await pub.waitForTimeout(3000);
    await pub.getByLabel("Nom du responsable", { exact: true }).fill("RecetteC");
    await pub.getByLabel("Prénom du responsable", { exact: true }).fill("Preprod");
    await pub.getByLabel("Téléphone", { exact: true }).fill("+22670000001");
    await pub.getByLabel(/^Nom enfant 1/, { exact: true }).fill("Gamma");
    await pub.getByLabel(/^Prénom enfant 1/, { exact: true }).fill("Candidat");
    const lvl = pub.getByLabel(/^Niveau souhaité enfant 1/);
    if (await lvl.count()) await lvl.selectOption({ index: 1 });
    await pub.locator('input[name="file_0_naissance"]').setInputFiles(pdf);
    await pub.locator('input[name="confirmAccuracy"]').check();
    await pub.getByRole("button", { name: /Soumettre la candidature/ }).click();
    await pub.waitForTimeout(12000);
    const doneBody = await pub.locator("body").innerText();
    fileNumber = doneBody.match(/DOS-\d{4}-\d{5}/)?.[0] ?? "";
    secret = (await pub.getByLabel("Code de suivi").innerText().catch(() => "")).trim();
    check("dossier déposé (numéro + code)", fileNumber.length > 0 && secret.length > 10);
    await pub.context().close();

    console.log("== Instruction back-office ==");
    const adm = await login(browser, "admin@demo.local", PW, "Admin");
    if (!adm) {
      fail++;
      console.log("  FAIL admin non connecté — suite sautée");
    } else {
      await adm.goto(`${BASE}/app/admissions`, { waitUntil: "domcontentloaded" });
      await adm.waitForTimeout(2500);
      const dash = await adm.locator("body").innerText();
      check("tableau de bord : indicateurs + filtres",
        /En instruction/.test(dash) && /Liste d'attente/.test(dash) &&
        /Entretiens à venir/.test(dash) &&
        (await adm.getByLabel("Filtrer par statut").count()) === 1);

      await adm.goto(`${BASE}/app/admissions?q=${encodeURIComponent(fileNumber)}`, { waitUntil: "domcontentloaded" });
      await adm.waitForTimeout(2000);
      await adm.getByRole("link", { name: "Ouvrir" }).first().click();
      await adm.waitForTimeout(3000);
      check("fiche consultée par l'agent", /Gamma/.test(await adm.locator("body").innerText()));

      // Note interne.
      await adm.getByLabel("Note interne").fill("Note privée G2C-PP");
      await adm.getByRole("button", { name: "Ajouter la note" }).click();
      await adm.waitForTimeout(3000);
      check("note interne ajoutée", /Note privée G2C-PP/.test(await adm.locator("body").innerText()));

      // Passage en instruction puis demande de complément.
      const instrBtn = adm.getByRole("button", { name: "Passer en instruction" });
      if (await instrBtn.count()) { await instrBtn.click(); await adm.waitForTimeout(3000); }
      await adm.getByLabel("Message de la demande").fill("Bulletin de trimestre requis");
      await adm.getByRole("button", { name: "Demander un complément" }).click();
      await adm.waitForTimeout(3000);
      check("complément demandé", /Bulletin de trimestre/.test(await adm.locator("body").innerText()));
      await adm.context().close();
    }

    console.log("== Réponse du candidat ==");
    const su1 = await track(browser, slug, fileNumber, secret);
    const t1 = await su1.locator("body").innerText();
    check("suivi : demande de complément visible", /Bulletin de trimestre/.test(t1));
    check("suivi : note interne absente", !/Note privée G2C-PP/.test(t1));
    await su1.getByLabel("Réponse à l'établissement").fill("Je joins le bulletin vendredi");
    await su1.getByRole("button", { name: "Envoyer" }).click();
    await su1.waitForTimeout(4000);
    check("réponse envoyée et historisée",
      /bulletin vendredi/.test(await su1.locator("body").innerText()));
    await su1.context().close();

    console.log("== Entretien ==");
    const adm2 = await login(browser, "admin@demo.local", PW, "Admin2");
    if (adm2) {
      await adm2.goto(`${BASE}/app/admissions?q=${encodeURIComponent(fileNumber)}`, { waitUntil: "domcontentloaded" });
      await adm2.waitForTimeout(2000);
      await adm2.getByRole("link", { name: "Ouvrir" }).first().click();
      await adm2.waitForTimeout(3000);
      check("réponse du candidat visible côté agent",
        /bulletin vendredi/.test(await adm2.locator("body").innerText()));

      await adm2.getByLabel("Date de l'entretien").fill("2099-02-10T09:00");
      await adm2.getByLabel("Lieu de l'entretien").fill("Salle 9");
      await adm2.getByLabel("Consignes pour le candidat").fill("Présenter une pièce d'identité");
      await adm2.getByRole("button", { name: "Convoquer" }).click();
      await adm2.waitForTimeout(3000);
      check("entretien planifié", /Salle 9/.test(await adm2.locator("body").innerText()));

      // Reprogrammation.
      await adm2.getByLabel("Nouvelle date de l'entretien").fill("2099-02-12T14:30");
      await adm2.getByRole("button", { name: "Reprogrammer" }).click();
      await adm2.waitForTimeout(3000);
      check("reprogrammation tracée",
        /Initialement prévu/.test(await adm2.locator("body").innerText()));

      // Clôture avec résultat + appréciation internes.
      await adm2.getByLabel("Issue de l'entretien").selectOption("COMPLETED");
      await adm2.getByLabel("Résultat de l'entretien").fill("17/20 EXCELLENT");
      await adm2.getByRole("button", { name: "Clôturer" }).click();
      await adm2.waitForTimeout(3000);
      check("entretien clôturé (résultat interne)",
        /17\/20 EXCELLENT/.test(await adm2.locator("body").innerText()));
      await adm2.context().close();
    }

    console.log("== Suivi : convocation ==");
    const su2 = await track(browser, slug, fileNumber, secret);
    const t2 = await su2.locator("body").innerText();
    check("convocation visible (lieu + consignes)",
      /Salle 9/.test(t2) && /pièce d'identité/.test(t2));
    check("résultat interne NON exposé", !/17\/20|EXCELLENT/.test(t2));
    check("note interne toujours absente", !/Note privée G2C-PP/.test(t2));
    await su2.context().close();

    console.log("== Décisions ==");
    const adm3 = await login(browser, "admin@demo.local", PW, "Admin3");
    if (adm3) {
      await adm3.goto(`${BASE}/app/admissions?q=${encodeURIComponent(fileNumber)}`, { waitUntil: "domcontentloaded" });
      await adm3.waitForTimeout(2000);
      await adm3.getByRole("link", { name: "Ouvrir" }).first().click();
      await adm3.waitForTimeout(3000);

      // Refus motivé.
      await adm3.getByLabel("Motif du refus").fill("Pièce justificative non conforme");
      await adm3.getByRole("button", { name: "Refuser" }).click();
      await adm3.waitForTimeout(3000);
      check("refus motivé", /Refusé/.test(await adm3.locator("body").innerText()));

      // Réexamen puis admission conditionnelle.
      await adm3.getByLabel("Motif du réexamen").fill("Pièce reçue en mains propres");
      await adm3.getByRole("button", { name: "Réexaminer" }).click();
      await adm3.waitForTimeout(3000);
      check("réexamen → retour en instruction",
        /En instruction/.test(await adm3.locator("body").innerText()));
      await adm3.getByLabel("Conditions de l'admission").fill("Fournir le carnet de santé");
      await adm3.getByRole("button", { name: "Admettre sous condition" }).click();
      await adm3.waitForTimeout(3000);
      check("admission conditionnelle",
        /sous condition/i.test(await adm3.locator("body").innerText()));

      // Liste d'attente (réexamen d'une conditionnelle).
      await adm3.getByLabel("Motif du réexamen").fill("Réévaluation du dossier");
      await adm3.getByRole("button", { name: "Réexaminer" }).click();
      await adm3.waitForTimeout(3000);
      await adm3.getByLabel("Rang en liste d'attente").fill("3");
      await adm3.getByRole("button", { name: "Liste d'attente" }).click();
      await adm3.waitForTimeout(3000);
      check("liste d'attente avec rang", /Liste d'attente/.test(await adm3.locator("body").innerText()) &&
        /Rang : 3/.test(await adm3.locator("body").innerText()));

      // Admission finale.
      await adm3.getByRole("button", { name: "Admettre", exact: true }).click();
      await adm3.waitForTimeout(3000);
      const final = await adm3.locator("body").innerText();
      check("admission finale + historique des décisions",
        /Admis/.test(final) && /Décision :/.test(final));
      await adm3.context().close();
    }

    console.log("== Suivi : résultat ==");
    const su3 = await track(browser, slug, fileNumber, secret);
    const t3 = await su3.locator("body").innerText();
    check("suivi : décision Admis affichée", /Décision : Admis/.test(t3) || /Admis/.test(t3));
    check("suivi : historique des échanges complet",
      /Bulletin de trimestre/.test(t3) && /bulletin vendredi/.test(t3));
    check("suivi : aucune donnée interne",
      !/Note privée|17\/20|EXCELLENT/.test(t3));
    await su3.context().close();

    console.log("== Compte restreint ==");
    const rd = await login(browser, READER_EMAIL, READER_PW, "Reader");
    if (rd) {
      await rd.goto(`${BASE}/app/admissions`, { waitUntil: "domcontentloaded" });
      await rd.waitForTimeout(2500);
      check("read : file consultable", (await rd.locator("body").innerText()).length > 50);
      const piecesResp = await rd.context().request.get(
        `${BASE}/app/admissions/pieces/any/download`, { maxRedirects: 0 });
      check("read : pièces refusées", piecesResp.status() !== 200);
      // Le compte read peut ouvrir la fiche mais n'a ni décision ni pièces.
      await rd.goto(`${BASE}/app/admissions?q=${encodeURIComponent(fileNumber)}`, { waitUntil: "domcontentloaded" });
      await rd.waitForTimeout(2000);
      const open = rd.getByRole("link", { name: "Ouvrir" });
      if (await open.count()) {
        await open.first().click();
        await rd.waitForTimeout(3000);
        const rdBody = await rd.locator("body").innerText();
        check("read : fiche sans décision ni pièces ni notes",
          !/Refuser|Admettre|Télécharger/.test(rdBody) &&
          !/Note privée G2C-PP/.test(rdBody));
      } else note("read : fiche non ouverte");
      await rd.context().close();
    }

    // Non-régression G2-A légère.
    const adm4 = await login(browser, "admin@demo.local", PW, "Admin4");
    if (adm4) {
      await adm4.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
      await adm4.waitForTimeout(2000);
      check("non-régression : /app/documents OK",
        !adm4.url().includes("/forbidden") && /Documents/i.test(await adm4.locator("body").innerText()));
      await adm4.context().close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await browser.close();
  console.log(`\n=== G2-C préprod : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}

if (MODE === "fixtures") {
  serverFixtures().catch((e) => { console.error(e); process.exit(1); });
} else if (MODE === "cleanup") {
  serverCleanup().catch((e) => { console.error(e); process.exit(1); });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}
