/**
 * Recette G3-D — rapprochement Mobile Money, commissions,
 * reversements, remboursements, anomalies, risque guichet.
 *
 * Couvre : calcul de commission fixe/proportionnelle/mixte, portée
 * établissement vs payeur, rapprochement exact, reversement groupé /
 * partiel / manquant / doublon / référence inconnue, anomalies
 * (confirmation sans encaissement, encaissement sans confirmation,
 * écart de montant, confirmation tardive, guichet concurrent),
 * workflow complet des remboursements (total, partiel, refus, échec,
 * annulation, idempotence, concurrence), isolation inter-écoles,
 * audit, absence de tout appel réel.
 *
 * Usage : npx tsx scripts/g3/payments-g3d-recette.ts
 *         G3D_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { recordPayment } from "../../src/lib/services/finance/payments";
import { userHasSchoolPermission } from "../../src/lib/permissions/rbac";
import {
  confirmIntent,
  createPaymentIntent,
  createPaymentProvider,
  postConfirmedIntent,
} from "../../src/lib/services/payments/mobileIntents";
import {
  completeSettlement,
  computeProviderFee,
  decideDiscrepancy,
  declareSettlement,
  flagMissingSettlements,
  flagUnconfirmedRefunds,
  listDiscrepancies,
  listReconciliations,
  listSettlements,
  syncReconciliations,
  verifyReconciliation,
} from "../../src/lib/services/payments/reconciliation";
import {
  approveRefund,
  cancelRefund,
  confirmRefund,
  createRefundRequest,
  executeRefund,
  listRefunds,
  rejectRefund,
} from "../../src/lib/services/payments/refunds";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3D-FX";
const FX2 = "G3D-OTHER";
const EMAILS = ["g3d-admin@test.local", "g3d-readonly@test.local", "g3d-adminb@test.local", "g3d-admin2@test.local"];

async function cleanup(schoolId: string) {
  await prisma.paymentDiscrepancy.deleteMany({ where: { schoolId } });
  await prisma.paymentReconciliation.deleteMany({ where: { schoolId } });
  await prisma.paymentRefund.deleteMany({ where: { schoolId } });
  await prisma.paymentSettlement.deleteMany({ where: { schoolId } });
  await prisma.webhookEvent.deleteMany({ where: { schoolId } });
  await prisma.job.deleteMany({ where: { schoolId } });
  await prisma.paymentTransaction.deleteMany({ where: { schoolId } });
  await prisma.paymentIntent.deleteMany({ where: { schoolId } });
  await prisma.paymentProvider.deleteMany({ where: { schoolId } });
  await prisma.paymentAllocation.deleteMany({ where: { installment: { schoolId } } });
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.cashClosure.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
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

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G3D", lastName: email, status: "ACTIVE" },
  });
  const role = await prisma.role.create({ data: { name: `G3D_${email}`, scope: "SCHOOL", schoolId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: permKeys } }, select: { id: true } });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, roleId: role.id, status: "ACTIVE" },
  });
  return user;
}

/** Confirme + comptabilise une intention sandbox (bypass interne recette). */
async function postSandbox(ctx: { userId: string; schoolId: string }, intentId: string) {
  return confirmIntent(ctx, intentId, {
    postToLedger: true,
    __allowSandboxPosting: true,
  });
}

