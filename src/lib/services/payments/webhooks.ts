/**
 * G3-B — Webhooks prestataires : réception, vérification, déduplication,
 * traitement fiable des confirmations, reprise automatique.
 *
 * Séparation stricte :
 *   `receiveWebhook` — vérifie l'authenticité (signature adaptateur,
 *   octets bruts, temps constant, fraîcheur), résout fournisseur ET
 *   école côté serveur (le schoolId du payload n'est jamais utilisé),
 *   enregistre l'événement DURABLEMENT puis l'enfile pour traitement.
 *   Un crash après réception ne perd aucun événement authentifié.
 *   `processWebhookEvent` — applique l'événement sous le MÊME verrou
 *   que `confirmIntent` (`mm-confirm:{intentId}`) : webhook et polling
 *   partagent la machine à états, sans divergence.
 *
 * Ordonnancement : une intention CONFIRMED n'est jamais rétrogradée
 * par un événement plus tardif — toute contradiction financière
 * devient une ANOMALY tracée + alerte interne (rapprochement manuel).
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import { enqueueJob, registerJobHandler } from "@/lib/services/comm/queue";
import { checkRemoteExecution, getProviderAdapter, isLivePaymentsEnabled } from "./providers";
import type { RemoteEnv } from "./providers";
import {
  confirmIntent,
  expireDuePaymentIntents,
  intentRemoteEnv,
  liveCallContext,
  pollPaymentIntent,
  postConfirmedIntent,
} from "./mobileIntents";
import {
  ensureDiscrepancy,
  flagMissingSettlements,
  flagUnconfirmedRefunds,
  syncReconciliations,
} from "./reconciliation";
import type { Prisma, WebhookEventStatus } from "@prisma/client";

const MAX_BODY_BYTES = 16 * 1024;
const STALE_EVENT_MS = 60 * 1000;
const REPOST_GRACE_MS = 5 * 60 * 1000;
const POLL_UNCERTAIN_MIN = 30;
const POSTING_ALERT_ATTEMPTS = 3;
const MAX_EVENT_ATTEMPTS = 5;

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Acteur d'un traitement machine : l'initiateur de l'intention, sinon
 * un membre actif de l'école (FK réelle — jamais "system" en base).
 */
