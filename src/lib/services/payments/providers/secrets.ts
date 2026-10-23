/**
 * G3-E — Résolution des secrets prestataires.
 *
 * Règles invariants :
 *   - la base stocke uniquement des RÉFÉRENCES (noms de variables
 *     d'environnement : `credentialsRef`, `webhookSecretRef`) ;
 *   - un secret n'existe qu'en mémoire serveur, jamais en base,
 *     jamais en log, jamais renvoyé au navigateur ;
 *   - une référence absente ou une variable vide lève
 *     `ProviderConfigError` — jamais de secret par défaut ni de repli.
 */
import { ProviderConfigError } from "./types";

type SecretKind = "credentials" | "webhook";
export type RemoteEnv = "TEST" | "LIVE";

/**
 * Résout le secret d'un prestataire depuis l'environnement.
 * `provider` ne transporte que les noms de variables (`…Ref`).
 *
 * Phase 3B — l'environnement distant choisit la RÉFÉRENCE :
 * TEST → `testCredentialsRef`/`testWebhookSecretRef`,
 * LIVE → `credentialsRef`/`webhookSecretRef`. La séparation est
 * garantie par la configuration serveur (deux jeux de variables),
 * jamais par le préfixe des clés — celui-ci n'est qu'un contrôle
 * complémentaire.
 */
export function resolveProviderSecret(
  provider: {
    credentialsRef?: string | null;
    webhookSecretRef?: string | null;
    testCredentialsRef?: string | null;
    testWebhookSecretRef?: string | null;
  },
  kind: SecretKind,
  env: RemoteEnv = "LIVE",
): string {
  const ref = env === "TEST"
    ? (kind === "credentials" ? provider.testCredentialsRef : provider.testWebhookSecretRef)
    : (kind === "credentials" ? provider.credentialsRef : provider.webhookSecretRef);
  if (!ref) {
    throw new ProviderConfigError(
      kind === "credentials" ? "credentialsRef" : "webhookSecretRef",
      `Référence de secret ${kind} absente`,
    );
  }
  const value = process.env[ref];
  if (!value) {
    // La référence (nom de variable) peut figurer en log/erreur ; sa
    // valeur, jamais.
    throw new ProviderConfigError(ref, `Variable d'environnement ${ref} absente ou vide`);
  }
  return value;
}
