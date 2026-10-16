import { test, expect, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma, ACCOUNTS } from "./helpers";
import { listAccounts } from "../src/lib/services/finance/accounts";
import { listUnpaid } from "../src/lib/services/finance/payments";
import { buildPaymentsExport } from "../src/lib/export/finance";

/**
 * P5c — exports financiers (comptes, échéances, impayés, journal des
 * paiements + ventilations) et registre des bulletins (+ versions).
 * Vérifie : concordance exacte des montants avec les services
 * existants, permissions finance.reports.read / reportcards.read,
 * périmètre enseignant par année, URL historique /csv, volumes > 500,
 * injection de formules, isolation tenant, lecture seule.
 */

const demoCtx = async () => {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
  });
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: ACCOUNTS.demoAdmin.email },
  });
  return {
    school,
    year,
    ctx: { userId: admin.id, schoolId: school.id },
  };
};

const rows = (csv: string) =>
  csv.replace("﻿", "").trim().split("\r\n").slice(1).filter(Boolean);
const header = (csv: string) => csv.replace("﻿", "").split("\r\n")[0];
const col = (csv: string, name: string) => header(csv).split(";").indexOf(name);
const cell = (l: string, i: number) => l.split(";")[i] ?? "";

async function xlsxOf(res: { ok(): boolean; body(): Promise<Buffer> }) {
  expect(res.ok()).toBeTruthy();
  const buf = await res.body();
  expect(buf.subarray(0, 2).toString()).toBe("PK");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

test.describe.configure({ mode: "serial" });

// ---------- Situation financière / échéances / impayés ----------
test.describe("P5c — comptes, échéances, impayés", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("comptes : montants strictement concordants avec listAccounts", async ({
    request,
  }) => {
    const { year, ctx } = await demoCtx();
    const service = await listAccounts(ctx, { academicYearId: year.id });
    const res = await request.get(
      `/app/fees/accounts/export?format=csv&year=${year.id}`,
    );
    expect(res.status()).toBe(200);
    const csv = await res.text();
    const iMat = col(csv, "matricule");
    const data = rows(csv);
    expect(data.length).toBe(service.length);
    const byMat = new Map(data.map((l) => [cell(l, iMat), l]));
    for (const a of service) {
      const l = byMat.get(a.student.matricule);
      expect(l, a.student.matricule).toBeDefined();
      expect(Number(cell(l!, col(csv, "charges_xof")))).toBe(a.charges);
      expect(Number(cell(l!, col(csv, "remises_xof")))).toBe(a.discounts);
      expect(Number(cell(l!, col(csv, "du_xof")))).toBe(a.due);
      expect(Number(cell(l!, col(csv, "paye_xof")))).toBe(a.paid);
      expect(Number(cell(l!, col(csv, "solde_xof")))).toBe(a.balance);
    }
  });

  test("comptes : filtre classe + XLSX", async ({ request }) => {
    const { school, year, ctx } = await demoCtx();
    const classroom = await prisma.classroom.findFirstOrThrow({
      where: { schoolId: school.id, academicYearId: year.id },
    });
    const service = await listAccounts(ctx, {
      academicYearId: year.id,
      classroomId: classroom.id,
    });
    const res = await request.get(
      `/app/fees/accounts/export?format=csv&year=${year.id}&classroom=${classroom.id}`,
    );
    expect(rows(await res.text()).length).toBe(service.length);
    const wb = await xlsxOf(
      await request.get(`/app/fees/accounts/export?format=xlsx&year=${year.id}`),
    );
    expect(wb.getWorksheet("Comptes")).toBeTruthy();
    expect(wb.getWorksheet("Comptes")!.autoFilter).toBeTruthy();
  });

  test("échéances : reste = montant − allocations validées, statut calculé", async ({
    request,
  }) => {
    const { school, year } = await demoCtx();
    const inst = await prisma.feeInstallment.findFirstOrThrow({
      where: {
        schoolId: school.id,
        academicYearId: year.id,
        allocations: { some: { payment: { status: "VALIDATED" } } },
      },
      include: {
        allocations: { where: { payment: { status: "VALIDATED" } } },
      },
    });
    const res = await request.get(
      `/app/fees/installments/export?format=csv&year=${year.id}&student=${inst.studentId}`,
    );
    const csv = await res.text();
    const iEch = col(csv, "echeance");
    const row = rows(csv).find((l) => cell(l, iEch) === inst.label)!;
    const paid = inst.allocations.reduce((s, a) => s + a.amount, 0);
    expect(Number(cell(row, col(csv, "montant_xof")))).toBe(inst.amount);
    expect(Number(cell(row, col(csv, "paye_xof")))).toBe(paid);
    expect(Number(cell(row, col(csv, "reste_xof")))).toBe(
      Math.max(0, inst.amount - paid),
    );
    expect(["À venir", "Partielle", "Payée", "En retard", "Annulée"]).toContain(
      cell(row, col(csv, "statut")),
    );
    const wb = await xlsxOf(
      await request.get(
        `/app/fees/installments/export?format=xlsx&year=${year.id}`,
      ),
    );
    expect(wb.getWorksheet("Échéances")).toBeTruthy();
  });

  test("impayés : concordance exacte avec listUnpaid (FIFO) + filtre retards", async ({
    request,
  }) => {
    const { year, ctx } = await demoCtx();
    const service = await listUnpaid(ctx, { academicYearId: year.id });
    const res = await request.get(
      `/app/fees/unpaid/export?format=csv&year=${year.id}`,
    );
    const csv = await res.text();
    const data = rows(csv);
    expect(data.length).toBe(service.length);
    const iMat = col(csv, "matricule");
    const iEch = col(csv, "echeance");
    const iCat = col(csv, "categorie");
    for (const u of service) {
      const row = data.find(
        (l) =>
          cell(l, iMat) === u.student.matricule &&
          cell(l, iEch) === (u.label ?? "") &&
          cell(l, iCat) === u.category,
      );
      expect(row, `${u.student.matricule}/${u.label}`).toBeDefined();
      expect(Number(cell(row!, col(csv, "reste_xof")))).toBe(u.remaining);
      expect(Number(cell(row!, col(csv, "retard_jours")))).toBe(u.daysLate);
    }
    const late = await request.get(
      `/app/fees/unpaid/export?format=csv&year=${year.id}&late=1`,
    );
    expect(rows(await late.text()).length).toBe(
      service.filter((u) => u.late).length,
    );
    const wb = await xlsxOf(
      await request.get(`/app/fees/unpaid/export?format=xlsx&year=${year.id}`),
    );
    expect(wb.getWorksheet("Impayés")).toBeTruthy();
  });
});

