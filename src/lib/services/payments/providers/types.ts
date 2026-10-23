/**
 * G3-A/G3-E — Abstraction des prestataires de paiement Mobile Money.
 *
 * Un adaptateur par prestataire (Orange Money, Moov Money, agrégateur…)
 * et un adaptateur SANDBOX déterministe pour les recettes sans argent
 * réel. AUCUNE capacité n'est supposée : chaque adaptateur déclare
 * explicitement ce qu'il prend en charge via `capabilities`.
 *
 * Contrat d'erreurs :
 *   - ProviderTimeoutError     transport/délai — le service réessaiera
 *   - ProviderUnavailableError prestataire injoignable — réessaiera
 *   - ProviderBusinessError    refus métier — jamais de retry automatique
 *   - ProviderConfigError      secret/config manquant — bloquant, alerté
 *
 * Contrat de temps : chaque méthode DOIT borner ses appels réseau
 * (recommandé ≤ ADAPTER_CALL_TIMEOUT_MS) — le service ne peut pas
 * interrompre un appel externe sans coopération de l'adaptateur.
 */

export type ProviderPaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "EXPIRED";

/**
 * Contexte d'appel résolu par le service pour un prestataire réel.
 * `credentials` contient les identifiants lus depuis l'environnement
 * (résolution `resolveProviderSecret`, mémoire seule — jamais en
 * base ni en log) ; `config` est `PaymentProvider.config` (non-secret).
 */
export type AdapterCallContext = {
  credentials?: string;
  config?: Record<string, unknown> | null;
};

export type InitiateInput = {
  /** Référence interne unique de l'intention (renvoyée comme référence métier). */
  intentId: string;
  amount: number;
  currency: string;
  payerPhone?: string | null;
  /** Scénario de simulation — ignoré par les adaptateurs réels. */
  sandboxScript?: SandboxScript | null;
  /** Contexte d'exécution (secrets + config) — prestataires LIVE. */
  call?: AdapterCallContext;
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
  /**
   * Montant/devise lus dans la réponse prestataire, quand exposés.
   * Le service compare toujours au montant attendu de l'intention —
   * une divergence ouvre une anomalie, jamais de comptabilisation.
   */
  amount?: number;
  currency?: string;
};

/** Délai maximal recommandé pour un appel prestataire (ms). */
export const ADAPTER_CALL_TIMEOUT_MS = 15_000;

