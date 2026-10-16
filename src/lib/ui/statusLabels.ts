/**
 * Dictionnaires partagés : valeur technique (enum BDD/API) → libellé
 * français d'affichage. Les valeurs stockées, les paramètres d'URL et
 * les exports ne changent pas — seul le rendu est traduit.
 *
 * Les domaines correspondent aux enums Prisma :
 * `record` = RecordStatus (élèves, enseignants, parents, classes,
 * niveaux, matières, salles, échéances…).
 */

type Labels = Record<string, string>;

const ACADEMIC_YEAR_STATUS: Labels = {
  DRAFT: "Brouillon",
  ACTIVE: "Active",
  CLOSED: "Clôturée",
};

const PERIOD_TYPE: Labels = {
  TRIMESTER: "Trimestre",
  SEMESTER: "Semestre",
  OTHER: "Autre",
};

// RecordStatus — référentiels (élèves, enseignants, parents, classes, …)
const RECORD_STATUS: Labels = {
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};

const ENROLLMENT_STATUS: Labels = {
  ENROLLED: "Inscrit",
  TRANSFERRED: "Transféré",
  WITHDRAWN: "Retiré",
  COMPLETED: "Terminé",
};

const USER_STATUS: Labels = {
  ACTIVE: "Actif",
  DISABLED: "Désactivé",
};

const MEMBERSHIP_STATUS: Labels = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
};

const ASSESSMENT_STATUS: Labels = {
  DRAFT: "Brouillon",
  OPEN: "Ouverte",
  SUBMITTED: "Soumise",
  VALIDATED: "Validée",
  PUBLISHED: "Publiée",
  CANCELLED: "Annulée",
};

const GRADE_STATUS: Labels = {
  ENTERED: "Saisie",
  MISSING: "Non noté",
  ABSENT: "Absent",
  EXEMPT: "Dispensé",
  CANCELLED: "Annulé",
};

// ResultStatus — moyennes, résultats annuels et bulletins
const RESULT_STATUS: Labels = {
  DRAFT: "Brouillon",
  CALCULATED: "Calculé",
  PENDING_VALIDATION: "En attente de validation",
  VALIDATED: "Validé",
  PUBLISHED: "Publié",
  RECTIFIED: "Rectifié",
};

const PAYMENT_STATUS: Labels = {
  VALIDATED: "Validé",
  CANCELLED: "Annulé",
};

const PAYMENT_METHOD: Labels = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement bancaire",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

const SUBSCRIPTION_STATUS: Labels = {
  TRIALING: "Essai",
  ACTIVE: "Actif",
  PAST_DUE: "Impayé",
  GRACE: "Période de grâce",
  SUSPENDED: "Suspendu",
  CANCELLED: "Résilié",
  EXPIRED: "Expiré",
};

const SCHOOL_STATUS: Labels = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
};

const SCHOOL_TYPE: Labels = {
  PRIMARY: "Primaire",
  MIDDLE: "Collège",
  HIGH: "Lycée",
  MIXED: "Mixte",
  OTHER: "Autre",
};

const SESSION_STATUS: Labels = {
  PLANNED: "Planifiée",
  DONE: "Terminée",
  CANCELLED: "Annulée",
  POSTPONED: "Reportée",
};

const ATTENDANCE_STATUS: Labels = {
  PRESENT: "Présent",
  ABSENT: "Absent",
  LATE: "En retard",
  EXCUSED: "Excusé",
  UNMARKED: "Non renseigné",
};

const GENDER: Labels = {
  MALE: "Masculin",
  FEMALE: "Féminin",
};

const GUARDIAN_RELATION: Labels = {
  FATHER: "Père",
  MOTHER: "Mère",
  GUARDIAN: "Tuteur",
  FINANCIAL: "Responsable financier",
  EMERGENCY: "Contact d'urgence",
};

const GRADING_POLICY_STATUS: Labels = {
  DRAFT: "Brouillon",
  ACTIVE: "Active",
  ARCHIVED: "Archivée",
};

const MESSAGE_STATUS: Labels = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmé",
  SENT: "Envoyé",
  PARTIAL: "Partiel",
  FAILED: "Échec",
  CANCELLED: "Annulé",
};

const DELIVERY_STATUS: Labels = {
  QUEUED: "En file",
  SENT: "Envoyé",
  FAILED: "Échec",
  SKIPPED: "Ignoré",
  BLOCKED: "Bloqué",
};

const JOB_STATUS: Labels = {
  PENDING: "En attente",
  RUNNING: "En cours",
  DONE: "Terminé",
  FAILED: "Échec",
  DEAD: "Abandonné",
};

const SIGNUP_REQUEST_STATUS: Labels = {
  PENDING: "En attente",
  CONTACTED: "Contactée",
  APPROVED: "Approuvée",
  CONVERTED: "Convertie",
  ALREADY_CONVERTED: "Déjà convertie",
  REJECTED: "Rejetée",
};

const PLATFORM_INVOICE_STATUS: Labels = {
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

const SUPPORT_SESSION_STATUS: Labels = {
  ACTIVE: "Active",
  ENDED: "Terminée",
  EXPIRED: "Expirée",
};

const CHANGE_REQUEST_STATUS: Labels = {
  PENDING: "En attente",
  APPROVED: "Approuvée",
  REJECTED: "Rejetée",
};

const MAPS = {
  academicYear: ACADEMIC_YEAR_STATUS,
  periodType: PERIOD_TYPE,
  record: RECORD_STATUS,
  student: RECORD_STATUS,
  teacher: RECORD_STATUS,
  guardian: RECORD_STATUS,
  classroom: RECORD_STATUS,
  level: RECORD_STATUS,
  subject: RECORD_STATUS,
  room: RECORD_STATUS,
  enrollment: ENROLLMENT_STATUS,
  user: USER_STATUS,
  membership: MEMBERSHIP_STATUS,
  assessment: ASSESSMENT_STATUS,
  grade: GRADE_STATUS,
  result: RESULT_STATUS,
  reportCard: RESULT_STATUS,
  payment: PAYMENT_STATUS,
  paymentMethod: PAYMENT_METHOD,
  installment: RECORD_STATUS,
  subscription: SUBSCRIPTION_STATUS,
  school: SCHOOL_STATUS,
  schoolType: SCHOOL_TYPE,
  session: SESSION_STATUS,
  attendance: ATTENDANCE_STATUS,
  gender: GENDER,
  guardianRelation: GUARDIAN_RELATION,
  gradingPolicy: GRADING_POLICY_STATUS,
  message: MESSAGE_STATUS,
  delivery: DELIVERY_STATUS,
  job: JOB_STATUS,
  signupRequest: SIGNUP_REQUEST_STATUS,
  platformInvoice: PLATFORM_INVOICE_STATUS,
  supportSession: SUPPORT_SESSION_STATUS,
  changeRequest: CHANGE_REQUEST_STATUS,
} as const;

export type StatusDomain = keyof typeof MAPS;

/**
 * Libellé français d'une valeur technique. Retourne la valeur brute si
 * inconnue (mieux que masquer une information) — les nouveaux statuts
 * restent visibles jusqu'à l'ajout de leur libellé.
 */
export function statusLabel(
  domain: StatusDomain,
  value: string | null | undefined,
): string {
  if (value == null || value === "") return "—";
  return MAPS[domain][value] ?? value;
}
