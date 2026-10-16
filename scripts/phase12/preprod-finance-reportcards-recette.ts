import "dotenv/config";
import { execSync } from "node:child_process";
import { chromium, type BrowserContext, type APIResponse } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { listAccounts } from "@/lib/services/finance/accounts";
import { listUnpaid } from "@/lib/services/finance/payments";

/**
 * Recette préprod P5c — exports financiers + registre des bulletins.
 * Données de test ISOLÉES : élève « P5C-JOURNAL », paiements de test et
 * une remise temporaire — tous supprimés en fin de recette.
 * Aucune donnée métier modifiée (compteurs vérifiés avant/après).
 *
 * Usage (tunnel SSH 127.0.0.1:15432 → preprod 5432 ouvert + env) :
 *   set -a; . $TEMP/p5env.txt; set +a
 *   npx tsx scripts/phase12/preprod-finance-reportcards-recette.ts
 */

const BASE = "https://preprod.ecomschool.fr";
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

async function login(ctx: BrowserContext, email: string) {
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

const get = (ctx: BrowserContext, path: string) =>
  ctx.request.get(`${BASE}${path}`, { maxRedirects: 0 });
const csvText = async (r: APIResponse) => (await r.body()).toString("utf8");
const xlsx = async (r: APIResponse) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await r.body()) as unknown as ExcelJS.Buffer);
  return wb;
};
const rows = (csv: string) =>
  csv.replace("﻿", "").trim().split("\r\n").slice(1).filter(Boolean);
const header = (csv: string) => csv.replace("﻿", "").split("\r\n")[0];
const col = (csv: string, name: string) => header(csv).split(";").indexOf(name);
const cell = (l: string, i: number) => l.split(";")[i] ?? "";