async function resolveActor(schoolId: string, initiatedById?: string | null) {
  if (initiatedById) return initiatedById;
  const m = await prisma.schoolMembership.findFirst({
    where: { schoolId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  return m?.userId ?? null;
}

// ─── Réception ──────────────────────────────────────────────────────

/**
 * Vérifie + enregistre + enfile un webhook. Ne fait AUCUN traitement
 * métier synchrone : la réponse HTTP est rapide et l'événement est
 * durable dès l'accusé. Appelé par la route HTTP dédiée.
 */
export async function receiveWebhook(input: {
  providerId: string;
  rawBody: string;
  headers: Record<string, string>;
}): Promise<
  Res<{ eventId: string; duplicate: boolean }>
> {
  if (Buffer.byteLength(input.rawBody) > MAX_BODY_BYTES) {
    return { ok: false, error: "PAYLOAD_TOO_LARGE" };
  }
  const provider = await prisma.paymentProvider.findUnique({
    where: { id: input.providerId },
  });
  // Prestataire inconnu → 404 côté route ; jamais d'oracle d'existence
  // (même réponse quel que soit l'id).
  if (!provider || provider.status !== "ACTIVE") {
    return { ok: false, error: "NOT_FOUND" };
  }
  const adapter = getProviderAdapter(provider.code);
  if (!adapter?.verifyWebhook) {
    return { ok: false, error: "PROVIDER_NOT_CONFIGURED" };
  }

  // Secrets : références d'env résolues côté serveur — jamais stockés.
  // Phase 3B — une IPN peut être signée par la clé TEST ou LIVE :
  // chaque environnement configuré est essayé, et l'environnement
  // qui a authentifié l'événement (`verifiedEnv`) est conservé dans
  // la charge persistée — le traitement le compare ensuite à
  // l'environnement FIGÉ de l'intention (IPN croisée → anomalie).
  const candidates: { env: RemoteEnv | "SANDBOX"; secret: string }[] = [];
  if (provider.code === "SANDBOX") {
    const s = provider.webhookSecretRef
      ? process.env[provider.webhookSecretRef]
      : process.env.MOBILE_MONEY_SANDBOX_WEBHOOK_SECRET;
    if (s) candidates.push({ env: "SANDBOX", secret: s });
  } else {
    // L'environnement courant du prestataire est essayé en premier.
    const ordered: RemoteEnv[] = provider.remoteEnv === "TEST" ? ["TEST", "LIVE"] : ["LIVE", "TEST"];
    for (const env of ordered) {
      const ref = env === "TEST" ? provider.testWebhookSecretRef : provider.webhookSecretRef;
      const s = ref ? process.env[ref] : undefined;
      if (s) candidates.push({ env, secret: s });
    }
  }
  if (candidates.length === 0) return { ok: false, error: "PROVIDER_NOT_CONFIGURED" };

  let verified: { event: { externalId: string; eventType: string; raw: unknown } } | null = null;
  let verifiedEnv: RemoteEnv | "SANDBOX" | null = null;
  let lastError = "INVALID_SIGNATURE";
  for (const c of candidates) {
    const v = adapter.verifyWebhook({
      rawBody: input.rawBody,
      headers: input.headers,
      secret: c.secret,
    });
    if (v.ok) { verified = v; verifiedEnv = c.env; break; }
    lastError = v.error;
  }
  if (!verified || !verifiedEnv) {
    // Événement non authentifié : non persisté (anti-remplissage),
    // audit minimal sans contenu ni secret.
    await logAudit({
      schoolId: provider.schoolId,
      action: "payment_webhook.rejected",
      entity: "PaymentProvider", entityId: provider.id,
      metadata: { reason: lastError, providerCode: provider.code },
    });
    return { ok: false, error: lastError };
  }

  const event = verified.event;
  // Phase 3C — la clé de déduplication distingue l'environnement :
  // une IPN TEST et une IPN LIVE portant le même token/statut sont
  // deux événements distincts (même prestataire, environnements
  // différents). SANDBOX inchangé — l'idempotence est préservée :
  // le même couple (env, externalId) déduplique toujours.
  const externalId =
    verifiedEnv === "SANDBOX" ? event.externalId : `${verifiedEnv}:${event.externalId}`;
  const payloadHash = sha256(input.rawBody);
  let record: { id: string } | null = null;
  try {
    record = await prisma.webhookEvent.create({
      data: {
        schoolId: provider.schoolId,
        providerId: provider.id,
        externalId,
        eventType: event.eventType,
        payloadHash,
        // verifiedEnv : environnement dont la clé a authentifié l'IPN
        // — comparé à remoteEnv figé de l'intention au traitement.
        payload: { ...(event.raw as Record<string, unknown>), verifiedEnv } as Prisma.InputJsonValue,
        signatureValid: true,
      },
      select: { id: true },
    });
  } catch (e) {
    // Doublon (providerId, externalId) — déjà enregistré : accusé
    // identique, aucun retraitement.
    if ((e as { code?: string })?.code === "P2002") {
      return { ok: true, data: { eventId: "", duplicate: true } };
    }
    throw e;
  }

  const job = await enqueueJob({
    type: "mm.webhook.process",
    payload: { eventId: record.id },
    schoolId: provider.schoolId,
    dedupKey: `wh:${record.id}`,
    maxAttempts: 5,
  });
  if (!job.ok && !("deduplicated" in job)) return { ok: false, error: "ENQUEUE_FAILED" };
  await logAudit({
    schoolId: provider.schoolId,
    action: "payment_webhook.received",
    entity: "WebhookEvent", entityId: record.id,
    metadata: { providerCode: provider.code, externalId: event.externalId, eventType: event.eventType },
  });
  return { ok: true, data: { eventId: record.id, duplicate: false } };
}

/**
 * Applique un événement authentifié à son intention. Idempotent :
 * relire un événement déjà traité ne refait rien. Sous le même verrou
 * advisory que confirmIntent → webhook/polling/repost sérialisés.
 */
export async function processWebhookEvent(eventId: string): Promise<{
  outcome: WebhookEventStatus | "RETRY";
}> {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    include: { provider: true, intent: true },
  });
  if (!event) return { outcome: "FAILED" };
  if (event.status === "PROCESSED" || event.status === "IGNORED" || event.status === "ANOMALY") {
    return { outcome: event.status };
  }

  // Marque PROCESSING — si un crash survient ensuite, l'événement
  // reste traçable (stale → repris par le sweep ou relance manuelle).
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const intentRef = typeof payload.intentRef === "string" ? payload.intentRef : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const providerTxId = typeof payload.providerTxId === "string" ? payload.providerTxId : undefined;
  const reason = typeof payload.reason === "string" ? payload.reason : undefined;

  // Résolution serveur de l'intention : (providerId, providerRef) —
  // jamais par schoolId du payload.
  const intent = await prisma.paymentIntent.findFirst({
    where: { providerId: event.providerId, providerRef: intentRef },
    include: { provider: true },
  });

  let outcome: WebhookEventStatus | "RETRY";
  let result: Record<string, unknown> = {};
  let retryable = false;

  const payloadEnv = typeof payload.verifiedEnv === "string" ? payload.verifiedEnv : null;
  const envMismatch =
    intent != null &&
    intent.remoteEnv != null &&
    payloadEnv != null &&
    payloadEnv !== "SANDBOX" &&
    intent.remoteEnv !== payloadEnv;

  if (!intent || intent.schoolId !== event.schoolId) {
    outcome = "ANOMALY";
    result = { anomaly: "UNKNOWN_INTENT", intentRef };
    await notifyPaymentAdmins(event.schoolId, {
      title: "Anomalie webhook paiement",
      body: `Événement ${event.externalId} sans intention correspondante (réf. ${intentRef || "?"}).`,
    });
  } else if (envMismatch) {
    // Phase 3B — IPN authentifiée par la clé d'un AUTRE environnement
    // que celui figé de l'intention (TEST↔LIVE) : authentique mais
    // incohérente → anomalie traçable, jamais de traitement métier.
    outcome = "ANOMALY";
    result = { anomaly: "ENV_MISMATCH", intentEnv: intent.remoteEnv, ipnEnv: payloadEnv };
    await notifyPaymentAdmins(event.schoolId, {
      title: "Anomalie webhook paiement",
      body: `IPN ${event.externalId} signée ${payloadEnv} pour une intention ${intent.remoteEnv} — rejetée.`,
      link: `/app/paiements-mobile?intent=${intent.id}`,
    });
  } else {
    const actorId = await resolveActor(event.schoolId, intent.initiatedById);
    if (!actorId) {
      outcome = "FAILED";
      result = { error: "NO_ACTOR" };
    } else {
      try {
        const r = await applyEventToIntent({
          ctx: { userId: actorId, schoolId: event.schoolId },
          intentId: intent.id,
          providerTxId,
          status,
          reason,
          eventExternalId: event.externalId,
        });
        outcome = r.outcome;
        result = r.result;
        if (r.anomaly) {
          await notifyPaymentAdmins(event.schoolId, {
            title: "Anomalie de confirmation paiement",
            body: `Intention ${intent.id.slice(0, 8)}… — ${r.anomaly}`,
            link: `/app/paiements-mobile?intent=${intent.id}`,
          });
        }
        if (r.deferred) {
          await notifyPaymentAdmins(event.schoolId, {
            title: "Encaissement confirmé en attente de comptabilisation",
            body: `Intention ${intent.id.slice(0, 8)}… — ${intent.amount} ${intent.currency}. Reprise automatique programmée.`,
            link: `/app/paiements-mobile?intent=${intent.id}`,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "PROCESSING_ERROR";
        // Erreur technique transitoire : l'événement repart en RECEIVED
        // (repris par le sweep / le job) jusqu'au plafond de tentatives,
        // puis FAILED + alerte — jamais de rejet définitif silencieux.
        if (event.attempts + 1 < MAX_EVENT_ATTEMPTS) {
          outcome = "RETRY";
          retryable = true;
          result = { error: msg, retrying: true };
        } else {
          outcome = "FAILED";
          result = { error: msg };
          await notifyPaymentAdmins(event.schoolId, {
            title: "Échec persistant de traitement webhook",
            body: `Événement ${event.externalId} : ${msg.slice(0, 200)} après ${event.attempts + 1} tentatives — intervention requise.`,
          });
        }
      }
    }
  }

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: {
      intentId: intent?.id ?? null,
      status: retryable ? "RECEIVED" : (outcome as WebhookEventStatus),
      result: result as Prisma.InputJsonValue,
      lastError: outcome === "FAILED" || retryable
        ? (result.error as string) ?? "PROCESSING_ERROR" : null,
      processedAt: retryable ? null : new Date(),
    },
  });
  return { outcome };
}

/**
 * Cœur ordonnancement : applique le statut prestataire sous le verrou
 * de confirmation. Contradictions → ANOMALY (rapprochement), jamais
 * de rétrogradation silencieuse d'une confirmation fiable.
 */
async function applyEventToIntent(input: {
  ctx: { userId: string; schoolId: string };
  intentId: string;
  status: string;
  providerTxId?: string;
  reason?: string;
  eventExternalId: string;
}): Promise<{
  outcome: WebhookEventStatus;
  result: Record<string, unknown>;
  anomaly?: string;
  deferred?: boolean;
}> {
  const { ctx, intentId, status, reason, eventExternalId } = input;
  // Réassignable : la référence transaction re-vérifiée prime sur
  // celle reçue dans l'IPN.
  let providerTxId = input.providerTxId;

  const trace = async (extra: Record<string, unknown>) => {
    await prisma.paymentTransaction.create({
      data: {
        intentId, schoolId: ctx.schoolId,
        kind: "WEBHOOK",
        providerTxId: providerTxId ?? null,
        payload: { eventId: eventExternalId, status, ...extra },
      },
    });
  };

  // SUCCESS — confirmation fiable. Une confirmation qui arrive après
  // un état terminal (FAILED/EXPIRED/CANCELLED) est une contradiction
  // financière : ANOMALY + rapprochement, jamais de résurrection.
  if (status === "SUCCESS") {
    const cur = await prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: {
        status: true, amount: true, currency: true, providerRef: true,
        remoteEnv: true,
        provider: {
          select: {
            id: true, code: true, mode: true, status: true, liveEnabled: true,
            remoteEnv: true, credentialsRef: true, testCredentialsRef: true,
            config: true,
          },
        },
      },
    });
    if (cur && (cur.status === "FAILED" || cur.status === "EXPIRED" || cur.status === "CANCELLED")) {
      await trace({ applied: "none", contradiction: `SUCCESS_after_${cur.status}` });
      return {
        outcome: "ANOMALY",
        result: { anomaly: "LATE_CONFIRM_AFTER_TERMINAL", terminalStatus: cur.status, providerTxId },
        anomaly: `Confirmation reçue après ${cur.status} — rapprochement requis.`,
      };
    }
    // G3-E — re-vérification obligatoire : pour les adaptateurs dont
    // la signature webhook n'authentifie pas chaque événement
    // (PayDunya : hash statique de la MasterKey), l'IPN seule ne
    // déclenche JAMAIS de confirmation. On re-interroge le statut
    // auprès du prestataire et on compare montant/devise. Échec de
    // transport → exception → RETRY (preuve conservée) ; contradiction
    // → ANOMALY sans comptabilisation.
    const adapter = cur ? getProviderAdapter(cur.provider.code) : null;
    if (cur && adapter?.webhookReverification) {
      // L'environnement FIGÉ de l'intention pilote la barrière ET la
      // résolution des secrets — jamais celui courant du prestataire.
      const env = intentRemoteEnv(cur) ?? (cur.provider.remoteEnv === "TEST" ? "TEST" : "LIVE");
      const liveErr = cur.provider.mode === "LIVE"
        ? checkRemoteExecution(cur.provider, adapter, env)
        : "PROVIDER_NOT_LIVE";
      if (liveErr) throw new Error(`REVERIFY_BLOCKED_${liveErr}`);
      const reverified = await adapter.checkStatus(
        cur.providerRef!, null, liveCallContext(cur.provider, env),
      );
      if (reverified.status !== "SUCCESS") {
        await trace({ applied: "none", contradiction: `REVERIFY_${reverified.status}` });
        return {
          outcome: "ANOMALY",
          result: { anomaly: "IPN_NOT_CONFIRMED_BY_PROVIDER", providerStatus: reverified.status, rawStatus: reverified.rawStatus ?? null },
          anomaly: `IPN de succès non confirmée par le prestataire (statut réel : ${reverified.rawStatus ?? reverified.status}) — aucune comptabilisation.`,
        };
      }
      // Données indispensables absentes ou divergentes → anomalie,
      // jamais de comptabilisation : montant exact, devise attendue,
      // référence interne (custom_data.intent_id), unicité de la
      // transaction prestataire.
      const amountMismatch = reverified.amount == null || reverified.amount !== cur.amount;
      const currencyMismatch = reverified.currency == null || reverified.currency !== cur.currency;
      const refMismatch = reverified.customRef == null || reverified.customRef !== intentId;
      if (amountMismatch || currencyMismatch || refMismatch) {
        await ensureDiscrepancy(prisma, {
          schoolId: ctx.schoolId,
          type: refMismatch ? "OTHER" : "AMOUNT_MISMATCH",
          intentId,
          expectedAmount: cur.amount,
          actualAmount: reverified.amount ?? null,
          description: `IPN reverifiée incohérente (montant ${reverified.amount ?? "absent"}, devise ${reverified.currency ?? "absente"}, réf ${reverified.customRef ?? "absente"} vs attendus ${cur.amount} ${cur.currency} / ${intentId}) — confirmation bloquée.`,
        });
        await trace({ applied: "none", contradiction: refMismatch ? "REF_MISMATCH" : "AMOUNT_MISMATCH" });
        return {
          outcome: "ANOMALY",
          result: { anomaly: refMismatch ? "INTERNAL_REF_MISMATCH" : "AMOUNT_MISMATCH", expected: cur.amount, actual: reverified.amount ?? null },
          anomaly: "Confirmation bloquée : montant, devise ou référence interne divergents après re-vérification prestataire.",
        };
      }
      if (reverified.providerTxId) {
        const dupe = await prisma.paymentIntent.findFirst({
          where: {
            providerTxId: reverified.providerTxId,
            id: { not: intentId },
            status: { in: ["CONFIRMED", "CONFIRMED_PENDING_POSTING"] },
          },
          select: { id: true },
        });
        if (dupe) {
          await ensureDiscrepancy(prisma, {
            schoolId: ctx.schoolId,
            type: "DUPLICATE_REFERENCE",
            intentId,
            description: `Référence transaction prestataire ${reverified.providerTxId} déjà rattachée à l'intention ${dupe.id} — confirmation bloquée.`,
          });
          await trace({ applied: "none", contradiction: "DUPLICATE_TXID" });
          return {
            outcome: "ANOMALY",
            result: { anomaly: "DUPLICATE_PROVIDER_TXID", otherIntentId: dupe.id },
            anomaly: "Référence transaction déjà confirmée sur une autre intention — aucune comptabilisation.",
          };
        }
      }
      // La référence transaction re-vérifiée prime sur celle de l'IPN.
      providerTxId = reverified.providerTxId ?? providerTxId;
    }

    const res = await confirmIntent(ctx, intentId, {
      providerTxId,
      // La comptabilisation réelle n'a lieu que pour les intentions
      // LIVE — la barrière G3-A protège le sandbox automatiquement.
      postToLedger: true,
    });
    if (!res.ok && res.error === "POSTING_SANDBOX_FORBIDDEN") {
      // Sandbox : confirmation simulée, sans encaissement (attendu).
      const sim = await confirmIntent(ctx, intentId, { providerTxId });
      await trace({ applied: "confirm_simulated" });
      return {
        outcome: sim.ok ? "PROCESSED" : "IGNORED",
        result: { applied: sim.ok ? "confirm_simulated" : sim.error },
      };
    }
    if (!res.ok && res.error === "INVALID_STATE") {
      const st = (await prisma.paymentIntent.findUnique({ where: { id: intentId }, select: { status: true } }))?.status;
      await trace({ applied: "none", terminalStatus: st });
      return { outcome: "IGNORED", result: { ignored: "INVALID_STATE", status: st } };
    }
    if (!res.ok) {
      await trace({ applied: "confirm_failed", error: res.error });
      return { outcome: "FAILED", result: { error: res.error } };
    }
    await trace({ applied: "confirm", paymentId: res.data.paymentId ?? null });
    const deferred = res.data.status === "CONFIRMED_PENDING_POSTING";
    return {
      outcome: "PROCESSED",
      result: { applied: "confirm", deferred, paymentId: res.data.paymentId ?? null, already: res.data.already ?? false },
      deferred,
    };
  }

  // FAILED / EXPIRED — échec après confirmation = contradiction.
  const current = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    select: { status: true, providerTxId: true },
  });
  if (!current) return { outcome: "FAILED", result: { error: "NOT_FOUND" } };

  if (current.status === "CONFIRMED" || current.status === "CONFIRMED_PENDING_POSTING") {
    await trace({ applied: "none", contradiction: `${status}_after_${current.status}` });
    return {
      outcome: "ANOMALY",
      result: { anomaly: `${status}_AFTER_${current.status}`, providerTxId },
      anomaly: `Événement ${status} reçu alors que l'intention est ${current.status} — encaissement préservé, rapprochement requis.`,
    };
  }

  if (current.status === "PENDING") {
    if (status === "FAILED") {
      const r = await failIntentFromEvent(ctx, intentId, reason ?? "PROVIDER_REFUSED", providerTxId);
      await trace({ applied: r.ok ? "fail" : "none", error: r.ok ? null : r.error });
      return { outcome: r.ok ? "PROCESSED" : "FAILED", result: r.ok ? { applied: "fail" } : { error: r.error } };
    }
    if (status === "EXPIRED") {
      const r = await expireIntentFromEvent(ctx, intentId, providerTxId);
      await trace({ applied: r.ok ? "expire" : "none" });
      return { outcome: r.ok ? "PROCESSED" : "FAILED", result: r.ok ? { applied: "expire" } : { error: r.error } };
    }
    await trace({ applied: "none", note: "pending_event_noop" });
    return { outcome: "IGNORED", result: { ignored: "PENDING_EVENT" } };
  }

  // FAILED/EXPIRED/CANCELLED/CREATED + événement d'échec/expiry → no-op.
  await trace({ applied: "none", note: `${status}_after_${current.status}` });
  return { outcome: "IGNORED", result: { ignored: `${status}_AFTER_${current.status}` } };
}

