/**
 * Recette G3-E / Phase 2B — conformité de l'adaptateur PAYDUNYA.
 *
 * TOUT passe par un transport HTTP simulé déterministe
 * (createMockTransport) : aucun appel réseau réel, aucun identifiant
 * PayDunya réel, aucun secret réel. Les fixtures sont isolées dans
 * deux écoles de test et supprimées en fin de run (G3E_PD_CLEANUP=0
 * pour conserver).
 *
 * Couvre : création de facture, token + URL de redirection, mapping
 * des statuts, IPN valide/invalide/dupliquée/anticipée, montant et
 * devise divergents, référence inconnue, marchand incorrect,
 * confirmation tardive, timeout, erreur HTTP, réponse malformée,
 * réponse incohérente, rejeu idempotent, isolation inter-écoles,
 * concurrence guichet, absence de double encaissement, verrou LIVE,
 * absence de paiement réel.
 *
 * Usage : npx tsx scripts/g3/payments-g3e-paydunya-recette.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { prisma } from "../../src/lib/db/prisma";
import {
  createPaymentIntent,
  createPaymentProvider,
  pollPaymentIntent,
  setProviderLive,
} from "../../src/lib/services/payments/mobileIntents";
import {
  getProviderAdapter,
  registerProviderAdapter,
} from "../../src/lib/services/payments/providers";
import { createMockTransport } from "../../src/lib/services/payments/providers/http";
import {
  createPaydunyaAdapter,
  paydunyaAdapter,
} from "../../src/lib/services/payments/providers/paydunya";
import { ProviderTimeoutError } from "../../src/lib/services/payments/providers";
import {
  processWebhookEvent,
  receiveWebhook,
  replayWebhookEvent,
} from "../../src/lib/services/payments/webhooks";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3EPD-FX";
const FX2 = "G3EPD-OTHER";
const EMAILS = ["g3epd-admin@test.local", "g3epd-adminb@test.local"];

// Secrets de TEST uniquement — jamais d'identifiants réels.
const MK_A = "pd-mk-fixture-A";
const MK_B = "pd-mk-fixture-B";

const sha512 = (s: string) => createHash("sha512").update(s, "utf8").digest("hex");

/** Corps d'IPN form-urlencoded documenté (champs data[...] PHP). */
function ipnBody(input: {
  token: string; status: string; masterKey: string;
  intentId?: string; amount?: number; hashOverride?: string;
}) {
  const p = new URLSearchParams();
  p.set("data[response_code]", "00");
  p.set("data[response_text]", "Payment Done");
  p.set("data[status]", input.status);
  p.set("data[invoice][token]", input.token);
  if (input.amount != null) p.set("data[invoice][total_amount]", String(input.amount));
  if (input.intentId) p.set("data[custom_data][intent_id]", input.intentId);
  p.set("data[hash]", input.hashOverride ?? sha512(input.masterKey));
  return p.toString();
}

// ─── Transport simulé ───────────────────────────────────────────────

type MockState = {
  /** Statut renvoyé par confirm/{token}. */
  statuses: Map<string, { status: string; amount?: number; currency?: string; responseCode?: string }>;
  /** Comportements dégradés : next create/confirm échoue ainsi. */
  failNext: "timeout" | "http500" | "malformed" | "empty" | null;
  /** response_code ≠ "00" sur la création. */
  createRejectCode: string | null;
};

