/**
 * Recette G3-B — webhooks sécurisés, confirmation fiable, reprise auto.
 *
 * Couvre : signature valide/invalide/modifiée/expirée, déduplication,
 * rejeu, prestataire inconnu, isolation inter-écoles, événements
 * simultanés et désordonnés, webhook+polling concurrents, crash après
 * réception / avant traitement / après recordPayment, repost
 * idempotent, jour clôturé, confirmation tardive, échec prestataire,
 * absence d'encaissement réel sandbox, notifications, audit.
 *
 * Usage : npx tsx scripts/g3/payments-g3b-recette.ts
 *         G3B_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";

// Secret sandbox de recette — résolu par référence d'env comme en prod.
const SECRET = "g3b-webhook-secret";
process.env.MOBILE_MONEY_SANDBOX_WEBHOOK_SECRET = SECRET;

import { prisma } from "../../src/lib/db/prisma";
import { PaymentMethod } from "@prisma/client";
import { userHasSchoolPermission } from "../../src/lib/permissions/rbac";
import { recordPayment } from "../../src/lib/services/finance/payments";
import { runDueJobs } from "../../src/lib/services/comm/queue";
import {
  createPaymentIntent,
  createPaymentProvider,
  expireDuePaymentIntents,
  getPaymentIntent,
  pollPaymentIntent,
} from "../../src/lib/services/payments/mobileIntents";
import {
  listWebhookEvents,
  pollUncertainIntents,
  processWebhookEvent,
  receiveWebhook,
  registerMobileMoneyHandlers,
  replayWebhookEvent,
  repostPendingPostings,
  sweepUnprocessedWebhookEvents,
} from "../../src/lib/services/payments/webhooks";
import { sandboxWebhookSignature } from "../../src/lib/services/payments/providers/sandbox";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3B-FX";
const FX2 = "G3B-OTHER";
const EMAILS = ["g3b-admin@test.local", "g3b-other@test.local"];

async function cleanup(schoolId: string) {
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
  await prisma.cashClosure.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
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
    data: { email, passwordHash: "x", firstName: "G3B", lastName: email },
  });
  const role = await prisma.role.create({ data: { name: `G3B_${email}`, scope: "SCHOOL", schoolId } });
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

/** Construit un appel webhook signé — signature sur octets bruts. */
async function sendWebhook(
  providerId: string,
  event: Record<string, unknown>,
  opts: { secret?: string; ageSeconds?: number; tamper?: boolean } = {},
) {
  let rawBody = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0));
  const signature = sandboxWebhookSignature(rawBody, ts, opts.secret ?? SECRET);
  if (opts.tamper) rawBody = rawBody.replace("SUCCESS", "SUCCESX");
  return receiveWebhook({
    providerId,
    rawBody,
    headers: { "x-sandbox-timestamp": ts, "x-sandbox-signature": signature },
  });
}