async function failIntentFromEvent(
  ctx: { userId: string; schoolId: string },
  intentId: string, reason: string, providerTxId?: string,
) {
  // Transition interne PENDING → FAILED (même garde que la machine).
  const upd = await prisma.paymentIntent.updateMany({
    where: { id: intentId, schoolId: ctx.schoolId, status: "PENDING" },
    data: { status: "FAILED", failureReason: reason, providerTxId, failedAt: new Date() },
  });
  if (upd.count === 0) return { ok: false, error: "INVALID_STATE" };
  await prisma.paymentTransaction.create({
    data: { intentId, schoolId: ctx.schoolId, kind: "FAIL", providerTxId, payload: { status: "FAILED", reason } },
  });
  await logAudit({
    actorId: ctx.userId === "system" ? null : ctx.userId, schoolId: ctx.schoolId,
    action: "payment_intent.failed", entity: "PaymentIntent", entityId: intentId,
    metadata: { reason, providerTxId: providerTxId ?? null, source: "webhook" },
  });
  return { ok: true };
}

async function expireIntentFromEvent(
  ctx: { userId: string; schoolId: string },
  intentId: string, providerTxId?: string,
) {
  const upd = await prisma.paymentIntent.updateMany({
    where: { id: intentId, schoolId: ctx.schoolId, status: "PENDING" },
    data: { status: "EXPIRED", failureReason: "PROVIDER_EXPIRED", providerTxId, expiredAt: new Date() },
  });
  if (upd.count === 0) return { ok: false, error: "INVALID_STATE" };
  await prisma.paymentTransaction.create({
    data: { intentId, schoolId: ctx.schoolId, kind: "EXPIRE", providerTxId, payload: { status: "EXPIRED" } },
  });
  return { ok: true };
}

