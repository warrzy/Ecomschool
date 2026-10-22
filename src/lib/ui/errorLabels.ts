/**
 * Dictionnaire central des codes d'erreur métier → messages français
 * destinés à l'affichage utilisateur (bannières ?error=…).
 *
 * Les codes internes restent inchangés côté services, actions et tests.
 * Tout code inconnu reçoit un message générique — jamais d'exception
 * technique ni de détail sensible à l'écran.
 */

const ERROR_LABELS: Record<string, string> = {
  // Générique
  INVALID_INPUT: "Certaines informations saisies sont invalides. Vérifiez le formulaire.",
  INVALID: "Requête invalide.",
  INVALID_JSON: "Données invalides.",
  NOT_FOUND: "Élément introuvable.",
  FORBIDDEN: "Action non autorisée.",
  CONFLICT: "Cette action entre en conflit avec une donnée existante.",
  CREATE_FAILED: "La création a échoué. Réessayez.",
  UPDATE_FAILED: "La modification a échoué. Réessayez.",
  DELETE_FAILED: "La suppression a échoué. Réessayez.",
  SAVE_FAILED: "L'enregistrement a échoué. Réessayez.",
  DUPLICATE: "Un élément identique existe déjà.",
  NETWORK: "Erreur réseau. Réessayez.",

  // Élèves / utilisateurs / parents
  MATRICULE_TAKEN: "Ce matricule est déjà attribué à un autre élève.",
  EMAIL_TAKEN: "Cette adresse email est déjà utilisée.",
  CODE_TAKEN: "Ce code est déjà utilisé.",
  ALREADY_EXISTS: "Un élément identique existe déjà.",
  ALREADY_LINKED: "Cet élément est déjà associé.",
  CANNOT_TARGET_SELF: "Vous ne pouvez pas effectuer cette action sur votre propre compte.",
  CANNOT_TARGET_PLATFORM_USER: "Cette action ne peut pas cibler un utilisateur de la plateforme.",
  INVALID_ROLE: "Rôle invalide pour cette action.",
  LAST_ACTIVE_ADMIN: "Impossible : c'est le dernier administrateur actif de l'établissement.",
  INVALID_TOKEN: "Lien invalide ou expiré.",

  // Scolarité / inscriptions / notes
  NO_CURRENT_YEAR: "Aucune année scolaire courante n'est définie.",
  ALREADY_ENROLLED: "Cet élève est déjà inscrit dans une classe cette année.",
  CROSS_YEAR: "La classe et l'année scolaire ne correspondent pas.",
  YEAR_CLOSED: "Cette année scolaire est clôturée.",
  CLASSROOM_ARCHIVED: "Cette classe est archivée : l'inscription est impossible.",
  HAS_ENROLLED: "Impossible d'archiver : des élèves sont encore inscrits dans cette classe.",
  HAS_DEPENDENCIES: "Impossible d'archiver : cet élément est encore utilisé (classes actives, affectations ou évaluations en cours).",
  HAS_ACTIVE_ENROLLMENT: "Impossible d'archiver cet élève : il est encore inscrit. Clôturez d'abord son inscription.",
  STUDENT_INACTIVE: "Cet élève est archivé : l'inscription est impossible.",
  NOT_ENROLLED: "Cet élève n'est pas inscrit pour cette année scolaire.",
  IS_CURRENT: "Action impossible sur l'année courante.",
  LOCKED: "L'évaluation ou la période est verrouillée.",
  PERIOD_LOCKED: "Cette période de notation est verrouillée.",
  RECTIFICATION_REQUIRED: "Ce bulletin est publié : utilisez la rectification avec motif pour produire une nouvelle version.",
  OUT_OF_RANGE: "Une note est hors du barème autorisé.",
  INVALID_STATE: "Action impossible dans l'état actuel de l'élément.",
  INVALID_STATUS: "Statut invalide pour cette action.",
  CLOSED_DAY: "Journée clôturée : la saisie est impossible.",
  OVERPAYMENT: "Le montant saisi dépasse le solde restant dû de l'élève.",
  TEMPLATE_REQUIRED: "Un gabarit de bulletin est requis.",

  // Finances
  ALREADY_CANCELLED: "Cet élément est déjà annulé.",
  ALREADY_PAID: "Cet élément est déjà payé.",
  IDEMPOTENCY_CONFLICT: "Cette opération a déjà été enregistrée avec un contenu différent.",

  // Abonnement / limites commerciales
  LIMIT_REACHED: "La limite de votre abonnement est atteinte. Contactez ECOM-TOUCH.",
  LIMIT_STUDENTS: "Le nombre maximal d'élèves de votre abonnement est atteint.",
  LIMIT_USERS: "Le nombre maximal d'utilisateurs de votre abonnement est atteint.",
  PLAN_NOT_FOUND: "Offre introuvable.",
  MODULE_DISABLED: "Cette fonctionnalité n'est pas incluse dans votre abonnement.",

  // Messagerie / notifications
  PROVIDER_NOT_CONFIGURED: "Le canal d'envoi n'est pas configuré pour cet établissement.",
  INVALID_PHONE: "Numéro WhatsApp invalide — format international attendu (ex. +226XXXXXXXX).",
  PHONE_REQUIRED: "Renseignez votre numéro WhatsApp pour activer les alertes.",
  TRANSACTIONAL_REQUIRED: "Le canal transactionnel doit être activé pour cet envoi.",
  ENQUEUE_FAILED: "L'envoi n'a pas pu être planifié. Réessayez.",

  // Documents (G2-A)
  FILE_TOO_LARGE: "Le fichier dépasse la taille maximale autorisée (5 Mo).",
  UNSUPPORTED_TYPE: "Ce type de fichier n'est pas accepté (PDF, JPEG ou PNG uniquement).",
  QUOTA_EXCEEDED: "Le quota de stockage de l'établissement est atteint.",
  STORAGE_FAILED: "L'enregistrement du fichier a échoué. Réessayez.",
  INTEGRITY_ERROR: "Le fichier a été altéré : contactez l'administrateur.",

  // Divers
  SETTINGS_NOT_OBJECT: "Paramètres invalides.",
  UNKNOWN_ERROR: "Une erreur inattendue est survenue. Réessayez.",
};

const GENERIC_MESSAGE =
  "Une erreur est survenue. Réessayez, puis contactez le support si le problème persiste.";

/** Message français affichable pour un code d'erreur métier (ou inconnu). */
export function errorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_MESSAGE;
  return ERROR_LABELS[code] ?? GENERIC_MESSAGE;
}
