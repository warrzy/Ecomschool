/**
 * Adaptateur SANDBOX — simulateur déterministe de prestataire Mobile
 * Money. Aucun appel réseau, aucun argent réel, aucun secret requis.
 * Couvre : succès, échec, expiration, réponse tardive, réponse
 * répétée, timeout. La concurrence de confirmation est garantie par
 * le verrou applicatif (service), pas par l'adaptateur.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  InitiateInput,
  InitiateResult,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  SandboxScript,
  StatusResult,
  WebhookVerification,
} from "./types";
import { ProviderTimeoutError } from "./types";

function txId(providerRef: string) {
  return `SBTX-${providerRef}`;
}

/**
 * Format du webhook SANDBOX (déterministe, hors ligne) :
 *   corps  : {"eventId","intentRef","status","providerTxId","reason","occurredAt"}
 *   en-tête: x-sandbox-timestamp (unix s), x-sandbox-signature
 *            = hex HMAC-SHA256(`${timestamp}.${rawBody}`, secret)
 * Fraîcheur : ±5 minutes. Comparaison en temps constant.
 */
const WEBHOOK_TOLERANCE_S = 300;

export function sandboxWebhookSignature(rawBody: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function normalize(raw: Record<string, unknown>): NormalizedWebhookEvent | null {
  const externalId = typeof raw.eventId === "string" ? raw.eventId : null;
  const intentRef = typeof raw.intentRef === "string" ? raw.intentRef : null;
  const status = raw.status;
  if (!externalId || !intentRef) return null;
  if (status !== "SUCCESS" && status !== "FAILED" && status !== "EXPIRED" && status !== "PENDING") {
    return null;
  }
  return {
    externalId,
    intentRef,
    status,
    providerTxId: typeof raw.providerTxId === "string" ? raw.providerTxId : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    occurredAt: typeof raw.occurredAt === "string" ? raw.occurredAt : undefined,
    eventType: `PAYMENT.${status}`,
    raw: {
      eventId: externalId,
      intentRef,
      status,
      providerTxId: raw.providerTxId ?? null,
      reason: raw.reason ?? null,
      occurredAt: raw.occurredAt ?? null,
    },
  };
}

export const sandboxAdapter: PaymentProviderAdapter = {
  code: "SANDBOX",

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const script = input.sandboxScript;
    if (script?.outcome === "TIMEOUT" && (script.checks ?? 0) === 0) {
      throw new ProviderTimeoutError("Simulation : timeout à l'initiation");
    }
    return {
      providerRef: `SB-${input.intentId}`,
      instructions: `Simulation : composez *144# pour valider ${input.amount} ${input.currency} (aucun débit réel).`,
    };
  },

  async checkStatus(providerRef: string, script?: SandboxScript | null): Promise<StatusResult> {
    const outcome = script?.outcome ?? "PENDING";
    switch (outcome) {
      case "SUCCESS":
      case "REPEATED":
        return { status: "SUCCESS", providerTxId: txId(providerRef), rawStatus: "200" };
      case "FAILED":
        return {
          status: "FAILED",
          providerTxId: txId(providerRef),
          rawStatus: "FAILED",
          reason: script?.reason ?? "Solde insuffisant (simulation)",
        };
      case "TIMEOUT":
        throw new ProviderTimeoutError("Simulation : timeout à la consultation");
      case "LATE": {
        const checks = script?.checks ?? 0;
        const after = script?.afterChecks ?? 2;
        // Reste PENDING pendant `after` consultations, puis succès.
        if (checks > after) {
          return { status: "SUCCESS", providerTxId: txId(providerRef), rawStatus: "200" };
        }
        return { status: "PENDING", rawStatus: "PROCESSING" };
      }
      case "PENDING":
      default:
        return { status: "PENDING", rawStatus: "PROCESSING" };
    }
  },

  verifyWebhook({ rawBody, headers, secret, now }): WebhookVerification {
    const timestamp = headers["x-sandbox-timestamp"];
    const signature = headers["x-sandbox-signature"];
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
      return { ok: false, error: "MALFORMED" };
    }
    const ts = Number(timestamp);
    const nowS = Math.floor((now ?? new Date()).getTime() / 1000);
    if (Math.abs(nowS - ts) > WEBHOOK_TOLERANCE_S) {
      return { ok: false, error: "EXPIRED" };
    }
    const expected = sandboxWebhookSignature(rawBody, timestamp, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: "INVALID_SIGNATURE" };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "MALFORMED" };
    }
    const event = normalize(parsed);
    if (!event) return { ok: false, error: "MALFORMED" };
    return { ok: true, event };
  },
};