// ─── Notifications internes ─────────────────────────────────────────

async function notifyPaymentAdmins(
  schoolId: string,
  msg: { title: string; body?: string; link?: string },
) {
  const users = await prisma.schoolMembership.findMany({
    where: {
      schoolId, status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: {
        scope: "SCHOOL",
        OR: [{ schoolId: null }, { schoolId }],
        rolePermissions: { some: { permission: { key: "mobilepayments.manage" } } },
      },
    },
    select: { userId: true },
  });
  await notifyUsers({
    schoolId,
    userIds: users.map((u) => u.userId),
    type: "ADMIN_MESSAGE",
    title: msg.title,
    body: msg.body,
    link: msg.link ?? "/app/paiements-mobile",
  });
}

// ─── Sweeps (cron) ──────────────────────────────────────────────────

/** Événements RECEIVED/PENDING non traités → ré-enfilement (crash-safe). */
export async function sweepUnprocessedWebhookEvents(opts: { limit?: number } = {}) {
  const stale = await prisma.webhookEvent.findMany({
    where: {
      status: { in: ["RECEIVED", "PROCESSING"] },
      receivedAt: { lt: new Date(Date.now() - STALE_EVENT_MS) },
    },
    orderBy: { receivedAt: "asc" },
    take: opts.limit ?? 25,
  });
  let enqueued = 0;
  for (const e of stale) {
    // PROCESSING stale → repart sur RECEIVED pour être rejoué.
    if (e.status === "PROCESSING") {
      await prisma.webhookEvent.updateMany({
        where: { id: e.id, status: "PROCESSING" },
        data: { status: "RECEIVED" },
      });
    }
    const job = await enqueueJob({
      type: "mm.webhook.process",
      payload: { eventId: e.id },
      schoolId: e.schoolId,
      dedupKey: `wh-sweep:${e.id}:${Math.floor(Date.now() / 60000)}`,
      maxAttempts: 5,
    });
    if (job.ok) enqueued++;
  }
  return { swept: stale.length, enqueued };
}