// ---------- Journal des paiements ----------
test.describe("P5c — journal des paiements", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });
  const cleanup: string[] = [];
  let tempStudentId = "";
  let yearId = "";
  let schoolId = "";
  test.beforeAll(async () => {
    const { school, year } = await demoCtx();
    schoolId = school.id;
    yearId = year.id;
    const s = await prisma.student.create({
      data: {
        schoolId: school.id,
        matricule: "P5C-JOURNAL",
        firstName: "Test",
        lastName: "Journal",
      },
    });
    tempStudentId = s.id;
  });
  test.afterAll(async () => {
    if (cleanup.length)
      await prisma.payment.deleteMany({ where: { id: { in: cleanup } } });
    if (tempStudentId)
      await prisma.student.delete({ where: { id: tempStudentId } });
  });

  test("annulé explicite, feuille Ventilations, CSV ventilations, URL historique", async ({
    request,
  }) => {
    const cancelled = await prisma.payment.create({
      data: {
        schoolId,
        studentId: tempStudentId,
        academicYearId: yearId,
        amount: 1000,
        method: "CASH",
        reference: "P5C-ANNUL",
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: "Erreur de saisie",
      },
    });
    cleanup.push(cancelled.id);

    // 1. annulé identifié explicitement
    const res = await request.get(
      `/app/fees/payments/export?format=csv&student=${tempStudentId}`,
    );
    const csv = await res.text();
    const row = rows(csv).find(
      (l) => cell(l, col(csv, "reference")) === "P5C-ANNUL",
    )!;
    expect(cell(row, col(csv, "statut"))).toBe("Annulé");
    expect(cell(row, col(csv, "motif_annulation"))).toBe("Erreur de saisie");

    // 2. status=VALIDATED exclut l'annulé
    const csvV = await (
      await request.get(
        `/app/fees/payments/export?format=csv&student=${tempStudentId}&status=VALIDATED`,
      )
    ).text();
    expect(csvV).not.toContain("P5C-ANNUL");

    // 3. XLSX : feuilles Paiements + Ventilations (1 ligne / allocation)
    const nAlloc = await prisma.paymentAllocation.count({
      where: { payment: { schoolId, academicYearId: yearId } },
    });
    const wb = await xlsxOf(
      await request.get(`/app/fees/payments/export?format=xlsx&year=${yearId}`),
    );
    expect(wb.getWorksheet("Paiements")).toBeTruthy();
    const vent = wb.getWorksheet("Ventilations")!;
    expect(vent).toBeTruthy();
    expect(vent.rowCount - 1).toBe(nAlloc);

    // 4. CSV ventilations distinct via view=allocations
    const csvA = await (
      await request.get(
        `/app/fees/payments/export?format=csv&view=allocations&year=${yearId}`,
      )
    ).text();
    expect(header(csvA)).toContain("montant_alloue_xof");

    // 5. rétrocompatibilité : URL historique /csv — CONTRAT D'ORIGINE
    //    (en-têtes accentués, élève en une colonne, enums bruts, cellules
    //    systématiquement quotées, nom de fichier fixe)
    const legacy = await request.get(`/app/fees/payments/csv?year=${yearId}`);
    expect(legacy.status()).toBe(200);
    expect(legacy.headers()["content-disposition"]).toContain(
      "journal-paiements.csv",
    );
    const legacyCsv = await legacy.text();
    expect(header(legacyCsv)).toBe(
      "date;reçu;matricule;élève;mode;référence;montant;statut;motif_annulation",
    );
    expect(legacyCsv).toContain('"P5C-ANNUL"');
    expect(legacyCsv).toContain('"CANCELLED"');
    expect(legacyCsv).toContain('"CASH"');
    expect(legacyCsv).toContain('"Erreur de saisie"');
    for (const c of rows(legacyCsv)[0].split(";")) {
      expect(c.startsWith('"')).toBeTruthy();
    }
    const legacyA = await (
      await request.get(
        `/app/fees/payments/csv?view=allocations&year=${yearId}`,
      )
    ).text();
    expect(header(legacyA)).toContain("montant_alloue_xof");
  });

  test("plus de 500 paiements exportés sans troncature", async ({
    request,
  }) => {
    const data = Array.from({ length: 510 }, (_, i) => ({
      schoolId,
      studentId: tempStudentId,
      academicYearId: yearId,
      amount: 100 + i,
      method: "CASH" as const,
      paidAt: new Date(Date.now() - i * 1000),
    }));
    const created = await prisma.$transaction(
      data.map((d) => prisma.payment.create({ data: d, select: { id: true } })),
    );
    cleanup.push(...created.map((p) => p.id));
    const expected = await prisma.payment.count({
      where: { studentId: tempStudentId },
    });
    expect(expected).toBeGreaterThan(500);
    const res = await request.get(
      `/app/fees/payments/export?format=csv&student=${tempStudentId}`,
    );
    const csv = await res.text();
    expect(csv).not.toContain("Export tronqué");
    expect(rows(csv).length).toBe(expected);
  });

  test("plafond : truncated signalé par le builder (les routes → 413)", async () => {
    const { ctx } = await demoCtx();
    const capped = await buildPaymentsExport(
      ctx,
      { academicYearId: yearId },
      { maxRows: 2 },
    );
    expect(capped.truncated).toBeTruthy();
    expect(capped.payments.length).toBe(2);
    const full = await buildPaymentsExport(ctx, { academicYearId: yearId });
    expect(full.truncated).toBeFalsy();
  });

  test("injection de formules neutralisée dans le journal", async ({
    request,
  }) => {
    await prisma.student.update({
      where: { id: tempStudentId },
      data: { firstName: "=1+2" },
    });
    const p = await prisma.payment.create({
      data: {
        schoolId,
        studentId: tempStudentId,
        academicYearId: yearId,
        amount: 500001,
        method: "OTHER",
        reference: " =2+3",
      },
    });
    cleanup.push(p.id);
    const csv = await (
      await request.get(
        `/app/fees/payments/export?format=csv&student=${tempStudentId}`,
      )
    ).text();
    const row = rows(csv).find(
      (l) => Number(cell(l, col(csv, "montant_xof"))) === 500001,
    )!;
    const unquote = (v: string) => v.replace(/^"([\s\S]*)"$/, "$1");
    expect(unquote(cell(row, col(csv, "reference"))).startsWith("'")).toBeTruthy();
    expect(unquote(cell(row, col(csv, "prenom"))).startsWith("'")).toBeTruthy();
    for (const l of rows(csv)) {
      for (const c of l.split(";"))
        expect(/^"?[\s]*[=+\-@]/.test(c)).toBeFalsy();
    }
    await prisma.student.update({
      where: { id: tempStudentId },
      data: { firstName: "Test" },
    });
  });
});

