/**
 * G3-E Phase 2B — transport HTTP injectable pour les adaptateurs de
 * prestataires réels.
 *
 * La logique métier (formatage des requêtes, parsing, sécurité) vit
 * dans l'adaptateur ; le transport ne sait que « émettre une requête
 * et renvoyer statut + corps ». En recette on injecte un transport
 * simulé déterministe — AUCUN accès réseau réel n'est possible.
 *
 * Le transport par défaut (`fetchTransport`) n'est atteint qu'après
 * le verrou global LIVE + secrets + liveEnabled ; les recettes le
 * remplacent systématiquement par un double de test.
 */
import { ProviderTimeoutError, ProviderUnavailableError } from "./types";

export type HttpRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  /** Corps texte (JSON ou form-urlencoded selon le prestataire). */
  body?: string;
  timeoutMs: number;
};

export type HttpResponse = {
  /** Code HTTP (200, 400, 500…). */
  status: number;
  /** Corps brut — le parsing relève de l'adaptateur. */
  body: string;
};

export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

const DEFAULT_TIMEOUT_MS = 15_000;

/** Transport réel via fetch — utilisé uniquement hors recettes. */
export const fetchTransport: HttpTransport = async (req) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: ctrl.signal,
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      throw new ProviderTimeoutError(`Délai dépassé (${req.timeoutMs} ms)`);
    }
    throw new ProviderUnavailableError(
      `Transport HTTP indisponible : ${e instanceof Error ? e.message : "erreur réseau"}`,
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Transport simulé déterministe pour les recettes — aucun accès
 * réseau. Chaque appel est routé par `handler` ; tout appel est
 * journalisé pour vérification (urls touchées, corps envoyés).
 */
export type MockTransportHandler = (
  req: HttpRequest,
) => HttpResponse | undefined | Promise<HttpResponse | undefined>;

export function createMockTransport(handler: MockTransportHandler): {
  transport: HttpTransport;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  const transport: HttpTransport = async (req) => {
    calls.push(req);
    const res = await handler(req);
    if (!res) {
      throw new ProviderUnavailableError(
        `Transport simulé : aucune réponse prévue pour ${req.method} ${req.url}`,
      );
    }
    return res;
  };
  return { transport, calls };
}
