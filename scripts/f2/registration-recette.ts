/**
 * Lot F2-D2-B — Recette authentifiée du guichet d'inscription (LOCAL).
 *
 * Pré-requis : `npm run dev` + `npx tsx scripts/f2/test-fixtures.ts`
 * + `npx tsx scripts/f2/bootstrap-registration-permissions.ts`.
 * Les fixtures f2-*@test.local ont déjà les permissions fines.
 * Écritures : fixtures F2B-* uniquement (base locale).
 *
 * Exécution : npx tsx scripts/f2/registration-recette.ts
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";

const BASE = process.env.F2_BASE_URL ?? "http://localhost:3000";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

async function login(browser: Browser, email: string, label: string, pw = PW): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(pw);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function bodyText(page: Page) {
  await page.waitForTimeout(800);
  return page.locator("body").innerText();
}

async function pay(page: Page, amount: number) {
  const before = page.url();
  // Le formulaire d'encaissement est le seul avec idempotencyKey —
  // nécessaire car « Montant » existe aussi dans l'édition d'échéances
  // (visible pour FINANCE_MANAGER / ADMIN_SCHOOL).
  const form = page.locator("form", {
    has: page.locator('input[name="idempotencyKey"]'),
  });
  await form.getByLabel("Montant").fill(String(amount));
  await form.getByLabel("Mode de paiement").selectOption("CASH");
  await form.getByRole("button", { name: "Encaisser" }).click();
  // Dev server : l'action peut prendre ~20 s. L'URL change toujours
  // (ok=payment&receipt=… ou error=…), même si l'URL précédente
  // contenait déjà ces paramètres.
  await page.waitForFunction((prev) => location.href !== prev, before, {
    timeout: 90000,
  });
  await page.waitForTimeout(800);
}

async function main() {
  const school = await prisma.school.findFirstOrThrow({
    where: { name: { contains: "Démo" } }, select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true }, select: { id: true },
  });
  const cls = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: year.id },
    select: { id: true, name: true },
  });
  // Fixture : élève existant NON inscrit à l'année courante.
  const stamp = Date.now().toString(36).toUpperCase();
  const orphan = await prisma.student.create({
    data: {
      schoolId: school.id,
      matricule: `F2B-${stamp}`,
      firstName: "NonInscrit",
      lastName: "Fixture",
    },
    select: { id: true, matricule: true },
  });
  // Fixture : élève archivé — inscriptible nulle part (recherche exclut
  // les non-ACTIVE ; le service refuserait de toute façon).
  await prisma.student.create({
    data: {
      schoolId: school.id,
      matricule: `F2B-ARCH-${stamp}`,
      firstName: "Archive",
      lastName: "Fixture",
      status: "ARCHIVED",
    },
  });
  // Fixture : élève inscrit SANS créances — simule un échec de génération
  // après commit ; la reprise doit être proposée sur le dossier, sans
  // dépendre d'un paramètre d'URL.
  const gapStudent = await prisma.student.create({
    data: {
      schoolId: school.id,
      matricule: `F2B-NC-${stamp}`,
      firstName: "SansCreance",
      lastName: "Fixture",
    },
    select: { id: true },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: school.id,
      studentId: gapStudent.id,
      classroomId: cls.id,
      academicYearId: year.id,
      status: "ENROLLED",
    },
  });

  const browser = await chromium.launch();

  // ---------- CASHIER — guichet complet ----------
  console.log("\n== CASHIER — guichet ==");
  const pc = await login(browser, "f2-caissier-a@test.local", "caissier");
  if (pc) {
    await pc.goto(`${BASE}/app/fees/registration`, { waitUntil: "domcontentloaded" });
    let t = await bodyText(pc);
    check("caissier : page guichet", /inscriptions/i.test(t));
    check("caissier : onglet nouvel élève", /nouvel élève/i.test(t));

    // Parcours A : créer + inscrire.
    const mat = `F2B-G${stamp}`;
    await pc.goto(`${BASE}/app/fees/registration?mode=new`, { waitUntil: "domcontentloaded" });
    await pc.locator('input[name="matricule"]').fill(mat);
    await pc.locator('input[name="lastName"]').fill("Guichet");
    await pc.locator('input[name="firstName"]').fill("Eleve");
    await pc.locator('select[name="sex"]').selectOption("FEMALE");
    await pc.locator('select[name="classroomId"]').selectOption(cls.id);
    await pc.getByRole("button", { name: /créer et inscrire/i }).click();
    await pc.waitForURL(/\/app\/fees\/accounts\//, { timeout: 60000 });
    t = await bodyText(pc);
    check("redirection vers dossier financier", pc.url().includes("/app/fees/accounts/"));
    check("inscription confirmée", /inscription enregistrée|créances/i.test(t));
    check("solde affiché", /solde/i.test(t));
    check("aucune reprise proposée (créances complètes)", !/non générée/i.test(t));

    // Encaissement 1 : partiel.
    const due = await prisma.studentFeeCharge.aggregate({
      where: { student: { matricule: mat }, academicYearId: year.id, status: "ACTIVE" },
      _sum: { amount: true },
    });
    const total = due._sum.amount ?? 0;
    check("créances générées (>0)", total > 0);
    if (total > 0) {
      const p1 = Math.max(1, Math.floor(total / 4));
      await pay(pc, p1);
      t = await bodyText(pc);
      check("1er versement : reçu émis", /reçu REC-/i.test(t));
      // Encaissement 2 : nouveau versement.
      const p2 = Math.max(1, Math.floor(total / 4));
      await pay(pc, p2);
      t = await bodyText(pc);
      check("2e versement : reçu distinct", (t.match(/REC-\d+-\d+/g) ?? []).length >= 2);
      // Surpaiement refusé.
      await pay(pc, total);
      t = await bodyText(pc);
      check("surpaiement refusé", /solde restant/i.test(t));
      // Solde exact.
      await pay(pc, total - p1 - p2);
      t = await bodyText(pc);
      check("solde exact accepté", /reçu REC-/i.test(t));
      check("« Frais soldés » affiché", /frais soldés/i.test(t));
      check("formulaire encaisser désactivé", (await pc.getByLabel("Montant").count()) === 0);
      // Historique : 3 reçus distincts.
      const receipts = await prisma.payment.count({
        where: { student: { matricule: mat }, status: "VALIDATED" },
      });
      check("3 paiements validés en historique", receipts === 3);
    }
    // Mes encaissements : le reçu y apparaît.
    await pc.goto(`${BASE}/app/fees/my-payments?q=${encodeURIComponent(mat)}`, { waitUntil: "domcontentloaded" });
    t = await bodyText(pc);
    check("versements visibles dans Mes encaissements", /REC-/.test(t));

    // Élève archivé : absent de la recherche, donc non inscriptible.
    await pc.goto(
      `${BASE}/app/fees/registration?q=F2B-ARCH-${stamp}`,
      { waitUntil: "domcontentloaded" },
    );
    t = await bodyText(pc);
    check("élève archivé exclu de la recherche", /aucun élève/i.test(t));

    // Reprise de créances — détectée sur l'état réel (inscrit, 0 créance,
    // tarifs configurés), sans paramètre d'URL.
    await pc.goto(
      `${BASE}/app/fees/accounts/${gapStudent.id}?year=${year.id}`,
      { waitUntil: "domcontentloaded" },
    );
    t = await bodyText(pc);
    check("créances manquantes détectées sur le dossier", /non générée/i.test(t));
    const beforeRetry = pc.url();
    await pc.getByRole("button", { name: /relancer la génération/i }).click();
    await pc.waitForFunction((prev) => location.href !== prev, beforeRetry, {
      timeout: 90000,
    });
    t = await bodyText(pc);
    const gapCharges = await prisma.studentFeeCharge.count({
      where: { studentId: gapStudent.id, status: "ACTIVE" },
    });
    check("reprise : créances générées", gapCharges > 0);
    check("reprise : alerte disparue", !/non générée/i.test(t));

    // Restrictions : le journal global reste refusé au caissier.
    await pc.goto(`${BASE}/app/fees/payments`, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    while (!pc.url().includes("/forbidden") && Date.now() - t0 < 15000) {
      await pc.waitForTimeout(700);
    }
    check("journal global toujours refusé", pc.url().includes("/forbidden"));
    await pc.context().close();
  }

  // ---------- FINANCE_MANAGER — élève existant ----------
  console.log("\n== FINANCE_MANAGER — élève existant ==");
  const pfm = await login(browser, "f2-finance@test.local", "FM");
  if (pfm) {
    await pfm.goto(
      `${BASE}/app/fees/registration?q=${orphan.matricule}`,
      { waitUntil: "domcontentloaded" },
    );
    let t = await bodyText(pfm);
    check("FM : recherche matricule trouve l'élève", t.includes(orphan.matricule!));
    check("FM : statut « Non inscrit »", /non inscrit/i.test(t));
    await pfm.locator('select[name="classroomId"]').selectOption(cls.id);
    await pfm.getByRole("button", { name: /^inscrire$/i }).click();
    await pfm.waitForURL(/\/app\/fees\/accounts\//, { timeout: 60000 });
    t = await bodyText(pfm);
    check("FM : inscription existante → dossier", /inscription enregistrée/i.test(t));
    const accountUrl = pfm.url();
    // Re-soumission : retour liste → déjà inscrit.
    await pfm.goto(
      `${BASE}/app/fees/registration?q=${orphan.matricule}`,
      { waitUntil: "domcontentloaded" },
    );
    t = await bodyText(pfm);
    check("FM : élève désormais « Inscrit » + lien dossier", /inscrit/i.test(t) && !/non inscrit/i.test(t));
    // Retour sur le dossier pour l'encaissement différé.
    await pfm.goto(accountUrl, { waitUntil: "domcontentloaded" });
    // Encaissement différé : paiement partiel puis solde.
    const due = await prisma.studentFeeCharge.aggregate({
      where: { studentId: orphan.id, academicYearId: year.id, status: "ACTIVE" },
      _sum: { amount: true },
    });
    if ((due._sum.amount ?? 0) > 0) {
      await pay(pfm, 1);
      t = await bodyText(pfm);
      check("FM : encaissement différé sur dossier", /reçu REC-/i.test(t));
    } else {
      note("aucune créance pour l'élève fixture");
    }
    await pfm.context().close();
  }

  // ---------- ADMIN_SCHOOL ----------
  console.log("\n== ADMIN_SCHOOL ==");
  const adminPw = process.env.SEED_DEMO_PASSWORD;
  if (!adminPw) note("admin : SEED_DEMO_PASSWORD absent");
  else {
    const padm = await login(browser, "admin@demo.local", "admin", adminPw);
    if (padm) {
      await padm.goto(`${BASE}/app/fees/registration`, { waitUntil: "domcontentloaded" });
      const t = await bodyText(padm);
      check("admin : guichet accessible", /inscriptions/i.test(t));
      check("admin : onglets visibles", /nouvel élève/i.test(t) && /élève existant/i.test(t));
      await padm.context().close();
    }
  }

  // ---------- Alerte doublon (GET) ----------
  console.log("\n== Alerte doublons ==");
  const pc2 = await login(browser, "f2-caissier-a@test.local", "caissier (doublons)");
  if (pc2) {
    await pc2.goto(
      `${BASE}/app/fees/registration?mode=new&dupLast=Guichet&dupFirst=Eleve`,
      { waitUntil: "domcontentloaded" },
    );
    let t = await bodyText(pc2);
    check("doublon potentiel signalé", /similaire/i.test(t));
    // Reconnexion : le dossier de l'élève repris ne propose plus la reprise.
    await pc2.goto(
      `${BASE}/app/fees/accounts/${gapStudent.id}?year=${year.id}`,
      { waitUntil: "domcontentloaded" },
    );
    t = await bodyText(pc2);
    check("reconnexion : dossier à jour, reprise non reproposée", !/non générée/i.test(t) && /créances vérifiées|solde/i.test(t));
    await pc2.context().close();
  }

  await browser.close();
  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
