import type { MessageChannel } from "@prisma/client";

/**
 * Fournisseurs d'envoi par canal. Aucune donnée sensible ne quitte le serveur
 * sans fournisseur explicitement configuré (variables d'environnement).
 * Si le canal n'est pas configuré → indisponible (jamais d'envoi simulé).
 */

export type SendInput = {
  to: string;
  subject?: string;
  body: string;
  /** Nom de template approuvé (WhatsApp Business). */
  templateName?: string;
};

export type SendResult =
  | { ok: true; providerRef?: string; costUnits?: number }
  | { ok: false; error: string; retryable?: boolean };

export interface ChannelProvider {
  channel: MessageChannel;
  configured(): boolean;
  send(input: SendInput): Promise<SendResult>;
}

/** Timeout et décodage d'un POST JSON générique. */
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Email (webhook SMTP / API HTTP générique) ----------

export const emailProvider: ChannelProvider = {
  channel: "EMAIL",
  configured() {
    return !!process.env.EMAIL_PROVIDER_URL;
  },
  async send(input) {
    const url = process.env.EMAIL_PROVIDER_URL;
    if (!url) return { ok: false, error: "PROVIDER_NOT_CONFIGURED" };
    try {
      const res = await postJson(
        url,
        { to: input.to, subject: input.subject ?? "", text: input.body },
        process.env.EMAIL_PROVIDER_TOKEN
          ? { authorization: `Bearer ${process.env.EMAIL_PROVIDER_TOKEN}` }
          : {},
      );
      if (!res.ok) {
        return { ok: false, error: `HTTP_${res.status}`, retryable: res.status >= 500 };
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, providerRef: data.id };
    } catch {
      return { ok: false, error: "NETWORK", retryable: true };
    }
  },
};

// ---------- SMS (passerelle HTTP générique compatible Burkina Faso) ----------

export const smsProvider: ChannelProvider = {
  channel: "SMS",
  configured() {
    return !!process.env.SMS_PROVIDER_URL && !!process.env.SMS_PROVIDER_TOKEN;
  },
  async send(input) {
    const url = process.env.SMS_PROVIDER_URL;
    const token = process.env.SMS_PROVIDER_TOKEN;
    if (!url || !token) return { ok: false, error: "PROVIDER_NOT_CONFIGURED" };
    try {
      const res = await postJson(
        url,
        { to: input.to, text: input.body },
        { authorization: `Bearer ${token}` },
      );
      if (!res.ok) {
        return { ok: false, error: `HTTP_${res.status}`, retryable: res.status >= 500 };
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      // Estimation du coût configurable (unités par segment de 160 car.).
      const unitCost = Number(process.env.SMS_COST_PER_SEGMENT ?? 0);
      const segments = Math.max(1, Math.ceil(input.body.length / 160));
      return { ok: true, providerRef: data.id, costUnits: Math.trunc(unitCost * segments) };
    } catch {
      return { ok: false, error: "NETWORK", retryable: true };
    }
  },
};

// ---------- WhatsApp Business Platform (API officielle Meta) ----------

export const whatsappProvider: ChannelProvider = {
  channel: "WHATSAPP",
  configured() {
    return !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
  },
  async send(input) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false, error: "PROVIDER_NOT_CONFIGURED" };
    if (!input.templateName) {
      return { ok: false, error: "TEMPLATE_REQUIRED" };
    }
    try {
      const res = await postJson(
        `https://graph.facebook.com/v21.0/${phoneId}/messages`,
        {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: { name: input.templateName, language: { code: "fr" } },
        },
        { authorization: `Bearer ${token}` },
      );
      if (!res.ok) {
        return { ok: false, error: `HTTP_${res.status}`, retryable: res.status >= 500 };
      }
      const data = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
      };
      return { ok: true, providerRef: data.messages?.[0]?.id };
    } catch {
      return { ok: false, error: "NETWORK", retryable: true };
    }
  },
};

// ---------- Registre ----------

const providers: Record<string, ChannelProvider> = {
  EMAIL: emailProvider,
  SMS: smsProvider,
  WHATSAPP: whatsappProvider,
};

/** Remplace un fournisseur — réservé aux tests. */
export function registerTestProvider(channel: MessageChannel, provider: ChannelProvider) {
  providers[channel] = provider;
}

export function getProvider(channel: MessageChannel): ChannelProvider | null {
  return providers[channel] ?? null;
}

export function channelAvailable(channel: MessageChannel): boolean {
  if (channel === "INTERNAL") return true;
  return providers[channel]?.configured() ?? false;
}

export function channelsStatus() {
  return (["EMAIL", "SMS", "WHATSAPP"] as const).map((c) => ({
    channel: c,
    configured: channelAvailable(c),
  }));
}