async function main() {
  // ---------- Fixtures ----------
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (old) await cleanup(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3d-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3d-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e" } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, name: "6e A", academicYearId: year.id, levelId: level.id },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });

  const admin = await makeMember("g3d-admin@test.local", school.id, [
    "payments.record", "mobilepayments.manage", "mobilepayments.read",
    "mobilepayments.reconcile", "mobilepayments.refund",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const reader = await makeMember("g3d-readonly@test.local", school.id, ["mobilepayments.read"]);
  const ctxRO = { userId: reader.id, schoolId: school.id };

  const mkStudent = async (mat: string, sId = school.id) =>
    prisma.student.create({
      data: { schoolId: sId, matricule: mat, firstName: "Élève", lastName: mat, status: "ACTIVE" },
    });
  const enroll = (studentId: string) =>
    prisma.enrollment.create({
      data: {
        schoolId: school.id, studentId, academicYearId: year.id,
        classroomId: classroom.id, status: "ENROLLED", enrolledAt: new Date(),
      },
    });
  const due = new Date(Date.now() + 30 * 86400_000);
  const chargeWith = async (studentId: string, amounts: number[]) => {
    const charge = await prisma.studentFeeCharge.create({
      data: {
        schoolId: school.id, studentId, academicYearId: year.id, categoryId: cat.id,
        amount: amounts.reduce((s, a) => s + a, 0),
      },
    });
    const installments = [];
    for (const a of amounts) {
      installments.push(await prisma.feeInstallment.create({
        data: {
          schoolId: school.id, chargeId: charge.id, studentId, academicYearId: year.id,
          dueDate: due, amount: a, label: "T",
        },
      }));
    }
    return { charge, installments };
  };

  const pA = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Simu A", mode: "SANDBOX" });
  const providerA = pA.ok ? pA.data.id : "";

  const mkIntent = async (
    studentId: string, amount: number, extra: {
      feeInstallmentId?: string;
      allocations?: { installmentId: string; amount: number }[];
      sandboxOutcome?: "SUCCESS" | "PENDING";
    } = {},
  ) => {
    const r = await createPaymentIntent(ctxA, {
      studentId, academicYearId: year.id, providerId: providerA,
      amount, currency: "XOF", channel: "ADMIN_TEST",
      feeInstallmentId: extra.feeInstallmentId,
      allocations: extra.allocations,
      sandboxOutcome: extra.sandboxOutcome ?? "SUCCESS",
    });
    return r.ok ? r.data.intentId : "";
  };

  // ══════════ 1. COMMISSIONS ══════════
  console.log("\n— Commissions (fixe / proportionnelle / mixte / portée) —");
  const fixed = computeProviderFee({ feeFixed: 100, feePercent: 0, feeBearer: "SCHOOL" }, 10_000);
  check("commission fixe : 100 sur 10 000 → net 9 900", fixed.fee === 100 && fixed.netExpected === 9_900);
  const pct = computeProviderFee({ feeFixed: 0, feePercent: 200, feeBearer: "SCHOOL" }, 10_000);
  check("commission 2 % : 200 sur 10 000 → net 9 800", pct.fee === 200 && pct.netExpected === 9_800);
  const mixed = computeProviderFee({ feeFixed: 100, feePercent: 150, feeBearer: "SCHOOL" }, 8_000);
  check("commission mixte : 100 + 1,5 % → 220, net 7 780", mixed.fee === 220 && mixed.netExpected === 7_780);
  const payer = computeProviderFee({ feeFixed: 50, feePercent: 100, feeBearer: "PAYER" }, 10_000);
  check("commission payeur : école attend le brut intégral", payer.fee === 150 && payer.netExpected === 10_000);

  // Paramétrage fournisseur réel.
  await prisma.paymentProvider.update({
    where: { id: providerA },
    data: { feeFixed: 100, feePercent: 100, feeBearer: "SCHOOL" },
  });

  // ══════════ 2. RAPPROCHEMENT EXACT ══════════
  console.log("\n— Rapprochement —");
  const s1 = await mkStudent("G3D-S1");
  await enroll(s1.id);
  const f1 = await chargeWith(s1.id, [20_000]);
  const inst1 = f1.installments[0];

  const i1 = await mkIntent(s1.id, 10_000, { feeInstallmentId: inst1.id });
  const paymentsBefore = await prisma.payment.count({ where: { schoolId: school.id } });
  const c1 = await postSandbox(ctxA, i1);
  check("posting sandbox (recette) → CONFIRMED + paymentId", c1.ok && !!c1.data.paymentId);

  let recon1 = await prisma.paymentReconciliation.findUnique({ where: { intentId: i1 } });
  check("rapprochement créé à l'encaissement", !!recon1);
  check("brut / commission / net corrects",
    !!recon1 && recon1.grossAmount === 10_000 && recon1.feeAmount === 200 && recon1.netExpected === 9_800);
  check("reçu rattaché au rapprochement",
    !!c1.ok && recon1?.paymentId === c1.data.paymentId);
  check("statut initial PENDING", recon1?.status === "PENDING");
  check("année scolaire tracée (SYSCOHADA)", recon1?.academicYearId === year.id);

  // Décisions sur le rapprochement.
  const noNote = await verifyReconciliation(ctxA, recon1!.id, { action: "MATCHED" });
  check("rapprochement manuel sans motif → NOTE_REQUIRED", !noNote.ok && noNote.error === "NOTE_REQUIRED");
  const toVerify = await verifyReconciliation(ctxA, recon1!.id, { action: "TO_VERIFY", note: "contrôle" });
  check("passage À VÉRIFIER", toVerify.ok);
  const resolved = await verifyReconciliation(ctxA, recon1!.id, { action: "RESOLVED", note: "vérifié sur relevé" });
  check("clôture avec motif", resolved.ok);
  recon1 = await prisma.paymentReconciliation.findUnique({ where: { intentId: i1 } });
  check("décision tracée (checkedBy/checkedAt)", !!recon1?.checkedById && !!recon1.checkedAt);

  // ══════════ 3. REVERSEMENTS ══════════
  console.log("\n— Reversements groupés —");
  // Deux opérations confirmées supplémentaires dans la même période.
  const s2 = await mkStudent("G3D-S2");
  await enroll(s2.id);
  const f2 = await chargeWith(s2.id, [12_000]);
  const i2 = await mkIntent(s2.id, 12_000, { feeInstallmentId: f2.installments[0].id });
  await postSandbox(ctxA, i2);
  const s3 = await mkStudent("G3D-S3");
  await enroll(s3.id);
  const f3 = await chargeWith(s3.id, [8_000]);
  const i3 = await mkIntent(s3.id, 8_000, { feeInstallmentId: f3.installments[0].id });
  await postSandbox(ctxA, i3);
  // Remettre recon1 en PENDING hors période (confirmedAt hors fenêtre).
  await prisma.paymentReconciliation.update({ where: { intentId: i1 }, data: { status: "RESOLVED" } });

  const yesterday = new Date(Date.now() - 86400_000);
  const tomorrow = new Date(Date.now() + 86400_000);
  // i2 : 12 000 → frais 220 → net 11 780 ; i3 : 8 000 → frais 180 → net 7 820. Total 19 600.
  const st1 = await declareSettlement(ctxA, {
    providerId: providerA, reference: "REV-2026-001",
    periodStart: yesterday, periodEnd: tomorrow, netDeclared: 19_600,
  });
  check("reversement groupé déclaré → MATCHED, 2 opérations",
    st1.ok && st1.data.status === "MATCHED" && st1.data.covered === 2);
  const recsAfter = await prisma.paymentReconciliation.findMany({
    where: { intentId: { in: [i2, i3] } },
  });
  check("opérations couvertes rapprochées", recsAfter.every((r) => r.status === "MATCHED"));
  const settle1 = await prisma.paymentSettlement.findFirst({ where: { reference: "REV-2026-001", schoolId: school.id } });
  check("totaux reversement : brut 20 000, frais 400, net 19 600",
    !!settle1 && settle1.grossTotal === 20_000 && settle1.feeTotal === 400 && settle1.netExpected === 19_600);
  check("déclaration marquée non-bancaire", settle1?.declared === true);

  // Double référence.
  const dupe = await declareSettlement(ctxA, {
    providerId: providerA, reference: "REV-2026-001",
    periodStart: yesterday, periodEnd: tomorrow, netDeclared: 19_600,
  });
  check("double référence → DUPLICATE_REFERENCE", !dupe.ok && dupe.error === "DUPLICATE_REFERENCE");
  check("anomalie DUPLICATE_REFERENCE tracée",
    (await prisma.paymentDiscrepancy.count({ where: { schoolId: school.id, type: "DUPLICATE_REFERENCE" } })) === 1);

  // Référence inconnue : période vide.
  const unknown = await declareSettlement(ctxA, {
    providerId: providerA, reference: "REV-INCONNU",
    periodStart: new Date("2030-01-01"), periodEnd: new Date("2030-02-01"), netDeclared: 5_000,
  });
  check("référence inconnue : 0 opération couverte + anomalie",
    unknown.ok && unknown.data.covered === 0 &&
    (await prisma.paymentDiscrepancy.count({ where: { schoolId: school.id, type: "UNKNOWN_REFERENCE" } })) === 1);

  // Reversement partiel.
  const s4 = await mkStudent("G3D-S4");
  await enroll(s4.id);
  const f4 = await chargeWith(s4.id, [6_000]);
  const i4 = await mkIntent(s4.id, 6_000, { feeInstallmentId: f4.installments[0].id });
  await postSandbox(ctxA, i4); // net attendu 6 000 − 160 = 5 840
  const partial = await declareSettlement(ctxA, {
    providerId: providerA, reference: "REV-PARTIEL",
    periodStart: yesterday, periodEnd: tomorrow, netDeclared: 5_000,
  });
  check("reversement partiel → PARTIAL + anomalie SETTLEMENT_PARTIAL",
    partial.ok && partial.data.status === "PARTIAL" &&
    (await prisma.paymentDiscrepancy.count({ where: { schoolId: school.id, type: "SETTLEMENT_PARTIAL" } })) === 1);
  const rec4 = await prisma.paymentReconciliation.findUnique({ where: { intentId: i4 } });
  check("opération du partiel passée À VÉRIFIER", rec4?.status === "TO_VERIFY");

  // Reversement déclaré puis clôturé au net reçu.
  const s5 = await mkStudent("G3D-S5");
  await enroll(s5.id);
  const f5 = await chargeWith(s5.id, [4_000]);
  const i5 = await mkIntent(s5.id, 4_000, { feeInstallmentId: f5.installments[0].id });
  await postSandbox(ctxA, i5); // net 4 000 − 140 = 3 860
  const decl = await declareSettlement(ctxA, {
    providerId: providerA, reference: "REV-DECLARE",
    periodStart: yesterday, periodEnd: tomorrow,
  });
  check("déclaration sans net → DECLARED", decl.ok && decl.data.status === "DECLARED");
  const comp = await completeSettlement(ctxA, decl.ok ? decl.data.id : "", { netDeclared: 3_860 });
  check("clôture au net reçu exact → MATCHED", comp.ok && comp.data.status === "MATCHED");
  const compBad = await completeSettlement(ctxA, decl.ok ? decl.data.id : "", { netDeclared: 1 });
  check("re-clôture interdite", !compBad.ok && compBad.error === "INVALID_STATE");

  // Reversement manquant.
  const s6 = await mkStudent("G3D-S6");
  await enroll(s6.id);
  const f6 = await chargeWith(s6.id, [3_000]);
  const i6 = await mkIntent(s6.id, 3_000, { feeInstallmentId: f6.installments[0].id });
  await postSandbox(ctxA, i6);
  await prisma.paymentIntent.update({
    where: { id: i6 },
    data: { confirmedAt: new Date(Date.now() - 10 * 86400_000) },
  });
  const missing = await flagMissingSettlements(school.id, { graceDays: 7 });
  check("reversement manquant signalé (> 7 j)", missing >= 1);
  check("anomalie SETTLEMENT_MISSING tracée",
    (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, type: "SETTLEMENT_MISSING", intentId: i6 },
    })) === 1);

  // ══════════ 4. ANOMALIES ══════════
  console.log("\n— Anomalies —");
  // Encaissement sans confirmation : recordPayment direct au guichet.
  const s7 = await mkStudent("G3D-S7");
  await enroll(s7.id);
  await chargeWith(s7.id, [2_000]);
  await recordPayment(ctxA, {
    studentId: s7.id, academicYearId: year.id, amount: 2_000, method: "MOBILE_MONEY",
  });
  // Confirmation sans encaissement : intention confirmée sans posting.
  const s8 = await mkStudent("G3D-S8");
  await enroll(s8.id);
  await chargeWith(s8.id, [2_000]);
  const i8 = await mkIntent(s8.id, 2_000, { sandboxOutcome: "SUCCESS" });
  await confirmIntent(ctxA, i8); // confirmée, pas de posting (sandbox)
  // Confirmation tardive.
  const s9 = await mkStudent("G3D-S9");
  await enroll(s9.id);
  await chargeWith(s9.id, [2_000]);
  const i9 = await mkIntent(s9.id, 2_000);
  await confirmIntent(ctxA, i9);
  await prisma.paymentIntent.update({
    where: { id: i9 },
    data: { expiresAt: new Date(Date.now() - 3600_000), confirmedAt: new Date() },
  });
  // Écart de montant : transaction CONFIRM avec montant divergent.
  await prisma.paymentTransaction.create({
    data: {
      intentId: i9, schoolId: school.id, kind: "CONFIRM",
      payload: { status: "CONFIRMED", amount: 1_500 },
    },
  });

  await syncReconciliations(school.id, { __includeSimulated: true });
  check("rapprochements matérialisés à la confirmation (i8, i9)",
    !!(await prisma.paymentReconciliation.findUnique({ where: { intentId: i8 } })) &&
    !!(await prisma.paymentReconciliation.findUnique({ where: { intentId: i9 } })));
  check("anomalie PAYMENT_NO_CONFIRM (guichet sans intention)",
    (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, type: "PAYMENT_NO_CONFIRM", paymentId: { not: null } },
    })) >= 1);
  check("anomalie CONFIRMED_NO_PAYMENT (confirmation sans encaissement)",
    (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, type: "CONFIRMED_NO_PAYMENT", intentId: i8 },
    })) === 1);
  check("anomalie LATE_CONFIRMATION",
    (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, type: "LATE_CONFIRMATION", intentId: i9 },
    })) === 1);
  check("anomalie AMOUNT_MISMATCH",
    (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, type: "AMOUNT_MISMATCH", intentId: i9 },
    })) === 1);
  const syncAgain = await syncReconciliations(school.id, { __includeSimulated: true });
  check("synchronisation idempotente (0 nouvelle anomalie)", syncAgain.anomalies === 0);

  // ══════════ 5. GUICHET CONCURRENT ══════════
  console.log("\n— Risque guichet (paiement pendant intention active) —");
  const s10 = await mkStudent("G3D-S10");
  await enroll(s10.id);
  const f10 = await chargeWith(s10.id, [10_000, 10_000]);
  const i10 = await mkIntent(s10.id, 6_000, {
    feeInstallmentId: f10.installments[0].id,
    allocations: [{ installmentId: f10.installments[0].id, amount: 6_000 }],
  });
  // Le guichet encaisse 8 000 sur la même échéance pendant l'attente.
  await recordPayment(ctxA, {
    studentId: s10.id, academicYearId: year.id, amount: 8_000, method: "CASH",
    allocations: [{ installmentId: f10.installments[0].id, amount: 8_000 }],
  });
  const blocked = await postSandbox(ctxA, i10);
  check("posting bloqué : OVERPAYMENT_BLOCKED", !blocked.ok && blocked.error === "OVERPAYMENT_BLOCKED");
  const intent10 = await prisma.paymentIntent.findUnique({ where: { id: i10 } });
  check("confirmation conservée (CONFIRMED, pas de paymentId)",
    intent10?.status === "CONFIRMED" && intent10.paymentId === null);
  check("anomalie OVERPAYMENT_BLOCKED créée",
    (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, type: "OVERPAYMENT_BLOCKED", intentId: i10 },
    })) === 1);
  check("aucune double allocation sur l'échéance",
    (await prisma.paymentAllocation.aggregate({
      where: { installmentId: f10.installments[0].id },
      _sum: { amount: true },
    }))._sum.amount === 8_000);
  check("rapprochement préservé malgré le blocage",
    !!(await prisma.paymentReconciliation.findUnique({ where: { intentId: i10 } })));

  // Solde global épuisé (sans allocations explicites).
  const s11 = await mkStudent("G3D-S11");
  await enroll(s11.id);
  await chargeWith(s11.id, [5_000]);
  const i11 = await mkIntent(s11.id, 5_000, { sandboxOutcome: "PENDING" });
  await recordPayment(ctxA, { studentId: s11.id, academicYearId: year.id, amount: 5_000, method: "CASH" });
  const blocked2 = await postSandbox(ctxA, i11);
  check("solde global épuisé → OVERPAYMENT_BLOCKED", !blocked2.ok && blocked2.error === "OVERPAYMENT_BLOCKED");
  check("trace POSTING UNALLOCATABLE",
    (await prisma.paymentTransaction.count({
      where: { intentId: i11, kind: "POSTING", payload: { path: ["status"], equals: "UNALLOCATABLE" } },
    })) >= 1);

  // Libération du solde → repost possible depuis CONFIRMED sans paymentId.
  const s12 = await mkStudent("G3D-S12");
  await enroll(s12.id);
  const f12 = await chargeWith(s12.id, [7_000]);
  const i12 = await mkIntent(s12.id, 7_000, {
    feeInstallmentId: f12.installments[0].id,
    allocations: [{ installmentId: f12.installments[0].id, amount: 7_000 }],
  });
  const pay12 = await recordPayment(ctxA, {
    studentId: s12.id, academicYearId: year.id, amount: 7_000, method: "CASH",
    allocations: [{ installmentId: f12.installments[0].id, amount: 7_000 }],
  });
  const blocked3 = await postSandbox(ctxA, i12);
  check("échéance soldée au guichet → blocage", !blocked3.ok && blocked3.error === "OVERPAYMENT_BLOCKED");
  // Le guichet annule son encaissement → le posting redevient possible.
  await prisma.payment.update({
    where: { id: pay12.ok ? pay12.result.id : "" },
    data: { status: "CANCELLED" },
  });
  const repost = await postConfirmedIntent(ctxA, i12, { __allowSandboxPosting: true });
  check("repost après libération du solde → comptabilisé", repost.ok && !!repost.data.paymentId);

  // ══════════ 5b. CONCURRENCE ATOMIQUE (écriture effective) ══════════
  console.log("\n— Concurrence atomique à l'écriture —");
  // Deux encaissements simultanés, allocations explicites, même échéance :
  // le plafond par échéance est garanti dans la transaction sérialisable.
  const sC1 = await mkStudent("G3D-SC1");
  await enroll(sC1.id);
  const fC1 = await chargeWith(sC1.id, [5_000]);
  const [wA, wB] = await Promise.all([
    recordPayment(ctxA, {
      studentId: sC1.id, academicYearId: year.id, amount: 4_000, method: "CASH",
      allocations: [{ installmentId: fC1.installments[0].id, amount: 4_000 }],
    }),
    recordPayment(ctxA, {
      studentId: sC1.id, academicYearId: year.id, amount: 4_000, method: "MOBILE_MONEY",
      allocations: [{ installmentId: fC1.installments[0].id, amount: 4_000 }],
    }),
  ]);
  check("deux allocations explicites concurrentes → une seule écrit",
    [wA, wB].filter((r) => r.ok).length === 1 &&
    [wA, wB].some((r) => !r.ok && r.error === "OVERPAYMENT"));
  check("total alloué limité au plafond (4 000 / échéance 5 000)",
    ((await prisma.paymentAllocation.aggregate({
      where: { installmentId: fC1.installments[0].id }, _sum: { amount: true },
    }))._sum.amount ?? 0) === 4_000);

  // Guichet + intention Mobile Money simultanés sur la même échéance.
  const sC2 = await mkStudent("G3D-SC2");
  await enroll(sC2.id);
  const fC2 = await chargeWith(sC2.id, [5_000]);
  const iC2 = await mkIntent(sC2.id, 4_000, {
    sandboxOutcome: "PENDING",
    feeInstallmentId: fC2.installments[0].id,
    allocations: [{ installmentId: fC2.installments[0].id, amount: 4_000 }],
  });
  const [rG, rM] = await Promise.all([
    recordPayment(ctxA, {
      studentId: sC2.id, academicYearId: year.id, amount: 3_000, method: "CASH",
      allocations: [{ installmentId: fC2.installments[0].id, amount: 3_000 }],
    }),
    postSandbox(ctxA, iC2),
  ]);
  const intentC2 = await prisma.paymentIntent.findUnique({ where: { id: iC2 } });
  const mmPosted = rM.ok && !!intentC2?.paymentId;
  const guiPosted = rG.ok;
  const allocC2 = (await prisma.paymentAllocation.aggregate({
    where: { installmentId: fC2.installments[0].id }, _sum: { amount: true },
  }))._sum.amount ?? 0;
  check("guichet + MM simultanés : un seul gagnant, jamais 7 000 sur 5 000",
    allocC2 <= 5_000 && mmPosted !== guiPosted);
  if (!mmPosted) {
    check("perdant MM : confirmation conservée + anomalie OVERPAYMENT_BLOCKED",
      intentC2?.status === "CONFIRMED" && intentC2.paymentId === null &&
      (await prisma.paymentDiscrepancy.count({
        where: { intentId: iC2, type: "OVERPAYMENT_BLOCKED" },
      })) >= 1);
  } else {
    check("perdant guichet : OVERPAYMENT atomique, aucune allocation guichet",
      !rG.ok && rG.error === "OVERPAYMENT" && allocC2 === 4_000);
  }

  // Deux encaissements FIFO simultanés (répartition recalculée dans la tx).
  const sC3 = await mkStudent("G3D-SC3");
  await enroll(sC3.id);
  const fC3 = await chargeWith(sC3.id, [5_000]);
  const [fA2, fB2] = await Promise.all([
    recordPayment(ctxA, { studentId: sC3.id, academicYearId: year.id, amount: 4_000, method: "CASH" }),
    recordPayment(ctxA, { studentId: sC3.id, academicYearId: year.id, amount: 4_000, method: "MOBILE_MONEY" }),
  ]);
  check("deux FIFO concurrents → une seule écrit (répartition fraîche au retry)",
    [fA2, fB2].filter((r) => r.ok).length === 1 &&
    [fA2, fB2].some((r) => !r.ok && r.error === "OVERPAYMENT"));
  check("FIFO : total alloué limité",
    ((await prisma.paymentAllocation.aggregate({
      where: { installmentId: fC3.installments[0].id }, _sum: { amount: true },
    }))._sum.amount ?? 0) === 4_000);

  // ══════════ 6. REMBOURSEMENTS ══════════
  console.log("\n— Remboursements —");
  const payment1 = (await prisma.paymentIntent.findUnique({ where: { id: i1 } }))!.paymentId!;
  const noReason = await createRefundRequest(ctxA, { paymentId: payment1, amount: 1_000, reason: " " });
  check("demande sans motif → REASON_REQUIRED", !noReason.ok && noReason.error === "REASON_REQUIRED");
  const tooMuch = await createRefundRequest(ctxA, { paymentId: payment1, amount: 99_999, reason: "x" });
  check("montant > remboursable → EXCEEDS_REFUNDABLE", !tooMuch.ok && tooMuch.error === "EXCEEDS_REFUNDABLE");

  // Remboursement total : demande → approbation → exécution → confirmation.
  const rf1 = await createRefundRequest(ctxA, {
    paymentId: payment1, amount: 10_000, reason: "Trop-perçu", idempotencyKey: "rf-total-1",
  });
  check("demande totale créée (REQUESTED)", rf1.ok);
  const rf1Id = rf1.ok ? rf1.data.id : "";
  check("une demande n'est PAS un remboursement effectué",
    (await prisma.paymentRefund.findUnique({ where: { id: rf1Id } }))?.status === "REQUESTED");
  check("confirm direct interdit (INVALID_STATE)", !(await confirmRefund(ctxA, rf1Id)).ok);
  check("approbation", (await approveRefund(ctxA, rf1Id)).ok);
  const ex1 = await executeRefund(ctxA, rf1Id);
  check("exécution simulée → référence SIMREF-", ex1.ok && !!ex1.data.providerRef?.startsWith("SIMREF-"));
  check("confirmation → CONFIRMED", (await confirmRefund(ctxA, rf1Id)).ok);
  const pay1After = await prisma.payment.findUnique({ where: { id: payment1 } });
  check("paiement d'origine conservé VALIDATED (pas d'annulation auto)", pay1After?.status === "VALIDATED");
  const reconRf = await prisma.paymentReconciliation.findUnique({ where: { intentId: i1 } });
  check("rapprochement noté du remboursement", (reconRf?.notes ?? "").includes("Remboursement"));

  // Remboursement partiel ×2 puis dépassement.
  const payment12 = (await prisma.paymentIntent.findUnique({ where: { id: i12 } }))!.paymentId!;
  const rfP1 = await createRefundRequest(ctxA, { paymentId: payment12, amount: 4_000, reason: "Partiel 1" });
  check("partiel 1 créé", rfP1.ok);
  if (rfP1.ok) {
    await approveRefund(ctxA, rfP1.data.id);
    await executeRefund(ctxA, rfP1.data.id);
    await confirmRefund(ctxA, rfP1.data.id);
  }
  const rfP2 = await createRefundRequest(ctxA, { paymentId: payment12, amount: 3_000, reason: "Partiel 2" });
  check("partiel 2 dans la limite restante", rfP2.ok);
  const rfP3 = await createRefundRequest(ctxA, { paymentId: payment12, amount: 1_000, reason: "Excès" });
  check("3e remboursement > solde → EXCEEDS_REFUNDABLE", !rfP3.ok && rfP3.error === "EXCEEDS_REFUNDABLE");

  // Refus motivé — sur un encaissement non encore remboursé.
  const payment2 = (await prisma.paymentIntent.findUnique({ where: { id: i2 } }))!.paymentId!;
  const rfR = await createRefundRequest(ctxA, { paymentId: payment2, amount: 500, reason: "Test refus" });
  check("refus sans motif → REASON_REQUIRED",
    !(await rejectRefund(ctxA, rfR.ok ? rfR.data.id : "", " ")).ok);
  check("refus motivé → REJECTED",
    (await rejectRefund(ctxA, rfR.ok ? rfR.data.id : "", "Non justifié")).ok);
  check("refusé : ré-exécution impossible",
    !(await executeRefund(ctxA, rfR.ok ? rfR.data.id : "")).ok);

  // Échec d'exécution (simulé, indicateur interne) — sur un
  // encaissement vierge (payment12 est déjà engagé à 7 000/7 000).
  const payment3 = (await prisma.paymentIntent.findUnique({ where: { id: i3 } }))!.paymentId!;
  const rfF = await createRefundRequest(ctxA, { paymentId: payment3, amount: 500, reason: "Test échec" });
  check("demande échec créée", rfF.ok);
  if (rfF.ok) {
    await approveRefund(ctxA, rfF.data.id);
    const fx = await executeRefund(ctxA, rfF.data.id, { __simulateFail: true });
    check("échec simulé → FAILED", fx.ok &&
      (await prisma.paymentRefund.findUnique({ where: { id: rfF.data.id } }))?.status === "FAILED");
  }

  // Annulation avant exécution.
  const rfC = await createRefundRequest(ctxA, { paymentId: payment3, amount: 500, reason: "Test annulation" });
  check("annulation REQUESTED → CANCELLED",
    (await cancelRefund(ctxA, rfC.ok ? rfC.data.id : "")).ok);

  // Rejeu idempotent + conflit.
  const rfReplay = await createRefundRequest(ctxA, {
    paymentId: payment1, amount: 500, reason: "Rejeu", idempotencyKey: "rf-total-1",
  });
  check("rejeu même clé, contenu différent → IDEMPOTENCY_CONFLICT",
    !rfReplay.ok && rfReplay.error === "IDEMPOTENCY_CONFLICT");
  const rfR2 = await createRefundRequest(ctxA, {
    paymentId: payment1, amount: 10_000, reason: "Trop-perçu", idempotencyKey: "rf-total-1",
  });
  check("rejeu même clé, même contenu → already", rfR2.ok && rfR2.data.already === true && rfR2.data.id === rf1Id);

  // Concurrence : deux approbations/exécutions simultanées.
  const rfCC = await createRefundRequest(ctxA, { paymentId: payment2, amount: 1_000, reason: "Concurrence" });
  const ccId = rfCC.ok ? rfCC.data.id : "";
  const [ap1, ap2] = await Promise.all([approveRefund(ctxA, ccId), approveRefund(ctxA, ccId)]);
  check("deux approbations concurrentes → au moins une réussit, état unique",
    (ap1.ok || ap2.ok) &&
    (await prisma.paymentRefund.findUnique({ where: { id: ccId } }))?.status === "APPROVED");
  const [exA, exB] = await Promise.all([executeRefund(ctxA, ccId), executeRefund(ctxA, ccId)]);
  check("deux exécutions concurrentes → un seul EXECUTED",
    (exA.ok || exB.ok) &&
    (await prisma.paymentRefund.findUnique({ where: { id: ccId } }))?.status === "EXECUTED");

  // Remboursement exécuté non confirmé → anomalie.
  await prisma.paymentRefund.update({
    where: { id: ccId },
    data: { executedAt: new Date(Date.now() - 30 * 3600_000) },
  });
  const unconfirmed = await flagUnconfirmedRefunds(school.id, { graceHours: 24 });
  check("remboursement non confirmé signalé", unconfirmed === 1);

  // Politique d'auto-approbation : les approbations précédentes étaient
  // des auto-approbations mono-admin (seul détenteur de la permission)
  // → tolérées mais auditées comme exception.
  const saAudit = await prisma.auditLog.findFirst({
    where: { schoolId: school.id, action: "payment_refund.approved", entityId: rf1Id },
    select: { metadata: true },
  });
  check("auto-approbation mono-admin auditée comme exception",
    (saAudit?.metadata as { selfApproval?: boolean } | null)?.selfApproval === true);
  // Dès qu'un second approbateur existe, la séparation est obligatoire.
  const admin2 = await makeMember("g3d-admin2@test.local", school.id, ["mobilepayments.refund"]);
  const ctxA2 = { userId: admin2.id, schoolId: school.id };
  const rfSA = await createRefundRequest(ctxA, { paymentId: payment3, amount: 200, reason: "Auto-app multi-approbateurs" });
  const saId = rfSA.ok ? rfSA.data.id : "";
  const saRes = await approveRefund(ctxA, saId);
  check("auto-approbation refusée quand un second approbateur existe",
    !saRes.ok && saRes.error === "SELF_APPROVAL");
  check("demande inchangée après refus (REQUESTED)",
    (await prisma.paymentRefund.findUnique({ where: { id: saId } }))?.status === "REQUESTED");
  check("approbation par un autre approbateur → ok",
    (await approveRefund(ctxA2, saId)).ok);

  // ══════════ 7. ISOLATION / PERMISSIONS / AUDIT ══════════
  console.log("\n— Isolation, permissions, audit —");
  await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const adminB = await makeMember("g3d-adminb@test.local", schoolB.id, ["mobilepayments.reconcile", "mobilepayments.refund"]);
  const ctxB = { userId: adminB.id, schoolId: schoolB.id };

  check("listes G3-D vides côté école B",
    (await listReconciliations(ctxB)).length === 0 &&
    (await listSettlements(ctxB)).length === 0 &&
    (await listRefunds(ctxB)).length === 0 &&
    (await listDiscrepancies(ctxB)).length === 0);
  check("décision cross-école refusée",
    !(await decideDiscrepancy(ctxB, (await prisma.paymentDiscrepancy.findFirst({ where: { schoolId: school.id } }))!.id, { action: "RESOLVED", note: "x" })).ok);
  check("reversement cross-école refusé",
    !(await declareSettlement(ctxB, {
      providerId: providerA, reference: "X", periodStart: yesterday, periodEnd: tomorrow,
    })).ok);
  check("remboursement cross-école refusé",
    !(await createRefundRequest(ctxB, { paymentId: payment1, amount: 100, reason: "x" })).ok);
  check("rapprochement cross-école refusé",
    !(await verifyReconciliation(ctxB, recon1!.id, { action: "RESOLVED", note: "x" })).ok);

  check("permissions : read-only sans reconcile/refund",
    !(await userHasSchoolPermission({ ...ctxRO, permissionKey: "mobilepayments.reconcile" })) &&
    !(await userHasSchoolPermission({ ...ctxRO, permissionKey: "mobilepayments.refund" })) &&
    (await userHasSchoolPermission({ ...ctxRO, permissionKey: "mobilepayments.read" })));
  check("permissions : admin détient reconcile + refund",
    (await userHasSchoolPermission({ ...ctxA, permissionKey: "mobilepayments.reconcile" })) &&
    (await userHasSchoolPermission({ ...ctxA, permissionKey: "mobilepayments.refund" })));

  const audits = await prisma.auditLog.findMany({
    where: { schoolId: school.id },
    select: { action: true },
  });
  const acts = new Set(audits.map((a) => a.action));
  check("audit : reversement déclaré", acts.has("payment_settlement.declared"));
  check("audit : reversement clôturé", acts.has("payment_settlement.completed"));
  check("audit : intention non imputable", acts.has("payment_intent.unallocatable"));
  check("audit : remboursement tracé (requested→confirmed)",
    acts.has("payment_refund.requested") && acts.has("payment_refund.approved") &&
    acts.has("payment_refund.executed") && acts.has("payment_refund.confirmed"));
  check("audit : décision de rapprochement", acts.has("payment_reconciliation.resolved"));

  // Décision d'anomalie avec historique.
  const disc = await prisma.paymentDiscrepancy.findFirst({
    where: { schoolId: school.id, type: "SETTLEMENT_MISSING" },
  });
  const rev = await decideDiscrepancy(ctxA, disc!.id, { action: "IN_REVIEW", note: "Relance prestataire" });
  const res = await decideDiscrepancy(ctxA, disc!.id, { action: "RESOLVED", note: "Reversement reçu" });
  const discAfter = await prisma.paymentDiscrepancy.findUnique({ where: { id: disc!.id } });
  check("décisions d'anomalie tracées dans l'historique",
    rev.ok && res.ok && ((discAfter?.history as unknown[] | null)?.length ?? 0) === 2 && discAfter?.status === "RESOLVED");
  check("décision sans motif → NOTE_REQUIRED",
    !(await decideDiscrepancy(ctxA, disc!.id, { action: "RESOLVED", note: "" })).ok);

  // ══════════ 8. AUCUN RÉEL ══════════
  console.log("\n— Aucun paiement / remboursement réel —");
  const i8After = await prisma.paymentIntent.findUnique({ where: { id: i8 } });
  const i9After = await prisma.paymentIntent.findUnique({ where: { id: i9 } });
  check("confirmation sandbox sans posting → aucun encaissement (i8, i9)",
    i8After?.paymentId === null && i9After?.paymentId === null &&
    paymentsBefore === (await prisma.payment.count({ where: { schoolId: school.id, intent: { id: { in: [i8, i9] } } } })));
  const refundRefs = await prisma.paymentRefund.findMany({
    where: { schoolId: school.id, providerRef: { not: null } },
    select: { providerRef: true },
  });
  check("toutes les références de remboursement sont SIMREF- (simulées)",
    refundRefs.every((r) => r.providerRef!.startsWith("SIMREF-")));
  const exportsOk = (await listReconciliations(ctxA)).every((r) =>
    !JSON.stringify(r).includes("webhookSecretRef"));
  check("aucune référence de secret exposée dans les listes", exportsOk);

  // ---------- Bilan ----------
  console.log(`\n═══ G3-D : ${pass} PASS / ${fail} FAIL ═══`);

  if (process.env.G3D_CLEANUP === "1" || fail === 0) {
    await cleanup(school.id);
    await cleanup(schoolB.id);
    await prisma.schoolMembership.deleteMany({ where: { user: { email: { in: EMAILS } } } });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    console.log("Fixtures supprimées.");
  }
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
