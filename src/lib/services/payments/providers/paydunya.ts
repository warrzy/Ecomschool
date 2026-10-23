/**
 * G3-E Phase 2B — adaptateur PAYDUNYA (Checkout/PAR par redirection).
 *
 * Référence : documentation officielle PayDunya
 *   - https://developers.paydunya.com/doc/FR/http_json (API Checkout
 *     JSON + IPN + consultation de statut)
 *   - https://developers.paydunya.com/doc/FR/api_softpay_index
 *   - https://developers.paydunya.com/doc/FR/introduction
 *
 * Périmètre retenu (docs/g3e-first-provider-spec.md) :
 *   - Création de facture : POST {base}/checkout-invoice/create
 *   - Statut              : GET  {base}/checkout-invoice/confirm/{token}
 *   - IPN                 : formulaire URL-encodé `data[...]`, hash
 *                           = SHA-512(MasterKey) — statique par compte,
 *                           donc `webhookReverification = true` : une
 *                           IPN ne déclenche JAMAIS une confirmation
 *                           directe ; le service re-vérifie le statut
 *                           via checkStatus + compare montant/devise.
 *
 * SoftPay Orange Money BF / Moov Money BF : NON implémenté à ce stade
 * (endpoints direct-serveur à valider contractuellement ; le parcours
 * PAR par redirection couvre déjà les deux opérateurs).
 *
 * API PUSH/déboursement : NON assimilée à un remboursement de
 * transaction sans confirmation contractuelle → refunds = false,
 * settlements = false.
 *
 * Sécurité : aucun secret dans la base, les logs, les payloads
 * persistés ou les réponses. Les identifiants ne transitent que par
 * `AdapterCallContext.credentials` résolu en mémoire. Le hash IPN est
 * vérifié puis JAMAIS stocké (redacted dans `raw`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { fetchTransport, type HttpTransport } from "./http";
import type {
  InitiateInput,
  InitiateResult,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  ProviderPaymentStatus,
  StatusResult,
  WebhookVerification,
} from "./types";
import {
  ProviderBusinessError,
  ProviderConfigError,
  ProviderUnavailableError,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

/** Endpoints documentés — sandbox par défaut (fail-safe). */
const BASE_SANDBOX = "https://app.paydunya.com/sandbox-api/v1";
const BASE_LIVE = "https://app.paydunya.com/api/v1";
/** Hôte officiel unique — tout autre hôte est rejeté avant transport. */
const ALLOWED_HOST = "app.paydunya.com";

// ─── Configuration ──────────────────────────────────────────────────

type PaydunyaCreds = {
  masterKey: string;
  privateKey: string;
  publicKey?: string;
  token: string;
};

function parseCredentials(raw: string | undefined): PaydunyaCreds {
  if (!raw) {
    throw new ProviderConfigError("credentialsRef", "Identifiants PayDunya absents");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderConfigError("credentialsRef", "Identifiants PayDunya illisibles");
  }
  const c = parsed as Partial<PaydunyaCreds>;
  if (!c?.masterKey || !c?.privateKey || !c?.token) {
    throw new ProviderConfigError(
      "credentialsRef",
      "Identifiants PayDunya incomplets (masterKey/privateKey/token requis)",
    );
  }
  return { masterKey: c.masterKey, privateKey: c.privateKey, publicKey: c.publicKey, token: c.token };
}

/**
 * `PaymentProvider.config` (JSON non-secret) attendu :
 * {
 *   "store":        { "name": "…", "website_url": "…" },   // requis par PayDunya
 *   "channels":     ["orange-money-burkina","moov-burkina-faso"],
 *   "description":  "Frais scolaires"
 * }
 * `baseUrl` n'est JAMAIS pris depuis la config : l'URL de production
 * ne peut pas être injectée par un paramètre école. La variante
 * sandbox est choisie par le service (provider.mode) — absent →
 * sandbox (fail-safe). Aucune URL libre n'est acceptée : l'URL de
 * callback IPN est calculée côté serveur (call.callbackUrl).
 */
