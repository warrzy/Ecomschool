/**
 * Recette G3 manuel — encaissement Mobile Money au guichet
 * (vérification manuelle) :
 * saisie PENDING par opérateur (Orange Money / Moov Money), référence
 * obligatoire et anti-doublon par école+opérateur, aucune écriture
 * financière avant validation, validation par agent habilité via le
 * moteur partagé (reçu + allocations + snapshot), double validation
 * impossible, rejet motivé + ressaisie, surpaiement bloqué à la
 * validation, isolation inter-écoles, permissions create/validate,
 * annulation traçable, audit complet.
 *
 * Usage : npx tsx scripts/g3/manual-momo-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  listPendingManualPayments,
  recordManualMobileMoney,
  rejectManualPayment,
  validateManualPayment,
} from "../../src/lib/services/finance/manualMobileMoney";
import { cancelPayment, paymentsStats, listPayments } from "../../src/lib/services/finance/payments";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3M-FX";
const SLUG = "g3m-fix";
const FX2 = "G3M-FX-BIS";
const SLUG2 = "g3m-fix-bis";
const EMAILS = [
  "g3m-cashier@test.local",
  "g3m-validator@test.local",
  "g3m-both@test.local",
  "g3m-noperm@test.local",
  "g3m-b@test.local",
];

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G3M", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G3M_${email}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId },
  });
  const perms = await prisma.permission.findMany({
    where: { key: { in: permKeys } }, select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, roleId: role.id, status: "ACTIVE" },
  });
  return user;
}

async function cleanupSchool(schoolId: string) {
  await prisma.paymentAllocation.deleteMany({ where: { payment: { schoolId } } });
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeTariff.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
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

async function makeSchool(name: string, slug: string, code: string) {
  const school = await prisma.school.create({ data: { name, code, slug } });
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
  const category = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "SCO", label: "Scolarité" },
  });
  const student = await prisma.student.create({
    data: {
      schoolId: school.id, matricule: `${code}-001`,
      firstName: "Awa", lastName: code, sex: "FEMALE",
    },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: school.id, studentId: student.id,
      classroomId: classroom.id, academicYearId: year.id, status: "ENROLLED",
    },
  });
  const charge = await prisma.studentFeeCharge.create({
    data: {
      schoolId: school.id, studentId: student.id,
      academicYearId: year.id, categoryId: category.id, amount: 100_000,
    },
  });
  const inst1 = await prisma.feeInstallment.create({
    data: {
      schoolId: school.id, chargeId: charge.id, studentId: student.id,
      academicYearId: year.id, label: "T1", dueDate: new Date("2026-10-01"), amount: 60_000,
    },
  });
  const inst2 = await prisma.feeInstallment.create({
    data: {
      schoolId: school.id, chargeId: charge.id, studentId: student.id,
      academicYearId: year.id, label: "T2", dueDate: new Date("2027-01-01"), amount: 40_000,
    },
  });
  return { school, year, level, classroom, category, student, charge, inst1, inst2 };
}

const validatedSum = (schoolId: string, studentId: string, yearId: string) =>
  prisma.payment.aggregate({
    where: { schoolId, studentId, academicYearId: yearId, status: "VALIDATED" },
    _sum: { amount: true },
  }).then((r) => r._sum.amount ?? 0);

(async () => {
  for (const slug of [SLUG, SLUG2]) {
    const old = await prisma.school.findFirst({ where: { slug }, select: { id: true } });
    if (old) await cleanupSchool(old.id);
  }
  const staleUsers = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (staleUsers.length) {
    const ids = staleUsers.map((u) => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  const A = await makeSchool(FX, SLUG, FX);
  const B = await makeSchool(FX2, SLUG2, FX2);

  const cashier = await makeMember("g3m-cashier@test.local", A.school.id, ["finance.payments.create"]);
  const validator = await makeMember("g3m-validator@test.local", A.school.id, ["finance.payments.validate"]);
  const both = await makeMember("g3m-both@test.local", A.school.id, [
    "finance.payments.create", "finance.payments.validate",
  ]);
  const noPerm = await makeMember("g3m-noperm@test.local", A.school.id, []);
  const cashierB = await makeMember("g3m-b@test.local", B.school.id, [
    "finance.payments.create", "finance.payments.validate",
  ]);
  const ctxCash = { userId: cashier.id, schoolId: A.school.id };
  const ctxVal = { userId: validator.id, schoolId: A.school.id };
  const ctxBoth = { userId: both.id, schoolId: A.school.id };
  const ctxNoPerm = { userId: noPerm.id, schoolId: A.school.id };
  const ctxB = { userId: cashierB.id, schoolId: B.school.id };

  const base = { studentId: A.student.id, academicYearId: A.year.id };

  // ---------- Saisie ----------
  console.log("\n== Saisie PENDING ==");
  const om = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 25_000, operator: "ORANGE_MONEY", reference: "OM-REF-001",
    merchantAccount: "*144# OM 76XXXXXX",
  });
  check("saisie Orange Money → PENDING créé", om.ok);
  const moov = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 15_000, operator: "MOOV_MONEY", reference: "MOOV-REF-001",
  });
  check("saisie Moov Money → PENDING créé", moov.ok);
  if (om.ok) {
    const row = await prisma.payment.findUnique({ where: { id: om.result.id } });
    check("méthode = MOBILE_MONEY_MANUAL", row?.method === "MOBILE_MONEY_MANUAL");
    check("statut PENDING", row?.status === "PENDING");
    check("opérateur enregistré", row?.mobileMoneyOperator === "ORANGE_MONEY");
    check("compte marchand enregistré", row?.merchantAccount === "*144# OM 76XXXXXX");
    check("aucun reçu émis", row?.receiptNumber === null);
    check("agent saisisseur tracé", row?.receivedById === cashier.id);
  }

  // ---------- Aucune écriture financière avant validation ----------
  console.log("\n== PENDING sans effet financier ==");
  check("solde validé = 0", (await validatedSum(A.school.id, A.student.id, A.year.id)) === 0);
  const allocCount = await prisma.paymentAllocation.count({
    where: { payment: { schoolId: A.school.id } },
  });
  check("0 allocation créée", allocCount === 0);
  const stats = await paymentsStats(ctxCash, { academicYearId: A.year.id });
  check("stats : total validé hors PENDING", stats.validatedTotal === 0);
  const pending = await listPendingManualPayments(ctxCash);
  check("2 encaissements en attente listés", pending.length === 2);

  // ---------- Contrôles de saisie ----------
  console.log("\n== Contrôles de saisie ==");
  const noRef = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 5_000, operator: "ORANGE_MONEY", reference: "   ",
  });
  check("référence vide → INVALID_INPUT", !noRef.ok && noRef.error === "INVALID_INPUT");
  const dupe = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 5_000, operator: "ORANGE_MONEY", reference: "OM-REF-001",
  });
  check("référence dupliquée (même école+opérateur) → DUPLICATE_REFERENCE",
    !dupe.ok && dupe.error === "DUPLICATE_REFERENCE");
  const otherOp = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 5_000, operator: "MOOV_MONEY", reference: "OM-REF-001",
  });
  check("même référence autre opérateur → acceptée", otherOp.ok);
  if (otherOp.ok) {
    await rejectManualPayment(ctxVal, { paymentId: otherOp.result.id, reason: "fixture" });
  }
  const crossRef = await recordManualMobileMoney(ctxB, {
    studentId: B.student.id, academicYearId: B.year.id,
    amount: 5_000, operator: "ORANGE_MONEY", reference: "OM-REF-001",
  });
  check("même référence autre école → acceptée", crossRef.ok);
  const badAmount = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 0, operator: "ORANGE_MONEY", reference: "X-0",
  });
  check("montant 0 → INVALID_INPUT", !badAmount.ok && badAmount.error === "INVALID_INPUT");
  const negAmount = await recordManualMobileMoney(ctxCash, {
    ...base, amount: -500, operator: "ORANGE_MONEY", reference: "X-NEG",
  });
  check("montant négatif → INVALID_INPUT", !negAmount.ok && negAmount.error === "INVALID_INPUT");
  const badOp = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 5_000, operator: "FAKE_OP" as never, reference: "X-OP",
  });
  check("opérateur inconnu → INVALID_INPUT", !badOp.ok && badOp.error === "INVALID_INPUT");
  const noPermRecord = await recordManualMobileMoney(ctxNoPerm, {
    ...base, amount: 5_000, operator: "ORANGE_MONEY", reference: "X-NOPERM",
  });
  check("saisie sans permission create → FORBIDDEN", !noPermRecord.ok && noPermRecord.error === "FORBIDDEN");

  // ---------- Permissions de validation ----------
  console.log("\n== Validation ==");
  const valNoPerm = om.ok ? await validateManualPayment(ctxNoPerm, om.result.id) : null;
  check("validation sans permission → FORBIDDEN", !valNoPerm?.ok && valNoPerm?.error === "FORBIDDEN");
  const valCashier = om.ok ? await validateManualPayment(ctxCash, om.result.id) : null;
  check("validation par le saisisseur (sans perm validate) → FORBIDDEN",
    !valCashier?.ok && valCashier?.error === "FORBIDDEN");
  const valCross = om.ok ? await validateManualPayment(ctxB, om.result.id) : null;
  check("validation inter-écoles → NOT_FOUND", !valCross?.ok && valCross?.error === "NOT_FOUND");

  const valOk = om.ok ? await validateManualPayment(ctxVal, om.result.id) : null;
  check("validation par agent habilité → OK", !!valOk?.ok);
  if (valOk?.ok) {
    const row = await prisma.payment.findUnique({
      where: { id: om!.ok ? om!.result.id : "" },
      include: { allocations: true },
    });
    check("statut VALIDATED", row?.status === "VALIDATED");
    check("reçu émis après validation", !!row?.receiptNumber?.startsWith("REC-"));
    check("verifiedById = validateur", row?.verifiedById === validator.id);
    check("verifiedAt renseigné", !!row?.verifiedAt);
    check("allocation créée (FIFO 25 000 sur T1 60 000)",
      row?.allocations.length === 1 && row.allocations[0].installmentId === A.inst1.id && row.allocations[0].amount === 25_000);
    const snap = row?.receiptSnapshot as Record<string, unknown> | null;
    check("snapshot : opérateur", snap?.operator === "Orange Money");
    check("snapshot : vérification MANUAL", snap?.verification === "MANUAL");
    check("snapshot : compte marchand", snap?.merchantAccount === "*144# OM 76XXXXXX");
  }
  check("solde validé = 25 000", (await validatedSum(A.school.id, A.student.id, A.year.id)) === 25_000);
  const valAgain = om.ok ? await validateManualPayment(ctxVal, om.result.id) : null;
  check("double validation → NOT_PENDING", !valAgain?.ok && valAgain?.error === "NOT_PENDING");

  // ---------- Surpaiement bloqué à la validation ----------
  console.log("\n== Surpaiement ==");
  const tooMuch = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 200_000, operator: "ORANGE_MONEY", reference: "OM-OVER-001",
  });
  check("saisie montant > solde autorisée (PENDING)", tooMuch.ok);
  const valOver = tooMuch.ok ? await validateManualPayment(ctxVal, tooMuch.result.id) : null;
  check("validation surpayée → OVERPAYMENT", !valOver?.ok && valOver?.error === "OVERPAYMENT");
  if (tooMuch.ok) {
    const row = await prisma.payment.findUnique({ where: { id: tooMuch.result.id } });
    check("le PENDING surpayé reste PENDING", row?.status === "PENDING");
  }
  const afterOver = await prisma.payment.count({
    where: { schoolId: A.school.id, status: "VALIDATED" },
  });
  check("aucune comptabilisation malgré le surpaiement", afterOver === 1);

  // ---------- Rejet ----------
  console.log("\n== Rejet ==");
  const rejNoReason = moov.ok
    ? await rejectManualPayment(ctxVal, { paymentId: moov.result.id, reason: "  " }) : null;
  check("rejet sans motif → INVALID_INPUT", !rejNoReason?.ok && rejNoReason?.error === "INVALID_INPUT");
  const rejNoPerm = moov.ok
    ? await rejectManualPayment(ctxCash, { paymentId: moov.result.id, reason: "x" }) : null;
  check("rejet sans permission validate → FORBIDDEN", !rejNoPerm?.ok && rejNoPerm?.error === "FORBIDDEN");
  const rejOk = moov.ok
    ? await rejectManualPayment(ctxVal, { paymentId: moov.result.id, reason: "Transaction introuvable sur le compte Moov" }) : null;
  check("rejet motivé → OK", !!rejOk?.ok);
  if (moov.ok) {
    const row = await prisma.payment.findUnique({ where: { id: moov.result.id } });
    check("rejeté → CANCELLED", row?.status === "CANCELLED");
    check("aucun reçu sur un rejeté", row?.receiptNumber === null);
  }
  const rejAgain = moov.ok
    ? await rejectManualPayment(ctxVal, { paymentId: moov.result.id, reason: "bis" }) : null;
  check("double rejet → NOT_PENDING", !rejAgain?.ok && rejAgain?.error === "NOT_PENDING");
  const reRecord = await recordManualMobileMoney(ctxCash, {
    ...base, amount: 15_000, operator: "MOOV_MONEY", reference: "MOOV-REF-001",
  });
  check("ressaisie de la référence après rejet → acceptée", reRecord.ok);
  const valReRecord = reRecord.ok ? await validateManualPayment(ctxVal, reRecord.result.id) : null;
  check("ressaisie validée → OK", !!valReRecord?.ok);
  check("solde validé = 40 000", (await validatedSum(A.school.id, A.student.id, A.year.id)) === 40_000);

  // ---------- Annulation d'un validé + traçabilité ----------
  console.log("\n== Annulation validé ==");
  const cancelOk = om.ok
    ? await cancelPayment(ctxVal, { paymentId: om.result.id, reason: "Erreur de vérification" }) : null;
  check("annulation d'un manuel validé → OK (moteur existant)", !!cancelOk?.ok);
  if (om.ok) {
    const row = await prisma.payment.findUnique({ where: { id: om.result.id } });
    check("annulé → CANCELLED + motif", row?.status === "CANCELLED" && !!row?.cancelReason);
  }

  // ---------- Isolation ----------
  console.log("\n== Isolation inter-écoles ==");
  const pendB = await listPendingManualPayments(ctxB);
  check("école B : ses propres en attente", pendB.length === 1 && pendB[0].reference === "OM-REF-001");
  const journalA = await listPayments(ctxCash, { academicYearId: A.year.id });
  check("journal A : aucune ligne de B", journalA.every((p) => p.schoolId === A.school.id));
  const cancelCross = crossRef.ok
    ? await cancelPayment(ctxB, { paymentId: crossRef.result.id, reason: "nettoyage" }) : null;
  check("annulation de la ligne B par B → OK", !!cancelCross?.ok);

  // ---------- Distinction prestataire ----------
  console.log("\n== Distinction manuel / prestataire ==");
  const anyValidated = await prisma.payment.findFirst({
    where: { schoolId: A.school.id, status: "VALIDATED", method: "MOBILE_MONEY_MANUAL" },
  });
  check("validé manuel : method = MOBILE_MONEY_MANUAL", anyValidated?.method === "MOBILE_MONEY_MANUAL");
  check("validé manuel : verifiedById présent", !!anyValidated?.verifiedById);
  const providerPayment = await prisma.payment.create({
    data: {
      schoolId: A.school.id, studentId: A.student.id, academicYearId: A.year.id,
      amount: 1_000, method: "MOBILE_MONEY", status: "VALIDATED", reference: "PROV-1",
    },
  });
  const checkMethod = await prisma.payment.findUnique({ where: { id: providerPayment.id } });
  check("prestataire : method = MOBILE_MONEY (distincte)", checkMethod?.method === "MOBILE_MONEY");
  await prisma.payment.delete({ where: { id: providerPayment.id } });

  // ---------- Audit ----------
  console.log("\n== Audit ==");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: A.school.id, entity: "Payment" },
    select: { action: true },
  });
  const actions = new Set(audits.map((a) => a.action));
  check("audit saisie tracée", actions.has("finance.payment_manual.record"));
  check("audit validation tracée", actions.has("finance.payment_manual.validate"));
  check("audit rejet tracé", actions.has("finance.payment_manual.reject"));
  check("audit annulation tracée", actions.has("finance.payment.cancel"));
  check("aucun secret dans l'audit", !JSON.stringify(audits).match(/pin|otp|password|secret/i));

  // ---------- Nettoyage ----------
  if (process.env.G3M_KEEP !== "1") {
    await cleanupSchool(A.school.id);
    await cleanupSchool(B.school.id);
    const ids = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((u) => u.id);
    if (ids.length) {
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    console.log("\n  fixtures nettoyées");
  }

  console.log(`\n==== G3 MANUEL : ${pass} PASS / ${fail} FAIL ====`);
  if (fail) process.exit(1);
})()
  .catch((e) => { console.error("G3M_RECETTE_FAILED", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
