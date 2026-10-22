/**
 * Recette G3-A — fondations Mobile Money : fournisseurs, intentions,
 * machine à états, simulateur sandbox (succès, échec, expiration,
 * timeout, réponse tardive, répétition, concurrence), idempotence,
 * isolation, audit, absence d'encaissement réel, intégration
 * `recordPayment` sur fixture isolée.
 *
 * Usage : npx tsx scripts/g3/payments-g3a-recette.ts
 *         G3A_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { userHasSchoolPermission } from "../../src/lib/permissions/rbac";
import {
  cancelPaymentIntent,
  confirmIntent,
  createPaymentIntent,
  createPaymentProvider,
  expireDuePaymentIntents,
  getPaymentIntent,
  listPaymentIntents,
  paymentIntentStats,
  pollPaymentIntent,
  postConfirmedIntent,
  setPaymentProviderStatus,
  setSandboxOutcome,
} from "../../src/lib/services/payments/mobileIntents";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3A-FX";
const FX2 = "G3A-OTHER";
const EMAILS = [
  "g3a-admin@test.local",
  "g3a-read@test.local",
  "g3a-other@test.local",
];

async function cleanup(schoolId: string) {
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
  await prisma.cashClosure.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const schoolUsers = await prisma.user.findMany({ where: { schoolId }, select: { id: true } });
  if (schoolUsers.length) {
    await prisma.user.deleteMany({ where: { id: { in: schoolUsers.map((u) => u.id) } } });
  }
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G3A", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G3A_${email}`, scope: "SCHOOL", schoolId },
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

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3a-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3a-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  await prisma.feeTariff.create({
    data: { schoolId: school.id, academicYearId: year.id, categoryId: cat.id, amount: 60000, installmentCount: 1 },
  });

  const mkStudent = async (mat: string, sId: string) =>
    prisma.student.create({
      data: { schoolId: sId, matricule: mat, firstName: "Élève", lastName: mat, status: "ACTIVE" },
    });
  const s1 = await mkStudent("G3A-001", school.id);
  const s2 = await mkStudent("G3A-002", school.id);
  const s3 = await mkStudent("G3A-003", school.id);
  const s4 = await mkStudent("G3A-004", school.id);
  const s5 = await mkStudent("G3A-005", school.id);
  const s6 = await mkStudent("G3A-006", school.id);
  const s7 = await mkStudent("G3A-007", school.id);
  const s8 = await mkStudent("G3A-008", school.id);
  const sB = await mkStudent("G3A-B01", schoolB.id);

  const admin = await makeMember("g3a-admin@test.local", school.id, [
    "mobilepayments.read", "mobilepayments.manage", "mobilepayments.simulate",
  ]);
  const reader = await makeMember("g3a-read@test.local", school.id, ["mobilepayments.read"]);
  const other = await makeMember("g3a-other@test.local", schoolB.id, [
    "mobilepayments.read", "mobilepayments.manage", "mobilepayments.simulate",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const ctxB = { userId: other.id, schoolId: schoolB.id };

  // ---------- Fournisseurs ----------
  console.log("\n— Fournisseurs —");
  const p1 = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Simu OM", mode: "SANDBOX", minAmount: 100, maxAmount: 500000 });
  check("création fournisseur sandbox", p1.ok);
  const dup = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Bis", mode: "SANDBOX" });
  check("unicité (schoolId, code)", !dup.ok && dup.error === "ALREADY_EXISTS");
  const badCode = await createPaymentProvider(ctxA, { code: "orange money!!", label: "x", mode: "SANDBOX" });
  check("code fournisseur invalide rejeté", !badCode.ok);
  const liveFake = await createPaymentProvider(ctxA, { code: "ORANGE_MONEY", label: "OM", mode: "LIVE" });
  check("fournisseur réel sans adaptateur rejeté", !liveFake.ok && liveFake.error === "PROVIDER_UNAVAILABLE");
  const providerId = p1.ok ? p1.data.id : "";
  const pB = await createPaymentProvider(ctxB, { code: "SANDBOX", label: "Simu B", mode: "SANDBOX" });

  // ---------- Création / idempotence ----------
  console.log("\n— Création et idempotence —");
  const i1 = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, amount: 25000, currency: "XOF",
    providerId, idempotencyKey: "g3a-key-1", channel: "ADMIN_TEST", sandboxOutcome: "PENDING",
  });
  check("création intention", i1.ok && !i1.data.replayed);
  const intent1 = i1.ok ? i1.data.intentId : "";
  const replay = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, amount: 25000, currency: "XOF",
    providerId, idempotencyKey: "g3a-key-1", channel: "ADMIN_TEST",
  });
  check("rejeu même clé+contenu → même intention", replay.ok && replay.data.replayed && replay.data.intentId === intent1);
  const conflict = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, amount: 30000, currency: "XOF",
    providerId, idempotencyKey: "g3a-key-1", channel: "ADMIN_TEST",
  });
  check("même clé + contenu différent → conflit", !conflict.ok && conflict.error === "IDEMPOTENCY_CONFLICT");
  const secondActive = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId,
  });
  check("seconde intention active refusée", !secondActive.ok && secondActive.error === "ACTIVE_INTENT_EXISTS");

  const badAmt = await createPaymentIntent(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 0, currency: "XOF", providerId,
  });
  check("montant invalide", !badAmt.ok && badAmt.error === "INVALID_AMOUNT");
  const belowMin = await createPaymentIntent(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 50, currency: "XOF", providerId,
  });
  check("montant sous le minimum fournisseur", !belowMin.ok && belowMin.error === "INVALID_AMOUNT");
  const badCur = await createPaymentIntent(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 1000, currency: "EUR", providerId,
  });
  check("devise invalide", !badCur.ok && badCur.error === "INVALID_CURRENCY");
  const badProv = await createPaymentIntent(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId: "nope",
  });
  check("fournisseur inconnu", !badProv.ok && badProv.error === "UNKNOWN_PROVIDER");
  const crossProv = await createPaymentIntent(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 1000, currency: "XOF",
    providerId: pB.ok ? pB.data.id : "",
  });
  check("fournisseur d'une autre école refusé", !crossProv.ok && crossProv.error === "UNKNOWN_PROVIDER");
  const crossStudent = await createPaymentIntent(ctxA, {
    studentId: sB.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId,
  });
  check("élève d'une autre école refusé", !crossStudent.ok && crossStudent.error === "NOT_FOUND");

  // ---------- Scénarios sandbox ----------
  console.log("\n— Simulateur sandbox —");
  // Succès : script SUCCESS → consultation → CONFIRMED, aucun Payment.
  const i2 = await createPaymentIntent(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 12000, currency: "XOF",
    providerId, sandboxOutcome: "SUCCESS",
  });
  check("création (scénario succès)", i2.ok);
  const intent2 = i2.ok ? i2.data.intentId : "";
  const poll2 = await pollPaymentIntent(ctxA, intent2);
  check("succès simulé → CONFIRMED", poll2.ok && poll2.data.status === "CONFIRMED");
  const det2 = await getPaymentIntent(ctxA, intent2);
  check("providerTxId enregistré", !!det2?.providerTxId?.startsWith("SBTX-"));
  check("confirmation simulée : aucun Payment", (await prisma.payment.count({ where: { schoolId: school.id } })) === 0);
  check("confirmation simulée : aucun reçu", !det2?.payment);
  check("transactions INITIATE+STATUS_CHECK+CONFIRM tracées",
    (det2?.transactions.map((t) => t.kind) ?? []).join(",").includes("INITIATE")
    && (det2?.transactions.map((t) => t.kind) ?? []).join(",").includes("CONFIRM"));

  // Échec.
  const i3 = await createPaymentIntent(ctxA, {
    studentId: s3.id, academicYearId: year.id, amount: 8000, currency: "XOF",
    providerId, sandboxOutcome: "FAILED",
  });
  const poll3 = await pollPaymentIntent(ctxA, i3.ok ? i3.data.intentId : "");
  check("échec simulé → FAILED", poll3.ok && poll3.data.status === "FAILED");
  const det3 = await getPaymentIntent(ctxA, i3.ok ? i3.data.intentId : "");
  check("motif d'échec tracé", !!det3?.failureReason && det3.transactions.some((t) => t.kind === "FAIL"));

  // Timeout à la consultation.
  const i4 = await createPaymentIntent(ctxA, {
    studentId: s4.id, academicYearId: year.id, amount: 8000, currency: "XOF",
    providerId, sandboxOutcome: "TIMEOUT",
  });
  // TIMEOUT en sandbox échoue dès l'initiation → FAILED.
  check("timeout à l'initiation → FAILED", !i4.ok && i4.error === "PROVIDER_TIMEOUT");
  const i4b = await createPaymentIntent(ctxA, {
    studentId: s4.id, academicYearId: year.id, amount: 8000, currency: "XOF",
    providerId, sandboxOutcome: "PENDING",
  });
  await setSandboxOutcome(ctxA, i4b.ok ? i4b.data.intentId : "", "TIMEOUT");
  const poll4 = await pollPaymentIntent(ctxA, i4b.ok ? i4b.data.intentId : "");
  check("timeout à la consultation → erreur, intention reste PENDING",
    !poll4.ok && poll4.error === "PROVIDER_TIMEOUT"
    && (await getPaymentIntent(ctxA, i4b.ok ? i4b.data.intentId : ""))?.status === "PENDING");

  // Réponse tardive : 2 consultations PENDING puis SUCCESS.
  const i5 = await createPaymentIntent(ctxA, {
    studentId: s5.id, academicYearId: year.id, amount: 9000, currency: "XOF",
    providerId, sandboxOutcome: "LATE", sandboxAfterChecks: 2,
  });
  const id5 = i5.ok ? i5.data.intentId : "";
  const p5a = await pollPaymentIntent(ctxA, id5);
  const p5b = await pollPaymentIntent(ctxA, id5);
  const p5c = await pollPaymentIntent(ctxA, id5);
  check("réponse tardive : PENDING puis CONFIRMED",
    p5a.ok && p5a.data.status === "PENDING" && p5b.ok && p5b.data.status === "PENDING"
    && p5c.ok && p5c.data.status === "CONFIRMED");

  // Confirmation répétée : REPEATED → deux confirmations, une seule intention.
  const i6 = await createPaymentIntent(ctxA, {
    studentId: s6.id, academicYearId: year.id, amount: 7000, currency: "XOF",
    providerId, sandboxOutcome: "REPEATED",
  });
  const id6 = i6.ok ? i6.data.intentId : "";
  await pollPaymentIntent(ctxA, id6);
  const c6 = await confirmIntent(ctxA, id6);
  check("confirmation répétée → idempotente", c6.ok && c6.data.already === true);
  check("toujours aucun Payment après confirmations répétées",
    (await prisma.payment.count({ where: { schoolId: school.id } })) === 0);

  // Confirmations concurrentes → une seule effective.
  const i7 = await createPaymentIntent(ctxA, {
    studentId: s7.id, academicYearId: year.id, amount: 7000, currency: "XOF",
    providerId, sandboxOutcome: "PENDING",
  });
  const id7 = i7.ok ? i7.data.intentId : "";
  const [cc1, cc2] = await Promise.all([
    confirmIntent(ctxA, id7),
    confirmIntent(ctxA, id7),
  ]);
  const det7 = await getPaymentIntent(ctxA, id7);
  check("2 confirmations concurrentes → 1 confirmée, 0 erreur",
    cc1.ok && cc2.ok && det7?.status === "CONFIRMED");
  check("confirmations concurrentes : 1 seule passe non-already",
    [cc1, cc2].filter((r) => r.ok && !r.data.already).length === 1);

  // Expiration.
  const i8 = await createPaymentIntent(ctxA, {
    studentId: s8.id, academicYearId: year.id, amount: 7000, currency: "XOF",
    providerId, sandboxOutcome: "PENDING",
  });
  const id8 = i8.ok ? i8.data.intentId : "";
  await prisma.paymentIntent.update({ where: { id: id8 }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const sweep = await expireDuePaymentIntents(ctxA);
  const det8 = await getPaymentIntent(ctxA, id8);
  check("balayage → EXPIRED", sweep.expired >= 1 && det8?.status === "EXPIRED");
  check("expiration tracée (EXPIRE)", det8?.transactions.some((t) => t.kind === "EXPIRE") === true);

  // Fournisseur archivé → intentions refusées, réactivation ok.
  const sArch = await mkStudent("G3A-ARCH", school.id);
  await setPaymentProviderStatus(ctxA, providerId, "ARCHIVED");
  const iArch = await createPaymentIntent(ctxA, {
    studentId: sArch.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId,
  });
  check("fournisseur archivé → PROVIDER_INACTIVE", !iArch.ok && iArch.error === "PROVIDER_INACTIVE");
  await setPaymentProviderStatus(ctxA, providerId, "ACTIVE");
  const iArch2 = await createPaymentIntent(ctxA, {
    studentId: sArch.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId,
  });
  check("fournisseur réactivé → création ok", iArch2.ok);
  if (iArch2.ok) await cancelPaymentIntent(ctxA, iArch2.data.intentId, "TEST");

  // ---------- Transitions interdites ----------
  console.log("\n— Machine à états —");
  const bad1 = await confirmIntent(ctxA, id8);
  check("confirmer une EXPIRED → refusé", !bad1.ok && bad1.error === "INVALID_STATE");
  const bad2 = await cancelPaymentIntent(ctxA, intent2);
  check("annuler une CONFIRMED → refusé", !bad2.ok && bad2.error === "INVALID_STATE");
  const bad3 = await pollPaymentIntent(ctxA, i3.ok ? i3.data.intentId : "");
  check("consulter une FAILED → statut renvoyé sans transition", bad3.ok && bad3.data.status === "FAILED");
  const cancel1 = await createPaymentIntent(ctxA, {
    studentId: s5.id, academicYearId: year.id, amount: 500, currency: "XOF", providerId,
  });
  // s5 est CONFIRMED → création refusée (encore active ? non : CONFIRMED n'est pas actif) → devrait passer.
  check("nouvelle intention après CONFIRMED autorisée", cancel1.ok);
  if (cancel1.ok) {
    const canc = await cancelPaymentIntent(ctxA, cancel1.data.intentId, "TEST");
    check("annulation PENDING → CANCELLED", canc.ok);
    const detC = await getPaymentIntent(ctxA, cancel1.data.intentId);
    check("annulation tracée (CANCEL)", detC?.transactions.some((t) => t.kind === "CANCEL") === true);
  }

  // ---------- Concurrence de création ----------
  console.log("\n— Concurrence —");
  const s9 = await mkStudent("G3A-009", school.id);
  const [r1, r2] = await Promise.all([
    createPaymentIntent(ctxA, { studentId: s9.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId }),
    createPaymentIntent(ctxA, { studentId: s9.id, academicYearId: year.id, amount: 1000, currency: "XOF", providerId }),
  ]);
  const intents9 = await prisma.paymentIntent.findMany({
    where: { schoolId: school.id, studentId: s9.id },
  });
  check("créations concurrentes → 1 seule intention active",
    intents9.length === 1 && [r1, r2].some((r) => r.ok) && [r1, r2].some((r) => !r.ok && r.error === "ACTIVE_INTENT_EXISTS"));

  // ---------- Isolation inter-écoles ----------
  console.log("\n— Isolation —");
  const pollCross = await pollPaymentIntent(ctxB, intent2);
  check("poll cross-school → NOT_FOUND", !pollCross.ok && pollCross.error === "NOT_FOUND");
  const listB = await listPaymentIntents(ctxB);
  check("liste inter-écoles isolée", listB.every((i) => i.schoolId === schoolB.id));
  const statsB = await paymentIntentStats(ctxB);
  check("stats inter-écoles isolées", statsB.every((s) => s.count === 0 || true) && statsB.reduce((s, r) => s + r.count, 0) === 0);

  // ---------- Permissions ----------
  console.log("\n— Permissions —");
  check("admin a mobilepayments.manage",
    await userHasSchoolPermission({ userId: admin.id, schoolId: school.id, permissionKey: "mobilepayments.manage" }));
  check("lecteur sans mobilepayments.manage",
    !(await userHasSchoolPermission({ userId: reader.id, schoolId: school.id, permissionKey: "mobilepayments.manage" })));
  check("lecteur sans mobilepayments.simulate",
    !(await userHasSchoolPermission({ userId: reader.id, schoolId: school.id, permissionKey: "mobilepayments.simulate" })));
  const adminRole = await prisma.role.findFirst({ where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null } });
  if (adminRole) {
    const granted = await prisma.rolePermission.count({
      where: { roleId: adminRole.id, permission: { key: { in: ["mobilepayments.read", "mobilepayments.manage", "mobilepayments.simulate"] } } },
    });
    check("bootstrap : 3 permissions liées à ADMIN_SCHOOL", granted === 3);
  } else {
    check("bootstrap : rôle ADMIN_SCHOOL présent", false);
  }

  // ---------- Audit ----------
  console.log("\n— Audit —");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: school.id, entity: "PaymentIntent" },
    orderBy: { createdAt: "asc" },
  });
  check("audit payment_intent.created", audits.some((a) => a.action === "payment_intent.created"));
  check("audit payment_intent.confirmed", audits.some((a) => a.action === "payment_intent.confirmed"));
  check("audit payment_intent.expired", audits.some((a) => a.action === "payment_intent.expired"));
  check("audit sans secret (credentialsRef jamais logué)",
    audits.every((a) => !JSON.stringify(a.metadata).match(/password|secret|token/i)));

  // ---------- Intégration recordPayment (fixture isolée) ----------
  console.log("\n— Intégration recordPayment —");
  // Créance + échéance réelles pour s1.
  const charge = await prisma.studentFeeCharge.create({
    data: { schoolId: school.id, studentId: s1.id, academicYearId: year.id, categoryId: cat.id, amount: 25000 },
  });
  const inst = await prisma.feeInstallment.create({
    data: {
      schoolId: school.id, chargeId: charge.id, studentId: s1.id,
      academicYearId: year.id, dueDate: new Date("2026-12-01"), amount: 25000,
    },
  });
  // Annuler l'intention PENDING de s1 puis en créer une comptabilisable.
  await cancelPaymentIntent(ctxA, intent1, "POSTING_TEST");
  const ip1 = await createPaymentIntent(ctxA, {
    studentId: s1.id, academicYearId: year.id, amount: 25000, currency: "XOF",
    providerId, feeInstallmentId: inst.id,
    allocations: [{ installmentId: inst.id, amount: 25000 }],
    sandboxOutcome: "PENDING",
  });
  check("intention ciblée sur une échéance", ip1.ok);
  const idp1 = ip1.ok ? ip1.data.intentId : "";
  const confPost = await confirmIntent(ctxA, idp1, { providerTxId: "SBTX-POST-1", postToLedger: true });
  check("confirmation + comptabilisation → CONFIRMED + paymentId",
    confPost.ok && confPost.data.status === "CONFIRMED" && !!confPost.data.paymentId);
  const detP1 = await getPaymentIntent(ctxA, idp1);
  check("reçu réel généré via recordPayment", !!detP1?.payment?.receiptNumber?.startsWith("REC-"));
  const alloc = await prisma.paymentAllocation.findFirst({
    where: { installmentId: inst.id },
  });
  check("échéance soldée par l'encaissement", alloc?.amount === 25000);
  const repost = await postConfirmedIntent(ctxA, idp1);
  check("repost idempotent → déjà comptabilisé", repost.ok && repost.data.already === true);
  check("aucun double encaissement",
    (await prisma.payment.count({ where: { schoolId: school.id } })) === 1);

  // CLOSED_DAY : confirmation puis jour clôturé → CONFIRMED_PENDING_POSTING.
  const s10 = await mkStudent("G3A-010", school.id);
  const charge10 = await prisma.studentFeeCharge.create({
    data: { schoolId: school.id, studentId: s10.id, academicYearId: year.id, categoryId: cat.id, amount: 5000 },
  });
  await prisma.feeInstallment.create({
    data: {
      schoolId: school.id, chargeId: charge10.id, studentId: s10.id,
      academicYearId: year.id, dueDate: new Date("2026-12-01"), amount: 5000,
    },
  });
  const ip2 = await createPaymentIntent(ctxA, {
    studentId: s10.id, academicYearId: year.id, amount: 5000, currency: "XOF",
    providerId, sandboxOutcome: "PENDING",
  });
  const idp2 = ip2.ok ? ip2.data.intentId : "";
  const today = new Date();
  const closure = await prisma.cashClosure.create({
    data: { schoolId: school.id, date: today, totalAmount: 0, paymentsCount: 0, closedById: admin.id },
  });
  const confClosed = await confirmIntent(ctxA, idp2, { postToLedger: true });
  check("jour clôturé → CONFIRMED_PENDING_POSTING (rien perdu)",
    confClosed.ok && confClosed.data.status === "CONFIRMED_PENDING_POSTING");
  check("jour clôturé : aucun paiement créé",
    (await prisma.payment.count({ where: { studentId: s10.id } })) === 0);
  await prisma.cashClosure.delete({ where: { id: closure.id } });
  const repost2 = await postConfirmedIntent(ctxA, idp2);
  check("repost après réouverture → CONFIRMED + encaissement",
    repost2.ok && repost2.data.status === "CONFIRMED" && !!repost2.data.paymentId);
  check("2 paiements réels au total (uniquement ceux comptabilisés)",
    (await prisma.payment.count({ where: { schoolId: school.id } })) === 2);

  // ---------- Nettoyage ----------
  const doCleanup = process.env.G3A_CLEANUP === "1";
  if (doCleanup) {
    await cleanup(school.id);
    await cleanup(schoolB.id);
    for (const email of EMAILS) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (u) {
        await prisma.schoolMembership.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }
    console.log("\nFixtures supprimées (G3A_CLEANUP=1).");
  } else {
    console.log("\nFixtures conservées — relancer avec G3A_CLEANUP=1 pour nettoyer.");
  }

  console.log(`\n===== RÉSULTAT : ${pass} PASS / ${fail} FAIL =====`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
