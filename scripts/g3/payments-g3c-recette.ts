/**
 * Recette G3-C — portail parent : frais, paiements Mobile Money, reçus.
 *
 * Couvre : accès mono/multi-enfants, identifiants modifiés, isolation
 * inter-écoles, échéance inexistante/soldée, paiement partiel, montants
 * invalides/excessifs, double-clic, rejeu idempotent, intentions
 * concurrentes, échéances indépendantes, prestataire indisponible,
 * succès/échec/expiration/confirmation tardive sandbox, suivi,
 * historique, reçus autorisés/refusés, absence de reçu fictif et
 * d'encaissement opérationnel sandbox.
 *
 * Usage : npx tsx scripts/g3/payments-g3c-recette.ts
 *         G3C_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { recordPayment } from "../../src/lib/services/finance/payments";
import {
  createPaymentProvider,
  expireDuePaymentIntents,
  pollPaymentIntent,
} from "../../src/lib/services/payments/mobileIntents";
import { getChildFinances, verifyChildAccess } from "../../src/lib/services/portal/parent";
import {
  cancelParentIntent,
  createParentPaymentIntent,
  getParentIntent,
  getPayableInstallment,
  listParentIntents,
  listParentProviders,
  notifyParentIntentUpdate,
  parentFinancesOverview,
} from "../../src/lib/services/portal/parentPayments";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3C-FX";
const FX2 = "G3C-OTHER";
const EMAILS = [
  "g3c-admin@test.local", "g3c-parent1@test.local",
  "g3c-parent2@test.local", "g3c-parentb@test.local",
  "g3c-adminb@test.local",
];

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
  await prisma.feeDiscount.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeTariff.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
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

async function makeUser(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G3C", lastName: email, status: "ACTIVE" },
  });
}

/** Compte parent : User + Guardian lié + liens StudentGuardian. */
async function makeParent(email: string, schoolId: string, studentIds: string[]) {
  const user = await makeUser(email);
  const guardian = await prisma.guardian.create({
    data: { schoolId, firstName: "Parent", lastName: email, userId: user.id, status: "ACTIVE" },
  });
  for (const studentId of studentIds) {
    await prisma.studentGuardian.create({
      data: { schoolId, studentId, guardianId: guardian.id, relation: "FATHER" },
    });
  }
  return user;
}

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await makeUser(email);
  const role = await prisma.role.create({ data: { name: `G3C_${email}`, scope: "SCHOOL", schoolId } });
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

