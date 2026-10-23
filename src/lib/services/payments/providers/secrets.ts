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

/**
 * Résout le secret d'un prestataire depuis l'environnement.
 * `provider` ne transporte que les noms de variables (`…Ref`).
 */
export function resolveProviderSecret(
  provider: { credentialsRef?: string | null; webhookSecretRef?: string | null },
  kind: SecretKind,
): string {
  const ref = kind === "credentials" ? provider.credentialsRef : provider.webhookSecretRef;
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