// ---------- Permissions ----------
// Le garde-fou renvoie une redirection (307/302) vers une page 200 :
// maxRedirects: 0 est indispensable pour observer le refus réel.
const refused = async (request: APIRequestContext, url: string) =>
  (await request.get(url, { maxRedirects: 0 })).status();

test.describe("P5c — refus CASHIER et TEACHER sur les finances", () => {
  const routes = ["accounts", "installments", "unpaid", "payments"];
  test.describe("caissier", () => {
    test.use({ storageState: "e2e/.auth/demoCashier.json" });
    for (const r of routes) {
      test(`/app/fees/${r}/export refusé`, async ({ request }) => {
        const s = await refused(request, `/app/fees/${r}/export?format=csv`);
        expect([302, 303, 307, 308, 403]).toContain(s);
      });
    }
    test("URL historique /csv refusée", async ({ request }) => {
      const s = await refused(request, "/app/fees/payments/csv");
      expect([302, 303, 307, 308, 403]).toContain(s);
    });
    test("registre bulletins refusé", async ({ request }) => {
      const s = await refused(request, "/app/report-cards/export?format=csv");
      expect([302, 303, 307, 308, 403]).toContain(s);
    });
  });
  test.describe("enseignant", () => {
    test.use({ storageState: "e2e/.auth/demoTeacher.json" });
    for (const r of routes) {
      test(`/app/fees/${r}/export refusé`, async ({ request }) => {
        const s = await refused(request, `/app/fees/${r}/export?format=csv`);
        expect([302, 303, 307, 308, 403]).toContain(s);
      });
    }
    test("URL historique /csv refusée", async ({ request }) => {
      const s = await refused(request, "/app/fees/payments/csv");
      expect([302, 303, 307, 308, 403]).toContain(s);
    });
  });
});