/**
 * Reprise automatique des encaissements différés (jour clôturé, crash).
 * La barrière G3-A s'applique ici aussi : une intention sandbox bloquée
 * en CONFIRMED_PENDING_POSTING y reste — `__allowSandboxPosting` est un
 * indicateur INTERNE réservé aux recettes sur fixtures isolées.
 */
export async function repostPendingPostings(
  opts: { limit?: number; __allowSandboxPosting?: boolean } = {},
) {
  const due = await prisma.paymentIntent.findMany({
    where: {
      status: "CONFIRMED_PENDING_POSTING",
      updatedAt: { lt: new Date(Date.now() - REPOST_GRACE_MS) },
    },
    include: { provider: { select: { mode: true } } },
    orderBy: { updatedAt: "asc" },
    take: opts.limit ?? 20,
  });
  let posted = 0, still = 0, failed = 0, locked = 0;
  for (const intent of due) {
    // Une intention figée TEST ne poste jamais au ledger — elle
    // n'atteint pas ce statut par le chemin normal ; court-circuit
    // défensif (la barrière postConfirmedIntent la refuserait).
    if (intent.remoteEnv === "TEST") { still++; continue; }
    // Verrou global : un encaissement LIVE différé n'est jamais
    // comptabilisé tant que MOBILE_MONEY_LIVE_ENABLED est absent —
    // la preuve est conservée, la comptabilisation attend l'activation.
    if (intent.provider.mode === "LIVE" && !isLivePaymentsEnabled()) {
      locked++;
      continue;
    }
    const attempts = await prisma.paymentTransaction.count({
      where: { intentId: intent.id, kind: "POSTING" },
    });
    const actorId = await resolveActor(intent.schoolId, intent.initiatedById);
    if (!actorId) { failed++; continue; }
    const res = await postConfirmedIntent(
      { userId: actorId, schoolId: intent.schoolId },
      intent.id,
      { __allowSandboxPosting: opts.__allowSandboxPosting },
    );
    if (res.ok && res.data.status === "CONFIRMED") posted++;
    else if (res.ok) still++;
    else failed++;

    // Échec persistant → alerte interne une fois (au 3e essai).
    if (!res.ok && attempts + 1 >= POSTING_ALERT_ATTEMPTS && !intent.failureReason?.startsWith("ALERTED")) {
      await prisma.paymentIntent.updateMany({
        where: { id: intent.id },
        data: { failureReason: `ALERTED_${res.ok ? "PENDING" : res.error}` },
      });
      await notifyPaymentAdmins(intent.schoolId, {
        title: "Encaissement Mobile Money bloqué — intervention requise",
        body: `Intention ${intent.id.slice(0, 8)}… (${intent.amount} ${intent.currency}) : ${res.ok ? "en attente" : res.error} après ${attempts + 1} tentatives.`,
        link: `/app/paiements-mobile?intent=${intent.id}`,
      });
    }
  }
  return { due: due.length, posted, still, failed, locked };
}