/** Erreur de transport/indisponibilité — distincte d'un refus métier. */
export class ProviderTimeoutError extends Error {
  constructor(message = "Délai prestataire dépassé") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

/** Prestataire injoignable ou indisponible — retryable comme un timeout. */
export class ProviderUnavailableError extends Error {
  constructor(message = "Prestataire indisponible") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/** Refus métier (solde insuffisant, numéro invalide…) — pas de retry. */
export class ProviderBusinessError extends Error {
  readonly reason: string;
  constructor(reason: string, message = "Refus prestataire") {
    super(message);
    this.name = "ProviderBusinessError";
    this.reason = reason;
  }
}

/** Configuration absente (secret manquant, identifiants invalides). */
export class ProviderConfigError extends Error {
  readonly ref: string;
  constructor(ref: string, message = "Configuration prestataire incomplète") {
    super(message);
    this.name = "ProviderConfigError";
    this.ref = ref;
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

// ─── G3-E : remboursements et reversements via prestataire ──────────

export type ProviderRefundInput = {
  /** Référence de session de l'intention d'origine (providerRef). */
  intentRef: string;
  /** Transaction d'origine côté prestataire (preuve). */
  providerTxId: string;
  amount: number;
  currency: string;
  reason: string;
  /** Clé d'idempotence du remboursement (`rf:{refundId}`). */
  idempotencyKey: string;
  /** Scénario de simulation — ignoré par les adaptateurs réels. */
  sandboxScript?: SandboxScript | null;
};

export type ProviderRefundResult = {
  providerRefundRef: string;
  status: "EXECUTED" | "PENDING" | "FAILED";
  reason?: string;
};

/** Ligne d'un décompte prestataire (une transaction encaissée). */
export type ProviderSettlementItem = {
  providerTxId: string;
  grossAmount: number;
  feeAmount: number;
};

/** Décompte/reversement normalisé fourni par le prestataire. */
export type ProviderSettlementReport = {
  /** Référence du reversement chez le prestataire. */
  reference: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  feeTotal: number;
  netAmount: number;
  settledAt?: string;
  items: ProviderSettlementItem[];
  /** Curseur de pagination — null si la série est complète. */
  nextCursor?: string | null;
};

/**
 * Capacités déclarées par l'adaptateur — source de vérité. Une capacité
 * non déclarée = NON DISPONIBLE ; le service n'appelle jamais une
 * méthode absente. `payerFee` indique que le prestataire sait facturer
 * la commission au payeur en sus du montant.
 */
export type ProviderCapabilities = {
  initiate: boolean;
  pollStatus: boolean;
  webhooks: boolean;
  refunds: boolean;
  settlements: boolean;
  payerFee: boolean;
};

export interface PaymentProviderAdapter {
  readonly code: string;
  readonly capabilities: ProviderCapabilities;

  initiate(input: InitiateInput): Promise<InitiateResult>;
  checkStatus(
    providerRef: string,
    script?: SandboxScript | null,
    call?: AdapterCallContext,
  ): Promise<StatusResult>;

  /**
   * Sécurité des confirmations : quand `true`, un webhook `SUCCESS`
   * n'est JAMAIS suffisant pour confirmer — le service re-vérifie le
   * statut via `checkStatus` (et compare montant/devise) avant
   * `confirmIntent`. Requis pour les prestataires dont le mécanisme
   * webhook n'authentifie pas chaque événement individuellement
   * (ex. PayDunya : hash statique de la MasterKey).
   */
  readonly webhookReverification?: boolean;

  /**
   * Vérifie l'authenticité d'un webhook sur les OCTETS BRUTS du corps
   * et normalise l'événement. Chaque prestataire a son propre format
   * de signature — l'implémentation est propre à l'adaptateur.
   * Comparaison en temps constant + contrôle de fraîcheur requis.
   * Présente uniquement si `capabilities.webhooks`.
   */
  verifyWebhook?(input: {
    rawBody: string;
    headers: Record<string, string>;
    /** Secret résolu depuis l'environnement — jamais depuis la base. */
    secret: string;
    now?: Date;
  }): WebhookVerification;

  /**
   * Exécute un remboursement auprès du prestataire. Présente uniquement
   * si `capabilities.refunds` ET si le contrat de l'école l'autorise
   * (`PaymentProvider.refundsEnabled`). Doit être idempotent sur
   * `idempotencyKey`. Jamais appelé en sandbox sans scénario explicite.
   */
  initiateRefund?(input: ProviderRefundInput): Promise<ProviderRefundResult>;

  /**
   * Récupère les décomptes/reversements publiés par le prestataire sur
   * une période. Présente uniquement si `capabilities.settlements` —
   * la plupart des opérateurs n'exposent pas d'API de décompte : la
   * déclaration manuelle (PaymentSettlement.declared) reste alors le
   * seul canal, sans prétendre à une preuve bancaire.
   */
  fetchSettlements?(input: {
    periodStart: string;
    periodEnd: string;
    cursor?: string | null;
    sandboxScript?: SandboxScript | null;
  }): Promise<ProviderSettlementReport>;
}

/** Scénario déterministe du simulateur SANDBOX. */
export type SandboxScript = {
  outcome: "SUCCESS" | "FAILED" | "PENDING" | "LATE" | "TIMEOUT" | "REPEATED" | "ERROR";
  /** Nombre de consultations PENDING avant bascule (scénario LATE). */
  afterChecks?: number;
  /** Compteur interne de consultations (maintenu par le service). */
  checks?: number;
  reason?: string;
  /** Issue du remboursement simulé (défaut : EXECUTED). */
  refundOutcome?: "EXECUTED" | "PENDING" | "FAILED";
  /** Décompte simulé injecté dans fetchSettlements (défaut : vide). */
  settlements?: ProviderSettlementReport[];
};