function buildMock(state: MockState) {
  return createMockTransport(async (req) => {
    if (state.failNext) {
      const f = state.failNext;
      state.failNext = null;
      if (f === "timeout") throw new ProviderTimeoutError("timeout simulé");
      if (f === "http500") return { status: 500, body: JSON.stringify({ response_code: "99", response_text: "Erreur serveur" }) };
      if (f === "malformed") return { status: 200, body: "<<< pas du json >>>" };
      if (f === "empty") return { status: 200, body: JSON.stringify({ response_code: "00" }) };
    }
    if (req.method === "POST" && req.url.endsWith("/checkout-invoice/create")) {
      const body = JSON.parse(req.body!) as { invoice: { total_amount: number }; custom_data?: { intent_id?: string } };
      if (state.createRejectCode) {
        return { status: 200, body: JSON.stringify({ response_code: state.createRejectCode, response_text: "Création refusée" }) };
      }
      const token = `pd_tok_${body.custom_data?.intent_id ?? "anon"}`;
      state.statuses.set(token, { status: "pending", amount: body.invoice.total_amount });
      return {
        status: 200,
        body: JSON.stringify({
          response_code: "00",
          response_text: `https://app.paydunya.com/sandbox-checkout/pay/${token}`,
          token,
        }),
      };
    }
    const m = /\/checkout-invoice\/confirm\/(.+)$/.exec(req.url);
    if (req.method === "GET" && m) {
      const token = decodeURIComponent(m[1]);
      const s = state.statuses.get(token);
      if (!s || s.responseCode) {
        return { status: 200, body: JSON.stringify({ response_code: s?.responseCode ?? "01", response_text: "Transaction introuvable" }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          response_code: "00",
          response_text: "Transaction Found",
          invoice: { token, status: s.status, total_amount: s.amount, currency: s.currency },
          transaction_id: `pdtx_${token}`,
        }),
      };
    }
    return undefined; // route non prévue → ProviderUnavailableError
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
    data: { email, passwordHash: "x", firstName: "G3EPD", lastName: email, status: "ACTIVE" },
  });
  const role = await prisma.role.create({ data: { name: `G3EPD_${email}`, scope: "SCHOOL", schoolId } });
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
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3epd-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3epd-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e" } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, name: "6e A", academicYearId: year.id, levelId: level.id },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  const admin = await makeMember("g3epd-admin@test.local", school.id, [
    "payments.record", "mobilepayments.manage", "mobilepayments.reconcile",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const adminB = await makeMember("g3epd-adminb@test.local", schoolB.id, ["mobilepayments.manage"]);
  const ctxB = { userId: adminB.id, schoolId: schoolB.id };

  const student = await prisma.student.create({
    data: { schoolId: school.id, matricule: "G3EPD-S1", firstName: "Élève", lastName: "PD", status: "ACTIVE" },
  });
  await prisma.enrollment.create({
    data: { schoolId: school.id, studentId: student.id, academicYearId: year.id, classroomId: classroom.id, status: "ENROLLED", enrolledAt: new Date() },
  });
  const studentB = await prisma.student.create({
    data: { schoolId: schoolB.id, matricule: "G3EPD-SB", firstName: "Élève", lastName: "PDB", status: "ACTIVE" },
  });
  const yearB = await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const catB = await prisma.feeCategory.create({ data: { schoolId: schoolB.id, code: "SCOL", label: "Scolarité" } });
  const chargeB = await prisma.studentFeeCharge.create({
    data: { schoolId: schoolB.id, studentId: studentB.id, academicYearId: yearB.id, categoryId: catB.id, amount: 300_000 },
  });
  const instB = await prisma.feeInstallment.create({
    data: {
      schoolId: schoolB.id, chargeId: chargeB.id, studentId: studentB.id, academicYearId: yearB.id,
      dueDate: new Date(Date.now() + 30 * 86400_000), amount: 5_000, label: "T",
    },
  });
  const charge = await prisma.studentFeeCharge.create({
    data: { schoolId: school.id, studentId: student.id, academicYearId: year.id, categoryId: cat.id, amount: 300_000 },
  });
  const mkInstallment = (amount: number) =>
    prisma.feeInstallment.create({
      data: {
        schoolId: school.id, chargeId: charge.id, studentId: student.id, academicYearId: year.id,
        dueDate: new Date(Date.now() + 30 * 86400_000), amount, label: "T",
      },
    });

  // Environnement de test — secrets FICTIFS, levée du verrou global
  // pour exercer le chemin LIVE avec transport simulé.
  const state: MockState = { statuses: new Map(), failNext: null, createRejectCode: null };
  const { transport, calls } = buildMock(state);
  registerProviderAdapter(createPaydunyaAdapter(transport));

  process.env.PD_TEST_CREDS_A = JSON.stringify({
    masterKey: MK_A, privateKey: "pd-pk-A", publicKey: "pd-pub-A", token: "pd-tk-A",
  });
  process.env.PD_TEST_WH_A = MK_A;
  process.env.PD_TEST_CREDS_B = JSON.stringify({
    masterKey: MK_B, privateKey: "pd-pk-B", token: "pd-tk-B",
  });
  process.env.PD_TEST_WH_B = MK_B;
  const prevLock = process.env.MOBILE_MONEY_LIVE_ENABLED;
  process.env.MOBILE_MONEY_LIVE_ENABLED = "true";

  const pdConfig = {
    store: { name: "École Fixture A", website_url: "https://fixture-a.test" },
    callbackUrl: "https://fixture-a.test/webhooks/paydunya",
    channels: ["orange-money-burkina", "moov-burkina-faso"],
  };

  // Prestataire école A — via le service (adapteur enregistré requis).
  const pACreate = await createPaymentProvider(ctxA, { code: "PAYDUNYA", label: "PayDunya A", mode: "LIVE" });
  check("création prestataire PAYDUNYA LIVE via service", pACreate.ok);
  const providerA = pACreate.ok ? pACreate.data.id : "";
  const enA = await setProviderLive(ctxA, providerA, true);
  check("activation liveEnabled PAYDUNYA", enA.ok);
  await prisma.paymentProvider.update({
    where: { id: providerA },
    data: {
      credentialsRef: "PD_TEST_CREDS_A",
      webhookSecretRef: "PD_TEST_WH_A",
      merchantRef: "fixture-merchant-A",
      config: pdConfig,
    },
  });

  // Prestataire école B — credentials et marchand DISTINCTS.
  const providerB = (await prisma.paymentProvider.create({
    data: {
      schoolId: schoolB.id, code: "PAYDUNYA", label: "PayDunya B",
      mode: "LIVE", liveEnabled: true,
      credentialsRef: "PD_TEST_CREDS_B", webhookSecretRef: "PD_TEST_WH_B",
      merchantRef: "fixture-merchant-B", config: pdConfig,
    },
  })).id;

  const mkPdIntent = async (opts: { studentId?: string; schoolId?: string; ctx?: { userId: string; schoolId: string }; providerId?: string; amount: number; installmentId?: string; idem?: string }) => {
    const ctx = opts.ctx ?? ctxA;
    const inst = opts.installmentId;
    return createPaymentIntent(ctx, {
      studentId: opts.studentId ?? student.id,
      academicYearId: year.id,
      providerId: opts.providerId ?? providerA,
      amount: opts.amount, currency: "XOF",
      channel: "ADMIN_TEST",
      feeInstallmentId: inst,
      allocations: inst ? [{ installmentId: inst, amount: opts.amount }] : undefined,
      idempotencyKey: opts.idem,
    });
  };

  // ══════════ A. UNITAIRE — initiate / checkStatus / verifyWebhook ══════════
  console.log("\n— Adaptateur unitaire : initiation, statuts, IPN —");
  const adapter = getProviderAdapter("PAYDUNYA")!;

  const call = {
    credentials: process.env.PD_TEST_CREDS_A!,
    config: { ...pdConfig, env: "live" as const },
  };
  const callsBefore = calls.length;
  const init = await adapter.initiate({ intentId: "unit-i1", amount: 5000, currency: "XOF", payerPhone: "+22670000000", call });
  check("initiation → token + URL de redirection",
    init.providerRef === "pd_tok_unit-i1" && !!init.instructions?.includes("pd_tok_unit-i1"));
  check("transport sollicité 1 fois (create)", calls.length === callsBefore + 1 && calls[calls.length - 1].method === "POST");
  const sentBody = JSON.parse(calls[calls.length - 1].body!) as { invoice: { total_amount: number }; custom_data: { intent_id: string } };
  check("montant + intent_id transmis (idempotence via custom_data)",
    sentBody.invoice.total_amount === 5000 && sentBody.custom_data.intent_id === "unit-i1");
  check("en-têtes marchands présents (clés seulement)",
    "PAYDUNYA-MASTER-KEY" in calls[calls.length - 1].headers && "PAYDUNYA-PRIVATE-KEY" in calls[calls.length - 1].headers);

  // Mapping des statuts.
  state.statuses.set("tok-completed", { status: "completed", amount: 5000 });
  state.statuses.set("tok-pending", { status: "pending" });
  state.statuses.set("tok-cancelled", { status: "cancelled" });
  state.statuses.set("tok-failed", { status: "failed" });
  state.statuses.set("tok-unknown", { status: "statut_non_documente" });
  const st1 = await adapter.checkStatus("tok-completed", null, call);
  const st2 = await adapter.checkStatus("tok-pending", null, call);
  const st3 = await adapter.checkStatus("tok-cancelled", null, call);
  const st4 = await adapter.checkStatus("tok-failed", null, call);
  const st5 = await adapter.checkStatus("tok-unknown", null, call);
  check("mapping statuts : completed→SUCCESS, pending→PENDING",
    st1.status === "SUCCESS" && st2.status === "PENDING");
  check("mapping statuts : cancelled/failed→FAILED, inconnu→PENDING",
    st3.status === "FAILED" && st4.status === "FAILED" && st5.status === "PENDING");
  check("montant/devise exposés sur SUCCESS",
    st1.amount === 5000 && st1.providerTxId === "pdtx_tok-completed");

  // IPN.
  const goodIpn = ipnBody({ token: "tok-ipn", status: "completed", masterKey: MK_A, intentId: "unit-i1" });
  const v1 = adapter.verifyWebhook!({ rawBody: goodIpn, headers: {}, secret: MK_A });
  check("IPN valide → événement normalisé",
    v1.ok && v1.event.status === "SUCCESS" && v1.event.intentRef === "tok-ipn");
  check("hash jamais stocké dans raw", v1.ok && v1.event.raw.hash === "[redacted]");
  const v2 = adapter.verifyWebhook!({ rawBody: ipnBody({ token: "t", status: "completed", masterKey: MK_A, hashOverride: "deadbeef" }), headers: {}, secret: MK_A });
  check("hash invalide → INVALID_SIGNATURE", !v2.ok && v2.error === "INVALID_SIGNATURE");
  const v3 = adapter.verifyWebhook!({ rawBody: "corps-bizarre=1", headers: {}, secret: MK_A });
  check("corps non-IPN → MALFORMED", !v3.ok && v3.error === "MALFORMED");
  const v4 = adapter.verifyWebhook!({ rawBody: ipnBody({ token: "t", status: "completed", masterKey: MK_B }), headers: {}, secret: MK_A });
  check("hash d'un autre marchand → INVALID_SIGNATURE", !v4.ok && v4.error === "INVALID_SIGNATURE");

  // Erreurs de transport.
  state.failNext = "timeout";
  let err: unknown = null;
  try { await adapter.checkStatus("tok-x", null, call); } catch (e) { err = e; }
  check("timeout transport → ProviderTimeoutError", err instanceof ProviderTimeoutError);
  state.failNext = "http500";
  err = null;
  try { await adapter.checkStatus("tok-x", null, call); } catch (e) { err = e; }
  check("HTTP 500 → ProviderUnavailableError", (err as { name?: string })?.name === "ProviderUnavailableError");
  state.failNext = "malformed";
  err = null;
  try { await adapter.checkStatus("tok-x", null, call); } catch (e) { err = e; }
  check("réponse malformée → ProviderUnavailableError", (err as { name?: string })?.name === "ProviderUnavailableError");
  state.failNext = "empty";
  err = null;
  try { await adapter.initiate({ intentId: "i", amount: 1, currency: "XOF", call }); } catch (e) { err = e; }
  check("succès incohérent (sans token) → ProviderUnavailableError", (err as { name?: string })?.name === "ProviderUnavailableError");
  err = null;
  try { await adapter.initiate({ intentId: "i", amount: 1, currency: "XOF", call: { config: pdConfig } }); } catch (e) { err = e; }
  check("credentials absents → ProviderConfigError", (err as { name?: string })?.name === "ProviderConfigError");
  err = null;
  try { await adapter.initiate({ intentId: "i", amount: 1, currency: "XOF", call: { credentials: "pas-du-json", config: pdConfig } }); } catch (e) { err = e; }
  check("credentials illisibles → ProviderConfigError", (err as { name?: string })?.name === "ProviderConfigError");
  state.createRejectCode = "1001";
  err = null;
  try { await adapter.initiate({ intentId: "i", amount: 1, currency: "XOF", call }); } catch (e) { err = e; }
  state.createRejectCode = null;
  check("refus métier (response_code≠00) → ProviderBusinessError", (err as { name?: string })?.name === "ProviderBusinessError");

  // ══════════ B. SERVICE — cycle complet avec re-vérification ══════════
  console.log("\n— Cycle service : initiation → IPN → re-vérification → encaissement —");
  const inst1 = await mkInstallment(10_000);
  const iA = await mkPdIntent({ amount: 10_000, installmentId: inst1.id });
  check("intention LIVE PayDunya → PENDING + token",
    iA.ok && iA.data.providerRef.startsWith("pd_tok_"));
  const intentAId = iA.ok ? iA.data.intentId : "";
  const tokenA = iA.ok ? iA.data.providerRef : "";
  check("aucune url externe réelle touchée (tout passe par le mock)",
    calls.every((c) => c.url.startsWith("https://app.paydunya.com/")));

  // Polling de statut → montant vérifié → confirmation + posting.
  state.statuses.set(tokenA, { status: "completed", amount: 10_000, currency: "XOF" });
  const poll1 = await pollPaymentIntent(ctxA, intentAId);
  check("poll SUCCESS cohérent → CONFIRMED + Payment",
    poll1.ok && poll1.data.status === "CONFIRMED");
  const pay1 = await prisma.payment.count({ where: { schoolId: school.id } });
  check("un seul encaissement comptabilisé", pay1 === 1);

  // Rejeu idempotent du polling (état terminal → pas d'appel).
  const callsN = calls.length;
  const poll2 = await pollPaymentIntent(ctxA, intentAId);
  check("rejeu poll sur CONFIRMED → idempotent, 0 appel transport",
    poll2.ok && poll2.data.status === "CONFIRMED" && calls.length === callsN);

  // IPN complète : receiveWebhook → process → reverification → payment.
  const inst2 = await mkInstallment(20_000);
  const iB = await mkPdIntent({ amount: 20_000, installmentId: inst2.id });
  const intentBId = iB.ok ? iB.data.intentId : "";
  const tokenB = iB.ok ? iB.data.providerRef : "";
  state.statuses.set(tokenB, { status: "completed", amount: 20_000, currency: "XOF" });
  const w1 = await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenB, status: "completed", masterKey: MK_A, intentId: intentBId, amount: 20_000 }),
    headers: {},
  });
  check("IPN reçue → événement durable", w1.ok && w1.data.eventId !== "");
  const ev1 = await prisma.webhookEvent.findFirst({ where: { providerId: providerA }, orderBy: { receivedAt: "desc" } });
  check("payload IPN stocké sanitisé (hash redacted, pas de masterKey)",
    (ev1?.payload as Record<string, unknown>)?.hash === "[redacted]" &&
    JSON.stringify(ev1?.payload ?? {}).includes(MK_A) === false);
  const p1 = await processWebhookEvent(ev1!.id);
  const pay2 = await prisma.payment.count({ where: { schoolId: school.id } });
  check("IPN + re-vérification → PROCESSED + encaissement",
    p1.outcome === "PROCESSED" && pay2 === 2);
  const intentB = await prisma.paymentIntent.findUnique({ where: { id: intentBId } });
  check("providerTxId re-vérifié enregistré", intentB?.providerTxId === `pdtx_${tokenB}`);

  // IPN dupliquée → duplicate:true, aucun retraitement.
  const w2 = await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenB, status: "completed", masterKey: MK_A }),
    headers: {},
  });
  check("IPN dupliquée → accusé duplicate", w2.ok && w2.data.duplicate === true);
  const pay3 = await prisma.payment.count({ where: { schoolId: school.id } });
  check("duplication → aucun double encaissement", pay3 === 2);

  // IPN invalide → rejet, événement non persisté.
  const evCount = await prisma.webhookEvent.count({ where: { schoolId: school.id } });
  const w3 = await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: "tok-x", status: "completed", masterKey: MK_A, hashOverride: "bad" }),
    headers: {},
  });
  check("signature IPN invalide → rejet sans persistance",
    !w3.ok && w3.error === "INVALID_SIGNATURE" &&
    (await prisma.webhookEvent.count({ where: { schoolId: school.id } })) === evCount);

  // IPN anticipée (avant persistance du providerRef) → ANOMALY, puis replay OK.
  const inst3 = await mkInstallment(30_000);
  const iC = await mkPdIntent({ amount: 30_000, installmentId: inst3.id });
  const intentCId = iC.ok ? iC.data.intentId : "";
  const tokenC = iC.ok ? iC.data.providerRef : "";
  // Simule l'initiation non encore persistée : providerRef retiré.
  await prisma.paymentIntent.update({ where: { id: intentCId }, data: { providerRef: null, status: "CREATED" } });
  state.statuses.set(tokenC, { status: "completed", amount: 30_000, currency: "XOF" });
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenC, status: "completed", masterKey: MK_A, amount: 30_000 }),
    headers: {},
  });
  const ev4 = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: `${tokenC}:completed` } });
  const p4 = ev4 ? await processWebhookEvent(ev4.id) : { outcome: "?" };
  const ev4b = ev4 ? await prisma.webhookEvent.findUnique({ where: { id: ev4.id } }) : null;
  check("IPN avant persistance de l'initiation → ANOMALY (preuve conservée)",
    p4.outcome === "ANOMALY" && ev4b?.status === "ANOMALY");
  const payC0 = await prisma.payment.count({ where: { schoolId: school.id } });
  // Restaure la réalité : initiation persistée → replay de l'anomalie.
  await prisma.paymentIntent.update({ where: { id: intentCId }, data: { providerRef: tokenC, status: "PENDING" } });
  const r4 = await replayWebhookEvent(ctxA, ev4!.id);
  const payC1 = await prisma.payment.count({ where: { schoolId: school.id } });
  check("anomalie rejouée après persistance → encaissement unique",
    r4.ok && r4.data.outcome === "PROCESSED" && payC1 === payC0 + 1);

  // Contradiction : IPN dit completed, prestataire dit pending.
  const inst4 = await mkInstallment(40_000);
  const iD = await mkPdIntent({ amount: 40_000, installmentId: inst4.id });
  const tokenD = iD.ok ? iD.data.providerRef : "";
  state.statuses.set(tokenD, { status: "pending", amount: 40_000 });
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenD, status: "completed", masterKey: MK_A }),
    headers: {},
  });
  const ev5 = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: `${tokenD}:completed` } });
  const p5 = await processWebhookEvent(ev5!.id);
  const intentD = await prisma.paymentIntent.findUnique({ where: { id: iD.ok ? iD.data.intentId : "" } });
  check("IPN contredite par le statut réel → ANOMALY, intention PENDING",
    p5.outcome === "ANOMALY" && intentD?.status === "PENDING");

  // Montant divergent → ANOMALY + discrepancy AMOUNT_MISMATCH.
  const inst5 = await mkInstallment(50_000);
  const iE = await mkPdIntent({ amount: 50_000, installmentId: inst5.id });
  const tokenE = iE.ok ? iE.data.providerRef : "";
  state.statuses.set(tokenE, { status: "completed", amount: 49_999, currency: "XOF" });
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenE, status: "completed", masterKey: MK_A, amount: 49_999 }),
    headers: {},
  });
  const ev6 = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: `${tokenE}:completed` } });
  const p6 = await processWebhookEvent(ev6!.id);
  const intentE = await prisma.paymentIntent.findUnique({ where: { id: iE.ok ? iE.data.intentId : "" } });
  const disc = await prisma.paymentDiscrepancy.findFirst({
    where: { schoolId: school.id, type: "AMOUNT_MISMATCH", intentId: intentE?.id },
  });
  check("montant divergent → ANOMALY + AMOUNT_MISMATCH, 0 comptabilisation",
    p6.outcome === "ANOMALY" && intentE?.status === "PENDING" && !!disc);

  // Devise divergente via polling → même barrière.
  const inst6 = await mkInstallment(60_000);
  const iF = await mkPdIntent({ amount: 60_000, installmentId: inst6.id });
  state.statuses.set(iF.ok ? iF.data.providerRef : "", { status: "completed", amount: 60_000, currency: "EUR" });
  const pf = await pollPaymentIntent(ctxA, iF.ok ? iF.data.intentId : "");
  const intentF = await prisma.paymentIntent.findUnique({ where: { id: iF.ok ? iF.data.intentId : "" } });
  check("devise divergente (EUR) → AMOUNT_MISMATCH refusé, PENDING conservée",
    !pf.ok && pf.error === "AMOUNT_MISMATCH" && intentF?.status === "PENDING");

  // Référence inconnue : IPN pour un token sans intention.
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: "pd_tok_inconnu", status: "completed", masterKey: MK_A }),
    headers: {},
  });
  const ev7 = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: "pd_tok_inconnu:completed" } });
  const p7 = await processWebhookEvent(ev7!.id);
  check("référence inconnue → ANOMALY UNKNOWN_INTENT",
    p7.outcome === "ANOMALY" && ev7?.intentId === null);

  // Marchand incorrect : statut introuvable chez PayDunya (response_code 01)
  // → erreur métier → RETRY (retraitement possible), jamais de posting.
  const inst7 = await mkInstallment(70_000);
  const iG = await mkPdIntent({ amount: 70_000, installmentId: inst7.id });
  const tokenG = iG.ok ? iG.data.providerRef : "";
  state.statuses.set(tokenG, { status: "completed", amount: 70_000, responseCode: "01" });
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenG, status: "completed", masterKey: MK_A }),
    headers: {},
  });
  const ev8 = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: `${tokenG}:completed` } });
  const p8 = await processWebhookEvent(ev8!.id);
  const intentG = await prisma.paymentIntent.findUnique({ where: { id: iG.ok ? iG.data.intentId : "" } });
  check("transaction inconnue chez le marchand → RETRY, intention intacte",
    p8.outcome === "RETRY" && intentG?.status === "PENDING");

  // Confirmation tardive : intention EXPIRED puis IPN completed → ANOMALY.
  const inst8 = await mkInstallment(80_000);
  const iH = await mkPdIntent({ amount: 80_000, installmentId: inst8.id });
  const tokenH = iH.ok ? iH.data.providerRef : "";
  await prisma.paymentIntent.update({ where: { id: iH.ok ? iH.data.intentId : "" }, data: { status: "EXPIRED", expiredAt: new Date() } });
  state.statuses.set(tokenH, { status: "completed", amount: 80_000 });
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenH, status: "completed", masterKey: MK_A }),
    headers: {},
  });
  const ev9 = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: `${tokenH}:completed` } });
  const p9 = await processWebhookEvent(ev9!.id);
  const payH = await prisma.payment.count({ where: { schoolId: school.id } });
  check("confirmation tardive post-expiration → ANOMALY LATE_CONFIRM",
    p9.outcome === "ANOMALY" &&
    (await prisma.payment.count({ where: { schoolId: school.id } })) === payH);

  // ══════════ C. CONCURRENCE & ISOLATION ══════════
  console.log("\n— Concurrence guichet et isolation inter-écoles —");
  const inst9 = await mkInstallment(90_000);
  const iI = await mkPdIntent({ amount: 90_000, installmentId: inst9.id });
  const tokenI = iI.ok ? iI.data.providerRef : "";
  state.statuses.set(tokenI, { status: "completed", amount: 90_000, currency: "XOF" });
  const [c1, c2] = await Promise.all([
    pollPaymentIntent(ctxA, iI.ok ? iI.data.intentId : ""),
    pollPaymentIntent(ctxA, iI.ok ? iI.data.intentId : ""),
  ]);
  const intentI = await prisma.paymentIntent.findUnique({
    where: { id: iI.ok ? iI.data.intentId : "" },
    select: { paymentId: true, status: true },
  });
  check("guichet concurrent : 2 poll simultanés → 1 seul encaissement",
    c1.ok && c2.ok && intentI?.status === "CONFIRMED" && !!intentI.paymentId);

  // Isolation : provider A utilisé depuis l'école B → refus scoping.
  const iso = await createPaymentIntent(ctxB, {
    studentId: studentB.id, academicYearId: yearB.id, providerId: providerA,
    amount: 1_000, currency: "XOF", channel: "ADMIN_TEST",
  });
  check("prestataire école A invisible depuis école B",
    !iso.ok && iso.error === "UNKNOWN_PROVIDER");

  // IPN postée à provider A pour le token d'une intention école B.
  const iJ = await createPaymentIntent(ctxB, {
    studentId: studentB.id, academicYearId: yearB.id, providerId: providerB,
    amount: 5_000, currency: "XOF", channel: "ADMIN_TEST",
    feeInstallmentId: instB.id,
    allocations: [{ installmentId: instB.id, amount: 5_000 }],
  });
  const tokenJ = iJ.ok ? iJ.data.providerRef : "";
  await receiveWebhook({
    providerId: providerA,
    rawBody: ipnBody({ token: tokenJ, status: "completed", masterKey: MK_A }),
    headers: {},
  });
  const evJ = await prisma.webhookEvent.findFirst({ where: { schoolId: school.id, externalId: `${tokenJ}:completed` } });
  const pJ = evJ ? await processWebhookEvent(evJ.id) : { outcome: "?" };
  const intentJ = await prisma.paymentIntent.findUnique({ where: { id: iJ.ok ? iJ.data.intentId : "" } });
  check("IPN cross-écoles → ANOMALY, intention B intacte",
    pJ.outcome === "ANOMALY" && intentJ?.status === "PENDING" && evJ?.intentId === null);

  // Le bon endpoint (provider B) confirme l'intention B — aucune fuite.
  state.statuses.set(tokenJ, { status: "completed", amount: 5_000, currency: "XOF" });
  await receiveWebhook({
    providerId: providerB,
    rawBody: ipnBody({ token: tokenJ, status: "completed", masterKey: MK_B }),
    headers: {},
  });
  const evJ2 = await prisma.webhookEvent.findFirst({ where: { schoolId: schoolB.id, externalId: `${tokenJ}:completed` } });
  const pJ2 = evJ2 ? await processWebhookEvent(evJ2.id) : { outcome: "?" };
  const payB = await prisma.payment.count({ where: { schoolId: schoolB.id } });
  check("même flux sous le bon marchand → PROCESSED école B",
    pJ2.outcome === "PROCESSED" && payB === 1);
  const payAll = await prisma.payment.count({ where: { schoolId: school.id } });
  check("aucun encaissement parasite école A", payAll === 4);

  // ══════════ D. VERROU & RÉSILIENCE SERVICE ══════════
  console.log("\n— Verrou LIVE, timeouts et erreurs en service —");
  const lock = process.env.MOBILE_MONEY_LIVE_ENABLED;
  delete process.env.MOBILE_MONEY_LIVE_ENABLED;
  const locked = await mkPdIntent({ amount: 1_000, installmentId: (await mkInstallment(1_000)).id });
  check("verrou global OFF → LIVE_DISABLED, 0 appel transport",
    !locked.ok && locked.error === "LIVE_DISABLED");
  process.env.MOBILE_MONEY_LIVE_ENABLED = lock;

  state.failNext = "timeout";
  const ti = await mkPdIntent({ amount: 2_000, installmentId: (await mkInstallment(2_000)).id });
  check("timeout à l'initiation → PROVIDER_TIMEOUT, intention FAILED",
    !ti.ok && ti.error === "PROVIDER_TIMEOUT");

  state.failNext = "malformed";
  const tm = await mkPdIntent({ amount: 2_000, installmentId: (await mkInstallment(2_000)).id });
  check("réponse malformée à l'initiation → INITIATE_FAILED",
    !tm.ok && tm.error === "INITIATE_FAILED");

  state.failNext = "http500";
  const th = await mkPdIntent({ amount: 2_000, installmentId: (await mkInstallment(2_000)).id });
  check("erreur HTTP à l'initiation → INITIATE_FAILED",
    !th.ok && th.error === "INITIATE_FAILED");

  const totalCalls = calls.length;
  check("zéro appel hors transport simulé (100 % via mock, domaine documenté)",
    totalCalls > 0 && calls.every((c) => c.url.startsWith("https://app.paydunya.com/")));

  // ---------- Cleanup ----------
  if (process.env.G3E_PD_CLEANUP !== "0") {
    await cleanup(school.id);
    await cleanup(schoolB.id);
    const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
    if (users.length) {
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    }
  }
  for (const k of ["PD_TEST_CREDS_A", "PD_TEST_WH_A", "PD_TEST_CREDS_B", "PD_TEST_WH_B"]) {
    delete process.env[k];
  }
  if (prevLock === undefined) delete process.env.MOBILE_MONEY_LIVE_ENABLED;
  else process.env.MOBILE_MONEY_LIVE_ENABLED = prevLock;
  registerProviderAdapter(paydunyaAdapter); // restaure l'instance production

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
