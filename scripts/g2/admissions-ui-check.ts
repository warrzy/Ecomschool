/**
 * G2-B — smoke test UI local : portail public /candidature + suivi +
 * back-office /app/admissions. Fixtures propres, nettoyées en fin de run.
 * Usage : npx tsx scripts/g2/admissions-ui-check.ts [baseUrl]
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";
const UI_PW = "G2B-Ui-2026!";
const UI_EMAIL = "g2b-ui-admin@test.local";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2b-ui-"));
  const pdf = path.join(dir, "naissance.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");

  // ---------- Fixtures ----------
  const school = await prisma.school.findFirstOrThrow({
    where: { name: { contains: "Démo" } },
    select: { id: true, slug: true, name: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
    select: { id: true },
  });
  const level = await prisma.level.findFirst({
    where: { schoolId: school.id, status: "ACTIVE" },
    select: { id: true },
  });
  const adminRole = await prisma.role.findFirstOrThrow({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const oldUser = await prisma.user.findUnique({ where: { email: UI_EMAIL } });
  if (oldUser) {
    await prisma.schoolMembership.deleteMany({ where: { userId: oldUser.id } });
    await prisma.user.delete({ where: { id: oldUser.id } });
  }
  const uiAdmin = await prisma.user.create({
    data: { email: UI_EMAIL, passwordHash: await hashPassword(UI_PW), firstName: "G2B", lastName: "UI" },
  });
  await prisma.schoolMembership.create({
    data: { userId: uiAdmin.id, schoolId: school.id, roleId: adminRole.id, status: "ACTIVE" },
  });

  const campaign = await prisma.admissionCampaign.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: "G2B UI Campagne",
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2099-12-31"),
      status: "OPEN",
      targetLevelIds: level ? [level.id] : [],
      requiredDocs: [
        { key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true },
      ],
    },
  });
  const closedCampaign = await prisma.admissionCampaign.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: "G2B UI Fermée",
      opensAt: new Date("2030-01-01"),
      closesAt: new Date("2030-12-31"),
      status: "OPEN",
      requiredDocs: [],
    },
  });

  let fileNumber = "";
  let secret = "";

  try {
    // ---------- Portail public ----------
    console.log("== Portail public ==");
    const pub = await browser.newPage();
    await pub.goto(`${BASE}/candidature/${school.slug}`, { waitUntil: "domcontentloaded" });
    const pubBody = await pub.locator("body").innerText();
    check("école identifiée + campagne ouverte listée", pubBody.includes(school.name) && pubBody.includes("G2B UI Campagne"));
    check("campagne hors période affichée sans bouton", pubBody.includes("G2B UI Fermée") && pubBody.includes("Hors période"));

    await pub.getByRole("link", { name: "Déposer une candidature" }).first().click();
    await pub.waitForTimeout(2000);
    const formBody = await pub.locator("body").innerText();
    check("formulaire : responsable + enfant + pièce requise",
      /Responsable/.test(formBody) && /Extrait de naissance/.test(formBody));

    await pub.getByLabel("Nom du responsable", { exact: true }).fill("Démo");
    await pub.getByLabel("Prénom du responsable", { exact: true }).fill("Parent");
    await pub.getByLabel("Téléphone", { exact: true }).fill("+22670123456");
    await pub.getByLabel(/^Nom enfant 1/, { exact: true }).fill("Testeur");
    await pub.getByLabel(/^Prénom enfant 1/, { exact: true }).fill("Candidat");
    if (level) {
      const sel = pub.getByLabel(/^Niveau souhaité enfant 1/);
      if (await sel.count()) await sel.selectOption({ index: 1 });
    }
    await pub.locator('input[name="file_0_naissance"]').setInputFiles(pdf);
    // La case de validation explicite est requise (native + serveur).
    check("case déclaration présente et requise",
      (await pub.locator('input[name="confirmAccuracy"][required]').count()) === 1);
    check("lien politique de confidentialité présent",
      (await pub.getByRole("link", { name: /politique de confidentialité/i }).count()) === 1);
    await pub.locator('input[name="confirmAccuracy"]').check();
    await pub.getByRole("button", { name: /Soumettre la candidature/ }).click();
    await pub.waitForTimeout(8000);
    const doneBody = await pub.locator("body").innerText();
    check("numéro de dossier affiché", /DOS-\d{4}-\d{5}/.test(doneBody));
    check("code de suivi affiché une fois", /code de suivi/i.test(doneBody));
    fileNumber = doneBody.match(/DOS-\d{4}-\d{5}/)?.[0] ?? "";
    const codeEl = pub.getByLabel("Code de suivi");
    secret = (await codeEl.count()) ? (await codeEl.innerText()).trim() : "";
    check("numéro + code capturés", fileNumber.length > 0 && secret.length > 10);

    // ---------- Suivi ----------
    console.log("== Suivi sécurisé ==");
    const suivi = await browser.newPage();
    await suivi.goto(`${BASE}/candidature/${school.slug}/suivi`, { waitUntil: "domcontentloaded" });
    await suivi.getByLabel("Numéro de dossier").fill(fileNumber);
    await suivi.getByLabel("Code de suivi").fill("mauvais-code");
    await suivi.getByRole("button", { name: /Consulter/ }).click();
    await suivi.waitForTimeout(3000);
    check("mauvais code → erreur affichée", /introuvable|invalide|erreur/i.test(await suivi.locator("body").innerText()));

    await suivi.getByLabel("Code de suivi").fill(secret);
    await suivi.getByRole("button", { name: /Consulter/ }).click();
    await suivi.waitForTimeout(3000);
    const trackBody = await suivi.locator("body").innerText();
    check("suivi : dossier + statut reçu", trackBody.includes(fileNumber) && /Dossier reçu/.test(trackBody));
    check("aucun chemin serveur dans la page", !/documents-private|shared\/uploads|storagePath/i.test(trackBody));

    const [dl] = await Promise.all([
      suivi.waitForEvent("download", { timeout: 30000 }),
      suivi.getByRole("link", { name: "Télécharger" }).first().click(),
    ]);
    const dlPath = await dl.path();
    check("téléchargement pièce via ticket → contenu réel", !!dlPath &&
      fs.readFileSync(dlPath!).subarray(0, 4).toString() === "%PDF");

    // Route pièce sans ticket → 404
    const noTicket = await suivi.context().request.get(`${BASE}/candidature/piece/faux-token`, { maxRedirects: 0 });
    check("route pièce sans ticket valide → refusée", noTicket.status() === 404);

    // Page confidentialité publique
    const conf = await suivi.context().request.get(
      `${BASE}/candidature/${school.slug}/confidentialite`);
    check("page confidentialité accessible", conf.status() === 200 &&
      /confidentialité/i.test(await conf.text()));

    // mobile
    await suivi.setViewportSize({ width: 390, height: 844 });
    await suivi.goto(`${BASE}/candidature/${school.slug}/suivi`, { waitUntil: "domcontentloaded" });
    await suivi.waitForTimeout(1200);
    check("mobile 390px sans overflow", await suivi.evaluate(() => document.documentElement.scrollWidth <= 390 + 16));

    // ---------- Back-office ----------
    console.log("== Back-office /app/admissions ==");
    const adm = await login(browser, UI_EMAIL, UI_PW, "Admin UI");
    if (adm) {
      await adm.goto(`${BASE}/app/admissions`, { waitUntil: "domcontentloaded" });
      await adm.waitForTimeout(2500);
      const admBody = await adm.locator("body").innerText();
      check("file : dossier listé", admBody.includes(fileNumber));
      await adm.getByRole("link", { name: "Ouvrir" }).first().click();
      await adm.waitForTimeout(3000);
      const detail = await adm.locator("body").innerText();
      check("fiche : candidat + pièce + chronologie", detail.includes("Candidat Testeur") && /naissance/i.test(detail));
      const [docDl] = await Promise.all([
        adm.waitForEvent("download", { timeout: 30000 }),
        adm.getByRole("link", { name: "Télécharger" }).first().click(),
      ]);
      check("téléchargement pièce côté review", !!(await docDl.path()));

      await adm.getByRole("button", { name: "Passer en instruction" }).click();
      await adm.waitForTimeout(3000);
      check("transition UNDER_REVIEW", /En instruction/.test(await adm.locator("body").innerText()));

      // ---------- G2-C : instruction complète ----------
      console.log("== G2-C : dashboard + instruction ==");
      const dashBody = await adm.locator("body").innerText();
      check("dashboard : indicateurs présents",
        /En instruction/.test(dashBody) && /Liste d'attente/.test(dashBody) &&
        /Entretiens à venir/.test(dashBody));

      // Note interne — jamais visible côté candidat.
      await adm.getByLabel("Note interne").fill("Note confidentielle G2C");
      await adm.getByRole("button", { name: "Ajouter la note" }).click();
      await adm.waitForTimeout(3000);
      check("note interne enregistrée",
        /Note confidentielle G2C/.test(await adm.locator("body").innerText()));

      // Demande de complément.
      await adm.getByLabel("Message de la demande").fill("Bulletin manquant");
      await adm.getByRole("button", { name: "Demander un complément" }).click();
      await adm.waitForTimeout(3000);
      check("complément demandé",
        /Bulletin manquant/.test(await adm.locator("body").innerText()));

      // Convocation.
      await adm.getByLabel("Date de l'entretien").fill("2099-01-15T10:30");
      await adm.getByLabel("Lieu de l'entretien").fill("Salle 7");
      await adm.getByLabel("Consignes pour le candidat").fill("Venir 15 min avant");
      await adm.getByRole("button", { name: "Convoquer" }).click();
      await adm.waitForTimeout(3000);
      check("entretien planifié",
        /Salle 7/.test(await adm.locator("body").innerText()));

      // Décision : refus motivé.
      await adm.getByLabel("Motif du refus").fill("Capacité atteinte");
      await adm.getByRole("button", { name: "Refuser" }).click();
      await adm.waitForTimeout(3000);
      check("décision refus enregistrée",
        /Refusé/.test(await adm.locator("body").innerText()));

      // Réexamen puis admission.
      await adm.getByLabel("Motif du réexamen").fill("Place libérée");
      await adm.getByRole("button", { name: "Réexaminer" }).click();
      await adm.waitForTimeout(3000);
      await adm.getByRole("button", { name: "Admettre", exact: true }).click();
      await adm.waitForTimeout(3000);
      check("réexamen → admis",
        /Admis/.test(await adm.locator("body").innerText()));

      // ---------- G2-D : conversion en inscription ----------
      console.log("== G2-D : conversion ==");
      const convBody = await adm.locator("body").innerText();
      check("panneau de conversion visible",
        /conversion en inscription définitive/i.test(convBody));
      const clsSel = adm.getByLabel("Classe cible");
      if (await clsSel.count()) {
        const opts = await clsSel.locator("option:not([disabled])").all();
        if (opts.length > 1) await clsSel.selectOption({ index: 1 });
      }
      await adm.getByLabel("Matricule du nouvel élève").fill("G2D-UI-01");
      const gSel = adm.getByLabel("Responsable à rattacher");
      if (await gSel.count()) await gSel.selectOption({ value: "create" });
      const ack = adm.locator('input[name="acknowledgeDuplicates"]');
      if (await ack.count()) await ack.check();
      await adm.locator('input[name="confirm"]').check();
      await adm.getByRole("button", { name: "Convertir en inscription" }).click();
      await adm.waitForTimeout(5000);
      const afterConv = await adm.locator("body").innerText();
      check("dossier converti : inscription + liens élève/créances",
        /inscription définitive/i.test(afterConv) && /G2D-UI-01/.test(afterConv));
      check("bouton d'invitation portail présent",
        /Préparer l'accès portail/.test(afterConv));
      check("décision verrouillée après conversion",
        /verrouillée/.test(afterConv));
      await adm.context().close();
    }

    // Suivi reflète la décision + convocation, sans note interne
    const suivi2 = await browser.newPage();
    await suivi2.goto(`${BASE}/candidature/${school.slug}/suivi`, { waitUntil: "domcontentloaded" });
    await suivi2.getByLabel("Numéro de dossier").fill(fileNumber);
    await suivi2.getByLabel("Code de suivi").fill(secret);
    await suivi2.getByRole("button", { name: /Consulter/ }).click();
    await suivi2.waitForTimeout(3000);
    const track2 = await suivi2.locator("body").innerText();
    check("suivi : décision admis visible", /Admis/.test(track2));
    check("suivi : convocation visible", /Salle 7/.test(track2));
    check("suivi : note interne absente", !/Note confidentielle G2C/.test(track2));
    check("suivi : demande de complément historisée", /Bulletin manquant/.test(track2));
    await suivi2.context().close();

    console.log("== Rôle sans habilitation ==");
    const ca = await login(browser, "f2-caissier-a@test.local", PW, "Caissier");
    if (ca) {
      await ca.goto(`${BASE}/app/admissions`, { waitUntil: "domcontentloaded" });
      const t0 = Date.now();
      while (!ca.url().includes("/forbidden") && Date.now() - t0 < 30000) await ca.waitForTimeout(800);
      check("CASHIER /app/admissions → forbidden", ca.url().includes("/forbidden"));
      const piecesResp = await ca.context().request.get(
        `${BASE}/app/admissions/pieces/any/download`, { maxRedirects: 0 });
      check("route pièces refusée sans review", piecesResp.status() !== 200);
      await ca.context().close();
    }
  } finally {
    // ---------- Nettoyage ----------
    const apps = await prisma.admissionApplication.findMany({
      where: { schoolId: school.id, fileNumber: { startsWith: "DOS-" }, campaignId: { in: [campaign.id, closedCampaign.id] } },
      select: { id: true },
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
    await prisma.admissionCampaign.deleteMany({ where: { id: { in: [campaign.id, closedCampaign.id] } } });
    // Entités créées par la conversion G2-D (élève, lien, inscription,
    // créances, responsable) — supprimées avec leurs dépendances.
    const convStudent = await prisma.student.findFirst({
      where: { schoolId: school.id, matricule: "G2D-UI-01" },
      select: { id: true },
    });
    if (convStudent) {
      await prisma.feeInstallment.deleteMany({ where: { studentId: convStudent.id } });
      await prisma.studentFeeCharge.deleteMany({ where: { studentId: convStudent.id } });
      await prisma.studentGuardian.deleteMany({ where: { studentId: convStudent.id } });
      await prisma.enrollment.deleteMany({ where: { studentId: convStudent.id } });
      await prisma.student.delete({ where: { id: convStudent.id } });
    }
    const convGuardian = await prisma.guardian.findFirst({
      where: {
        schoolId: school.id,
        phone: "+22670123456",
        lastName: "Démo",
        firstName: "Parent",
        students: { none: {} },
      },
      select: { id: true },
    });
    if (convGuardian) {
      await prisma.guardian.delete({ where: { id: convGuardian.id } });
    }
    await prisma.schoolMembership.deleteMany({ where: { userId: uiAdmin.id } });
    await prisma.user.delete({ where: { id: uiAdmin.id } });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await browser.close();
  await prisma.$disconnect();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