/** Polling de secours des intentions PENDING âgées (webhook jamais reçu). */
export async function pollUncertainIntents(opts: { limit?: number; minAgeMin?: number } = {}) {
  const minAge = (opts.minAgeMin ?? POLL_UNCERTAIN_MIN) * 60 * 1000;
  const due = await prisma.paymentIntent.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: new Date(Date.now() - minAge) },
      expiresAt: { gt: new Date() },
      provider: { status: "ACTIVE" },
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 15,
  });
  let polled = 0;
  for (const intent of due) {
    const actorId = await resolveActor(intent.schoolId, intent.initiatedById);
    if (!actorId) continue;
    const res = await pollPaymentIntent(
      { userId: actorId, schoolId: intent.schoolId },
      intent.id,
    );
    if (res.ok || res.error !== "NOT_FOUND") polled++;
  }
  return { polled: due.length, done: polled };
}

/** Maintenance G3-B complète — appelée par le cron /api/cron. */
export async function runMobileMoneyMaintenance() {
  registerMobileMoneyHandlers();
  const events = await sweepUnprocessedWebhookEvents({ limit: 25 });
  const reposts = await repostPendingPostings({ limit: 20 });
  const polls = await pollUncertainIntents({ limit: 15 });
  // Expiration des intentions hors délai (toutes écoles).
  const schools = await prisma.paymentIntent.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    select: { schoolId: true },
    distinct: ["schoolId"],
  });
  let expired = 0;
  for (const s of schools) {
    const r = await expireDuePaymentIntents({ userId: null, schoolId: s.schoolId });
    expired += r.expired;
  }
  // G3-D : rapprochements manquants, reversements attendus,
  // remboursements non confirmés — balayage idempotent par école.
  const recon = { created: 0, anomalies: 0, missingSettlements: 0, unconfirmedRefunds: 0 };
  const reconSchools = await prisma.paymentIntent.findMany({
    where: { status: { in: ["CONFIRMED", "CONFIRMED_PENDING_POSTING"] } },
    select: { schoolId: true },
    distinct: ["schoolId"],
    take: 50,
  });
  for (const s of reconSchools) {
    const r = await syncReconciliations(s.schoolId).catch(() => null);
    if (r) { recon.created += r.created; recon.anomalies += r.anomalies; }
    recon.missingSettlements += await flagMissingSettlements(s.schoolId).catch(() => 0);
    recon.unconfirmedRefunds += await flagUnconfirmedRefunds(s.schoolId).catch(() => 0);
  }
  return { events, reposts, polls, expired, reconciliation: recon };
}