const ev = (eventId: string, intentRef: string, status = "SUCCESS", extra: Record<string, unknown> = {}) => ({
  eventId, intentRef, status,
  providerTxId: `SBTX-${eventId}`,
  occurredAt: new Date().toISOString(),
  ...extra,
});

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

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3b-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g3b-other" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const yearB = await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  const cat2 = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "CANT", label: "Cantine" } });
  const cat3 = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "TRAN", label: "Transport" } });

  const mkStudent = async (mat: string, sId: string) =>
    prisma.student.create({
      data: { schoolId: sId, matricule: mat, firstName: "Élève", lastName: mat, status: "ACTIVE" },
    });
  const admin = await makeMember("g3b-admin@test.local", school.id, [
    "mobilepayments.read", "mobilepayments.manage", "mobilepayments.simulate",
  ]);
  const other = await makeMember("g3b-other@test.local", schoolB.id, [
    "mobilepayments.read", "mobilepayments.manage", "mobilepayments.simulate",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const ctxB = { userId: other.id, schoolId: schoolB.id };

  const pA = await createPaymentProvider(ctxA, { code: "SANDBOX", label: "Simu A", mode: "SANDBOX" });
  const pB = await createPaymentProvider(ctxB, { code: "SANDBOX", label: "Simu B", mode: "SANDBOX" });
  const providerA = pA.ok ? pA.data.id : "";
  const providerB = pB.ok ? pB.data.id : "";

  const mkIntent = async (mat: string, extra: Record<string, unknown> = {}) => {
    const st = await mkStudent(mat, school.id);
    const r = await createPaymentIntent(ctxA, {
      studentId: st.id, academicYearId: year.id, amount: 5000, currency: "XOF",
      providerId: providerA, sandboxOutcome: "PENDING", ...extra,
    });
    const intent = r.ok ? await prisma.paymentIntent.findUnique({ where: { id: r.data.intentId } }) : null;
    return { student: st, res: r, intent };
  };

  // ══════════════════ SÉCURITÉ DES WEBHOOKS ══════════════════
  console.log("\n— Vérification cryptographique —");
  const w1 = await mkIntent("G3B-W01");
  const ref1 = w1.intent?.providerRef ?? "";

  const bad = await sendWebhook(providerA, ev("EV-BAD", ref1), { secret: "wrong" });
  check("signature invalide → INVALID_SIGNATURE", !bad.ok && bad.error === "INVALID_SIGNATURE");
  const tampered = await sendWebhook(providerA, ev("EV-TAMPER", ref1), { tamper: true });
  check("corps modifié après signature → INVALID_SIGNATURE", !tampered.ok && tampered.error === "INVALID_SIGNATURE");
  const old = await sendWebhook(providerA, ev("EV-OLD", ref1), { ageSeconds: 400 });
  check("signature expirée → EXPIRED", !old.ok && old.error === "EXPIRED");
  const noRows = await prisma.webhookEvent.count({ where: { schoolId: school.id } });
  check("événements rejetés non persistés", noRows === 0);
  const unknown = await sendWebhook("cuk_unknownprovider", ev("EV-X", ref1));
  check("prestataire inconnu → NOT_FOUND", !unknown.ok && unknown.error === "NOT_FOUND");
  const noSecret = await prisma.paymentProvider.update({
    where: { id: providerA }, data: { webhookSecretRef: "MISSING_ENV_VAR_XYZ" },
  });
  void noSecret;
  const noCfg = await sendWebhook(providerA, ev("EV-NOCFG", ref1));
  check("secret non configuré → PROVIDER_NOT_CONFIGURED", !noCfg.ok && noCfg.error === "PROVIDER_NOT_CONFIGURED");
  await prisma.paymentProvider.update({ where: { id: providerA }, data: { webhookSecretRef: null } });

  // ── Signature valide ──
  const okWh = await sendWebhook(providerA, ev("EV-W1", ref1));
  check("signature valide → événement accepté", okWh.ok && !okWh.data.duplicate);
  const evtW1 = await prisma.webhookEvent.findFirst({ where: { providerId: providerA, externalId: "EV-W1" } });
  check("événement durable RECEIVED enregistré avant traitement",
    !!evtW1 && evtW1.status === "RECEIVED" && evtW1.signatureValid);
  check("job de traitement enfilé",
    (await prisma.job.count({ where: { type: "mm.webhook.process", schoolId: school.id } })) >= 1);
  check("aucun secret/signature stocké",
    !!evtW1 && !JSON.stringify(evtW1.payload).includes(signatureOf("EV-W1", ref1)));

  // ── Déduplication / rejeu ──
  const dupWh = await sendWebhook(providerA, ev("EV-W1", ref1));
  check("même externalId → accusé dupliqué", dupWh.ok && dupWh.data.duplicate);
  check("une seule ligne WebhookEvent par (provider, externalId)",
    (await prisma.webhookEvent.count({ where: { providerId: providerA, externalId: "EV-W1" } })) === 1);

  const p1r = await processWebhookEvent(evtW1!.id);
  check("SUCCESS webhook sandbox → intention confirmée (simulation)",
    p1r.outcome === "PROCESSED" && (await getPaymentIntent(ctxA, w1.intent!.id))?.status === "CONFIRMED");
  check("aucun encaissement réel créé par une confirmation sandbox",
    (await prisma.payment.count({ where: { studentId: w1.student.id } })) === 0);
  const p1r2 = await processWebhookEvent(evtW1!.id);
  check("rejeu du traitement → no-op idempotent", p1r2.outcome === "PROCESSED");

  // ══════════════════ ORDONNANCEMENT ══════════════════
  console.log("\n— Événements désordonnés / contradictions —");
  // FAILED après CONFIRMED → anomalie, intention préservée.
  await sendWebhook(providerA, ev("EV-W1-FAIL", ref1, "FAILED", { reason: "LATE_REFUSAL" }));
  const evFail = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W1-FAIL" } });
  const failAfterConf = await processWebhookEvent(evFail!.id);
  check("FAILED après CONFIRMED → ANOMALY tracée", failAfterConf.outcome === "ANOMALY");
  check("intention confirmée NON rétrogradée",
    (await getPaymentIntent(ctxA, w1.intent!.id))?.status === "CONFIRMED");
  const notifAnom = await prisma.notification.findFirst({
    where: { schoolId: school.id, title: { contains: "Anomalie" } },
  });
  check("alerte interne créée pour l'anomalie", !!notifAnom);

  // Ordre inverse : FAILED puis SUCCESS (arrivée tardive) → contradiction.
  const w2 = await mkIntent("G3B-W02");
  const ref2 = w2.intent?.providerRef ?? "";
  await sendWebhook(providerA, ev("EV-W2-F", ref2, "FAILED"));
  const evW2f = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W2-F" } });
  const w2f = await processWebhookEvent(evW2f!.id);
  check("FAILED sur intention PENDING → intention FAILED",
    w2f.outcome === "PROCESSED" && (await getPaymentIntent(ctxA, w2.intent!.id))?.status === "FAILED");
  await sendWebhook(providerA, ev("EV-W2-S", ref2, "SUCCESS"));
  const evW2s = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W2-S" } });
  const w2s = await processWebhookEvent(evW2s!.id);
  check("SUCCESS après FAILED terminal → ANOMALY (contradiction)",
    w2s.outcome === "ANOMALY");
  check("intention reste FAILED (pas de résurrection silencieuse)",
    (await getPaymentIntent(ctxA, w2.intent!.id))?.status === "FAILED");

  // ── Confirmation tardive après EXPIRED ──
  const w3 = await mkIntent("G3B-W03");
  const ref3 = w3.intent?.providerRef ?? "";
  await prisma.paymentIntent.update({ where: { id: w3.intent!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expireDuePaymentIntents({ userId: null, schoolId: school.id });
  await sendWebhook(providerA, ev("EV-W3-LATE", ref3, "SUCCESS"));
  const evLate = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W3-LATE" } });
  const late = await processWebhookEvent(evLate!.id);
  check("SUCCESS après EXPIRED → ANOMALY rapprochement", late.outcome === "ANOMALY");
  check("intention expirée inchangée", (await getPaymentIntent(ctxA, w3.intent!.id))?.status === "EXPIRED");

  // ── Isolation inter-écoles ──
  console.log("\n— Isolation —");
  const wB = await (async () => {
    const st = await mkStudent("G3B-B01", schoolB.id);
    const r = await createPaymentIntent(ctxB, {
      studentId: st.id, academicYearId: yearB.id, amount: 4000, currency: "XOF",
      providerId: providerB, sandboxOutcome: "PENDING",
    });
    return prisma.paymentIntent.findUnique({ where: { id: r.ok ? r.data.intentId : "" } });
  })();
  // Événement signé pour provider A mais visant la réf de l'école B.
  await sendWebhook(providerA, ev("EV-CROSS", wB?.providerRef ?? "?", "SUCCESS"));
  const evCross = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-CROSS" } });
  const cross = await processWebhookEvent(evCross!.id);
  check("événement ciblant une intention d'une autre école → ANOMALY",
    cross.outcome === "ANOMALY");
  check("intention de l'école B intacte",
    (await prisma.paymentIntent.findUnique({ where: { id: wB!.id } }))?.status === "PENDING");
  const eventsB = await listWebhookEvents(ctxB);
  check("liste webhooks isolée par école", eventsB.every((e) => e.schoolId === schoolB.id));
  const replayCross = await replayWebhookEvent(ctxB, evCross!.id);
  check("relance cross-school → NOT_FOUND", !replayCross.ok && replayCross.error === "NOT_FOUND");

  // ── Concurrence ──
  console.log("\n— Concurrence —");
  const w4 = await mkIntent("G3B-W04");
  const ref4 = w4.intent?.providerRef ?? "";
  await sendWebhook(providerA, ev("EV-W4-A", ref4, "SUCCESS"));
  await sendWebhook(providerA, ev("EV-W4-B", ref4, "SUCCESS"));
  const [eA, eB] = await prisma.webhookEvent.findMany({
    where: { externalId: { in: ["EV-W4-A", "EV-W4-B"] } }, orderBy: { receivedAt: "asc" },
  });
  const [cA, cB] = await Promise.all([processWebhookEvent(eA.id), processWebhookEvent(eB.id)]);
  check("deux webhooks SUCCESS simultanés → traités sans double effet",
    [cA.outcome, cB.outcome].every((o) => o === "PROCESSED") &&
    (await getPaymentIntent(ctxA, w4.intent!.id))?.status === "CONFIRMED");

  // Webhook et polling concurrents.
  const w5 = await mkIntent("G3B-W05");
  const ref5 = w5.intent?.providerRef ?? "";
  await sendWebhook(providerA, ev("EV-W5", ref5, "SUCCESS"));
  const evW5 = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W5" } });
  const [wh, pl] = await Promise.all([
    processWebhookEvent(evW5!.id),
    pollPaymentIntent(ctxA, w5.intent!.id),
  ]);
  const stW5 = (await getPaymentIntent(ctxA, w5.intent!.id))?.status;
  check("webhook + polling concurrents → une seule confirmation",
    wh.outcome === "PROCESSED" && pl.ok && stW5 === "CONFIRMED");

  // ══════════════════ REPRISE APRÈS CRASH ══════════════════
  console.log("\n— Crash / reprise —");
  // Crash après réception : l'événement reste RECEIVED, le sweep le reprend.
  const w6 = await mkIntent("G3B-W06");
  const ref6 = w6.intent?.providerRef ?? "";
  await sendWebhook(providerA, ev("EV-W6", ref6, "SUCCESS"));
  const evW6 = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W6" } });
  check("crash après réception : événement RECEIVED persisté", evW6?.status === "RECEIVED");
  await prisma.webhookEvent.update({
    where: { id: evW6!.id },
    data: { receivedAt: new Date(Date.now() - 120_000) },
  });
  const swept = await sweepUnprocessedWebhookEvents({ limit: 10 });
  check("sweep reprend les événements non traités", swept.enqueued >= 1);
  registerMobileMoneyHandlers();
  const jobs = await runDueJobs({ limit: 50 });
  check("jobs webhook exécutés", jobs.done >= 1);
  check("événement repris → PROCESSED + intention CONFIRMED",
    (await prisma.webhookEvent.findUnique({ where: { id: evW6!.id } }))?.status === "PROCESSED" &&
    (await getPaymentIntent(ctxA, w6.intent!.id))?.status === "CONFIRMED");

  // Crash avant traitement (job interrompu) : event marqué PROCESSING
  // obsolète → le sweep le remet en RECEIVED.
  const w7 = await mkIntent("G3B-W07");
  const ref7 = w7.intent?.providerRef ?? "";
  await sendWebhook(providerA, ev("EV-W7", ref7, "SUCCESS"));
  const evW7 = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-W7" } });
  await prisma.webhookEvent.update({
    where: { id: evW7!.id },
    data: { status: "PROCESSING", receivedAt: new Date(Date.now() - 120_000) },
  });
  await sweepUnprocessedWebhookEvents({ limit: 10 });
  check("PROCESSING obsolète remis en RECEIVED",
    (await prisma.webhookEvent.findUnique({ where: { id: evW7!.id } }))?.status === "RECEIVED");
  await runDueJobs({ limit: 50 });
  check("événement interrompu retraité",
    (await prisma.webhookEvent.findUnique({ where: { id: evW7!.id } }))?.status === "PROCESSED");

  // ── Repost automatique (jour clôturé, crash post-recordPayment) ──
  console.log("\n— Repost automatique —");
  const TEST_POST = { __allowSandboxPosting: true }; // fixture isolée
  const mkPostingIntent = async (mat: string, catId: string, amount: number) => {
    const st = await mkStudent(mat, school.id);
    const charge = await prisma.studentFeeCharge.create({
      data: { schoolId: school.id, studentId: st.id, academicYearId: year.id, categoryId: catId, amount },
    });
    const inst = await prisma.feeInstallment.create({
      data: { schoolId: school.id, chargeId: charge.id, studentId: st.id, academicYearId: year.id, dueDate: new Date("2026-12-01"), amount },
    });
    const r = await createPaymentIntent(ctxA, {
      studentId: st.id, academicYearId: year.id, amount, currency: "XOF",
      providerId: providerA, feeInstallmentId: inst.id,
      allocations: [{ installmentId: inst.id, amount }],
      sandboxOutcome: "PENDING",
    });
    return { student: st, intentId: r.ok ? r.data.intentId : "", installment: inst };
  };

  // Jour clôturé → repost conserve l'attente ; réouverture → comptabilisé.
  // (confirmation prestataire déjà reçue : statut posé directement)
  const pj = await mkPostingIntent("G3B-P01", cat.id, 9000);
  const closure = await prisma.cashClosure.create({
    data: { schoolId: school.id, date: new Date(), totalAmount: 0, paymentsCount: 0, closedById: admin.id },
  });
  await prisma.paymentIntent.update({
    where: { id: pj.intentId },
    data: { status: "CONFIRMED_PENDING_POSTING", updatedAt: new Date(Date.now() - 600_000) },
  });
  const rep1 = await repostPendingPostings({ ...TEST_POST });
  check("jour clôturé → repost diffère (aucun paiement perdu)",
    rep1.still >= 1 && (await prisma.payment.count({ where: { studentId: pj.student.id } })) === 0);
  await prisma.cashClosure.delete({ where: { id: closure.id } });
  const rep2 = await repostPendingPostings({ ...TEST_POST });
  const detPj = await getPaymentIntent(ctxA, pj.intentId);
  check("réouverture → repost comptabilise via recordPayment",
    rep2.posted >= 1 && detPj?.status === "CONFIRMED" && !!detPj?.payment?.receiptNumber);
  const rep3 = await repostPendingPostings({ ...TEST_POST });
  check("repost rejoué → idempotent, aucun double encaissement",
    rep3.posted === 0 && (await prisma.payment.count({ where: { studentId: pj.student.id } })) === 1);

  // Crash après recordPayment : paiement existant sous mm:{id}.
  const pc = await mkPostingIntent("G3B-P02", cat2.id, 7000);
  await recordPayment(ctxA, {
    studentId: pc.student.id, academicYearId: year.id, amount: 7000,
    method: PaymentMethod.MOBILE_MONEY, reference: "SBTX-G3B-CRASH",
    idempotencyKey: `mm:${pc.intentId}`,
  });
  await prisma.paymentIntent.update({
    where: { id: pc.intentId },
    data: { status: "CONFIRMED_PENDING_POSTING", updatedAt: new Date(Date.now() - 600_000) },
  });
  const payBefore = await prisma.payment.count({ where: { studentId: pc.student.id } });
  await repostPendingPostings({ ...TEST_POST });
  check("crash post-recordPayment → repost rattache sans doublon",
    (await prisma.payment.count({ where: { studentId: pc.student.id } })) === payBefore &&
    (await getPaymentIntent(ctxA, pc.intentId))?.status === "CONFIRMED");

  // Échec persistant : sandbox CPP sans drapeau → la barrière tient,
  // tentatives tracées, alerte interne.
  const pf = await mkPostingIntent("G3B-P03", cat3.id, 6000);
  await prisma.paymentIntent.update({
    where: { id: pf.intentId },
    data: { status: "CONFIRMED_PENDING_POSTING", updatedAt: new Date(Date.now() - 600_000) },
  });
  await repostPendingPostings({}); // sandbox, sans drapeau interne
  check("repost sandbox sans drapeau → refusé (barrière G3-A dans le cron)",
    (await getPaymentIntent(ctxA, pf.intentId))?.status === "CONFIRMED_PENDING_POSTING" &&
    (await prisma.payment.count({ where: { studentId: pf.student.id } })) === 0);

  // ── Polling de secours ──
  console.log("\n— Polling de secours —");
  const w8 = await mkIntent("G3B-W08", { sandboxOutcome: "SUCCESS" });
  await prisma.paymentIntent.update({
    where: { id: w8.intent!.id },
    data: { createdAt: new Date(Date.now() - 45 * 60 * 1000) },
  });
  const polled = await pollUncertainIntents({ limit: 10, minAgeMin: 30 });
  check("polling de secours cible les intentions incertaines", polled.polled >= 1);
  check("intention sandbox polluée → confirmée (simulation, même mécanisme)",
    (await getPaymentIntent(ctxA, w8.intent!.id))?.status === "CONFIRMED" &&
    (await prisma.payment.count({ where: { studentId: w8.student.id } })) === 0);
  // Intention trop récente : non candidate.
  const w9 = await mkIntent("G3B-W09");
  const polled2 = await pollUncertainIntents({ limit: 10, minAgeMin: 30 });
  void polled2;
  check("intention récente non polluée", (await getPaymentIntent(ctxA, w9.intent!.id))?.status === "PENDING");

  // ── Événement PENDING → ignoré proprement ──
  await sendWebhook(providerA, ev("EV-PEND", w9.intent!.providerRef!, "PENDING"));
  const evPend = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-PEND" } });
  const pRes = await processWebhookEvent(evPend!.id);
  check("événement PENDING → IGNORED (pas de confirmation)", pRes.outcome === "IGNORED");

  // ── Erreur technique : intentRef inconnu ──
  await sendWebhook(providerA, ev("EV-GHOST", "REF-INCONNUE", "SUCCESS"));
  const evGhost = await prisma.webhookEvent.findFirst({ where: { externalId: "EV-GHOST" } });
  const ghost = await processWebhookEvent(evGhost!.id);
  check("référence prestataire incohérente → ANOMALY", ghost.outcome === "ANOMALY");

  // ── Relance administrative ──
  const replay = await replayWebhookEvent(ctxA, evGhost!.id);
  check("relance admin sur ANOMALY → retraitée", replay.ok && replay.data.outcome === "ANOMALY");
  const replayInvalid = await replayWebhookEvent(ctxA, evPend!.id);
  check("relance sur IGNORED → INVALID_STATE", !replayInvalid.ok);

  // ── Audit ──
  console.log("\n— Audit —");
  const audits = await prisma.auditLog.findMany({ where: { schoolId: school.id } });
  check("audit payment_webhook.received", audits.some((a) => a.action === "payment_webhook.received"));
  check("audit payment_webhook.rejected", audits.some((a) => a.action === "payment_webhook.rejected"));
  check("audit payment_webhook.replayed", audits.some((a) => a.action === "payment_webhook.replayed"));
  check("audit sans secret ni signature",
    audits.every((a) => !JSON.stringify(a.metadata).includes(SECRET)));
  const evts = await prisma.webhookEvent.findMany({ where: { schoolId: school.id } });
  check("payloads stockés sanitisés (pas de signature/secret)",
    evts.every((e) => !JSON.stringify(e.payload).match(/secret|signature/i)));

  // ── Permissions ──
  check("admin a mobilepayments.manage",
    await userHasSchoolPermission({ userId: admin.id, schoolId: school.id, permissionKey: "mobilepayments.manage" }));

  // ── Bilan financier ──
  const totalPayments = await prisma.payment.count({ where: { schoolId: school.id } });
  check("encaissements réels = uniquement les 2 fixtures comptabilisées", totalPayments === 2);
  const totalReceipts = await prisma.payment.count({ where: { schoolId: school.id, receiptNumber: { not: null } } });
  check("un seul reçu par encaissement", totalReceipts === 2);

  // ---------- Nettoyage ----------
  if (process.env.G3B_CLEANUP === "1") {
    await cleanup(school.id);
    await cleanup(schoolB.id);
    for (const email of EMAILS) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (u) {
        await prisma.schoolMembership.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }
    console.log("\nFixtures supprimées (G3B_CLEANUP=1).");
  } else {
    console.log("\nFixtures conservées — relancer avec G3B_CLEANUP=1 pour nettoyer.");
  }

  console.log(`\n===== RÉSULTAT : ${pass} PASS / ${fail} FAIL =====`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

function signatureOf(eventId: string, ref: string) {
  return sandboxWebhookSignature(JSON.stringify(ev(eventId, ref)),
    String(Math.floor(Date.now() / 1000)), SECRET).slice(0, 12);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
