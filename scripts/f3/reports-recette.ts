/**
 * Recette F3-D — rapports et exports financiers :
 * 6 types de rapports, formats CSV/XLSX/PDF, filtres, totaux,
 * paiements et dépenses annulés, isolation tenant, troncature,
 * cohérence avec le tableau de bord F3-C.
 *
 * Usage : npx tsx scripts/f3/reports-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { buildReport } from "../../src/lib/services/finance/reports";
import { getTreasuryDashboard } from "../../src/lib/services/finance/treasury";
import { buildPaymentsExport } from "../../src/lib/export/finance";
import { toCsv } from "../../src/lib/export/csv";
import { buildXlsxBuffer } from "../../src/lib/export/xlsx";
import { renderFinanceReport } from "../../src/lib/pdf/finance-report";
import PDFDocument from "pdfkit";
import {
  cancelExpense,
  createExpense,
  ensureDefaultExpenseCategories,
  payExpense,
} from "../../src/lib/services/finance/expenses";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };
void note;

const FX = "F3D-FX";
const FX2 = "F3D-OTHER";
const RANGE = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-04-01T00:00:00Z") };

async function cleanup(schoolId: string) {
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.expense.deleteMany({ where: { schoolId } });
  await prisma.expenseCategory.deleteMany({ where: { schoolId } });
  await prisma.cashClosure.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
}

async function pdfBuffer(report: Awaited<ReturnType<typeof buildReport>>) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  renderFinanceReport(doc, {
    schoolName: "École test", title: report.title,
    meta: report.meta, notes: report.notes, sheets: report.sheets,
  });
  doc.end();
  return done;
}

(async () => {
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (!old) continue;
    await cleanup(old.id);
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }
  const stale = await prisma.user.findMany({ where: { email: "f3d@test.local" }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }
  const user = await prisma.user.create({
    data: { email: "f3d@test.local", passwordHash: "x", firstName: "F3D", lastName: "Test" },
  });
  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "f3d-fx" } });
  const other = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "f3d-other" } });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "F3D-2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const ctx = { userId: user.id, schoolId: school.id };
  const ctxOther = { userId: user.id, schoolId: other.id };
  const cats = await ensureDefaultExpenseCategories(ctx);
  const fonct = cats.find((c) => c.code === "FONCTIONNEMENT")!;

  const student = await prisma.student.create({
    data: { schoolId: school.id, matricule: "F3D-001", firstName: "Awa", lastName: "Test" },
  });
  await prisma.payment.createMany({
    data: [
      { schoolId: school.id, studentId: student.id, academicYearId: year.id, amount: 100000, method: "CASH", paidAt: new Date("2026-01-10"), status: "VALIDATED", receiptNumber: "R1" },
      { schoolId: school.id, studentId: student.id, academicYearId: year.id, amount: 50000, method: "MOBILE_MONEY", paidAt: new Date("2026-02-05"), status: "VALIDATED", receiptNumber: "R2" },
      { schoolId: school.id, studentId: student.id, academicYearId: year.id, amount: 30000, method: "CASH", paidAt: new Date("2026-01-20"), status: "CANCELLED", cancelledAt: new Date(), cancelReason: "doublon", receiptNumber: "R3" },
    ],
  });
  const e1 = await createExpense(ctx, { categoryId: fonct.id, academicYearId: year.id, label: "Électricité", amount: 40000, beneficiary: "SONABEL", expenseAt: new Date("2026-01-12") });
  const e2 = await createExpense(ctx, { categoryId: fonct.id, label: "Brouillon", amount: 20000, beneficiary: "=cmd-danger", expenseAt: new Date("2026-01-13") });
  const e3 = await createExpense(ctx, { categoryId: fonct.id, academicYearId: year.id, label: "Indemnité", amount: 15000, beneficiary: "Agent", expenseAt: new Date("2026-02-01") });
  if (e1.ok) await payExpense(ctx, e1.result.id, { method: "CASH", paidAt: new Date("2026-01-15") });
  if (e3.ok) {
    await payExpense(ctx, e3.result.id, { method: "CHECK", paidAt: new Date("2026-02-10") });
    await cancelExpense(ctx, e3.result.id, { reason: "décaissement erroné" });
  }
  void e2;
  const othCat = (await ensureDefaultExpenseCategories(ctxOther))[0];
  const oe = await createExpense(ctxOther, { categoryId: othCat.id, label: "Autre école", amount: 999000, beneficiary: "X", expenseAt: new Date("2026-01-15") });
  if (oe.ok) await payExpense(ctxOther, oe.result.id, { method: "CASH", paidAt: new Date("2026-01-15") });

  const dash = await getTreasuryDashboard(ctx, RANGE);

  // ---------- A. Journal des encaissements ----------
  console.log("— A. Journal encaissements —");
  const payRep = await buildReport(ctx, "payments", RANGE);
  check("3 lignes (annulé inclus, identifiable)", payRep.rowCount === 3);
  check("total = validés seuls (150k)",
    payRep.sheets[0].totals?.[8] === 150000);
  check("annulé visible avec motif",
    payRep.sheets[0].rows.some((r) => r[9] === "Annulé" && r[10] === "doublon"));
  check("note remboursement présente", payRep.notes.length > 0);

  // ---------- B. Journal des dépenses ----------
  console.log("— B. Journal dépenses —");
  const expRep = await buildReport(ctx, "expenses", RANGE);
  check("3 lignes (DRAFT inclus)", expRep.rowCount === 3);
  check("brouillon marqué", expRep.sheets[0].rows.some((r) => r[7] === "Brouillon"));
  check("PAID→CANCELLED : statut annulée + motif + payée le",
    expRep.sheets[0].rows.some((r) => r[7] === "Annulée" && r[8] === "décaissement erroné" && r[1] === "2026-02-10"));
  check("total décaissé = 55k (draft exclu)", expRep.sheets[0].totals?.[5] === 55000);
  const expPaid = await buildReport(ctx, "expenses", { ...RANGE, status: "PAID" });
  check("filtre statut PAID : 1 ligne", expPaid.rowCount === 1);

  // ---------- C. État de trésorerie ----------
  console.log("— C. État de trésorerie —");
  const trRep = await buildReport(ctx, "treasury", RANGE);
  check("encaissé = F3-C", trRep.sheets[0].rows[0][1] === dash.collectedTotal);
  check("décaissé = F3-C", trRep.sheets[1].totals?.[3] === dash.disbursedTotal);
  check("solde = F3-C", trRep.sheets[1].totals?.[4] === dash.net);
  check("3 notes de limite", trRep.notes.length === 3);
  check("mensuel : 3 mois", trRep.sheets[1].rows.length === 3);

  // ---------- D. Synthèse ----------
  console.log("— D. Synthèse —");
  const sumRep = await buildReport(ctx, "summary", RANGE);
  check("3 indicateurs + feuille comparaison",
    sumRep.sheets[0].rows.length === 3 && sumRep.sheets.length === 2);
  const cmp = sumRep.sheets[1].rows[0];
  check("comparaison : période précédente vide → écart = +150k",
    cmp[1] === 0 && cmp[3] === 150000);

  // ---------- E/F. Répartitions ----------
  console.log("— E/F. Répartitions —");
  const catRep = await buildReport(ctx, "expenses-by-category", RANGE);
  check("catégorie : Fonctionnement 55k = décaissé F3-C",
    catRep.sheets[0].totals?.[2] === dash.disbursedTotal);
  const mRep = await buildReport(ctx, "payments-by-method", RANGE);
  check("modes : total 150k = encaissé F3-C",
    mRep.sheets[0].totals?.[2] === dash.collectedTotal);
  check("2 modes (Espèces + Mobile Money)", mRep.sheets[0].rows.length === 2);

  // ---------- Formats ----------
  console.log("— Formats —");
  const csv = toCsv(payRep.sheets[0].headers, payRep.sheets[0].rows);
  check("CSV : BOM + en-têtes + 3 lignes",
    csv.startsWith("﻿") && csv.split("\r\n").filter(Boolean).length === 4);
  check("CSV : motif annulation présent", csv.includes("doublon"));
  const csvExp = toCsv(expRep.sheets[0].headers, expRep.sheets[0].rows);
  check("CSV : injection formule neutralisée ('=cmd)", csvExp.includes("'=cmd-danger"));
  const xlsx = await buildXlsxBuffer([
    { name: trRep.sheets[0].name, columns: trRep.sheets[0].headers.map((h) => ({ header: h })), rows: trRep.sheets[0].rows },
    { name: trRep.sheets[1].name, columns: trRep.sheets[1].headers.map((h) => ({ header: h })), rows: trRep.sheets[1].rows },
  ]);
  check("XLSX : buffer PK valide multi-feuilles", xlsx.length > 2000 && xlsx[0] === 0x50 && xlsx[1] === 0x4b);
  const pdf = await pdfBuffer(trRep);
  check("PDF : header %PDF + contenu", pdf.length > 1000 && pdf.subarray(0, 5).toString() === "%PDF-");
  const pdfBig = await pdfBuffer(payRep);
  check("PDF journal : %PDF valide", pdfBig.subarray(0, 5).toString() === "%PDF-");

  // ---------- Filtres ----------
  console.log("— Filtres —");
  const mCash = await buildReport(ctx, "payments", { ...RANGE, method: "CASH" });
  check("filtre CASH : 2 lignes (validé + annulé)", mCash.rowCount === 2);
  const yRep = await buildReport(ctx, "expenses-by-category", { ...RANGE, academicYearId: year.id });
  check("filtre année : exclut dépense non rattachée… aucune ici → 55k",
    yRep.sheets[0].totals?.[2] === 55000);
  const empty = await buildReport(ctx, "payments", {
    from: new Date("2020-01-01"), to: new Date("2020-02-01"),
  });
  check("période vide : 0 ligne, pas d'erreur", empty.rowCount === 0);

  // ---------- Isolation & troncature ----------
  console.log("— Isolation & troncature —");
  const oRep = await buildReport(ctxOther, "payments", RANGE);
  check("école B : 0 encaissement", oRep.rowCount === 0);
  const oExp = await buildReport(ctxOther, "expenses", RANGE);
  check("école B : que sa dépense", oExp.rowCount === 1 && oExp.sheets[0].totals?.[5] === 999000);
  const capped = await buildPaymentsExport(ctx, {}, { maxRows: 2 });
  check("troncature signalée (pas de fichier partiel silencieux)", capped.truncated === true);

  // ---------- Permission finance.reports.read ----------
  console.log("— Permission —");
  const perm = await prisma.permission.findFirst({ where: { key: "finance.reports.read" }, select: { id: true } });
  if (!perm) note("finance.reports.read absente en local");
  else {
    for (const rn of ["ADMIN_SCHOOL", "FINANCE_MANAGER", "CASHIER"]) {
      const role = await prisma.role.findFirst({ where: { name: rn, scope: "SCHOOL" }, select: { id: true } });
      if (!role) { note(`rôle ${rn} absent`); continue; }
      const has = await prisma.rolePermission.findFirst({ where: { roleId: role.id, permissionId: perm.id }, select: { roleId: true } });
      if (rn === "CASHIER") check("CASHIER sans finance.reports.read", !has);
      else check(`${rn} a finance.reports.read`, !!has);
    }
  }

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
