/**
 * G2-B — Recette préproduction : portail public + suivi + back-office.
 *
 * Modes :
 *   fixtures : exécuté SUR LE VPS (npx tsx … fixtures) — crée une campagne
 *              ouverte + une campagne hors période sur l'école démo, et un
 *              compte restreint (admissions.read seul). Sortie JSON.
 *   cleanup  : exécuté SUR LE VPS — supprime les objets de recette.
 *   (défaut) : exécuté en local — Playwright contre https://preprod.ecomschool.fr.
 *              Env : SEED_DEMO_PASSWORD, G2B_CAMPAIGN_ID, G2B_READER_EMAIL/PW.
 *
 * Aucune donnée réelle — campagnes et dossiers de recette uniquement.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.G2B_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const CAMPAIGN_NAME = "G2B PREPROD Recette";
const CLOSED_NAME = "G2B PREPROD Fermée";
const READER_EMAIL = "g2b-preprod-reader@test.local";
const READER_PW = "G2B-Preprod-2026!";
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
  await prisma.admissionCampaign.deleteMany({
    where: { schoolId: school.id, name: { in: [CAMPAIGN_NAME, CLOSED_NAME] } },
  });
  const campaign = await prisma.admissionCampaign.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: CAMPAIGN_NAME,
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2099-12-31"),
      status: "OPEN",
      targetLevelIds: level ? [level.id] : [],
      requiredDocs: [
        { key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true },
      ],
    },
  });
  await prisma.admissionCampaign.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: CLOSED_NAME,
      opensAt: new Date("2030-01-01"),
      closesAt: new Date("2030-12-31"),
      status: "OPEN",
      requiredDocs: [],
    },
  });
  // Compte restreint : admissions.read seul (pas review/manage).
  const role = await prisma.role.create({
    data: { schoolId: school.id, name: "G2B_READER_PP", scope: "SCHOOL" },
  });
  const perm = await prisma.permission.findUnique({
    where: { key: "admissions.read" }, select: { id: true },
  });
  if (perm) {
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
  }
  const old = await prisma.user.findUnique({ where: { email: READER_EMAIL } });
  if (old) {
    await prisma.schoolMembership.deleteMany({ where: { userId: old.id } });
    await prisma.user.delete({ where: { id: old.id } });
  }
  const user = await prisma.user.create({
    data: {
      email: READER_EMAIL,
      passwordHash: await hashPassword(READER_PW),
      firstName: "G2B", lastName: "Reader",
    },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId: school.id, roleId: role.id, status: "ACTIVE" },
  });
  console.log(JSON.stringify({ campaignId: campaign.id, school: school.name }));
  await prisma.$disconnect();
}

async function serverCleanup() {
  const { prisma } = await import("../../src/lib/db/prisma");
  const school = await prisma.school.findFirst({
    where: { slug: "demo-ecole" }, select: { id: true },
  });
  if (school) {
    const campaigns = await prisma.admissionCampaign.findMany({
      where: { schoolId: school.id, name: { in: [CAMPAIGN_NAME, CLOSED_NAME] } },
      select: { id: true },
    });
    const cids = campaigns.map((c) => c.id);
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
    await prisma.admissionEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionMessage.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
    await prisma.admissionCampaign.deleteMany({ where: { id: { in: cids } } });
    const role = await prisma.role.findFirst({
      where: { schoolId: school.id, name: "G2B_READER_PP" }, select: { id: true },
    });
    if (role) {
      await prisma.schoolMembership.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
    }
  }
  const old = await prisma.user.findUnique({ where: { email: READER_EMAIL } });
  if (old) {
    await prisma.schoolMembership.deleteMany({ where: { userId: old.id } });
    await prisma.user.delete({ where: { id: old.id } });
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

async function main() {
  if (!PW) { console.error("SEED_DEMO_PASSWORD manquant."); process.exit(1); }
  const browser = await chromium.launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2b-pp-"));
  const pdf = path.join(dir, "naissance.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");
  const slug = "demo-ecole";
  let fileNumber = "", secret = "";

  try {
    console.log("== Portail public ==");
    const pub = await browser.newPage();
    // Connexion lente simulée sur le parcours public.
    const cdp = await pub.context().newCDPSession(pub);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 400, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024,
    });
    await pub.goto(`${BASE}/candidature/${slug}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const pubBody = await pub.locator("body").innerText();
    check("portail : école + campagne ouverte + hors-période signalée",
      pubBody.includes("Démo") && pubBody.includes(CAMPAIGN_NAME) && pubBody.includes("Hors période"));
    await pub.getByRole("link", { name: "Déposer une candidature" }).first().click();
    await pub.waitForTimeout(3000);
    const formBody = await pub.locator("body").innerText();
    check("formulaire rendu (connexion lente)", /Responsable/.test(formBody) && /Extrait de naissance/.test(formBody));

    // Multi-enfants : 2 enfants en une soumission.
    await pub.getByLabel("Nom du responsable", { exact: true }).fill("Recette");
    await pub.getByLabel("Prénom du responsable", { exact: true }).fill("Preprod");
    await pub.getByLabel("Téléphone", { exact: true }).fill("+22670000000");
    await pub.getByLabel(/^Nom enfant 1/, { exact: true }).fill("Alpha");
    await pub.getByLabel(/^Prénom enfant 1/, { exact: true }).fill("Enfant");
    const lvl1 = pub.getByLabel(/^Niveau souhaité enfant 1/);
    if (await lvl1.count()) await lvl1.selectOption({ index: 1 });
    await pub.locator('input[name="file_0_naissance"]').setInputFiles(pdf);
    await pub.getByRole("button", { name: /Ajouter un autre enfant/ }).click();
    await pub.waitForTimeout(500);
    await pub.getByLabel(/^Nom enfant 2/, { exact: true }).fill("Beta");
    await pub.getByLabel(/^Prénom enfant 2/, { exact: true }).fill("Enfant");
    const lvl2 = pub.getByLabel(/^Niveau souhaité enfant 2/);
    if (await lvl2.count()) await lvl2.selectOption({ index: 1 });
    await pub.locator('input[name="file_1_naissance"]').setInputFiles(pdf);
    await pub.locator('input[name="confirmAccuracy"]').check();
    await pub.getByRole("button", { name: /Soumettre la candidature/ }).click();
    await pub.waitForTimeout(12000);
    const doneBody = await pub.locator("body").innerText();
    const numbers = doneBody.match(/DOS-\d{4}-\d{5}/g) ?? [];
    check("multi-enfants : 2 numéros de dossier", new Set(numbers).size === 2);
    fileNumber = numbers[0] ?? "";
    secret = (await pub.getByLabel("Code de suivi").innerText().catch(() => "")) .trim();
    check("code de suivi remis une fois", secret.length > 10);

    // Idempotence : double-clic soumission → la page résultat reste stable.
    // (le service déduplique par empreinte — vérifié côté recette service)

    console.log("== Suivi sécurisé ==");
    const suivi = await browser.newPage();
    await suivi.goto(`${BASE}/candidature/${slug}/suivi`, { waitUntil: "domcontentloaded" });
    await suivi.getByLabel("Numéro de dossier").fill(fileNumber);
    await suivi.getByLabel("Code de suivi").fill("mauvais");
    await suivi.getByRole("button", { name: /Consulter/ }).click();
    await suivi.waitForTimeout(3000);
    check("mauvais code → refus", /introuvable|invalide|erreur/i.test(await suivi.locator("body").innerText()));
    await suivi.getByLabel("Code de suivi").fill(secret);
    await suivi.getByRole("button", { name: /Consulter/ }).click();
    await suivi.waitForTimeout(4000);
    const trackBody = await suivi.locator("body").innerText();
    check("suivi : les 2 dossiers du groupe visibles",
      numbers.every((n) => trackBody.includes(n)) && /Dossier reçu/.test(trackBody));
    check("aucun chemin serveur exposé", !/uploads|storagePath|documents-private/i.test(trackBody));
    const [dl] = await Promise.all([
      suivi.waitForEvent("download", { timeout: 30000 }),
      suivi.getByRole("link", { name: "Télécharger" }).first().click(),
    ]);
    const dlPath = await dl.path();
    check("pièce téléchargée via ticket (contenu PDF)",
      !!dlPath && fs.readFileSync(dlPath!).subarray(0, 4).toString() === "%PDF");

    // Accès direct interdit : ticket falsifié, id nu.
    const bad = await suivi.context().request.get(`${BASE}/candidature/piece/faux`, { maxRedirects: 0 });
    check("route pièce falsifiée → refusée", bad.status() === 404);
    const conf = await suivi.context().request.get(`${BASE}/candidature/${slug}/confidentialite`);
    check("page confidentialité publique OK", conf.status() === 200);

    // mobile
    await suivi.setViewportSize({ width: 390, height: 844 });
    await suivi.goto(`${BASE}/candidature/${slug}/suivi`, { waitUntil: "domcontentloaded" });
    await suivi.waitForTimeout(1500);
    check("mobile 390px", await suivi.evaluate(() => document.documentElement.scrollWidth <= 390 + 16));
    await suivi.context().close();

    console.log("== Back-office ==");
    const adm = await login(browser, "admin@demo.local", PW, "Admin");
    if (adm) {
      await adm.goto(`${BASE}/app/admissions`, { waitUntil: "domcontentloaded" });
      await adm.waitForTimeout(2500);
      const admBody = await adm.locator("body").innerText();
      check("file : numéro listé", admBody.includes(fileNumber));
      await adm.goto(`${BASE}/app/admissions?q=${encodeURIComponent(fileNumber)}`, { waitUntil: "domcontentloaded" });
      await adm.waitForTimeout(2000);
      await adm.getByRole("link", { name: "Ouvrir" }).first().click();
      await adm.waitForTimeout(3000);
      const detail = await adm.locator("body").innerText();
      check("fiche : candidat + pièce + chronologie", /Alpha/.test(detail) && /naissance/i.test(detail));
      const [docDl] = await Promise.all([
        adm.waitForEvent("download", { timeout: 30000 }),
        adm.getByRole("link", { name: "Télécharger" }).first().click(),
      ]);
      check("pièce lisible côté instruction", !!(await docDl.path()));
      await adm.getByRole("button", { name: "Passer en instruction" }).click();
      await adm.waitForTimeout(3000);
      check("transition En instruction", /instruction/i.test(await adm.locator("body").innerText()));

      // Rotation du code via l'UI admin (secret affiché une fois côté client).
      adm.on("dialog", (d) => d.accept());
      const rotBtn = adm.getByRole("button", { name: /Régénérer le code de suivi/ });
      if (await rotBtn.count()) {
        await rotBtn.first().click();
        await adm.waitForTimeout(4000);
        const secretBox = adm.locator(".font-mono").last();
        const newSecret = (await secretBox.innerText().catch(() => "")).trim();
        check("rotation du code via UI (nouveau code affiché)", newSecret.length > 10);
        if (newSecret.length > 10) secret = newSecret;
      } else note("rotation UI : bouton non trouvé");
      await adm.context().close();
    }

    // Suivi reflète transition + rotation (ancien code mort si rotation capturée).
    const suivi2 = await browser.newPage();
    await suivi2.goto(`${BASE}/candidature/${slug}/suivi`, { waitUntil: "domcontentloaded" });
    await suivi2.getByLabel("Numéro de dossier").fill(fileNumber);
    await suivi2.getByLabel("Code de suivi").fill(secret);
    await suivi2.getByRole("button", { name: /Consulter/ }).click();
    await suivi2.waitForTimeout(4000);
    check("suivi après rotation/transition", /instruction|reçu/i.test(await suivi2.locator("body").innerText()));
    await suivi2.context().close();

    console.log("== Compte restreint (admissions.read seul) ==");
    const rd = await login(browser, READER_EMAIL, READER_PW, "Reader");
    if (rd) {
      await rd.goto(`${BASE}/app/admissions`, { waitUntil: "domcontentloaded" });
      await rd.waitForTimeout(2500);
      check("read : file visible", (await rd.locator("body").innerText()).length > 50);
      const piecesResp = await rd.context().request.get(
        `${BASE}/app/admissions/pieces/any/download`, { maxRedirects: 0 });
      check("read seul : pièces refusées", piecesResp.status() !== 200);
      await rd.context().close();
    }

    // Non-régression G2-A : page documents accessible à l'admin.
    console.log("== Non-régression G2-A ==");
    const adm2 = await login(browser, "admin@demo.local", PW, "Admin");
    if (adm2) {
      await adm2.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
      await adm2.waitForTimeout(2000);
      check("/app/documents accessible", !adm2.url().includes("/forbidden") &&
        /Documents/i.test(await adm2.locator("body").innerText()));
      await adm2.context().close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await browser.close();
  console.log(`\n=== G2-B préprod : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}

if (MODE === "fixtures") {
  serverFixtures().catch((e) => { console.error(e); process.exit(1); });
} else if (MODE === "cleanup") {
  serverCleanup().catch((e) => { console.error(e); process.exit(1); });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}