test.describe("P5c — FINANCE_MANAGER", () => {
  test.use({ storageState: "e2e/.auth/demoFinance.json" });
  test("les 4 exports financiers répondent 200", async ({ request }) => {
    const { year } = await demoCtx();
    for (const r of ["accounts", "installments", "unpaid", "payments"]) {
      expect(
        (
          await request.get(`/app/fees/${r}/export?format=csv&year=${year.id}`)
        ).status(),
      ).toBe(200);
    }
  });
  test("registre bulletins refusé sans droit pédagogique", async ({
    request,
  }) => {
    const s = await refused(request, "/app/report-cards/export?format=csv");
    expect([302, 303, 307, 308, 403]).toContain(s);
  });
});

// ---------- Registre des bulletins ----------
async function teacherScope() {
  const { school } = await demoCtx();
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: ACCOUNTS.demoTeacher.email },
  });
  const tids = (
    await prisma.teacher.findMany({
      where: { schoolId: school.id, userId: user.id },
      select: { id: true },
    })
  ).map((t) => t.id);
  const [ta, cs] = await Promise.all([
    prisma.teachingAssignment.findMany({
      where: { schoolId: school.id, teacherId: { in: tids } },
      select: { classroomId: true, academicYearId: true },
    }),
    prisma.classroomSubject.findMany({
      where: { schoolId: school.id, teacherId: { in: tids } },
      select: {
        classroomId: true,
        classroom: { select: { academicYearId: true } },
      },
    }),
  ]);
  const pairs = new Set<string>();
  for (const a of ta) pairs.add(`${a.academicYearId}|${a.classroomId}`);
  for (const c of cs)
    pairs.add(`${c.classroom.academicYearId}|${c.classroomId}`);
  return { school, pairs };
}

