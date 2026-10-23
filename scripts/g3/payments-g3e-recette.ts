/**
 * Recette G3-E / Phase 1 — conformité du contrat d'adaptateur et des
 * barrières d'activation. Aucun appel réseau, aucun paiement réel.
 *
 * Couvre : registre (aucun adaptateur réel), capacités déclarées,
 * prestataire non configuré / désactivé / LIVE non activé, secret
 * absent, signature invalide, double confirmation, concurrence
 * guichet, paiement non imputable, repost idempotent, remboursement
 * via adaptateur (simulé), reversements simulés, rotation de secrets,
 * isolation inter-écoles.
 *
 * Usage : npx tsx scripts/g3/payments-g3e-recette.ts
 *         G3E_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { recordPayment } from "../../src/lib/services/finance/payments";
import {
  confirmIntent,
  createPaymentIntent,
  createPaymentProvider,
  markProviderCredentialsRotated,
  postConfirmedIntent,
  setProviderLive,
  setProviderRefundsEnabled,
} from "../../src/lib/services/payments/mobileIntents";
import {
  getProviderAdapter,
  listProviderAdapters,
  resolveProviderSecret,
  ProviderConfigError,
} from "../../src/lib/services/payments/providers";
import {
  createRefundRequest,
  approveRefund,
  executeRefund,
} from "../../src/lib/services/payments/refunds";
import { declareSettlement } from "../../src/lib/services/payments/reconciliation";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3E-FX";
const FX2 = "G3E-OTHER";
const EMAILS = ["g3e-admin@test.local", "g3e-adminb@test.local"];

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
    data: { email, passwordHash: "x", firstName: "G3E", lastName: email, status: "ACTIVE" },
  });
  const role = await prisma.role.create({ data: { name: `G3E_${email}`, scope: "SCHOOL", schoolId } });
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

async function postSandbox(ctx: { userId: string; schoolId: string }, intentId: string) {
  return confirmIntent(ctx, intentId, { postToLedger: true, __allowSandboxPosting: true });
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

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3e-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3e-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e" } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, name: "6e A", academicYearId: year.id, levelId: level.id },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  const admin = await makeMember("g3e-admin@test.local", school.id, [
    "payments.record", "mobilepayments.manage", "mobilepayments.reconcile", "mobilepayments.refund",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const adminB = await makeMember("g3e-adminb@test.local", schoolB.id, ["mobilepayments.manage"]);
  const ctxB = { userId: adminB.id, schoolId: schoolB.id };

  const mkStudent = async (mat: string) =>
    prisma.student.create({ data: { schoolId: school.id, matricule: mat, firstName: "Élève", lastName: mat, status: "ACTIVE" } });
  const enroll = (studentId: string) =>
    prisma.enrollment.create({
      data: { schoolId: school.id, studentId, academicYearId: year.id, classroomId: classroom.id, status: "ENROLLED", enrolledAt: new Date() },
    });
  const due = new Date(Date.now() + 30 * 86400_000);
  const chargeWith = async (studentId: string, amounts: number[]) => {
    const charge = await prisma.studentFeeCharge.create({
      data: { schoolId: school.id, studentId, academicYearId: year.id, categoryId: cat.id, amount: amounts.reduce((s, a) => s + a, 0) },
    });
    const installments = [];
    for (const a of amounts) {
      installments.push(await prisma.feeInstallment.create({
        data: { schoolId: school.id, chargeId: charge.id, studentId, academicYearId: year.id, dueDate: due, amount: a, label: "T" },
      }));
    }
    return { charge, installments };
  };
  const mkIntent = async (studentId: string, amount: number, providerId: string, extra: {
    feeInstallmentId?: string;
    allocations?: { installmentId: string; amount: number }[];
    sandboxOutcome?: "SUCCESS" | "PENDING";
  } = {}) => {
    const r = await createPaymentIntent(ctxA, {
      studentId, academicYearId: year.id, providerId, amount, currency: "XOF",
      channel: "ADMIN_TEST", feeInstallmentId: extra.feeInstallmentId,
      allocations: extra.allocations, sandboxOutcome: extra.sandboxOutcome ?? "SUCCESS",
    });
    return r;
  };

  // ══════════ 1. REGISTRE & CAPACITÉS ══════════
  console.log("\n— Registre et capacités déclarées —");
  const adapters = listProviderAdapters();
  check("aucun adaptateur réel enregistré (SANDBOX seul)",
    adapters.length === 1 && adapters[0].code === "SANDBOX");
  const sb = getProviderAdapter("SANDBOX")!;
  check("capacités déclarées et cohérentes avec les méthodes",
    sb.capabilities.initiate && sb.capabilities.pollStatus && sb.capabilities.webhooks &&
    sb.capabilities.refunds === !!sb.initiateRefund &&
    sb.capabilities.settlements === !!sb.fetchSettlements);
  check("adaptateur inconnu → null", getProviderAdapter("ORANGE_MONEY") === null);

  // ══════════ 2. CONFIGURATION & GATES ══════════
  console.log("\n— Configuration par école et barrières —");
  const pA = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Simu A", mode: "SANDBOX" });
  const providerA = pA.ok ? pA.data.id : "";
  check("prestataire sandbox créé", !!providerA);
  check("SANDBOX en mode LIVE refusé à la création",
    !(await createPaymentProvider(ctxA, { code: "SANDBOX", label: "x", mode: "LIVE" })).ok);
  check("code non sandbox en mode SANDBOX refusé",
    !(await createPaymentProvider(ctxA, { code: "FAKE", label: "x", mode: "SANDBOX" })).ok);
  check("LIVE sans adaptateur refusé à la création",
    !(await createPaymentProvider(ctxA, { code: "ORANGE_MONEY", label: "x", mode: "LIVE" })).ok);

  const s1 = await mkStudent("G3E-S1");
  await enroll(s1.id);
  const f1 = await chargeWith(s1.id, [10_000]);

  // Prestataire non configuré.
  const noProv = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, providerId: "inexistant",
    amount: 1_000, currency: "XOF", channel: "ADMIN_TEST",
  });
  check("prestataire non configuré → UNKNOWN_PROVIDER", !noProv.ok && noProv.error === "UNKNOWN_PROVIDER");

  // Prestataire archivé.
  const archP = await prisma.paymentProvider.create({
    data: { schoolId: school.id, code: "ARCH", label: "Archivé", mode: "SANDBOX", status: "ARCHIVED" },
  });
  const arch = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, providerId: archP.id,
    amount: 1_000, currency: "XOF", channel: "ADMIN_TEST",
  });
  check("prestataire archivé → PROVIDER_INACTIVE", !arch.ok && arch.error === "PROVIDER_INACTIVE");

  // LIVE sans activation contrôlée.
  const liveP = await prisma.paymentProvider.create({
    data: { schoolId: school.id, code: "LIVETEST", label: "Live test", mode: "LIVE" },
  });
  const notLive = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, providerId: liveP.id,
    amount: 1_000, currency: "XOF", channel: "ADMIN_TEST",
  });
  check("LIVE sans liveEnabled → PROVIDER_NOT_LIVE (avant lookup adaptateur)",
    !notLive.ok && notLive.error === "PROVIDER_NOT_LIVE");

  // Activation contrôlée : impossible sans adaptateur.
  const enFail = await setProviderLive(ctxA, liveP.id, true);
  check("activation LIVE sans adaptateur → PROVIDER_UNAVAILABLE",
    !enFail.ok && enFail.error === "PROVIDER_UNAVAILABLE");

  // Activation réussie : fixture directe d'un provider en mode LIVE
  // (createPaymentProvider refuse SANDBOX+LIVE — la couche service
  // setProviderLive est testée ici sur sa seule condition d'adapter).
  const liveDirect = await prisma.paymentProvider.create({
    data: { schoolId: schoolB.id, code: "SANDBOX", label: "Live B", mode: "LIVE" },
  });
  const enB = await setProviderLive(ctxB, liveDirect.id, true);
  check("activation LIVE contrôlée → ok + traçabilité",
    enB.ok && (await prisma.paymentProvider.findUnique({ where: { id: liveDirect.id } }))?.liveEnabledById === adminB.id);
  const disB = await setProviderLive(ctxB, liveDirect.id, false);
  check("désactivation LIVE immédiate + idempotente",
    disB.ok && (await prisma.paymentProvider.findUnique({ where: { id: liveDirect.id } }))?.liveEnabled === false);
  check("activation sur prestataire SANDBOX (non-LIVE) → INVALID_STATE",
    !(await setProviderLive(ctxA, providerA, true)).ok);

  // Rotation de secrets tracée (valeur posée hors application).
  const rot = await markProviderCredentialsRotated(ctxA, providerA);
  check("rotation de secrets consignée",
    rot.ok && !!(await prisma.paymentProvider.findUnique({ where: { id: providerA } }))?.credentialsRotatedAt);

  // ══════════ 3. SECRETS & SIGNATURE ══════════
  console.log("\n— Secrets et signature —");
  let cfgErr: unknown = null;
  try { resolveProviderSecret({ credentialsRef: null }, "credentials"); } catch (e) { cfgErr = e; }
  check("référence absente → ProviderConfigError", cfgErr instanceof ProviderConfigError);
  cfgErr = null;
  try { resolveProviderSecret({ webhookSecretRef: "ENV_INEXISTANTE_G3E" }, "webhook"); } catch (e) { cfgErr = e; }
  check("variable d'env absente → ProviderConfigError", cfgErr instanceof ProviderConfigError);
  process.env.G3E_TMP_SECRET = "s3cr3t";
  check("secret résolu uniquement en mémoire", resolveProviderSecret({ webhookSecretRef: "G3E_TMP_SECRET" }, "webhook") === "s3cr3t");
  delete process.env.G3E_TMP_SECRET;

  const badSig = sb.verifyWebhook!({
    rawBody: JSON.stringify({ eventId: "e1", intentRef: "x", status: "SUCCESS" }),
    headers: { "x-sandbox-timestamp": String(Math.floor(Date.now() / 1000)), "x-sandbox-signature": "deadbeef" },
    secret: "s3cr3t",
  });
  check("signature invalide → INVALID_SIGNATURE", !badSig.ok && badSig.error === "INVALID_SIGNATURE");
  const staleSig = sb.verifyWebhook!({
    rawBody: "{}", headers: { "x-sandbox-timestamp": "1", "x-sandbox-signature": "x" }, secret: "s3cr3t",
  });
  check("signature expirée → EXPIRED", !staleSig.ok && staleSig.error === "EXPIRED");

  // ══════════ 4. CYCLE DE VIE : confirmations, concurrence, repost ══════════
  console.log("\n— Confirmations, concurrence guichet, repost —");
  const i1 = (await mkIntent(s1.id, 5_000, providerA, {
    feeInstallmentId: f1.installments[0].id,
    allocations: [{ installmentId: f1.installments[0].id, amount: 5_000 }],
  }));
  const i1Id = i1.ok ? i1.data.intentId : "";
  const conf1 = await postSandbox(ctxA, i1Id);
  const conf2 = await postSandbox(ctxA, i1Id);
  check("posting → CONFIRMED + paymentId", conf1.ok && !!conf1.data.paymentId);
  check("double confirmation idempotente",
    conf2.ok && conf1.ok === true && conf2.data.paymentId === conf1.data.paymentId);

  const paymentCount1 = await prisma.payment.count({ where: { schoolId: school.id } });
  check("un seul encaissement malgré le rejeu", paymentCount1 === 1);

  // Guichet concurrent : l'échéance 5 000 restante est déjà partiellement
  // couverte — un guichet la solde, l'intention suivante est bloquée.
  const s2 = await mkStudent("G3E-S2");
  await enroll(s2.id);
  const f2 = await chargeWith(s2.id, [8_000]);
  const i2 = (await mkIntent(s2.id, 6_000, providerA, {
    feeInstallmentId: f2.installments[0].id,
    allocations: [{ installmentId: f2.installments[0].id, amount: 6_000 }],
  }));
  const i2Id = i2.ok ? i2.data.intentId : "";
  await recordPayment(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 8_000, method: "CASH",
    allocations: [{ installmentId: f2.installments[0].id, amount: 8_000 }],
  });
  const blocked = await postSandbox(ctxA, i2Id);
  const intent2 = await prisma.paymentIntent.findUnique({ where: { id: i2Id } });
  check("guichet soldé → OVERPAYMENT_BLOCKED", !blocked.ok && blocked.error === "OVERPAYMENT_BLOCKED");
  check("confirmation conservée + anomalie, aucune double allocation",
    intent2?.status === "CONFIRMED" && intent2.paymentId === null &&
    (await prisma.paymentDiscrepancy.count({ where: { intentId: i2Id, type: "OVERPAYMENT_BLOCKED" } })) === 1);

  // Repost idempotent : paiement créé sous mm:{intentId} (crash simulé)
  // → le repost le rattache sans recréer.
  const s3 = await mkStudent("G3E-S3");
  await enroll(s3.id);
  const f3 = await chargeWith(s3.id, [4_000]);
  const i3 = (await mkIntent(s3.id, 4_000, providerA, {
    feeInstallmentId: f3.installments[0].id,
    allocations: [{ installmentId: f3.installments[0].id, amount: 4_000 }],
  }));
  const i3Id = i3.ok ? i3.data.intentId : "";
  await confirmIntent(ctxA, i3Id, { postToLedger: false });
  await prisma.paymentIntent.update({ where: { id: i3Id }, data: { status: "CONFIRMED" } });
  const orphan = await recordPayment(ctxA, {
    studentId: s3.id, academicYearId: year.id, amount: 4_000, method: "MOBILE_MONEY",
    idempotencyKey: `mm:${i3Id}`,
    allocations: [{ installmentId: f3.installments[0].id, amount: 4_000 }],
  });
  const repost = await postConfirmedIntent(ctxA, i3Id, { __allowSandboxPosting: true });
  check("repost idempotent : rattache l'encaissement existant",
    repost.ok && orphan.ok && repost.data.paymentId === orphan.result.id);
  check("aucun doublon d'encaissement après repost",
    (await prisma.payment.count({ where: { schoolId: school.id, idempotencyKey: `mm:${i3Id}` } })) === 1);

  // ══════════ 5. REMBOURSEMENTS VIA ADAPTATEUR ══════════
  console.log("\n— Remboursements via adaptateur (simulés) —");
  // Capacité non déclarée → activation impossible.
  const noRf = await prisma.paymentProvider.create({
    data: { schoolId: school.id, code: "NOREFUND", label: "x", mode: "LIVE" },
  });
  const noRfRes = await setProviderRefundsEnabled(ctxA, noRf.id, true);
  check("activer remb. API sans capacité → REFUND_UNSUPPORTED",
    !noRfRes.ok && noRfRes.error === "REFUND_UNSUPPORTED");
  // Activation sur SANDBOX (capacité déclarée).
  check("activer remb. API sur adaptateur capable → ok",
    (await setProviderRefundsEnabled(ctxA, providerA, true)).ok);
  check("réactivation idempotente", (await setProviderRefundsEnabled(ctxA, providerA, true)).ok);

  const payment1 = (await prisma.paymentIntent.findUnique({ where: { id: i1Id } }))!.paymentId!;
  const rf = await createRefundRequest(ctxA, { paymentId: payment1, amount: 1_000, reason: "Test adaptateur" });
  const rfId = rf.ok ? rf.data.id : "";
  await approveRefund(ctxA, rfId);
  const ex = await executeRefund(ctxA, rfId);
  const rfAfter = await prisma.paymentRefund.findUnique({ where: { id: rfId } });
  check("exécution via adaptateur → EXECUTED + référence SIMREF-",
    ex.ok && rfAfter?.status === "EXECUTED" && (rfAfter.providerRef ?? "").startsWith("SIMREF-"));

  // Scénario d'échec piloté par le script de l'intention.
  const s4 = await mkStudent("G3E-S4");
  await enroll(s4.id);
  const f4 = await chargeWith(s4.id, [6_000]);
  const i4 = (await mkIntent(s4.id, 6_000, providerA, {
    feeInstallmentId: f4.installments[0].id,
    allocations: [{ installmentId: f4.installments[0].id, amount: 6_000 }],
  }));
  const i4Id = i4.ok ? i4.data.intentId : "";
  await postSandbox(ctxA, i4Id);
  await prisma.paymentIntent.update({
    where: { id: i4Id },
    data: { sandboxScript: { outcome: "SUCCESS", refundOutcome: "FAILED" } },
  });
  const payment4 = (await prisma.paymentIntent.findUnique({ where: { id: i4Id } }))!.paymentId!;
  const rfF = await createRefundRequest(ctxA, { paymentId: payment4, amount: 500, reason: "Échec adaptateur" });
  const rfFId = rfF.ok ? rfF.data.id : "";
  await approveRefund(ctxA, rfFId);
  await executeRefund(ctxA, rfFId);
  check("scénario refundOutcome=FAILED → FAILED via adaptateur",
    (await prisma.paymentRefund.findUnique({ where: { id: rfFId } }))?.status === "FAILED");

  // Sans refundsEnabled → chemin simulé historique conservé.
  await setProviderRefundsEnabled(ctxA, providerA, false);
  const s5 = await mkStudent("G3E-S5");
  await enroll(s5.id);
  const f5 = await chargeWith(s5.id, [3_000]);
  const i5 = (await mkIntent(s5.id, 3_000, providerA, {
    feeInstallmentId: f5.installments[0].id,
    allocations: [{ installmentId: f5.installments[0].id, amount: 3_000 }],
  }));
  const i5Id = i5.ok ? i5.data.intentId : "";
  await postSandbox(ctxA, i5Id);
  const payment5 = (await prisma.paymentIntent.findUnique({ where: { id: i5Id } }))!.paymentId!;
  const rfL = await createRefundRequest(ctxA, { paymentId: payment5, amount: 300, reason: "Chemin historique" });
  const rfLId = rfL.ok ? rfL.data.id : "";
  await approveRefund(ctxA, rfLId);
  const exL = await executeRefund(ctxA, rfLId);
  check("sans refundsEnabled → SIMREF- historique conservé",
    exL.ok && exL.data.providerRef?.startsWith("SIMREF-") === true);
  await setProviderRefundsEnabled(ctxA, providerA, true);

  // ══════════ 6. REVERSEMENTS SIMULÉS ══════════
  console.log("\n— Reversements simulés (fetchSettlements) —");
  const report = await sb.fetchSettlements!({
    periodStart: "2026-10-01", periodEnd: "2026-10-31",
    sandboxScript: {
      outcome: "SUCCESS",
      settlements: [
        { reference: "SET-1", periodStart: "2026-10-01", periodEnd: "2026-10-31", grossAmount: 20_000, feeTotal: 400, netAmount: 19_600, items: [{ providerTxId: "SBTX-1", grossAmount: 20_000, feeAmount: 400 }] },
        { reference: "SET-2", periodStart: "2026-11-01", periodEnd: "2026-11-30", grossAmount: 5_000, feeTotal: 100, netAmount: 4_900, items: [] },
      ],
    },
  });
  check("décompte injecté renvoyé (référence, totaux)",
    report.reference === "SET-1" && report.netAmount === 19_600);
  check("pagination : nextCursor vers le second décompte", report.nextCursor === "1");
  const page2 = await sb.fetchSettlements!({
    periodStart: "2026-10-01", periodEnd: "2026-11-30", cursor: report.nextCursor,
    sandboxScript: {
      outcome: "SUCCESS",
      settlements: [
        { reference: "SET-1", periodStart: "a", periodEnd: "b", grossAmount: 1, feeTotal: 0, netAmount: 1, items: [] },
        { reference: "SET-2", periodStart: "a", periodEnd: "b", grossAmount: 2, feeTotal: 0, netAmount: 2, items: [] },
      ],
    },
  });
  check("seconde page + fin de série", page2.reference === "SET-2" && page2.nextCursor === null);
  const empty = await sb.fetchSettlements!({ periodStart: "2026-10-01", periodEnd: "2026-10-31" });
  check("décompte vide déterministe sans scénario", empty.items.length === 0 && empty.netAmount === 0);

  // Reversement incohérent déclaré → anomalie (régression G3-D).
  const incoh = await declareSettlement(ctxA, {
    providerId: providerA, reference: "G3E-INCOH",
    periodStart: new Date(Date.now() - 86400_000), periodEnd: new Date(),
    netDeclared: 999_999,
  });
  check("reversement incohérent → écart détecté",
    incoh.ok && (await prisma.paymentDiscrepancy.count({
      where: { schoolId: school.id, settlement: { reference: "G3E-INCOH" } },
    })) >= 1);

  // ══════════ 7. ISOLATION & AUDIT ══════════
  console.log("\n— Isolation et audit —");
  check("prestataire école A invisible côté école B",
    !(await createPaymentIntent(ctxB, {
      studentId: s1.id, academicYearId: year.id, providerId: providerA,
      amount: 100, currency: "XOF", channel: "ADMIN_TEST",
    })).ok);
  const acts = new Set((await prisma.auditLog.findMany({
    where: { schoolId: school.id }, select: { action: true },
  })).map((a) => a.action));
  check("audit : activation/désactivation LIVE tracée (école B)",
    (await prisma.auditLog.count({ where: { schoolId: schoolB.id, action: "payment_provider.live_enabled" } })) === 1);
  check("audit : rotation de secrets tracée", acts.has("payment_provider.credentials_rotated"));
  check("audit : activation remboursements tracée", acts.has("payment_provider.refunds_enabled"));

  // ---------- Bilan ----------
  console.log(`\n═══ G3-E : ${pass} PASS / ${fail} FAIL ═══`);
  if (process.env.G3E_CLEANUP === "1" || fail === 0) {
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
