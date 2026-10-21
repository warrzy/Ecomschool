/**
 * Recette F3-B — module Dépenses :
 * catégories (défauts, doublons, archivage), cycle de vie
 * DRAFT → PAID / CANCELLED, idempotence, validation, journée clôturée,
 * année clôturée, immutabilité post-paiement, isolation multi-tenant.
 *
 * Usage : npx tsx scripts/f3/expenses-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  createExpense,
  createExpenseCategory,
  cancelExpense,
  ensureDefaultExpenseCategories,
  listExpenseCategories,
  listExpenses,
  payExpense,
  setExpenseCategoryStatus,
  updateExpense,
} from "../../src/lib/services/finance/expenses";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };
void note;

const FX = "F3B-FX";
const FX2 = "F3B-OTHER";

async function cleanup(schoolId: string) {
  await prisma.expense.deleteMany({ where: { schoolId } });
  await prisma.expenseCategory.deleteMany({ where: { schoolId } });
  await prisma.cashClosure.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
}

(async () => {
  // ---------- Fixtures ----------
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (!old) continue;
    await cleanup(old.id);
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }

  const stale = await prisma.user.findMany({ where: { email: "f3b@test.local" }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }
  const user = await prisma.user.create({
    data: {
      email: "f3b@test.local", passwordHash: "x",
      firstName: "F3B", lastName: "Test",
    },
  });

  const school = await prisma.school.create({
    data: { name: FX, code: FX, slug: "f3b-fx" },
  });
  const other = await prisma.school.create({
    data: { name: FX2, code: FX2, slug: "f3b-other" },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "F3-2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const closedYear = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "F3-2024-2025",
      startDate: new Date("2024-09-01"), endDate: new Date("2025-06-30"),
      status: "CLOSED",
    },
  });
  const ctx = { userId: user.id, schoolId: school.id };
  const ctxOther = { userId: user.id, schoolId: other.id };

  // ---------- Catégories ----------
  console.log("— Catégories —");
  const defaults = await ensureDefaultExpenseCategories(ctx);
  check("catégories par défaut créées (5)", defaults.length === 5);
  const again = await ensureDefaultExpenseCategories(ctx);
  check("idempotent sans doublons", again.length === 5);

  const cat = await createExpenseCategory(ctx, {
    code: "restauration", label: "Restauration",
  });
  check("catégorie personnalisée créée (code normalisé)", cat.ok);
  const dup = await createExpenseCategory(ctx, {
    code: "RESTAURATION", label: "Autre libellé",
  });
  check("doublon de code refusé", !dup.ok && dup.error === "DUPLICATE");
  const invalid = await createExpenseCategory(ctx, { code: "", label: "" });
  check("catégorie invalide refusée", !invalid.ok && invalid.error === "INVALID_INPUT");

  const restaurationId = cat.ok ? cat.result.id : "";
  const fonct = defaults.find((d) => d.code === "FONCTIONNEMENT")!;

  // ---------- Création DRAFT ----------
  console.log("— Création —");
  const e1 = await createExpense(ctx, {
    categoryId: fonct.id, academicYearId: year.id,
    label: "Facture électricité", amount: 45000,
    beneficiary: "SONABEL", expenseAt: new Date("2026-01-15"),
  });
  check("dépense créée", e1.ok);
  const e1Id = e1.ok ? e1.result.id : "";

  const badAmount = await createExpense(ctx, {
    categoryId: fonct.id, label: "X", amount: 0, beneficiary: "B",
  });
  check("montant nul refusé", !badAmount.ok && badAmount.error === "INVALID_INPUT");
  const noLabel = await createExpense(ctx, {
    categoryId: fonct.id, label: " ", amount: 100, beneficiary: "B",
  });
  check("libellé vide refusé", !noLabel.ok && noLabel.error === "INVALID_INPUT");
  const badCat = await createExpense(ctx, {
    categoryId: "inexistant", label: "X", amount: 100, beneficiary: "B",
  });
  check("catégorie inconnue refusée", !badCat.ok && badCat.error === "NOT_FOUND");
  const closedYearExp = await createExpense(ctx, {
    categoryId: fonct.id, academicYearId: closedYear.id,
    label: "X", amount: 100, beneficiary: "B",
  });
  check("année clôturée refusée", !closedYearExp.ok && closedYearExp.error === "YEAR_CLOSED");

  // Idempotence : même clé → même dépense, pas de doublon.
  const i1 = await createExpense(ctx, {
    categoryId: fonct.id, label: "Clé idem", amount: 5000,
    beneficiary: "B", idempotencyKey: "f3b-idem-1",
  });
  const i2 = await createExpense(ctx, {
    categoryId: fonct.id, label: "Clé idem", amount: 5000,
    beneficiary: "B", idempotencyKey: "f3b-idem-1",
  });
  check("idempotence : même id renvoyé",
    i1.ok && i2.ok && i1.result.id === i2.result.id);
  const idemCount = await prisma.expense.count({
    where: { schoolId: school.id, idempotencyKey: "f3b-idem-1" },
  });
  check("idempotence : une seule ligne", idemCount === 1);

  // ---------- Modification DRAFT ----------
  console.log("— Modification —");
  const upd = await updateExpense(ctx, e1Id, { amount: 47000, label: "Électricité janv." });
  check("DRAFT modifiée", upd.ok);
  const e1After = await prisma.expense.findUnique({ where: { id: e1Id } });
  check("montant mis à jour", e1After?.amount === 47000 && e1After?.status === "DRAFT");
  const updBad = await updateExpense(ctx, e1Id, { amount: -5 });
  check("montant négatif refusé", !updBad.ok && updBad.error === "INVALID_INPUT");
  const updClosed = await updateExpense(ctx, e1Id, { academicYearId: closedYear.id });
  check("rattacher une année clôturée refusé",
    !updClosed.ok && updClosed.error === "YEAR_CLOSED");

  // ---------- Paiement ----------
  console.log("— Paiement —");
  const payNoMethod = await payExpense(ctx, e1Id, { method: undefined as never });
  check("payée sans méthode refusée", !payNoMethod.ok && payNoMethod.error === "INVALID_INPUT");

  // Journée clôturée : clôturer aujourd'hui puis payer avec paidAt = aujourd'hui.
  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  await prisma.cashClosure.create({
    data: { schoolId: school.id, date: dayStart, totalAmount: 0, paymentsCount: 0 },
  });
  const payClosed = await payExpense(ctx, e1Id, { method: "CASH" });
  check("paiement sur jour clôturé refusé", !payClosed.ok && payClosed.error === "CLOSED_DAY");
  const stillDraft = await prisma.expense.findUnique({ where: { id: e1Id } });
  check("refus sans effet de bord (toujours DRAFT)", stillDraft?.status === "DRAFT");
  await prisma.cashClosure.deleteMany({ where: { schoolId: school.id } });

  const pay1 = await payExpense(ctx, e1Id, {
    method: "BANK_TRANSFER", paidAt: new Date("2026-01-16"), paymentReference: "VIR-001",
  });
  check("DRAFT → PAID", pay1.ok);
  const paid = await prisma.expense.findUnique({ where: { id: e1Id } });
  check("paidAt + method figés",
    paid?.status === "PAID" && paid?.method === "BANK_TRANSFER" && !!paid?.paidAt);
  const repPay = await payExpense(ctx, e1Id, { method: "CASH" });
  check("double paiement refusé", !repPay.ok && repPay.error === "ALREADY_PAID");
  const updPaid = await updateExpense(ctx, e1Id, { amount: 1 });
  check("PAID immuable", !updPaid.ok && updPaid.error === "FORBIDDEN");

  // ---------- Annulation ----------
  console.log("— Annulation —");
  const e2 = await createExpense(ctx, {
    categoryId: fonct.id, label: "À annuler", amount: 1000, beneficiary: "B",
  });
  const e2Id = e2.ok ? e2.result.id : "";
  const noReason = await cancelExpense(ctx, e2Id, { reason: " " });
  check("annulation sans motif refusée", !noReason.ok && noReason.error === "INVALID_INPUT");
  const cancelDraft = await cancelExpense(ctx, e2Id, { reason: "erreur de saisie" });
  check("DRAFT → CANCELLED", cancelDraft.ok);
  const reCancel = await cancelExpense(ctx, e2Id, { reason: "encore" });
  check("double annulation refusée", !reCancel.ok && reCancel.error === "ALREADY_CANCELLED");
  const payCancelled = await payExpense(ctx, e2Id, { method: "CASH" });
  check("CANCELLED ne peut être payée", !payCancelled.ok && payCancelled.error === "ALREADY_CANCELLED");

  const cancelPaid = await cancelExpense(ctx, e1Id, { reason: "décaissement remboursé" });
  check("PAID → CANCELLED (trace conservée)", cancelPaid.ok);
  const e1Final = await prisma.expense.findUnique({ where: { id: e1Id } });
  check("trace annulation complète",
    e1Final?.status === "CANCELLED" && !!e1Final?.cancelReason &&
    !!e1Final?.paidAt && e1Final?.method === "BANK_TRANSFER");

  // ---------- Archivage catégorie ----------
  console.log("— Catégories : archivage —");
  const arch = await setExpenseCategoryStatus(ctx, restaurationId, "ARCHIVED");
  check("catégorie archivée", arch.ok);
  const useArchived = await createExpense(ctx, {
    categoryId: restaurationId, label: "X", amount: 100, beneficiary: "B",
  });
  check("dépense sur catégorie archivée refusée",
    !useArchived.ok && useArchived.error === "NOT_FOUND");
  const activeCats = await listExpenseCategories(ctx);
  check("archivée absente de la liste active",
    !activeCats.some((c) => c.id === restaurationId));

  // ---------- Isolation ----------
  console.log("— Isolation —");
  const e3 = await createExpense(ctx, {
    categoryId: fonct.id, label: "Liste", amount: 7000, beneficiary: "B",
  });
  const listOther = await listExpenses(ctxOther);
  check("école B ne voit rien", listOther.length === 0);
  const payOther = await payExpense(ctxOther, e3.ok ? e3.result.id : "", { method: "CASH" });
  check("école B ne peut payer", !payOther.ok && payOther.error === "NOT_FOUND");
  const catOther = await prisma.expenseCategory.count({ where: { schoolId: other.id } });
  check("catégories isolées", catOther === 0);

  // ---------- Audit ----------
  const audits = await prisma.auditLog.count({
    where: { schoolId: school.id, action: { startsWith: "expenses." } },
  });
  check("écritures auditées", audits >= 8);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