test.describe("P5c — registre des bulletins (admin)", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("registre complet : lignes = bulletins, versions = historique", async ({
    request,
  }) => {
    const { school } = await demoCtx();
    const [nCards, nVers] = await Promise.all([
      prisma.reportCard.count({ where: { schoolId: school.id } }),
      prisma.reportCardVersion.count({
        where: { reportCard: { schoolId: school.id } },
      }),
    ]);
    const res = await request.get("/app/report-cards/export?format=csv");
    const csv = await res.text();
    const data = rows(csv);
    expect(data.length).toBe(nCards);
    expect(header(csv)).toContain("version_courante");
    expect(header(csv)).toContain("date_publication");
    // isolation : tous les identifiants appartiennent à l'école courante
    const iId = col(csv, "identifiant");
    const dbIds = new Set(
      (
        await prisma.reportCard.findMany({
          where: { schoolId: school.id },
          select: { identifier: true },
        })
      ).map((c) => c.identifier),
    );
    for (const l of data) expect(dbIds.has(cell(l, iId))).toBeTruthy();
    // XLSX : feuilles Registre + Versions (historique complet)
    const wb = await xlsxOf(
      await request.get("/app/report-cards/export?format=xlsx"),
    );
    expect(wb.getWorksheet("Registre")!.rowCount - 1).toBe(nCards);
    expect(wb.getWorksheet("Versions")!.rowCount - 1).toBe(nVers);
  });

  test("filtres statut / période / année + export vide", async ({ request }) => {
    const { school, year } = await demoCtx();
    const period = await prisma.academicPeriod.findFirstOrThrow({
      where: { schoolId: school.id },
    });
    const count = async (extra: object) =>
      prisma.reportCard.count({ where: { schoolId: school.id, ...extra } });
    const pub = await (
      await request.get("/app/report-cards/export?format=csv&status=PUBLISHED")
    ).text();
    expect(rows(pub).length).toBe(await count({ status: "PUBLISHED" }));
    const draft = await (
      await request.get("/app/report-cards/export?format=csv&status=DRAFT")
    ).text();
    expect(rows(draft).length).toBe(await count({ status: "DRAFT" }));
    const byPeriod = await (
      await request.get(
        `/app/report-cards/export?format=csv&period=${period.id}`,
      )
    ).text();
    expect(rows(byPeriod).length).toBe(
      await count({ academicPeriodId: period.id }),
    );
    const byYear = await (
      await request.get(`/app/report-cards/export?format=csv&year=${year.id}`)
    ).text();
    expect(rows(byYear).length).toBe(
      await count({ academicPeriod: { academicYearId: year.id } }),
    );
  });
});

