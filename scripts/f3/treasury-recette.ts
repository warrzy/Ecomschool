/**
 * Recette F3-C — tableau de bord de trésorerie :
 * encaissements VALIDATED / CANCELLED, décaissements paidAt IS NOT NULL
 * (PAID + CANCELLED après paiement), filtres période/mode/année,
 * exclusion explicite des dépenses non rattachées, isolation tenant,
 * cohérence des totaux, absence de double comptabilisation,
 * permission treasury.read par rôle.
 *
 * Usage : npx tsx scripts/f3/treasury-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { getTreasuryDashboard } from "../../src/lib/services/finance/treasury";
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

const FX = "F3C-FX";
const FX2 = "F3C-OTHER";
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

(async () => {
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (!old) continue;
    await cleanup(old.id);
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }
  const stale = await prisma.user.findMany({ where: { email: "f3c@test.local" }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }
  const user = await prisma.user.create({
    data: { email: "f3c@test.local", passwordHash: "x", firstName: "F3C", lastName: "Test" },
  });

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "f3c-fx" } });
  const other = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "f3c-other" } });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "F3C-2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const ctx = { userId: user.id, schoolId: school.id };
  const ctxOther = { userId: user.id, schoolId: other.id };

  const cats = await ensureDefaultExpenseCategories(ctx);
  const fonct = cats.find((c) => c.code === "FONCTIONNEMENT")!;
  const salaires = cats.find((c) => c.code === "SALAIRES")!;

  // ---------- Fixtures : paiements ----------
  const student = await prisma.student.create({
    data: {
      schoolId: school.id, matricule: "F3C-001",
      firstName: "Awa", lastName: "Test",
    },
  });
  await prisma.payment.create({
    data: {
      schoolId: school.id, studentId: student.id, academicYearId: year.id,
      amount: 100000, method: "CASH", paidAt: new Date("2026-01-10"),
      status: "VALIDATED", receiptNumber: "REC-2026-00001",
    },
  });
  await prisma.payment.create({
    data: {
      schoolId: school.id, studentId: student.id, academicYearId: year.id,
      amount: 50000, method: "MOBILE_MONEY", paidAt: new Date("2026-02-05"),
      status: "VALIDATED", receiptNumber: "REC-2026-00002",
    },
  });
  await prisma.payment.create({
    data: {
      schoolId: school.id, studentId: student.id, academicYearId: year.id,
      amount: 30000, method: "CASH", paidAt: new Date("2026-01-20"),
      status: "CANCELLED", cancelledAt: new Date("2026-01-21"),
      cancelReason: "erreur de saisie", receiptNumber: "REC-2026-00003",
    },
  });

  // ---------- Fixtures : dépenses ----------
  const mk = (amount: number, catId: string, label: string, yearId?: string) =>
    createExpense(ctx, {
      categoryId: catId, academicYearId: yearId, label, amount,
      beneficiary: "Fournisseur", expenseAt: new Date("2026-01-05"),
    });
  const e1 = await mk(40000, fonct.id, "Électricité", year.id);
  const e2 = await mk(20000, fonct.id, "Brouillon", year.id);
  const e3 = await mk(15000, salaires.id, "Indemnité", year.id);
  const e4 = await mk(10000, fonct.id, "Achat hors année");
  if (e1.ok) await payExpense(ctx, e1.result.id, { method: "CASH", paidAt: new Date("2026-01-15") });
  if (e3.ok) {
    await payExpense(ctx, e3.result.id, { method: "CHECK", paidAt: new Date("2026-02-10") });
    await cancelExpense(ctx, e3.result.id, { reason: "décaissement erroné — trace conservée" });
  }
  if (e4.ok) await payExpense(ctx, e4.result.id, { method: "CASH", paidAt: new Date("2026-03-05") });
  void e2;

  const otherCat = (await ensureDefaultExpenseCategories(ctxOther))[0];
  const othExp = await createExpense(ctxOther, {
    categoryId: otherCat.id, label: "Dépense autre école", amount: 999000,
    beneficiary: "X",
  });
  if (othExp.ok) {
    await payExpense(ctxOther, othExp.result.id, { method: "CASH", paidAt: new Date("2026-01-15") });
  }

  // ---------- Totaux période complète ----------
  console.log("— Totaux (janv→mars 2026) —");
  const d = await getTreasuryDashboard(ctx, RANGE);
  check("encaissé = 150 000 (2 validés)", d.collectedTotal === 150000 && d.collectedCount === 2);
  check("paiement annulé exclu des entrées", d.cancelledPaymentsCount === 1 && d.cancelledPaymentsTotal === 30000);
  check("décaissé = 65 000 (3 payés)", d.disbursedTotal === 65000 && d.disbursedCount === 3);
  check("PAID→CANCELLED reste un décaissement", d.disbursedTotal === 40000 + 15000 + 10000);
  check("DRAFT exclu du décaissé", !d.recent.some((o) => o.label === "Brouillon"));
  check("solde net = 85 000", d.net === 150000 - 65000);

  // ---------- Évolution mensuelle ----------
  console.log("— Mensuel —");
  check("3 buckets mensuels", d.months.length === 3);
  const jan = d.months.find((m) => m.key === "2026-01");
  const feb = d.months.find((m) => m.key === "2026-02");
  const mar = d.months.find((m) => m.key === "2026-03");
  check("janv : 100k in / 40k out", jan?.collected === 100000 && jan?.disbursed === 40000);
  check("févr : 50k in / 15k out", feb?.collected === 50000 && feb?.disbursed === 15000);
  check("mars : 0 in / 10k out", mar?.collected === 0 && mar?.disbursed === 10000);

  // ---------- Répartitions ----------
  console.log("— Répartitions —");
  const catFonct = d.expensesByCategory.find((x) => x.label === "Fonctionnement");
  const catSal = d.expensesByCategory.find((x) => x.label === "Salaires et indemnités");
  check("catégories : Fonctionnement 50k / Salaires 15k",
    catFonct?.value === 50000 && catSal?.value === 15000);
  const mCash = d.collectedByMethod.find((x) => x.label === "Espèces");
  const mMM = d.collectedByMethod.find((x) => x.label === "Mobile Money");
  check("modes : Espèces 100k / MM 50k", mCash?.value === 100000 && mMM?.value === 50000);
  check("répartition exhaustive (= total décaissé)",
    d.expensesByCategory.reduce((s, x) => s + x.value, 0) === d.disbursedTotal);

  // ---------- Dernières opérations ----------
  console.log("— Opérations récentes —");
  check("5 ops (2 entrées + 3 sorties), tri décroissant",
    d.recent.length === 5 && d.recent[0].date.getTime() >= d.recent[1].date.getTime());
  const cancelledOp = d.recent.find((o) => o.label === "Indemnité");
  check("dépense annulée marquée (décaissement conservé)",
    cancelledOp?.cancelledAfterPayment === true);
  check("annulée comptée comme sortie", cancelledOp?.kind === "OUT");

  // ---------- Filtre période ----------
  console.log("— Filtres —");
  const janOnly = await getTreasuryDashboard(ctx, {
    from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-02-01T00:00:00Z"),
  });
  check("période janv : 100k in / 40k out", janOnly.collectedTotal === 100000 && janOnly.disbursedTotal === 40000);

  const cashOnly = await getTreasuryDashboard(ctx, { ...RANGE, method: "CASH" });
  check("filtre CASH : entrées 100k", cashOnly.collectedTotal === 100000);
  check("filtre CASH : sorties 50k (40k+10k)", cashOnly.disbursedTotal === 50000);

  const yearFilter = await getTreasuryDashboard(ctx, { ...RANGE, academicYearId: year.id });
  check("filtre année : décaissé rattaché 55k", yearFilter.disbursedTotal === 55000);
  check("dépense non rattachée exclue MAIS signalée", yearFilter.unlinkedDisbursed === 10000);
  check("filtre année : entrées inchangées 150k", yearFilter.collectedTotal === 150000);

  // ---------- Isolation & cohérence ----------
  console.log("— Isolation & cohérence —");
  const dOther = await getTreasuryDashboard(ctxOther, RANGE);
  check("école B : entrées 0", dOther.collectedTotal === 0);
  check("école B : sorties = sa seule dépense 999k", dOther.disbursedTotal === 999000);
  const d2 = await getTreasuryDashboard(ctx, RANGE);
  check("pas de double comptabilisation (2e appel identique)",
    d2.collectedTotal === d.collectedTotal && d2.disbursedTotal === d.disbursedTotal);
  check("somme mensuelle = total entrées",
    d.months.reduce((s, m) => s + m.collected, 0) === d.collectedTotal);
  check("somme mensuelle = total sorties",
    d.months.reduce((s, m) => s + m.disbursed, 0) === d.disbursedTotal);

  // ---------- Permission treasury.read ----------
  console.log("— Permission treasury.read —");
  const perm = await prisma.permission.findFirst({ where: { key: "treasury.read" }, select: { id: true } });
  if (!perm) {
    note("treasury.read absente — bootstrap non exécuté en local");
  } else {
    for (const rn of ["ADMIN_SCHOOL", "FINANCE_MANAGER", "CASHIER"]) {
      const role = await prisma.role.findFirst({ where: { name: rn, scope: "SCHOOL" }, select: { id: true } });
      if (!role) { note(`rôle ${rn} absent en local`); continue; }
      const has = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: perm.id }, select: { roleId: true },
      });
      if (rn === "CASHIER") check("CASHIER sans treasury.read", !has);
      else check(`${rn} a treasury.read`, !!has);
    }
  }

  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