type PaydunyaConfig = {
  store?: { name?: string; tagline?: string; phone_number?: string; postal_address?: string; website_url?: string };
  channels?: string[];
  description?: string;
  /** Renseigné par le service d'après provider.mode — jamais par l'admin. */
  env?: "test" | "live";
};

function baseUrl(cfg: PaydunyaConfig): string {
  return cfg.env === "live" ? BASE_LIVE : BASE_SANDBOX;
}

// ─── Réponses ───────────────────────────────────────────────────────

type JsonObj = Record<string, unknown>;

function parseJson(body: string): JsonObj {
  try {
    const v = JSON.parse(body) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as JsonObj;
  } catch {
    /* fallthrough */
  }
  throw new ProviderUnavailableError("Réponse PayDunya illisible (JSON attendu)");
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Normalisation des statuts PayDunya → modèle interne.
 * Documenté pour Checkout : `completed`, `pending`, `cancelled`,
 * `failed`. Toute valeur inconnue est conservée en `rawStatus` et
 * reste PENDING — jamais de confirmation sur statut non documenté.
 */
function normalizeStatus(raw: unknown): { status: ProviderPaymentStatus; rawStatus?: string } {
  const s = str(raw)?.toLowerCase();
  switch (s) {
    case "completed":
      return { status: "SUCCESS", rawStatus: s };
    case "cancelled":
    case "canceled":
      return { status: "FAILED", rawStatus: s };
    case "failed":
      return { status: "FAILED", rawStatus: s };
    case "expired":
      return { status: "EXPIRED", rawStatus: s };
    case "pending":
    case "processing":
      return { status: "PENDING", rawStatus: s };
    default:
      return { status: "PENDING", rawStatus: s };
  }
}

// ─── IPN (form-urlencoded, champs data[...] imbriqués) ─────────────

/**
 * PayDunya poste ses IPN en `application/x-www-form-urlencoded` avec
 * des clés PHP-style `data[invoice][token]`. Reconstruction d'un objet
 * imbriqué. Accepte aussi `data` en JSON unique (variante possible).
 */
function parseIpnData(rawBody: string): JsonObj | null {
  const data: JsonObj = {};
  const params = new URLSearchParams(rawBody);
  let found = false;
  const set = (obj: JsonObj, path: string[], value: string) => {
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k] as JsonObj;
    }
    cur[path[path.length - 1]] = value;
  };
  for (const [key, val] of params) {
    const m = /^data\[(.+)\]$/.exec(key);
    if (m) {
      set(data, m[1].split("]["), val);
      found = true;
    } else if (key === "data") {
      try {
        const v = JSON.parse(val) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.assign(data, v as JsonObj);
          found = true;
        }
      } catch {
        /* data non-JSON : ignoré */
      }
    }
  }
  return found ? data : null;
}

const masterKeyHash = (secret: string) =>
  createHash("sha512").update(secret, "utf8").digest("hex");

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

// ─── Adaptateur ─────────────────────────────────────────────────────