test.describe("P5c — registre enseignant (périmètre)", () => {
  test.use({ storageState: "e2e/.auth/demoTeacher.json" });

  test("export limité aux classes affectées (par année)", async ({
    request,
  }) => {
    const { school, pairs } = await teacherScope();
    const expected = await prisma.reportCard.count({
      where: {
        schoolId: school.id,
        OR: [...pairs].map((p) => {
          const [y, c] = p.split("|");
          return { classroomId: c, academicPeriod: { academicYearId: y } };
        }),
      },
    });
    const res = await request.get("/app/report-cards/export?format=csv");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    const data = rows(csv);
    expect(data.length).toBe(expected);
    // chaque bulletin exporté est dans une paire année|classe autorisée
    const iId = col(csv, "identifiant");
    const cards = await prisma.reportCard.findMany({
      where: { identifier: { in: data.map((l) => cell(l, iId)) } },
      select: {
        classroomId: true,
        academicPeriod: { select: { academicYearId: true } },
      },
    });
    for (const c of cards) {
      expect(
        pairs.has(`${c.academicPeriod.academicYearId}|${c.classroomId}`),
      ).toBeTruthy();
    }
  });

  test("classe hors périmètre → 403 explicite", async ({ request }) => {
    const { school, pairs } = await teacherScope();
    // Cas 1 : classe de l'école hors affectations ; sinon (enseignant
    // affecté partout) cas 2 : classe d'un AUTRE établissement —
    // le 403 couvre alors aussi l'isolation inter-tenant.
    const outside =
      (await prisma.classroom.findFirst({
        where: {
          schoolId: school.id,
          NOT: {
            OR: [...pairs].map((p) => {
              const [y, c] = p.split("|");
              return { id: c, academicYearId: y };
            }),
          },
        },
        select: { id: true },
      })) ??
      (await prisma.classroom.findFirst({
        where: { schoolId: { not: school.id } },
        select: { id: true },
      }));
    expect(outside).not.toBeNull();
    const res = await request.get(
      `/app/report-cards/export?format=csv&classroom=${outside!.id}`,
    );
    expect(res.status()).toBe(403);
    expect(await res.text()).toContain("hors");
  });
});

// ---------- Lecture seule ----------
test.describe("P5c — lecture seule", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });
  test("les exports ne modifient aucune donnée", async ({ request }) => {
    const { school, year } = await demoCtx();
    const before = {
      p: await prisma.payment.count({ where: { schoolId: school.id } }),
      i: await prisma.feeInstallment.count({ where: { schoolId: school.id } }),
      rc: await prisma.reportCard.count({ where: { schoolId: school.id } }),
      rv: await prisma.reportCardVersion.count({
        where: { reportCard: { schoolId: school.id } },
      }),
    };
    await request.get(`/app/fees/accounts/export?format=xlsx&year=${year.id}`);
    await request.get(
      `/app/fees/installments/export?format=xlsx&year=${year.id}`,
    );
    await request.get(`/app/fees/unpaid/export?format=xlsx&year=${year.id}`);
    await request.get(`/app/fees/payments/export?format=xlsx&year=${year.id}`);
    await request.get("/app/report-cards/export?format=xlsx");
    expect(await prisma.payment.count({ where: { schoolId: school.id } })).toBe(
      before.p,
    );
    expect(
      await prisma.feeInstallment.count({ where: { schoolId: school.id } }),
    ).toBe(before.i);
    expect(await prisma.reportCard.count({ where: { schoolId: school.id } })).toBe(
      before.rc,
    );
    expect(
      await prisma.reportCardVersion.count({
        where: { reportCard: { schoolId: school.id } },
      }),
    ).toBe(before.rv);
  });
});