// ─── Enregistrement des handlers ────────────────────────────────────

export function registerMobileMoneyHandlers() {
  registerJobHandler("mm.webhook.process", async (payload) => {
    const eventId = typeof payload.eventId === "string" ? payload.eventId : "";
    if (!eventId) return;
    const r = await processWebhookEvent(eventId);
    if (r.outcome === "FAILED" || r.outcome === "RETRY") {
      throw new Error("WEBHOOK_PROCESS_FAILED");
    }
  });
}

// ─── Relance administrative ─────────────────────────────────────────

/** Relance le traitement d'un événement (action admin auditée). */
export async function replayWebhookEvent(
  ctx: { userId: string; schoolId: string },
  eventId: string,
): Promise<Res<{ outcome: string }>> {
  const event = await prisma.webhookEvent.findFirst({
    where: { id: eventId, schoolId: ctx.schoolId },
  });
  if (!event) return { ok: false, error: "NOT_FOUND" };
  // Seuls les échecs et anomalies sont relançables — un événement
  // PROCESSED/IGNORED est définitif, RECEIVED/PROCESSING est en cours.
  if (event.status !== "FAILED" && event.status !== "ANOMALY") {
    return { ok: false, error: "INVALID_STATE" };
  }
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: "RECEIVED", lastError: null },
  });
  const r = await processWebhookEvent(event.id);
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "payment_webhook.replayed", entity: "WebhookEvent", entityId: event.id,
    metadata: { outcome: r.outcome },
  });
  return { ok: true, data: { outcome: r.outcome } };
}

export async function listWebhookEvents(
  ctx: { schoolId: string },
  filter: { status?: string; limit?: number } = {},
) {
  return prisma.webhookEvent.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: (filter.status as WebhookEventStatus | undefined) ?? undefined,
    },
    include: {
      provider: { select: { code: true, label: true } },
      intent: { select: { id: true, status: true, amount: true, currency: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: Math.min(filter.limit ?? 100, 200),
  });
}