async function main() {
  // ---------- Fixtures ----------
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (old) await cleanup(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.guardian.updateMany({ where: { userId: { in: stale.map((u) => u.id) } }, data: { userId: null } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3c-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3c-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const yearB = await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e" } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, name: "6e A", academicYearId: year.id, levelId: level.id },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });

  const admin = await makeMember("g3c-admin@test.local", school.id, [
    "payments.record", "mobilepayments.manage",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };

  const mkStudent = async (mat: string, sId = school.id) =>
    prisma.student.create({
      data: { schoolId: sId, matricule: mat, firstName: "Élève", lastName: mat, status: "ACTIVE" },
    });
  const enroll = (studentId: string, sId: string, yId: string, classroomId: string) =>
    prisma.enrollment.create({
      data: {
        schoolId: sId, studentId, academicYearId: yId,
        classroomId, status: "ENROLLED", enrolledAt: new Date(),
      },
    });
  const chargeWith = async (
    studentId: string, amounts: { amount: number; dueDate: Date; label?: string }[],
    sId = school.id, yId = year.id,
  ) => {
    const charge = await prisma.studentFeeCharge.create({
      data: {
        schoolId: sId, studentId, academicYearId: yId, categoryId: cat.id,
        amount: amounts.reduce((s, a) => s + a.amount, 0),
      },
    });
    const installments = [];
    for (const a of amounts) {
      installments.push(
        await prisma.feeInstallment.create({
          data: {
            schoolId: sId, chargeId: charge.id, studentId, academicYearId: yId,
            dueDate: a.dueDate, amount: a.amount, label: a.label,
          },
        }),
      );
    }
    return { charge, installments };
  };

  // Fournisseurs : sandbox actif + un prestataire sans adaptateur (créé en
  // base directement — le service expose PROVIDER_UNAVAILABLE).
  const pA = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Simu A", mode: "SANDBOX" });
  const providerA = pA.ok ? pA.data.id : "";
  const providerNoAdapter = await prisma.paymentProvider.create({
    data: { schoolId: school.id, code: "FAKECO", label: "Sans adaptateur", mode: "SANDBOX" },
  });
  const providerArchived = await prisma.paymentProvider.create({
    data: { schoolId: school.id, code: "OLDSIM", label: "Retiré", mode: "SANDBOX", status: "ARCHIVED" },
  });

  // ── Élève 1 : parent mono-enfant — 2 échéances de 10 000 ──
  const s1 = await mkStudent("G3C-S1");
  await enroll(s1.id, school.id, year.id, classroom.id);
  const pastDue = new Date(Date.now() - 10 * 86400_000);
  const futureDue = new Date(Date.now() + 30 * 86400_000);
  const f1 = await chargeWith(s1.id, [
    { amount: 10_000, dueDate: pastDue, label: "T1" },
    { amount: 10_000, dueDate: futureDue, label: "T2" },
  ]);
  const [inst1, inst2] = f1.installments;
  const parent1 = await makeParent("g3c-parent1@test.local", school.id, [s1.id]);
  const pctx1 = { userId: parent1.id, schoolId: school.id };

  // ── Parent multi-enfants : s2 + s3 ──
  const s2 = await mkStudent("G3C-S2");
  await enroll(s2.id, school.id, year.id, classroom.id);
  const f2 = await chargeWith(s2.id, [{ amount: 5_000, dueDate: pastDue, label: "T1" }]);
  const s3 = await mkStudent("G3C-S3");
  await enroll(s3.id, school.id, year.id, classroom.id);
  const f3 = await chargeWith(s3.id, [{ amount: 7_000, dueDate: futureDue, label: "T1" }]);
  const parent2 = await makeParent("g3c-parent2@test.local", school.id, [s2.id, s3.id]);
  const pctx2 = { userId: parent2.id, schoolId: school.id };

  // ── École B : parent + enfant isolés ──
  const sB = await mkStudent("G3C-SB", schoolB.id);
  const levelB = await prisma.level.create({ data: { schoolId: schoolB.id, name: "6e" } });
  const classroomB = await prisma.classroom.create({
    data: { schoolId: schoolB.id, name: "6e B", academicYearId: yearB.id, levelId: levelB.id },
  });
  await enroll(sB.id, schoolB.id, yearB.id, classroomB.id);
  const catB = await prisma.feeCategory.create({ data: { schoolId: schoolB.id, code: "SCOL", label: "Scolarité" } });
  const chargeB = await prisma.studentFeeCharge.create({
    data: {
      schoolId: schoolB.id, studentId: sB.id, academicYearId: yearB.id,
      categoryId: catB.id,
      amount: 8_000,
    },
  });
  const instB = await prisma.feeInstallment.create({
    data: {
      schoolId: schoolB.id, chargeId: chargeB.id, studentId: sB.id,
      academicYearId: yearB.id, dueDate: futureDue, amount: 8_000,
    },
  });
  const memberB = await makeUser("g3c-adminb@test.local");
  const ctxB = { userId: memberB.id, schoolId: schoolB.id };
  const pB = await createPaymentProvider(ctxB, { code: "SANDBOX", label: "Simu B", mode: "SANDBOX" });
  const providerB = pB.ok ? pB.data.id : "";
  const parentB = await makeParent("g3c-parentb@test.local", schoolB.id, [sB.id]);
  const pctxB = { userId: parentB.id, schoolId: schoolB.id };

  // ══════════ 1. ACCÈS ET VUES ══════════
  console.log("\n— Accès parent / multi-enfants —");
  check("verifyChildAccess : enfant lié → autorisé", !!(await verifyChildAccess(pctx1, s1.id)));
  check("verifyChildAccess : enfant d'un autre parent → refusé", !(await verifyChildAccess(pctx1, s2.id)));
  check("verifyChildAccess : élève d'une autre école → refusé", !(await verifyChildAccess(pctx1, sB.id)));
  check("verifyChildAccess : identifiant inexistant → refusé", !(await verifyChildAccess(pctx1, "cuk_inconnu")));

  const fin1 = await getChildFinances(pctx1, s1.id);
  check("mono-enfant : situation financière (20 000 dus)",
    !!fin1 && fin1.due === 20_000 && fin1.balance === 20_000 && fin1.installments.length === 2);
  check("échéance échue marquée en retard", !!fin1 && fin1.installments.some((i) => i.status === "LATE"));
  check("finances d'un enfant non lié → null", (await getChildFinances(pctx1, s2.id)) === null);
  check("finances d'un élève d'une autre école → null", (await getChildFinances(pctx1, sB.id)) === null);

  const ov2 = await parentFinancesOverview(pctx2);
  check("multi-enfants : vue consolidée à 2 lignes", ov2.length === 2);
  check("consolidé : soldes par enfant corrects",
    ov2.find((r) => r.student.id === s2.id)?.balance === 5_000 &&
    ov2.find((r) => r.student.id === s3.id)?.balance === 7_000);
  check("consolidé : retard détecté", ov2.find((r) => r.student.id === s2.id)?.lateInstallments === 1);

  const providers = await listParentProviders(pctx1);
  check("prestataires parent : seuls actifs+adaptateur exposés",
    providers.length === 1 && providers[0].id === providerA);
  check("références de secrets jamais exposées",
    !JSON.stringify(providers).includes("credentialsRef") && !JSON.stringify(providers).includes("webhookSecretRef"));

  // ══════════ 2. CRÉATION D'INTENTION ══════════
  console.log("\n— Création d'intention —");
  const pay1 = await getPayableInstallment(pctx1, s1.id, inst1.id);
  check("échéance payable : solde exigible complet", !!pay1 && pay1.remaining === 10_000);
  check("échéance inexistante → null", (await getPayableInstallment(pctx1, s1.id, "cuk_inexistant")) === null);
  check("échéance d'un autre élève → null", (await getPayableInstallment(pctx1, s1.id, f2.installments[0].id)) === null);
  check("échéance d'une autre école → null", (await getPayableInstallment(pctx1, sB.id, instB.id)) === null);

  const c1 = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 5_000,
    providerId: providerA, idempotencyKey: "g3c-k1", __sandboxOutcome: "PENDING",
  });
  check("paiement partiel : intention créée", c1.ok);
  const i1 = c1.ok ? await prisma.paymentIntent.findUnique({ where: { id: c1.data.intentId } }) : null;
  check("canal PARENT_PORTAL enregistré", i1?.channel === "PARENT_PORTAL");
  check("intention active déduit le solde exigible",
    (await getPayableInstallment(pctx1, s1.id, inst1.id))?.remaining === 5_000);

  const c1b = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 5_000,
    providerId: providerA, idempotencyKey: "g3c-k1",
  });
  check("double-clic même clé → rejeu idempotent (même intention)",
    c1b.ok && c1b.data.replayed && c1b.data.intentId === i1?.id);
  const c1c = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 4_000,
    providerId: providerA, idempotencyKey: "g3c-k1",
  });
  check("même clé, contenu différent → IDEMPOTENCY_CONFLICT", !c1c.ok && c1c.error === "IDEMPOTENCY_CONFLICT");
  const c1d = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 5_000,
    providerId: providerA, idempotencyKey: "g3c-k2",
  });
  check("seconde intention active sur même échéance → rejet",
    !c1d.ok && (c1d.error === "ACTIVE_INTENT_EXISTS" || c1d.error === "AMOUNT_EXCEEDS_BALANCE"));

  // Annulation puis tests de montants invalides sur inst1.
  await cancelParentIntent(pctx1, i1!.id);
  check("annulation parent → CANCELLED",
    (await prisma.paymentIntent.findUnique({ where: { id: i1!.id } }))?.status === "CANCELLED");

  const badAmt = async (amount: number) =>
    createParentPaymentIntent(pctx1, {
      studentId: s1.id, feeInstallmentId: inst1.id, amount,
      providerId: providerA, idempotencyKey: `g3c-bad-${amount}`,
    });
  const overAmt = await badAmt(10_001);
  check("montant supérieur au solde → AMOUNT_EXCEEDS_BALANCE",
    !overAmt.ok && overAmt.error === "AMOUNT_EXCEEDS_BALANCE");
  check("montant nul → INVALID_AMOUNT", !(await badAmt(0)).ok);
  check("montant négatif → INVALID_AMOUNT", !(await badAmt(-500)).ok);
  check("montant fractionnaire → INVALID_AMOUNT", !(await badAmt(500.5)).ok);

  const badTgt = async (studentId: string, feeInstallmentId: string) =>
    createParentPaymentIntent(pctx1, {
      studentId, feeInstallmentId, amount: 1_000,
      providerId: providerA, idempotencyKey: `g3c-${studentId.slice(-4)}-${feeInstallmentId.slice(-4)}`,
    });
  check("élève non lié → FORBIDDEN", !(await badTgt(s2.id, f2.installments[0].id)).ok);
  check("élève d'une autre école → FORBIDDEN",
    !(await badTgt(sB.id, instB.id)).ok);
  check("échéance inexistante → NOT_FOUND", !(await badTgt(s1.id, "cuk_inexistant")).ok);

  const badProv = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 1_000,
    providerId: providerB, idempotencyKey: "g3c-pb",
  });
  check("prestataire d'une autre école → rejet", !badProv.ok);
  const noAdapt = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 1_000,
    providerId: providerNoAdapter.id, idempotencyKey: "g3c-na",
  });
  check("prestataire sans adaptateur → PROVIDER_UNAVAILABLE",
    !noAdapt.ok && noAdapt.error === "PROVIDER_UNAVAILABLE");
  const archProv = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst1.id, amount: 1_000,
    providerId: providerArchived.id, idempotencyKey: "g3c-arch",
  });
  check("prestataire archivé → rejet", !archProv.ok);

  // Deux échéances indépendantes payables en parallèle.
  const [iT1, iT2] = await Promise.all([
    createParentPaymentIntent(pctx1, {
      studentId: s1.id, feeInstallmentId: inst1.id, amount: 10_000,
      providerId: providerA, idempotencyKey: "g3c-t1", __sandboxOutcome: "PENDING",
    }),
    createParentPaymentIntent(pctx1, {
      studentId: s1.id, feeInstallmentId: inst2.id, amount: 10_000,
      providerId: providerA, idempotencyKey: "g3c-t2", __sandboxOutcome: "PENDING",
    }),
  ]);
  check("deux échéances indépendantes → deux intentions actives", iT1.ok && iT2.ok);
  const idT1 = iT1.ok ? iT1.data.intentId : "";
  const idT2 = iT2.ok ? iT2.data.intentId : "";
  await cancelParentIntent(pctx1, idT2);

  // ══════════ 3. CONCURRENCE ══════════
  console.log("\n— Concurrence —");
  // inst2 libre à nouveau : deux créations parallèles, une seule gagne.
  const [rA, rB] = await Promise.all([
    createParentPaymentIntent(pctx1, {
      studentId: s1.id, feeInstallmentId: inst2.id, amount: 6_000,
      providerId: providerA, idempotencyKey: "g3c-race-a", __sandboxOutcome: "PENDING",
    }),
    createParentPaymentIntent(pctx1, {
      studentId: s1.id, feeInstallmentId: inst2.id, amount: 6_000,
      providerId: providerA, idempotencyKey: "g3c-race-b", __sandboxOutcome: "PENDING",
    }),
  ]);
  const wins = [rA, rB].filter((r) => r.ok).length;
  const activeCount = await prisma.paymentIntent.count({
    where: { feeInstallmentId: inst2.id, status: { in: ["CREATED", "PENDING", "CONFIRMED_PENDING_POSTING"] } },
  });
  check("deux intentions concurrentes → une seule active", wins === 1 && activeCount === 1);
  const loser = [rA, rB].find((r) => !r.ok);
  check("perdante rejetée proprement", !!loser && !loser.ok);
  const winnerId = rA.ok ? rA.data.intentId : rB.ok ? rB.data.intentId : "";

  // ══════════ 4. CYCLE DE VIE SANDBOX ══════════
  console.log("\n— Cycle sandbox —");
  // Succès : la fixture inst1 est couverte par idT1 (PENDING) — le polling
  // sandbox la confirme si le scénario le permet. On force le script.
  await prisma.paymentIntent.update({
    where: { id: idT1 }, data: { sandboxScript: { outcome: "SUCCESS", afterChecks: 0, checks: 0 } },
  });
  const poll1 = await pollPaymentIntent(pctx1, idT1);
  const iT1after = await prisma.paymentIntent.findUnique({ where: { id: idT1 } });
  check("succès sandbox → intention CONFIRMED (simulation)",
    poll1.ok && iT1after?.status === "CONFIRMED");
  check("confirmation sandbox → aucun Payment opérationnel",
    iT1after?.paymentId === null &&
    (await prisma.payment.count({ where: { studentId: s1.id } })) === 0);
  check("pas de reçu fictif pour une intention sandbox",
    !(await prisma.payment.count({ where: { id: iT1after?.paymentId ?? "x" } })));

  // Échec sandbox.
  await prisma.paymentIntent.update({
    where: { id: winnerId }, data: { sandboxScript: { outcome: "FAILED", afterChecks: 0, checks: 0 } },
  });
  await pollPaymentIntent(pctx1, winnerId);
  check("échec sandbox → intention FAILED",
    (await prisma.paymentIntent.findUnique({ where: { id: winnerId } }))?.status === "FAILED");
  // Nouvelle tentative autorisée après échec.
  const retry = await createParentPaymentIntent(pctx1, {
    studentId: s1.id, feeInstallmentId: inst2.id, amount: 6_000,
    providerId: providerA, idempotencyKey: "g3c-retry", __sandboxOutcome: "PENDING",
  });
  check("nouvelle tentative après échec autorisée", retry.ok);
  const retryId = retry.ok ? retry.data.intentId : "";

  // Expiration puis confirmation tardive refusée.
  await prisma.paymentIntent.update({
    where: { id: retryId }, data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expireDuePaymentIntents({ userId: null, schoolId: school.id });
  check("expiration → EXPIRED",
    (await prisma.paymentIntent.findUnique({ where: { id: retryId } }))?.status === "EXPIRED");
  const latePoll = await pollPaymentIntent(pctx1, retryId);
  check("confirmation tardive après expiration → statut inchangé",
    latePoll.ok && latePoll.data.status === "EXPIRED" &&
    (await prisma.paymentIntent.findUnique({ where: { id: retryId } }))?.status === "EXPIRED");

  // Annulation interdite sur intention confirmée.
  const cancelConf = await cancelParentIntent(pctx1, idT1);
  check("annulation d'une intention confirmée → refusée", !cancelConf.ok);

  // ══════════ 4bis. LIBÉRATION / GUICHET CONCURRENT ══════════
  console.log("\n— Libération des montants réservés —");
  const inst3 = f3.installments[0];
  // Annulation → la réservation est libérée.
  const rel1 = await createParentPaymentIntent(pctx2, {
    studentId: s3.id, feeInstallmentId: inst3.id, amount: 2_000,
    providerId: providerA, idempotencyKey: "g3c-rel1", __sandboxOutcome: "PENDING",
  });
  check("intention active réduit le solde exigible",
    rel1.ok && (await getPayableInstallment(pctx2, s3.id, inst3.id))?.remaining === 5_000);
  await cancelParentIntent(pctx2, rel1.ok ? rel1.data.intentId : "");
  check("annulation → solde exigible libéré",
    (await getPayableInstallment(pctx2, s3.id, inst3.id))?.remaining === 7_000);
  // Échec → libération.
  const rel2 = await createParentPaymentIntent(pctx2, {
    studentId: s3.id, feeInstallmentId: inst3.id, amount: 3_000,
    providerId: providerA, idempotencyKey: "g3c-rel2", __sandboxOutcome: "FAILED",
  });
  const rel2Id = rel2.ok ? rel2.data.intentId : "";
  await pollPaymentIntent(pctx2, rel2Id);
  check("échec sandbox → solde exigible libéré",
    (await getPayableInstallment(pctx2, s3.id, inst3.id))?.remaining === 7_000);
  // Expiration → libération + rejeu possible.
  const rel3 = await createParentPaymentIntent(pctx2, {
    studentId: s3.id, feeInstallmentId: inst3.id, amount: 4_000,
    providerId: providerA, idempotencyKey: "g3c-rel3", __sandboxOutcome: "PENDING",
  });
  const rel3Id = rel3.ok ? rel3.data.intentId : "";
  await prisma.paymentIntent.update({
    where: { id: rel3Id }, data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expireDuePaymentIntents({ userId: null, schoolId: school.id });
  check("expiration → solde exigible libéré",
    (await getPayableInstallment(pctx2, s3.id, inst3.id))?.remaining === 7_000);
  const rel4 = await createParentPaymentIntent(pctx2, {
    studentId: s3.id, feeInstallmentId: inst3.id, amount: 2_000,
    providerId: providerA, idempotencyKey: "g3c-rel4", __sandboxOutcome: "PENDING",
  });
  check("rejeu après expiration autorisé", rel4.ok);
  const rel4Id = rel4.ok ? rel4.data.intentId : "";

  // Paiement au guichet pendant une intention parent active : le solde
  // affiché (7 000 − 2 000 en cours) devient caduc après l'encaissement.
  const cashPay = await recordPayment(ctxA, {
    studentId: s3.id, academicYearId: year.id, amount: 7_000,
    method: "CASH", allocations: [{ installmentId: inst3.id, amount: 7_000 }],
    idempotencyKey: "g3c-cash-s3",
  });
  check("encaissement guichet pendant intention parent (fixture)", cashPay.ok);
  const staleTry = await createParentPaymentIntent(pctx2, {
    studentId: s3.id, feeInstallmentId: inst3.id, amount: 2_000,
    providerId: providerA, idempotencyKey: "g3c-stale",
  });
  check("solde modifié entre affichage et confirmation → rejet",
    !staleTry.ok && (staleTry.error === "INSTALLMENT_PAID" || staleTry.error === "AMOUNT_EXCEEDS_BALANCE"));
  await cancelParentIntent(pctx2, rel4Id); // intention restée active en sandbox
  check("aucune double créance ni double encaissement",
    (await prisma.payment.count({ where: { studentId: s3.id } })) === 1);

  // ══════════ 5. SUIVI / HISTORIQUE / REÇUS ══════════
  console.log("\n— Suivi, historique, reçus —");
  const trk = await getParentIntent(pctx1, idT1);
  check("suivi : détail de sa propre intention", !!trk && trk.transactions.length > 0);
  check("suivi : intention d'un autre parent → null",
    (await getParentIntent(pctx2, idT1)) === null);
  check("suivi : intention via un parent d'une autre école → null",
    (await getParentIntent(pctxB, idT1)) === null);
  const tamperedId = idT1.endsWith("0") ? `${idT1.slice(0, -1)}1` : `${idT1.slice(0, -1)}0`;
  check("suivi : identifiant modifié → null",
    tamperedId !== idT1 && (await getParentIntent(pctx1, tamperedId)) === null);

  const hist = await listParentIntents(pctx1, s1.id);
  check("historique : intentions du parent listées",
    hist.length >= 3 && hist.every((i) => i.channel === "PARENT_PORTAL"));
  check("historique : vide pour un enfant non lié",
    (await listParentIntents(pctx1, s2.id)).length === 0);

  // Reçu : encaissement réel au guichet sur l'échéance de s2.
  const pay = await recordPayment(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 5_000,
    method: "CASH", allocations: [{ installmentId: f2.installments[0].id, amount: 5_000 }],
    idempotencyKey: "g3c-cash",
  });
  check("paiement guichet enregistré (fixture reçu)", pay.ok);
  const paymentId = pay.ok ? pay.result.id : "";
  const fin2 = await getChildFinances(pctx2, s2.id);
  check("reçu visible dans les finances du parent autorisé",
    !!fin2 && fin2.payments.some((p) => p.id === paymentId && !!p.receiptNumber));
  // Mêmes gardes que la route /parent/receipts/[id]/pdf.
  const receiptGuards = async (ctx: { userId: string; schoolId: string }) => {
    const p = await prisma.payment.findFirst({
      where: { id: paymentId, schoolId: ctx.schoolId, status: "VALIDATED" },
      select: { studentId: true, receiptSnapshot: true },
    });
    if (!p?.receiptSnapshot) return null;
    return (await verifyChildAccess(ctx, p.studentId)) ? p : null;
  };
  check("téléchargement reçu autorisé pour le parent lié", !!(await receiptGuards(pctx2)));
  check("téléchargement reçu refusé pour un parent non lié",
    (await receiptGuards(pctx1)) === null);
  check("téléchargement reçu refusé hors école",
    (await receiptGuards(pctxB)) === null);

  // Reçu d'un paiement non validé → refusé (même garde que la route PDF).
  const s3pay = await prisma.payment.findFirst({
    where: { studentId: s3.id }, select: { id: true },
  });
  await prisma.payment.update({ where: { id: s3pay!.id }, data: { status: "CANCELLED" } });
  const s3payGuard = await prisma.payment.findFirst({
    where: { id: s3pay!.id, schoolId: pctx2.schoolId, status: "VALIDATED" },
  });
  check("reçu d'un paiement non validé → refusé", s3payGuard === null);

  // Échéance soldée par le paiement guichet → plus payable.
  check("échéance soldée → non payable",
    (await getPayableInstallment(pctx2, s2.id, f2.installments[0].id))?.remaining === 0);
  const paidTry = await createParentPaymentIntent(pctx2, {
    studentId: s2.id, feeInstallmentId: f2.installments[0].id, amount: 1_000,
    providerId: providerA, idempotencyKey: "g3c-paid",
  });
  check("paiement d'une échéance soldée → INSTALLMENT_PAID",
    !paidTry.ok && paidTry.error === "INSTALLMENT_PAID");

  // Notification interne parent.
  await notifyParentIntentUpdate(pctx1, idT1, "Paiement confirmé (simulation)");
  const notif = await prisma.notification.findFirst({
    where: { schoolId: school.id, userId: parent1.id },
  });
  check("notification interne au parent créée", !!notif);

  // Isolation : le parent de l'école B voit ses propres données.
  const finB = await getChildFinances(pctxB, sB.id);
  check("école B : finances de l'enfant local", !!finB && finB.balance === 8_000);
  check("école B : aucun prestataire de l'école A exposé",
    (await listParentProviders(pctxB)).every((p) => p.id === providerB));

  // Zéro encaissement opérationnel issu d'intentions sandbox parentales.
  const opPayments = await prisma.payment.count({
    where: { schoolId: school.id, method: "MOBILE_MONEY" },
  });
  check("aucun encaissement Mobile Money opérationnel en sandbox", opPayments === 0);

  // ---------- Bilan ----------
  console.log(`\n═══ G3-C : ${pass} PASS / ${fail} FAIL ═══`);

  if (process.env.G3C_CLEANUP === "1") {
    await cleanup(school.id);
    await cleanup(schoolB.id);
    const us = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
    if (us.length) {
      await prisma.guardian.updateMany({ where: { userId: { in: us.map((u) => u.id) } }, data: { userId: null } });
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: us.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: us.map((u) => u.id) } } });
    }
    console.log("Fixtures supprimées.");
  }
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
