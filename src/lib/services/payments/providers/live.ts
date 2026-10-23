/**
 * G3-E — Verrou global des paiements réels.
 *
 * `MOBILE_MONEY_LIVE_ENABLED` est le kill-switch SERVEUR, indépendant
 * de `PaymentProvider.liveEnabled` (activation contrôlée par école).
 * Toute opération susceptible de contacter un prestataire réel exige
 * simultanément :
 *   - verrou global explicitement "true" ;
 *   - prestataire ACTIVE ;
 *   - mode LIVE + activation contrôlée (`liveEnabled`) ;
 *   - adaptateur réel enregistré ;
 *   - secrets présents (références résolues en mémoire uniquement).
 *
 * Les prestataires SANDBOX ne sont jamais soumis au verrou — la
 * protection sandbox (aucun appel réseau) est inchangée. Les webhooks
 * entrants ne passent PAS par ce verrou : leur conservation et leur
 * audit relèvent de la preuve financière (G3-B) — la vérification de
 * signature est un calcul local, pas un appel prestataire.
 */
import { resolveProviderSecret } from "./secrets";
import { ProviderConfigError } from "./types";
import type { PaymentProviderAdapter } from "./types";

/** Vrai uniquement si la variable vaut explicitement "true". */
export function isLivePaymentsEnabled(): boolean {
  return process.env.MOBILE_MONEY_LIVE_ENABLED === "true";
}

export type LiveProviderShape = {
  code: string;
  mode: string;
  status: string;
  liveEnabled: boolean;
  credentialsRef?: string | null;
};

/**
 * Barrière d'exécution LIVE — appelée dans les SERVICES avant tout
 * appel adaptateur susceptible de joindre un prestataire réel.
 * `null` = appel autorisé ; sinon code d'erreur métier à renvoyer
 * SANS invoquer l'adaptateur (aucun effet de bord externe).
 */
export function checkLiveExecution(
  provider: LiveProviderShape,
  adapter: PaymentProviderAdapter | null,
): string | null {
  if (provider.mode !== "LIVE") return null; // SANDBOX : verrou non applicable
  if (!isLivePaymentsEnabled()) return "LIVE_DISABLED";
  if (provider.status !== "ACTIVE") return "PROVIDER_INACTIVE";
  if (!provider.liveEnabled) return "PROVIDER_NOT_LIVE";
  if (!adapter) return "PROVIDER_UNAVAILABLE";
  try {
    resolveProviderSecret(provider, "credentials");
  } catch (e) {
    if (e instanceof ProviderConfigError) return "PROVIDER_CONFIG";
    throw e;
  }
  return null;
}