async function main() {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" }, select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id }, orderBy: { startDate: "desc" },
    select: { id: true },
  });
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@demo.local" }, select: { id: true },
  });
  const ctxDb = { userId: admin.id, schoolId: school.id };
  const classroom = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: year.id },
    select: { id: true, name: true },
  });

  // Compteurs avant (lecture seule) + snapshot d'une version de bulletin.
  const countBefore = {
    pay: await prisma.payment.count({ where: { schoolId: school.id } }),
    inst: await prisma.feeInstallment.count({ where: { schoolId: school.id } }),
    disc: await prisma.feeDiscount.count({ where: { schoolId: school.id } }),
    rc: await prisma.reportCard.count({ where: { schoolId: school.id } }),
    rcv: await prisma.reportCardVersion.count({
      where: { reportCard: { schoolId: school.id } },
    }),
  };
  const aVersion = await prisma.reportCardVersion.findFirstOrThrow({
    where: { reportCard: { schoolId: school.id } },
    select: { id: true, payload: true },
  });
  const payloadBefore = JSON.stringify(aVersion.payload);

  // ---------- Données de test isolées ----------
  const tmpStudent = await prisma.student.create({
    data: {
      schoolId: school.id,
      matricule: `P5C-${Date.now().toString(36)}`,
      firstName: "Test",
      lastName: "Journal",
    },
    select: { id: true },
  });
  const tmpPaymentIds: string[] = [];
  let tmpStudentCleanupOnly = false;
  const tmpValidated = await prisma.payment.create({
    data: {
      schoolId: school.id, studentId: tmpStudent.id,
      academicYearId: year.id, amount: 7777, method: "CASH",
      reference: "P5C-VALID", status: "VALIDATED",
    },
    select: { id: true },
  });
  tmpPaymentIds.push(tmpValidated.id);
  const tmpCancelled = await prisma.payment.create({
    data: {
      schoolId: school.id, studentId: tmpStudent.id,
      academicYearId: year.id, amount: 1000, method: "CASH",
      reference: "P5C-ANNUL", status: "CANCELLED",
      cancelledAt: new Date(), cancelReason: "Erreur de saisie",
    },
    select: { id: true },
  });
  tmpPaymentIds.push(tmpCancelled.id);
  // Remise temporaire sur un élève ayant des impayés → test FIFO réel.
  const debtor = await listUnpaid(ctxDb, { academicYearId: year.id }).then(
    (u) => u[0],
  );
  const tmpDiscount = debtor
    ? await prisma.feeDiscount.create({
        data: {
          schoolId: school.id, studentId: debtor.student.id,
          academicYearId: year.id, type: "FIXED_AMOUNT", value: 3000,
          reason: "P5C recette — remise temporaire",
        },
        select: { id: true },
      })
    : null;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  try {
    const adminPage = await login(ctx, "admin@demo.local");

    // ---------- UI ----------
    const uiChecks: [string, string][] = [
      ["/app/fees/accounts", 'a[href*="fees/accounts/export"]'],
      ["/app/fees/accounts", 'a[href*="fees/installments/export"]'],
      ["/app/fees/unpaid", 'a[href*="fees/unpaid/export"]'],
      ["/app/fees/payments", 'a[href*="fees/payments/export"]'],
      ["/app/report-cards", 'a[href*="report-cards/export"]'],
    ];
    for (const [path, sel] of uiChecks) {
      await adminPage.goto(path, { waitUntil: "domcontentloaded" });
      check(`UI : commande d'export ${sel} sur ${path}`,
        (await adminPage.locator(sel).count()) > 0);
    }
    await adminPage.goto("/app/fees/accounts", { waitUntil: "domcontentloaded" });
    check(
      "UI : explication reste échéances (allocations) vs impayés (FIFO)",
      (await adminPage.locator("text=FIFO").count()) > 0,
    );

    // ---------- COMPTES ----------
    const accounts = await listAccounts(ctxDb, { academicYearId: year.id });
    const accCsv = await csvText(
      await get(ctx, `/app/fees/accounts/export?format=csv&year=${year.id}`),
    );
    check("comptes CSV : en-têtes + 1 ligne/compte",
      header(accCsv).startsWith("matricule;nom;prenom;classe;charges_xof") &&
        rows(accCsv).length === accounts.length,
      `${rows(accCsv).length} lignes`);
    const byMat = new Map(
      rows(accCsv).map((l) => [cell(l, col(accCsv, "matricule")), l]),
    );
    check(
      "comptes CSV : montants concordants avec listAccounts",
      accounts.slice(0, 10).every((a) => {
        const l = byMat.get(a.student.matricule);
        return !!l &&
          Number(cell(l, col(accCsv, "charges_xof"))) === a.charges &&
          Number(cell(l, col(accCsv, "du_xof"))) === a.due &&
          Number(cell(l, col(accCsv, "paye_xof"))) === a.paid &&
          Number(cell(l, col(accCsv, "solde_xof"))) === a.balance;
      }),
    );
    const accWb = await xlsx(
      await get(ctx, `/app/fees/accounts/export?format=xlsx&year=${year.id}`),
    );
    check("comptes XLSX : feuille Comptes + autofiltre + montants numériques",
      !!accWb.getWorksheet("Comptes")?.autoFilter &&
        typeof accWb.getWorksheet("Comptes")!.getRow(2).getCell(9).value ===
          "number");
    const accClCsv = await csvText(
      await get(ctx, `/app/fees/accounts/export?format=csv&year=${year.id}&classroom=${classroom.id}`),
    );
    check("comptes CSV : filtre classe",
      rows(accClCsv).length ===
        accounts.filter((a) => a.classroom.name === classroom.name).length,
      `${rows(accClCsv).length} lignes`);

    // ---------- ÉCHÉANCES ----------
    const instCsv = await csvText(
      await get(ctx, `/app/fees/installments/export?format=csv&year=${year.id}`),
    );
    const instAlloc = await prisma.feeInstallment.findFirstOrThrow({
      where: {
        schoolId: school.id, academicYearId: year.id,
        allocations: { some: { payment: { status: "VALIDATED" } } },
      },
      include: {
        allocations: { where: { payment: { status: "VALIDATED" } } },
      },
    });
    const iRow = rows(instCsv).find(
      (l) => cell(l, col(instCsv, "echeance")) === instAlloc.label,
    );
    const paid = instAlloc.allocations.reduce((s, a) => s + a.amount, 0);
    check("échéances CSV : reste = montant − allocations validées",
      !!iRow &&
        Number(cell(iRow, col(instCsv, "reste_xof"))) ===
          Math.max(0, instAlloc.amount - paid) &&
        Number(cell(iRow, col(instCsv, "paye_xof"))) === paid);
    check("échéances CSV : statuts traduits",
      /(À venir|Partielle|Payée|En retard|Annulée)/.test(instCsv) &&
        !instCsv.includes(";UPCOMING") && !instCsv.includes(";LATE"));
    const instWb = await xlsx(
      await get(ctx, `/app/fees/installments/export?format=xlsx&year=${year.id}`),
    );
    check("échéances XLSX : feuille Échéances",
      !!instWb.getWorksheet("Échéances"));

    // ---------- IMPAYÉS + FIFO ----------
    const unpaid = await listUnpaid(ctxDb, { academicYearId: year.id });
    const unpCsv = await csvText(
      await get(ctx, `/app/fees/unpaid/export?format=csv&year=${year.id}`),
    );
    check("impayés CSV : lignes = listUnpaid (FIFO inclus)",
      rows(unpCsv).length === unpaid.length,
      `${rows(unpCsv).length} lignes`);
    const debitorRow = debtor
      ? rows(unpCsv).find(
          (l) =>
            cell(l, col(unpCsv, "matricule")) === debtor.student.matricule &&
            cell(l, col(unpCsv, "echeance")) === (debtor.label ?? "") &&
            cell(l, col(unpCsv, "categorie")) === debtor.category,
        )
      : undefined;
    const debitorAfter = debtor
      ? (await listUnpaid(ctxDb, { academicYearId: year.id })).find(
          (u) =>
            u.student.id === debtor.student.id && u.label === debtor.label,
        )
      : undefined;
    check(
      "impayés CSV : reste net après remise FIFO = sortie du service",
      !debtor ||
        (!!debitorRow &&
          !!debitorAfter &&
          Number(cell(debitorRow, col(unpCsv, "reste_xof"))) ===
            debitorAfter.remaining),
      debitorAfter ? `reste=${debitorAfter.remaining}` : "aucun impayé",
    );
    const unpLate = await csvText(
      await get(ctx, `/app/fees/unpaid/export?format=csv&year=${year.id}&late=1`),
    );
    check("impayés CSV : filtre late=1 ⊆ en retard",
      rows(unpLate).length ===
        (await listUnpaid(ctxDb, { academicYearId: year.id })).filter((u) => u.late)
          .length);

    // ---------- JOURNAL DES PAIEMENTS ----------
    const jCsv = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&year=${year.id}`),
    );
    check("journal CSV : en-têtes standardisés",
      header(jCsv).startsWith("date;recu;matricule;nom;prenom;mode"));
    check("journal CSV : validé + annulé explicitement identifiés",
      /;P5C-VALID;[^;]*;Validé;/.test(jCsv) &&
        /;P5C-ANNUL;[^;]*;Annulé;Erreur de saisie/.test(jCsv));
    const jCancelledOnly = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&year=${year.id}&status=CANCELLED`),
    );
    check("journal CSV : status=CANCELLED → uniquement annulés",
      rows(jCancelledOnly).length === 1 &&
        jCancelledOnly.includes("P5C-ANNUL"));
    const jMethod = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&year=${year.id}&method=MOBILE_MONEY`),
    );
    check("journal CSV : filtre method=MOBILE_MONEY",
      rows(jMethod).length > 0 &&
        rows(jMethod).every((l) => l.includes("Mobile Money")));
    const nAlloc = await prisma.paymentAllocation.count({
      where: { payment: { schoolId: school.id, academicYearId: year.id } },
    });
    const jWb = await xlsx(
      await get(ctx, `/app/fees/payments/export?format=xlsx&year=${year.id}`),
    );
    check("journal XLSX : feuilles Paiements + Ventilations",
      !!jWb.getWorksheet("Paiements") && !!jWb.getWorksheet("Ventilations"));
    check("journal XLSX : Ventilations = 1 ligne/allocation BDD",
      jWb.getWorksheet("Ventilations")!.rowCount - 1 === nAlloc,
      `${jWb.getWorksheet("Ventilations")!.rowCount - 1}/${nAlloc}`);
    const jAllocCsv = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&view=allocations&year=${year.id}`),
    );
    check("ventilations CSV : en-têtes dédiées + 1 ligne/allocation",
      header(jAllocCsv).includes("montant_alloue_xof") &&
        rows(jAllocCsv).length === nAlloc);
    const jStudent = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&student=${tmpStudent.id}`),
    );
    check("journal CSV : filtre student → paiements de test seuls",
      rows(jStudent).length === 2);

    // ---------- > 500 PAIEMENTS ----------
    const bulk = Array.from({ length: 510 }, (_, i) => ({
      schoolId: school.id, studentId: tmpStudent.id,
      academicYearId: year.id, amount: 10 + i,
      method: "CASH" as const, paidAt: new Date(Date.now() - i * 1000),
    }));
    await prisma.payment.createMany({ data: bulk });
    // Nettoyage par studentId (createMany ne retourne pas les ids).
    tmpStudentCleanupOnly = true;
    const expected = await prisma.payment.count({
      where: { studentId: tmpStudent.id },
    });
    const jBig = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&student=${tmpStudent.id}`),
    );
    check("journal : >500 paiements sans troncature",
      rows(jBig).length === expected && !jBig.includes("Export tronqué"),
      `${rows(jBig).length}/${expected}`);

    // ---------- ANCIENNE URL /csv — CONTRAT HISTORIQUE ----------
    const legacy = await get(ctx, `/app/fees/payments/csv?year=${year.id}`);
    const legacyCsv = await csvText(legacy);
    check("historique /csv : en-tête contractuel exact",
      header(legacyCsv) ===
        "date;reçu;matricule;élève;mode;référence;montant;statut;motif_annulation");
    check("historique /csv : valeurs brutes (enums) + cellules quotées",
      legacyCsv.includes('"P5C-ANNUL"') &&
        legacyCsv.includes('"CANCELLED"') &&
        legacyCsv.includes('"CASH"') &&
        rows(legacyCsv)[0].split(";").every((c) => c.startsWith('"')));
    check("historique /csv : nom de fichier fixe journal-paiements.csv",
      (legacy.headers()["content-disposition"] ?? "").includes(
        "journal-paiements.csv",
      ));
    check("historique /csv : >500 lignes aussi (plafond levé)",
      (await csvText(
        await get(ctx, `/app/fees/payments/csv?student=${tmpStudent.id}`),
      )).split("\r\n").filter((l) => l.trim()).length - 1 === expected);

    // ---------- INJECTION ----------
    const jInj = await csvText(
      await get(ctx, `/app/fees/payments/export?format=csv&student=${tmpStudent.id}`),
    );
    check("journal : aucune cellule ne débute par un opérateur",
      rows(jInj).every((l) =>
        l.split(";").every((c) => !/^"?[\s]*[=+\-@]/.test(c)),
      ));
    const legacyInj = await csvText(
      await get(ctx, `/app/fees/payments/csv?student=${tmpStudent.id}`),
    );
    check("historique : aucune cellule non neutralisée",
      rows(legacyInj).every((l) =>
        l.split(";").every((c) => !/^"[\s]*[=+\-@]/.test(c)),
      ));

    // ---------- REGISTRE DES BULLETINS ----------
    const rcCsv = await csvText(
      await get(ctx, "/app/report-cards/export?format=csv"),
    );
    check("registre CSV : 1 ligne/bulletin + en-têtes",
      rows(rcCsv).length === countBefore.rc &&
        header(rcCsv).includes("version_courante") &&
        header(rcCsv).includes("date_publication"),
      `${rows(rcCsv).length} lignes`);
    const rcIds = new Set(
      (await prisma.reportCard.findMany({
        where: { schoolId: school.id }, select: { identifier: true },
      })).map((c) => c.identifier),
    );
    check("registre : isolation — identifiants ∈ école uniquement",
      rows(rcCsv).every((l) => rcIds.has(cell(l, col(rcCsv, "identifiant")))));
    const rcWb = await xlsx(
      await get(ctx, "/app/report-cards/export?format=xlsx"),
    );
    check("registre XLSX : Registre + Versions = historique BDD",
      rcWb.getWorksheet("Registre")!.rowCount - 1 === countBefore.rc &&
        rcWb.getWorksheet("Versions")!.rowCount - 1 === countBefore.rcv);
    const rcPub = await csvText(
      await get(ctx, "/app/report-cards/export?format=csv&status=PUBLISHED"),
    );
    check("registre : filtre status=PUBLISHED",
      rows(rcPub).length ===
        (await prisma.reportCard.count({
          where: { schoolId: school.id, status: "PUBLISHED" },
        })));

    // ---------- PERMISSIONS ----------
    const cashierPage = await login(ctx, "caissier@demo.local");
    const cCtx = cashierPage.context();
    const refusedAll = await Promise.all(
      [
        "/app/fees/accounts/export?format=csv",
        "/app/fees/installments/export?format=csv",
        "/app/fees/unpaid/export?format=csv",
        "/app/fees/payments/export?format=csv",
        "/app/fees/payments/csv",
        "/app/report-cards/export?format=csv",
      ].map(async (u) => (await get(cCtx, u)).status()),
    );
    check("caissier : les 6 routes refusées (307/403)",
      refusedAll.every((s) => [302, 303, 307, 308, 403].includes(s)),
      refusedAll.join(","));
    const financePage = await login(ctx, "finance@demo.local");
    const fCtx = financePage.context();
    const allowedFinance = await Promise.all(
      [
        `/app/fees/accounts/export?format=csv&year=${year.id}`,
        `/app/fees/installments/export?format=csv&year=${year.id}`,
        `/app/fees/unpaid/export?format=csv&year=${year.id}`,
        `/app/fees/payments/export?format=csv&year=${year.id}`,
        `/app/fees/payments/csv?year=${year.id}`,
      ].map(async (u) => (await get(fCtx, u)).status()),
    );
    check("finances : les 5 routes autorisées (200)",
      allowedFinance.every((s) => s === 200), allowedFinance.join(","));
    check("finances : registre bulletins refusé (pas de droit pédagogique)",
      [302, 303, 307, 308, 403].includes(
        (await get(fCtx, "/app/report-cards/export?format=csv")).status(),
      ));

    // ---------- ENSEIGNANT : périmètre ----------
    const teacherPage = await login(ctx, "enseignant@demo.local");
    const tCtx = teacherPage.context();
    const tRefused = await Promise.all(
      [
        "/app/fees/accounts/export?format=csv",
        "/app/fees/payments/export?format=csv",
        "/app/fees/payments/csv",
      ].map(async (u) => (await get(tCtx, u)).status()),
    );
    check("enseignant : exports financiers refusés",
      tRefused.every((s) => [302, 303, 307, 308, 403].includes(s)));
    const tUser = await prisma.user.findUniqueOrThrow({
      where: { email: "enseignant@demo.local" },
    });
    const tids = (
      await prisma.teacher.findMany({
        where: { schoolId: school.id, userId: tUser.id }, select: { id: true },
      })
    ).map((t) => t.id);
    const pairs = new Set<string>();
    for (const a of await prisma.teachingAssignment.findMany({
      where: { schoolId: school.id, teacherId: { in: tids } },
      select: { classroomId: true, academicYearId: true },
    })) pairs.add(`${a.academicYearId}|${a.classroomId}`);
    for (const c of await prisma.classroomSubject.findMany({
      where: { schoolId: school.id, teacherId: { in: tids } },
      select: { classroomId: true, classroom: { select: { academicYearId: true } } },
    })) pairs.add(`${c.classroom.academicYearId}|${c.classroomId}`);
    const tCsv = await csvText(
      await get(tCtx, "/app/report-cards/export?format=csv"),
    );
    const tCards = await prisma.reportCard.findMany({
      where: {
        identifier: {
          in: rows(tCsv).map((l) => cell(l, col(tCsv, "identifiant"))),
        },
      },
      select: {
        classroomId: true,
        academicPeriod: { select: { academicYearId: true } },
      },
    });
    check("enseignant : registre limité aux classes affectées (par année)",
      tCards.length > 0 &&
        tCards.every((c) =>
          pairs.has(`${c.academicPeriod.academicYearId}|${c.classroomId}`),
        ),
      `${tCards.length} bulletins`);
    check("enseignant : classroom=inexistant/hors périmètre → 403",
      (await get(tCtx, `/app/report-cards/export?format=csv&classroom=${crypto.randomUUID()}`)).status() === 403);

    // ---------- LECTURE SEULE + SNAPSHOTS ----------
    const aVersionAfter = await prisma.reportCardVersion.findUniqueOrThrow({
      where: { id: aVersion.id }, select: { payload: true },
    });
    check("snapshots : payload d'une version inchangé",
      JSON.stringify(aVersionAfter.payload) === payloadBefore);

    // ---------- NON-RÉGRESSION ----------
    const ok200 = async (p: string) =>
      (await adminPage.goto(p, { waitUntil: "domcontentloaded" }))?.status() === 200;
    const gradesCsv = await get(ctx, "/app/grades/export?format=csv");
    const studentsCsv = await get(ctx, "/app/students/export?format=csv");
    check("non-régression : P2-P5b pages + exports P5a/P5b",
      gradesCsv.status() === 200 && studentsCsv.status() === 200 &&
        (await ok200("/app/report-cards")) &&
        (await ok200("/app/announcements")) &&
        (await ok200("/app/fees")) &&
        (await ok200("/app/grades")));
    const neighbors = execSync(
      `ssh ecomschool-preprod "curl -s -o /dev/null -w '%{http_code} ' https://preprod.ecomschool.fr/login ; curl -s -o /dev/null -w '%{http_code} ' https://wendyam-finance.com ; curl -s -o /dev/null -w '%{http_code}' https://tme-machinery.com"`,
      { timeout: 30_000 },
    ).toString().trim();
    check("voisins VPS : preprod+wendyam+tme HTTP 200",
      neighbors === "200 200 200", neighbors);
  } finally {
    if (tmpStudentCleanupOnly) {
      await prisma.payment.deleteMany({
        where: { studentId: tmpStudent.id },
      });
    } else {
      await prisma.payment.deleteMany({
        where: { id: { in: tmpPaymentIds } },
      });
    }
    if (tmpDiscount)
      await prisma.feeDiscount.delete({ where: { id: tmpDiscount.id } });
    await prisma.student.delete({ where: { id: tmpStudent.id } });
    await ctx.close();
    await browser.close();
  }

  const countAfter = {
    pay: await prisma.payment.count({ where: { schoolId: school.id } }),
    inst: await prisma.feeInstallment.count({ where: { schoolId: school.id } }),
    disc: await prisma.feeDiscount.count({ where: { schoolId: school.id } }),
    rc: await prisma.reportCard.count({ where: { schoolId: school.id } }),
    rcv: await prisma.reportCardVersion.count({
      where: { reportCard: { schoolId: school.id } },
    }),
  };
  check(
    "lecture seule : compteurs BDD identiques après exports + nettoyage",
    countAfter.pay === countBefore.pay &&
      countAfter.inst === countBefore.inst &&
      countAfter.disc === countBefore.disc &&
      countAfter.rc === countBefore.rc &&
      countAfter.rcv === countBefore.rcv,
    JSON.stringify(countAfter),
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().finally(() => prisma.$disconnect());
