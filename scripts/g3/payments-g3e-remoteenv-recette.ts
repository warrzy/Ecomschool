/**
 * Recette G3-E / Phase 3B — séparation SANDBOX interne / REMOTE TEST /
 * LIVE pour l'adaptateur PAYDUNYA.
 *
 * TOUT passe par un transport HTTP simulé déterministe : aucun appel
 * réseau réel, aucun identifiant réel, aucun secret réel. Les fixtures
 * sont isolées dans deux écoles de test et supprimées en fin de run
 * (G3E_ENV_CLEANUP=0 pour conserver).
 *
 * Couvre : remoteEnv figé, verrou TEST distinct du verrou LIVE,
 * séparation des secrets, immutabilité de l'intention, IPN croisées
 * TEST↔LIVE, polling/replay/confirmation tardive/concurrence TEST,
 * absence de Payment/reçu/solde pour le TEST, hôte sandbox-api
 * uniquement, isolation inter-écoles, remboursement TEST interdit.
 *
 * Usage : npx tsx scripts/g3/payments-g3e-remoteenv-recette.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { prisma } from "../../src/lib/db/prisma";
import {
  createPaymentIntent,
  createPaymentProvider,
  pollPaymentIntent,
  setProviderLive,
  setProviderRemoteEnv,
} from "../../src/lib/services/payments/mobileIntents";
import {
  getProviderAdapter,
  registerProviderAdapter,
} from "../../src/lib/services/payments/providers";
import { createMockTransport } from "../../src/lib/services/payments/providers/http";
import { createPaydunyaAdapter } from "../../src/lib/services/payments/providers/paydunya";
import { ProviderTimeoutError } from "../../src/lib/services/payments/providers";
import {
  pollUncertainIntents,
  processWebhookEvent,
  receiveWebhook,
  replayWebhookEvent,
} from "../../src/lib/services/payments/webhooks";
import { executeRefund } from "../../src/lib/services/payments/refunds";
import { confirmIntent } from "../../src/lib/services/payments/mobileIntents";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3EENV-FX";
const FX2 = "G3EENV-OTHER";
const EMAILS = ["g3eenv-admin@test.local", "g3eenv-adminb@test.local"];

// Secrets fictifs — préfixe test_ documenté, jamais réels.
const TMK = "test_mk-fixture";
const LMK = "live_mk-fixture";
const TMK_B = "test_mk-fixture-B";
const sha512 = (s: string) => createHash("sha512").update(s, "utf8").digest("hex");

function ipnBody(input: { token: string; status: string; key: string; intentId?: string; amount?: number; hashOverride?: string }) {
  const p = new URLSearchParams();
  p.set("data[response_code]", "00");
  p.set("data[response_text]", "Payment Done");
  p.set("data[status]", input.status);
  p.set("data[invoice][token]", input.token);
  if (input.amount != null) p.set("data[invoice][total_amount]", String(input.amount));
  if (input.intentId) p.set("data[custom_data][intent_id]", input.intentId);
  p.set("data[hash]", input.hashOverride ?? sha512(input.key));
  return p.toString();
}

// ─── Transport simulé ───────────────────────────────────────────────

type MockState = {
  statuses: Map<string, { status: string; amount?: number; currency?: string; customRef?: string | null }>;
  failNext: "timeout" | null;
};

function buildMock(state: MockState) {
  return createMockTransport(async (req) => {
    if (state.failNext === "timeout") {
      state.failNext = null;
      throw new ProviderTimeoutError("timeout simulé");
    }
    if (req.method === "POST" && req.url.endsWith("/checkout-invoice/create")) {
      const body = JSON.parse(req.body!) as { invoice: { total_amount: number }; custom_data?: { intent_id?: string } };
      const env = req.url.includes("/sandbox-api/") ? "test" : "live";
      const token = `pd_${env}_tok_${body.custom_data?.intent_id ?? "anon"}`;
      state.statuses.set(token, { status: "pending", amount: body.invoice.total_amount, currency: "XOF" });
      return {
        status: 200,
        body: JSON.stringify({ response_code: "00", response_text: `https://app.paydunya.com/checkout/pay/${token}`, token }),
      };
    }
    const m = /\/checkout-invoice\/confirm\/(.+)$/.exec(req.url);
    if (req.method === "GET" && m) {
      const token = decodeURIComponent(m[1]);
      const s = state.statuses.get(token);
      if (!s) return { status: 200, body: JSON.stringify({ response_code: "01", response_text: "Introuvable" }) };
      return {
        status: 200,
        body: JSON.stringify({
          response_code: "00", response_text: "Transaction Found",
          invoice: { token, status: s.status, total_amount: s.amount, currency: s.currency },
          custom_data: s.customRef === null ? {} : { intent_id: s.customRef ?? token.replace(/^pd_(test|live)_tok_/, "") },
          transaction_id: `pdtx_${token}`,
        }),
      };
    }
    return undefined;
  });
}

// ─── Fixtures ───────────────────────────────────────────────────────

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
    data: { email, passwordHash: "x", firstName: "G3EENV", lastName: email, status: "ACTIVE" },
  });
  const role = await prisma.role.create({ data: { name: `G3EENV_${email}`, scope: "SCHOOL", schoolId } });
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

const paymentsCount = (schoolId: string) =>
  prisma.payment.count({ where: { schoolId, idempotencyKey: { startsWith: "mm:" } } });

async function main() {
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (old) await cleanup(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3eenv-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3eenv-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  const admin = await makeMember("g3eenv-admin@test.local", school.id, ["payments.record", "mobilepayments.manage", "mobilepayments.reconcile"]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const adminB = await makeMember("g3eenv-adminb@test.local", schoolB.id, ["mobilepayments.manage"]);
  const ctxB = { userId: adminB.id, schoolId: schoolB.id };

  const student = await prisma.student.create({
    data: { schoolId: school.id, matricule: "G3EENV-S1", firstName: "Élève", lastName: "ENV", status: "ACTIVE" },
  });
  const charge = await prisma.studentFeeCharge.create({
    data: { schoolId: school.id, studentId: student.id, academicYearId: year.id, categoryId: cat.id, amount: 10_000_000 },
  });
  const mkInstallment = (amount: number) =>
    prisma.feeInstallment.create({
      data: {
        schoolId: school.id, chargeId: charge.id, studentId: student.id, academicYearId: year.id,
        dueDate: new Date(Date.now() + 30 * 86400_000), amount, label: "T",
      },
    });

  // Verrous : les deux OFF par défaut.
  const prevLive = process.env.MOBILE_MONEY_LIVE_ENABLED;
  const prevTest = process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED;
  const prevUrl = process.env.NEXTAUTH_URL;
  delete process.env.MOBILE_MONEY_LIVE_ENABLED;
  delete process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED;
  process.env.NEXTAUTH_URL = "https://fixture.test";

  process.env.ENVTEST_TCREDS = JSON.stringify({ masterKey: TMK, privateKey: "test_pk", publicKey: "test_pub", token: "test_tk" });
  process.env.ENVTEST_TWH = TMK;
  process.env.ENVTEST_LCREDS = JSON.stringify({ masterKey: LMK, privateKey: "live_pk", token: "live_tk" });
  process.env.ENVTEST_LWH = LMK;
  process.env.ENVTEST_TCREDS_B = JSON.stringify({ masterKey: TMK_B, privateKey: "test_pk_b", token: "test_tk_b" });
  process.env.ENVTEST_TWH_B = TMK_B;

  const state: MockState = { statuses: new Map(), failNext: null };
  const { transport, calls } = buildMock(state);
  registerProviderAdapter(createPaydunyaAdapter(transport));

  const cfg = { store: { name: "École Fixture", website_url: "https://fixture.test" }, channels: ["orange-money-burkina"] };
  const sandboxUrls = () => calls.filter((c) => c.url.includes("/sandbox-api/")).length;
  const liveUrls = () => calls.filter((c) => c.url.includes("/api/v1/") && !c.url.includes("/sandbox-api/")).length;

  // ══════════ A. Modèle et rétrocompatibilité ══════════
  console.log("\n— A. Modèle de données et rétrocompatibilité —");
  const provSandbox = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Simu", mode: "SANDBOX" });
  check("prestataire SANDBOX interne créé", provSandbox.ok);
  const sbRow = await prisma.paymentProvider.findUnique({ where: { id: provSandbox.ok ? provSandbox.data.id : "" } });
  check("remoteEnv défaut LIVE même en mode SANDBOX (inerte)", sbRow?.remoteEnv === "LIVE");

  const provTest = await createPaymentProvider(ctxA, {
    code: "PAYDUNYA", label: "PayDunya TEST", mode: "LIVE", remoteEnv: "TEST",
  });
  check("prestataire remoteEnv=TEST créé via service", provTest.ok);
  const providerTest = provTest.ok ? provTest.data.id : "";
  await prisma.paymentProvider.update({
    where: { id: providerTest },
    data: {
      testCredentialsRef: "ENVTEST_TCREDS", testWebhookSecretRef: "ENVTEST_TWH",
      // credentialsRef posée tôt (requis pour les chemins LIVE de la
      // recette) ; webhookSecretRef reste absent jusqu'à la section E
      // pour tester le rejet de signature d'une IPN signée LIVE.
      credentialsRef: "ENVTEST_LCREDS",
      config: cfg,
    },
  });
  const provLive = await createPaymentProvider(ctxA, {
    code: "PAYDUNYA_LIVE" as never, label: "x", mode: "LIVE",
  });
  check("code non enregistré refusé (registre)", !provLive.ok && provLive.error === "PROVIDER_UNAVAILABLE");

  // Prestataire LIVE réel (même école — code distinct impossible, on
  // utilise remoteEnv sur le même code : un second provider PAYDUNYA
  // dans l'école B pour le LIVE distant).
  const providerLive = (await prisma.paymentProvider.create({
    data: {
      schoolId: schoolB.id, code: "PAYDUNYA", label: "PayDunya LIVE B",
      mode: "LIVE", remoteEnv: "LIVE", liveEnabled: false,
      credentialsRef: "ENVTEST_LCREDS", webhookSecretRef: "ENVTEST_LWH",
      testCredentialsRef: "ENVTEST_TCREDS_B", testWebhookSecretRef: "ENVTEST_TWH_B",
      config: cfg,
    },
  })).id;

  // ══════════ B. Verrous indépendants ══════════
  console.log("\n— B. Verrous REMOTE TEST et LIVE indépendants —");
  const inst1 = await mkInstallment(5_000);
  const callsBefore = calls.length;
  const lockedOut = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 5_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst1.id, allocations: [{ installmentId: inst1.id, amount: 5_000 }],
    idempotencyKey: "env-t1",
  });
  check("verrou TEST OFF → REMOTE_TEST_DISABLED", !lockedOut.ok && lockedOut.error === "REMOTE_TEST_DISABLED");
  check("0 appel transport sous verrou OFF", calls.length === callsBefore);

  process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED = "true";
  const t1 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 5_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst1.id, allocations: [{ installmentId: inst1.id, amount: 5_000 }],
    idempotencyKey: "env-t1",
  });
  check("verrou TEST ON → initiation réussie (token)", t1.ok && t1.data.providerRef.startsWith("pd_test_tok_"));
  check("appel passé uniquement par sandbox-api", sandboxUrls() > 0 && liveUrls() === 0);
  check("en-têtes = secrets TEST (test_mk)",
    calls[calls.length - 1].headers["PAYDUNYA-MASTER-KEY"] === TMK);
  const iT1 = await prisma.paymentIntent.findUnique({ where: { id: t1.ok ? t1.data.intentId : "" } });
  check("remoteEnv TEST figé sur l'intention", iT1?.remoteEnv === "TEST");
  check("verrou TEST n'a pas activé LIVE", process.env.MOBILE_MONEY_LIVE_ENABLED !== "true");

  // LIVE : verrou distinct toujours OFF → refus même si liveEnabled.
  await setProviderLive(ctxB, providerLive, true);
  const studentB = await prisma.student.create({
    data: { schoolId: schoolB.id, matricule: "G3EENV-SB", firstName: "É", lastName: "B", status: "ACTIVE" },
  });
  const yearB = await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const liveOff = await createPaymentIntent(ctxB, {
    studentId: studentB.id, academicYearId: yearB.id,
    providerId: providerLive, amount: 5_000, currency: "XOF", channel: "ADMIN_TEST",
    idempotencyKey: "env-l1",
  });
  check("verrou LIVE OFF → LIVE_DISABLED (TEST ON sans effet)", !liveOff.ok && liveOff.error === "LIVE_DISABLED");

  // LIVE ON + prestataire remoteEnv=TEST sans secrets TEST → PROVIDER_CONFIG.
  process.env.MOBILE_MONEY_LIVE_ENABLED = "true";
  const provTestNoCreds = await createPaymentProvider(ctxA, {
    code: "PAYDUNYA", label: "x", mode: "LIVE", remoteEnv: "TEST",
  });
  check("contrainte unique (schoolId, code) respectée", !provTestNoCreds.ok);
  await prisma.paymentProvider.update({
    where: { id: providerTest },
    data: { testCredentialsRef: null },
  });
  const instX = await mkInstallment(5_000);
  const noTestSecret = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 5_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: instX.id, allocations: [{ installmentId: instX.id, amount: 5_000 }],
    idempotencyKey: "env-tx",
  });
  check("secrets TEST absents → PROVIDER_CONFIG (même avec LIVE ON)", !noTestSecret.ok && noTestSecret.error === "PROVIDER_CONFIG");
  await prisma.paymentProvider.update({
    where: { id: providerTest },
    data: { testCredentialsRef: "ENVTEST_TCREDS" },
  });

  // ══════════ C. Confirmation TEST sans comptabilisation ══════════
  console.log("\n— C. Cycle TEST : confirmé techniquement, jamais comptabilisé —");
  state.statuses.set(iT1!.providerRef!, { status: "completed", amount: 5_000, currency: "XOF", customRef: iT1!.id });
  const poll1 = await pollPaymentIntent(ctxA, iT1!.id);
  const iT1After = await prisma.paymentIntent.findUnique({ where: { id: iT1!.id }, include: { payment: true } });
  check("poll TEST → intention CONFIRMED", poll1.ok && poll1.data.status === "CONFIRMED");
  check("CONFIRMED mais paymentId null", iT1After?.status === "CONFIRMED" && iT1After?.paymentId === null);
  check("0 Payment mm: créé pour le TEST", (await paymentsCount(school.id)) === 0);

  // Barrière directe au point d'entrée transactionnel : postToLedger
  // demandé explicitement sur une intention TEST PENDING → refus.
  const instP = await mkInstallment(5_500);
  const tP = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 5_500, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: instP.id, allocations: [{ installmentId: instP.id, amount: 5_500 }],
    idempotencyKey: "env-tp",
  });
  const forcePost = await confirmIntent(ctxA, tP.ok ? tP.data.intentId : "", { postToLedger: true });
  check("confirmIntent postToLedger sur TEST → POSTING_SANDBOX_FORBIDDEN",
    !forcePost.ok && forcePost.error === "POSTING_SANDBOX_FORBIDDEN");
  const freePost = await confirmIntent(ctxA, tP.ok ? tP.data.intentId : "", {});
  check("confirmation technique sans ledger autorisée",
    freePost.ok && freePost.data.status === "CONFIRMED" && (await paymentsCount(school.id)) === 0);

  // ══════════ D. Immutabilité de l'environnement figé ══════════
  console.log("\n— D. Immutabilité : bascule prestataire, intention inchangée —");
  const inst2 = await mkInstallment(6_000);
  const t2 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 6_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst2.id, allocations: [{ installmentId: inst2.id, amount: 6_000 }],
    idempotencyKey: "env-t2",
  });
  check("2e intention TEST créée", t2.ok);
  const flip = await setProviderRemoteEnv(ctxA, providerTest, "LIVE");
  check("bascule prestataire TEST→LIVE tracée", flip.ok);
  const iT2 = await prisma.paymentIntent.findUnique({ where: { id: t2.ok ? t2.data.intentId : "" } });
  check("intention garde remoteEnv TEST après bascule", iT2?.remoteEnv === "TEST");

  const liveCallsBefore = calls.length;
  state.statuses.set(iT2!.providerRef!, { status: "completed", amount: 6_000, currency: "XOF", customRef: iT2!.id });
  const poll2 = await pollPaymentIntent(ctxA, iT2!.id);
  check("poll après bascule : toujours sandbox-api + secrets TEST",
    poll2.ok && poll2.data.status === "CONFIRMED" &&
    calls.slice(liveCallsBefore).every((c) => c.url.includes("/sandbox-api/")) &&
    calls[calls.length - 1].headers["PAYDUNYA-MASTER-KEY"] === TMK);
  check("toujours 0 Payment", (await paymentsCount(school.id)) === 0);

  // Nouvelle intention APRÈS bascule : env LIVE figé → barrière LIVE.
  const inst3 = await mkInstallment(7_000);
  const t3 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 7_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst3.id, allocations: [{ installmentId: inst3.id, amount: 7_000 }],
    idempotencyKey: "env-t3",
  });
  check("après bascule : nouvelle intention = LIVE → liveEnabled requis",
    !t3.ok && t3.error === "PROVIDER_NOT_LIVE");
  await setProviderLive(ctxA, providerTest, true);
  const t3b = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 7_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst3.id, allocations: [{ installmentId: inst3.id, amount: 7_000 }],
    idempotencyKey: "env-t3",
  });
  check("LIVE complet → initiation via api/v1, secrets LIVE",
    t3b.ok && t3b.data.providerRef.startsWith("pd_live_tok_") &&
    calls[calls.length - 1].headers["PAYDUNYA-MASTER-KEY"] === LMK);
  const iT3 = await prisma.paymentIntent.findUnique({ where: { id: t3b.ok ? t3b.data.intentId : "" } });
  check("remoteEnv LIVE figé", iT3?.remoteEnv === "LIVE");
  await setProviderRemoteEnv(ctxA, providerTest, "TEST"); // retour TEST pour la suite

  // ══════════ E. Webhooks : séparation des IPN ══════════
  console.log("\n— E. IPN TEST/LIVE : vérification croisée —");
  // Le provider TEST a les DEUX secrets configurés ? Non : seulement
  // les refs TEST → une IPN signée LIVE n'est même pas authentifiée.
  const inst4 = await mkInstallment(8_000);
  const t4 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 8_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst4.id, allocations: [{ installmentId: inst4.id, amount: 8_000 }],
    idempotencyKey: "env-t4",
  });
  const iT4 = await prisma.paymentIntent.findUnique({ where: { id: t4.ok ? t4.data.intentId : "" } });
  const liveSigned = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT4!.providerRef!, status: "completed", key: LMK, intentId: iT4!.id, amount: 8_000 }), headers: {},
  });
  check("IPN signée clé LIVE sur provider TEST-only → rejetée (signature)", !liveSigned.ok);

  // Ajout de la ref webhook LIVE au provider → les deux secrets sont
  // essayés à la réception (credentialsRef l'était déjà).
  await prisma.paymentProvider.update({
    where: { id: providerTest },
    data: { webhookSecretRef: "ENVTEST_LWH" },
  });
  const liveSigned2 = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT4!.providerRef!, status: "completed", key: LMK, intentId: iT4!.id, amount: 8_000 }), headers: {},
  });
  check("IPN signée LIVE acceptée cryptographiquement", liveSigned2.ok && !liveSigned2.data.duplicate);
  const evX = await prisma.webhookEvent.findFirst({ where: { providerId: providerTest }, orderBy: { receivedAt: "desc" } });
  const rX = await processWebhookEvent(evX!.id);
  check("IPN LIVE pour intention TEST → ANOMALY ENV_MISMATCH", rX.outcome === "ANOMALY");
  const iT4After = await prisma.paymentIntent.findUnique({ where: { id: iT4!.id } });
  check("intention TEST intacte après IPN croisée", iT4After?.status === "PENDING" && iT4After?.paymentId === null);

  // IPN TEST correcte → PROCESSED, confirmée, jamais comptabilisée.
  // Nouvelle intention : le {token}:{status} de l'IPN croisée
  // précédente est déjà dédupliqué — même identifiant externe.
  const inst4b = await mkInstallment(8_500);
  const t4b = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 8_500, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst4b.id, allocations: [{ installmentId: inst4b.id, amount: 8_500 }],
    idempotencyKey: "env-t4b",
  });
  const iT4b = await prisma.paymentIntent.findUnique({ where: { id: t4b.ok ? t4b.data.intentId : "" } });
  state.statuses.set(iT4b!.providerRef!, { status: "completed", amount: 8_500, currency: "XOF", customRef: iT4b!.id });
  const testSigned = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT4b!.providerRef!, status: "completed", key: TMK, intentId: iT4b!.id, amount: 8_500 }), headers: {},
  });
  check("IPN TEST acceptée", testSigned.ok && !testSigned.data.duplicate);
  const evT = await prisma.webhookEvent.findFirst({ where: { providerId: providerTest }, orderBy: { receivedAt: "desc" } });
  const rT = await processWebhookEvent(evT!.id);
  const iT4bFinal = await prisma.paymentIntent.findUnique({ where: { id: iT4b!.id } });
  check("IPN TEST → PROCESSED + intention CONFIRMED sans Payment",
    rT.outcome === "PROCESSED" && iT4bFinal?.status === "CONFIRMED" && iT4bFinal?.paymentId === null);
  check("toujours 0 Payment après IPN TEST", (await paymentsCount(school.id)) === 0);

  // Replay TEST → idempotent, toujours rien au ledger.
  const replay = await replayWebhookEvent(ctxA, evT!.id);
  check("replay événement PROCESSED → INVALID_STATE", !replay.ok && replay.error === "INVALID_STATE");
  // Forcer un replay sur un événement ANOMALY.
  const replayX = await replayWebhookEvent(ctxA, evX!.id);
  check("replay anomalie IPN croisée → ANOMALY à nouveau", replayX.ok && replayX.data.outcome === "ANOMALY");
  check("replay sans effet financier", (await paymentsCount(school.id)) === 0);

  // ══════════ F. Chemins asynchrones TEST ══════════
  console.log("\n— F. Polling, cron, confirmation tardive, concurrence —");
  const inst5 = await mkInstallment(9_000);
  const t5 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 9_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst5.id, allocations: [{ installmentId: inst5.id, amount: 9_000 }],
    idempotencyKey: "env-t5",
  });
  const iT5 = await prisma.paymentIntent.findUnique({ where: { id: t5.ok ? t5.data.intentId : "" } });
  state.statuses.set(iT5!.providerRef!, { status: "completed", amount: 9_000, currency: "XOF", customRef: iT5!.id });
  const cronBefore = calls.length;
  const cronRes = await pollUncertainIntents({ minAgeMin: 0 });
  const iT5After = await prisma.paymentIntent.findUnique({ where: { id: iT5!.id } });
  check("cron polling TEST → intention confirmée via sandbox-api",
    cronRes.done >= 1 && iT5After?.status === "CONFIRMED" &&
    calls.slice(cronBefore).filter((c) => c.url.includes(encodeURIComponent(iT5!.providerRef!)))
      .every((c) => c.url.includes("/sandbox-api/")));
  check("cron : 0 Payment", (await paymentsCount(school.id)) === 0);

  // Confirmation tardive : SUCCESS après FAILED → ANOMALY.
  const inst6 = await mkInstallment(4_000);
  const t6 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 4_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst6.id, allocations: [{ installmentId: inst6.id, amount: 4_000 }],
    idempotencyKey: "env-t6",
  });
  const iT6 = await prisma.paymentIntent.findUnique({ where: { id: t6.ok ? t6.data.intentId : "" } });
  state.statuses.set(iT6!.providerRef!, { status: "failed", amount: 4_000, currency: "XOF" });
  await pollPaymentIntent(ctxA, iT6!.id); // → FAILED
  state.statuses.set(iT6!.providerRef!, { status: "completed", amount: 4_000, currency: "XOF", customRef: iT6!.id });
  const late = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT6!.providerRef!, status: "completed", key: TMK, intentId: iT6!.id, amount: 4_000 }), headers: {},
  });
  const evLate = await prisma.webhookEvent.findFirst({ where: { providerId: providerTest }, orderBy: { receivedAt: "desc" } });
  const rLate = await processWebhookEvent(evLate!.id);
  check("confirmation tardive TEST (SUCCESS après FAILED) → ANOMALY", late.ok && rLate.outcome === "ANOMALY");
  check("tardive : 0 Payment", (await paymentsCount(school.id)) === 0);

  // Concurrence : deux polls simultanés → 1 confirmation, 0 Payment.
  const inst7 = await mkInstallment(3_000);
  const t7 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 3_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst7.id, allocations: [{ installmentId: inst7.id, amount: 3_000 }],
    idempotencyKey: "env-t7",
  });
  const iT7 = await prisma.paymentIntent.findUnique({ where: { id: t7.ok ? t7.data.intentId : "" } });
  state.statuses.set(iT7!.providerRef!, { status: "completed", amount: 3_000, currency: "XOF", customRef: iT7!.id });
  await Promise.all([pollPaymentIntent(ctxA, iT7!.id), pollPaymentIntent(ctxA, iT7!.id)]);
  const iT7Final = await prisma.paymentIntent.findUnique({ where: { id: iT7!.id } });
  check("concurrence : 1 seule CONFIRMED, 0 Payment",
    iT7Final?.status === "CONFIRMED" && (await paymentsCount(school.id)) === 0);

  // Remboursement TEST → interdit (barrière remoteEnv figé).
  const refundAttempt = await executeRefund(ctxA, "nonexistent");
  check("refund sur id inexistant → NOT_FOUND", !refundAttempt.ok);
  const fakeRefund = await prisma.paymentRefund.create({
    data: {
      schoolId: school.id, intentId: iT7!.id, amount: 3_000,
      reason: "test", status: "APPROVED", requestedById: admin.id, approvedById: admin.id,
      idempotencyKey: "rf-envtest-1",
    },
  });
  const rfRes = await executeRefund(ctxA, fakeRefund.id);
  check("remboursement sur intention TEST → refusé", !rfRes.ok && rfRes.error === "REMOTE_TEST_REFUND_FORBIDDEN");

  // Verrou TEST OFF sur chemins async : intention PENDING conservée.
  const inst8 = await mkInstallment(2_000);
  const t8 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 2_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst8.id, allocations: [{ installmentId: inst8.id, amount: 2_000 }],
    idempotencyKey: "env-t8",
  });
  delete process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED;
  const callsOff = calls.length;
  const lockedPoll = await pollPaymentIntent(ctxA, t8.ok ? t8.data.intentId : "");
  check("poll TEST sous verrou OFF → REMOTE_TEST_DISABLED, 0 appel",
    !lockedPoll.ok && lockedPoll.error === "REMOTE_TEST_DISABLED" && calls.length === callsOff);
  const iT8 = await prisma.paymentIntent.findUnique({ where: { id: t8.ok ? t8.data.intentId : "" } });
  check("intention TEST intacte sous verrou OFF (preuve conservée)", iT8?.status === "PENDING");

  // ══════════ G. SANDBOX interne inchangé + isolation ══════════
  console.log("\n— G. SANDBOX interne et isolation inter-écoles —");
  process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED = "true"; // réarmé pour compter les appels
  const sbCallsBefore = calls.length;
  const instSb = await mkInstallment(1_500);
  const sbIntent = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id,
    providerId: provSandbox.ok ? provSandbox.data.id : "",
    amount: 1_500, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: instSb.id, allocations: [{ installmentId: instSb.id, amount: 1_500 }],
    idempotencyKey: "env-sb", sandboxOutcome: "SUCCESS",
  });
  check("SANDBOX interne : initiation sans verrou ni réseau",
    sbIntent.ok && calls.length === sbCallsBefore);
  const sbPoll = await pollPaymentIntent(ctxA, sbIntent.ok ? sbIntent.data.intentId : "");
  check("SANDBOX : confirmation simulée, 0 appel transport",
    sbPoll.ok && calls.length === sbCallsBefore);

  // Isolation : provider école A invisible depuis école B.
  const iso = await createPaymentIntent(ctxB, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 1_000, currency: "XOF", channel: "ADMIN_TEST", idempotencyKey: "env-iso",
  });
  check("provider école A inaccessible depuis école B", !iso.ok);

  // ══════════ H. Durcissement 3C : immutabilité et dédup par env ══════════
  console.log("\n— H. Immutabilité remoteEnv + déduplication TEST/LIVE —");
  // A. Modification directe de remoteEnv → le trigger base refuse.
  let mutErr: unknown = null;
  try {
    await prisma.paymentIntent.update({
      where: { id: iT1!.id }, data: { remoteEnv: "LIVE" },
    });
  } catch (e) { mutErr = e; }
  check("update remoteEnv après création → refusé par la base (REMOTE_ENV_IMMUTABLE)", mutErr != null);
  const iT1Chk = await prisma.paymentIntent.findUnique({ where: { id: iT1!.id }, select: { remoteEnv: true } });
  check("remoteEnv inchangé après tentative", iT1Chk?.remoteEnv === "TEST");
  // Une mise à jour ordinaire (statut/champs) reste possible.
  await prisma.paymentIntent.update({ where: { id: iT1!.id }, data: { failureReason: "note-recette" } });
  const iT1Chk2 = await prisma.paymentIntent.findUnique({ where: { id: iT1!.id }, select: { remoteEnv: true } });
  check("mise à jour autre champ autorisée, env préservé", iT1Chk2?.remoteEnv === "TEST");

  // B. IPN TEST et LIVE partageant le MÊME token → deux événements.
  const inst9 = await mkInstallment(2_500);
  const t9 = await createPaymentIntent(ctxA, {
    studentId: student.id, academicYearId: year.id, providerId: providerTest,
    amount: 2_500, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: inst9.id, allocations: [{ installmentId: inst9.id, amount: 2_500 }],
    idempotencyKey: "env-t9",
  });
  const iT9 = await prisma.paymentIntent.findUnique({ where: { id: t9.ok ? t9.data.intentId : "" } });
  state.statuses.set(iT9!.providerRef!, { status: "completed", amount: 2_500, currency: "XOF", customRef: iT9!.id });
  const ipnTest9 = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT9!.providerRef!, status: "completed", key: TMK, intentId: iT9!.id, amount: 2_500 }), headers: {},
  });
  check("IPN TEST acceptée (token iT9)", ipnTest9.ok && !ipnTest9.data.duplicate);
  const ipnLive9 = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT9!.providerRef!, status: "completed", key: LMK, intentId: iT9!.id, amount: 2_500 }), headers: {},
  });
  check("IPN LIVE même token+statut → événement DISTINCT (pas un doublon)",
    ipnLive9.ok && !ipnLive9.data.duplicate);
  const ipnTest9dup = await receiveWebhook({
    providerId: providerTest, rawBody: ipnBody({ token: iT9!.providerRef!, status: "completed", key: TMK, intentId: iT9!.id, amount: 2_500 }), headers: {},
  });
  check("même IPN TEST renvoyée → dédupliquée", ipnTest9dup.ok && ipnTest9dup.data.duplicate);
  const evs9 = await prisma.webhookEvent.findMany({
    where: { providerId: providerTest, externalId: { endsWith: `:${iT9!.providerRef!}:completed` } },
  });
  check("2 événements persistés (TEST:… et LIVE:…)",
    evs9.length === 2 && new Set(evs9.map((e) => e.externalId)).size === 2);

  // Traitement : TEST → CONFIRMED sans Payment ; LIVE → ANOMALY.
  const evTest9 = evs9.find((e) => e.externalId.startsWith("TEST:"));
  const evLive9 = evs9.find((e) => e.externalId.startsWith("LIVE:"));
  const rT9 = await processWebhookEvent(evTest9!.id);
  const iT9F = await prisma.paymentIntent.findUnique({ where: { id: iT9!.id } });
  check("IPN TEST traitée → CONFIRMED, 0 Payment",
    rT9.outcome === "PROCESSED" && iT9F?.status === "CONFIRMED" && iT9F?.paymentId === null);
  const rL9 = await processWebhookEvent(evLive9!.id);
  check("IPN LIVE même token → ANOMALY ENV_MISMATCH", rL9.outcome === "ANOMALY");

  // C. IPN ciblant une intention d'une AUTRE école via SON provider.
  const ipnCross = await receiveWebhook({
    providerId: providerLive,
    rawBody: ipnBody({ token: iT9!.providerRef!, status: "completed", key: LMK, intentId: iT9!.id, amount: 2_500 }), headers: {},
  });
  check("IPN école A reçue sur provider école B → persistée (authentifiée)", ipnCross.ok);
  const evCross = await prisma.webhookEvent.findFirst({
    where: { providerId: providerLive }, orderBy: { receivedAt: "desc" },
  });
  const rCross = await processWebhookEvent(evCross!.id);
  check("intention introuvable sous ce provider → ANOMALY, 0 effet",
    rCross.outcome === "ANOMALY" && (await paymentsCount(school.id)) === 0);

  // LIVE toujours verrouillé côté service : une intention LIVE figée
  // ne se confirme pas si le verrou retombe.
  delete process.env.MOBILE_MONEY_LIVE_ENABLED;
  const liveLocked = await pollPaymentIntent(ctxA, iT3!.id);
  check("intention LIVE : poll sous verrou OFF → LIVE_DISABLED",
    !liveLocked.ok && liveLocked.error === "LIVE_DISABLED");

  // D. Intention HISTORIQUE (remoteEnv NULL, insérée directement —
  //    le trigger interdit de nullifier une intention existante) sous
  //    un prestataire désormais TEST : l'environnement effectif est
  //    TEST → confirmation technique autorisée, JAMAIS de ledger.
  process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED = "true";
  const hist = await prisma.paymentIntent.create({
    data: {
      schoolId: school.id, studentId: student.id, academicYearId: year.id,
      providerId: providerTest, initiatedById: ctxA.userId,
      amount: 1_000, currency: "XOF", idempotencyKey: "env-hist-null",
      channel: "PARENT_PORTAL", providerRef: "pd-hist-null-tok",
      status: "PENDING", remoteEnv: null,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  state.statuses.set("pd-hist-null-tok", { status: "completed", amount: 1_000, currency: "XOF", customRef: hist.id });
  const callsBeforeHist = calls.length;
  const rHist = await pollPaymentIntent(ctxA, hist.id);
  const histF = await prisma.paymentIntent.findUnique({ where: { id: hist.id } });
  check("intention historique NULL sous provider TEST → CONFIRMED sans Payment",
    rHist.ok && histF?.status === "CONFIRMED" && histF?.paymentId === null &&
    (await paymentsCount(school.id)) === 0);
  check("appel passé par sandbox-api + secrets TEST (env effectif)",
    calls.length > callsBeforeHist &&
    calls[calls.length - 1].url.includes("sandbox-api") &&
    calls[calls.length - 1].headers["PAYDUNYA-MASTER-KEY"] === TMK);

  // Comptabilité finale : aucun effet financier TEST sur la base.
  const totals = {
    payments: await paymentsCount(school.id),
    receipts: await prisma.payment.count({ where: { schoolId: school.id, receiptNumber: { not: null } } }),
    allocations: await prisma.paymentAllocation.count({ where: { installment: { schoolId: school.id } } }),
    settlements: await prisma.paymentSettlement.count({ where: { schoolId: school.id } }),
  };
  check("aucun Payment / reçu / allocation / reversement TEST",
    totals.payments === 0 && totals.receipts === 0 && totals.allocations === 0 && totals.settlements === 0);
  check("tous les appels passés par le mock, domaine officiel unique",
    calls.every((c) => new URL(c.url).hostname === "app.paydunya.com"));

  // ─── Nettoyage ────────────────────────────────────────────────────
  if (prevLive === undefined) delete process.env.MOBILE_MONEY_LIVE_ENABLED;
  else process.env.MOBILE_MONEY_LIVE_ENABLED = prevLive;
  if (prevTest === undefined) delete process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED;
  else process.env.MOBILE_MONEY_REMOTE_TEST_ENABLED = prevTest;
  if (prevUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = prevUrl;
  for (const k of ["ENVTEST_TCREDS", "ENVTEST_TWH", "ENVTEST_LCREDS", "ENVTEST_LWH", "ENVTEST_TCREDS_B", "ENVTEST_TWH_B"]) {
    delete process.env[k];
  }

  if (process.env.G3E_ENV_CLEANUP !== "0") {
    await cleanup(school.id);
    await cleanup(schoolB.id);
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    console.log("Fixtures supprimées.");
  } else {
    console.log("Fixtures conservées (G3E_ENV_CLEANUP=0).");
  }
  console.log(`\n═══ G3-E Phase 3B : ${pass} PASS / ${fail} FAIL ═══`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
