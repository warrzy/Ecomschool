/**
 * G3-A — Abstraction des prestataires de paiement Mobile Money.
 *
 * Un adaptateur par prestataire (Orange Money, Moov Money, agrégateur…)
 * et un adaptateur SANDBOX déterministe pour les recettes sans argent
 * réel. L'interface couvre l'initiation et la consultation de statut ;
 * la vérification de signature de webhook est prévue pour G3-B.
 */

export type ProviderPaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "EXPIRED";

export type InitiateInput = {
  /** Référence interne unique de l'intention (renvoyée comme référence métier). */
  intentId: string;
  amount: number;
  currency: string;
  payerPhone?: string | null;
  /** Scénario de simulation — ignoré par les adaptateurs réels. */
  sandboxScript?: SandboxScript | null;
};

export type InitiateResult = {
  providerRef: string;
  /** Instructions affichables (push USSD, lien agrégateur…). */
  instructions?: string;
};

export type StatusResult = {
  status: ProviderPaymentStatus;
  /** Identifiant de transaction côté prestataire (preuve d'encaissement). */
  providerTxId?: string;
  rawStatus?: string;
  reason?: string;
};

/** Erreur de transport/indisponibilité — distincte d'un refus métier. */
export class ProviderTimeoutError extends Error {
  constructor(message = "Délai prestataire dépassé") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

/** Événement webhook normalisé — produit de `verifyWebhook` après vérif. */
export type NormalizedWebhookEvent = {
  /** Identifiant unique de l'événement chez le prestataire (dédup). */
  externalId: string;
  /** Référence de session de l'intention (providerRef). */
  intentRef: string;
  status: ProviderPaymentStatus;
  providerTxId?: string;
  reason?: string;
  /** Horodatage métier de l'événement (ordonnancement). */
  occurredAt?: string;
  eventType: string;
  /** Contenu sanitisé stocké à des fins de diagnostic — jamais de secret. */
  raw: Record<string, unknown>;
};

export type WebhookVerification =
  | { ok: true; event: NormalizedWebhookEvent }
  | { ok: false; error: "INVALID_SIGNATURE" | "EXPIRED" | "MALFORMED" };

export interface PaymentProviderAdapter {
  readonly code: string;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  checkStatus(providerRef: string, script?: SandboxScript | null): Promise<StatusResult>;
  /**
   * Vérifie l'authenticité d'un webhook sur les OCTETS BRUTS du corps
   * et normalise l'événement. Chaque prestataire a son propre format
   * de signature — l'implémentation est propre à l'adaptateur.
   * Comparaison en temps constant + contrôle de fraîcheur requis.
   */
  verifyWebhook?(input: {
    rawBody: string;
    headers: Record<string, string>;
    /** Secret résolu depuis l'environnement — jamais depuis la base. */
    secret: string;
    now?: Date;
  }): WebhookVerification;
}

/** Scénario déterministe du simulateur SANDBOX. */
export type SandboxScript = {
  outcome: "SUCCESS" | "FAILED" | "PENDING" | "LATE" | "TIMEOUT" | "REPEATED";
  /** Nombre de consultations PENDING avant bascule (scénario LATE). */
  afterChecks?: number;
  /** Compteur interne de consultations (maintenu par le service). */
  checks?: number;
  reason?: string;
};