export function createPaydunyaAdapter(transport: HttpTransport): PaymentProviderAdapter {
  const request = async (
    cfg: PaydunyaConfig,
    creds: PaydunyaCreds,
    method: "GET" | "POST",
    path: string,
    body?: JsonObj,
  ): Promise<JsonObj> => {
    const url = `${baseUrl(cfg)}${path}`;
    // Garde réseau : HTTPS + hôte officiel uniquement — jamais de
    // repli vers la production depuis TEST, jamais d'hôte libre.
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST) {
      throw new ProviderConfigError("baseUrl", `Hôte PayDunya non autorisé : ${u.hostname}`);
    }
    const res = await transport({
      url,
      method,
      headers: {
        "Content-Type": "application/json",
        "PAYDUNYA-MASTER-KEY": creds.masterKey,
        "PAYDUNYA-PRIVATE-KEY": creds.privateKey,
        "PAYDUNYA-TOKEN": creds.token,
        ...(creds.publicKey ? { "PAYDUNYA-PUBLIC-KEY": creds.publicKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const json = parseJson(res.body);
    if (res.status < 200 || res.status >= 300) {
      // Erreur HTTP documentée : le code métier PayDunya reste dans
      // response_code — ne pas l'inventer.
      throw new ProviderUnavailableError(
        `PayDunya HTTP ${res.status} (${str(json.response_text) ?? "sans détail"})`,
      );
    }
    return json;
  };

  return {
    code: "PAYDUNYA",
    capabilities: {
      initiate: true,
      pollStatus: true,
      webhooks: true,
      refunds: false,      // API PUSH ≠ remboursement — à confirmer
      settlements: false,  // décomptes non documentés en API — à confirmer
      payerFee: false,     // surcharges client : à confirmer contractuellement
    },
    // L'IPN PayDunya s'authentifie par SHA-512(MasterKey) — statique
    // par compte, elle ne prouve ni la fraîcheur ni le montant de
    // l'événement. Le service DOIT re-vérifier via checkStatus avant
    // toute confirmation.
    webhookReverification: true,

    async initiate(input: InitiateInput): Promise<InitiateResult> {
      const creds = parseCredentials(input.call?.credentials);
      const cfg = (input.call?.config ?? {}) as PaydunyaConfig;
      if (!cfg.store?.name) {
        throw new ProviderConfigError("config", "config.store.name PayDunya requis");
      }
      const res = await request(cfg, creds, "POST", "/checkout-invoice/create", {
        invoice: {
          total_amount: input.amount,
          description: cfg.description ?? `Paiement scolaire ${input.intentId}`,
          ...(cfg.channels?.length ? { channels: cfg.channels } : {}),
          ...(input.payerPhone ? { customer: { phone: input.payerPhone } } : {}),
        },
        store: {
          name: cfg.store.name,
          ...(cfg.store.tagline ? { tagline: cfg.store.tagline } : {}),
          ...(cfg.store.phone_number ? { phone_number: cfg.store.phone_number } : {}),
          ...(cfg.store.postal_address ? { postal_address: cfg.store.postal_address } : {}),
          ...(cfg.store.website_url ? { website_url: cfg.store.website_url } : {}),
        },
        // Idempotence : la référence interne voyage dans custom_data,
        // champ documenté renvoyé tel quel dans l'IPN et le statut.
        custom_data: { intent_id: input.intentId },
        actions: {
          // URL d'IPN calculée côté serveur — jamais depuis la config.
          ...(input.call?.callbackUrl ? { callback_url: input.call.callbackUrl } : {}),
        },
      });
      if (str(res.response_code) !== "00") {
        throw new ProviderBusinessError(
          `PAYDUNYA_${str(res.response_code) ?? "??"}`,
          str(res.response_text) ?? "Création de facture refusée",
        );
      }
      const token = str(res.token);
      const redirect = str(res.response_text);
      if (!token || !redirect) {
        throw new ProviderUnavailableError(
          "Réponse PayDunya incohérente (token ou URL de redirection absent)",
        );
      }
      // providerRef = token documenté ; instructions = URL de paiement
      // (renvoyée telle quelle par l'API en response_text).
      return { providerRef: token, instructions: redirect };
    },

    async checkStatus(providerRef, _script, call): Promise<StatusResult> {
      const creds = parseCredentials(call?.credentials);
      const cfg = (call?.config ?? {}) as PaydunyaConfig;
      const res = await request(
        cfg, creds, "GET",
        `/checkout-invoice/confirm/${encodeURIComponent(providerRef)}`,
      );
      if (str(res.response_code) !== "00") {
        throw new ProviderBusinessError(
          `PAYDUNYA_${str(res.response_code) ?? "??"}`,
          str(res.response_text) ?? "Statut indisponible",
        );
      }
      const invoice = (res.invoice ?? res.data) as JsonObj | undefined;
      // Le token retourné doit correspondre à celui interrogé —
      // une facture d'un autre compte n'est jamais acceptée.
      const returnedToken = str(invoice?.token);
      if (returnedToken && returnedToken !== providerRef) {
        throw new ProviderUnavailableError(
          "Réponse PayDunya incohérente (token ≠ facture demandée)",
        );
      }
      const custom = (res.custom_data ?? invoice?.custom_data) as JsonObj | undefined;
      const rawStatus =
        str(invoice?.status) ?? str(res.status);
      const n = normalizeStatus(rawStatus);
      return {
        status: n.status,
        rawStatus: n.rawStatus,
        amount: num(invoice?.total_amount) ?? num(invoice?.amount),
        currency: str(invoice?.currency),
        customRef: str(custom?.intent_id),
        // Référence transaction : champ exact à confirmer
        // contractuellement (cf. g3e-first-provider-spec.md §10).
        providerTxId: str(res.transaction_id) ?? str(invoice?.transaction_id),
        reason: str(res.response_text) !== "Transaction Found" ? str(res.response_text) : undefined,
      };
    },

    verifyWebhook({ rawBody, secret }): WebhookVerification {
      const data = parseIpnData(rawBody);
      if (!data) return { ok: false, error: "MALFORMED" };

      // 1) Authenticité — SHA-512(MasterKey) en temps constant.
      const hash = str(data.hash);
      if (!hash || !safeEqual(hash.toLowerCase(), masterKeyHash(secret))) {
        return { ok: false, error: "INVALID_SIGNATURE" };
      }

      // 2) Structure minimale attendue.
      const invoice = (data.invoice ?? {}) as JsonObj;
      const token = str(invoice.token) ?? str(data.token);
      const rawStatus = str(data.status) ?? str(invoice.status);
      if (!token || !rawStatus) return { ok: false, error: "MALFORMED" };
      const n = normalizeStatus(rawStatus);

      // 3) Référence de session = le TOKEN (providerRef stocké sur
      //    l'intention) — la résolution se fait par (providerId,
      //    providerRef), jamais par schoolId. `custom_data.intent_id`
      //    est conservé en trace mais n'est pas la clé de jointure.
      const custom = (data.custom_data ?? {}) as JsonObj;

      const event: NormalizedWebhookEvent = {
        // Déduplication : un même token/statut = un même événement.
        externalId: `${token}:${rawStatus.toLowerCase()}`,
        intentRef: token,
        status: n.status,
        providerTxId: str(data.transaction_id) ?? str(invoice.transaction_id),
        reason: str(data.fail_reason) ?? str(invoice.fail_reason),
        eventType: `PAYDUNYA.${n.status}`,
        raw: {
          // Champs du contrat de traitement (processWebhookEvent lit
          // intentRef/status/providerTxId/reason depuis le payload) +
          // diagnostic PayDunya sanitisé — JAMAIS le hash (dérivable
          // de la masterKey → prévenir les rejeux forgés).
          intentRef: token,
          status: n.status,
          providerTxId: str(data.transaction_id) ?? str(invoice.transaction_id) ?? null,
          reason: str(data.fail_reason) ?? str(invoice.fail_reason) ?? null,
          token,
          raw_status: rawStatus,
          response_code: str(data.response_code) ?? null,
          response_text: str(data.response_text) ?? null,
          total_amount: num(invoice.total_amount) ?? null,
          intent_id: str(custom.intent_id) ?? null,
          hash: "[redacted]",
        },
      };
      return { ok: true, event };
    },
  };
}

/** Instance production (transport fetch réel — inerte sans verrou). */
export const paydunyaAdapter = createPaydunyaAdapter(fetchTransport);
