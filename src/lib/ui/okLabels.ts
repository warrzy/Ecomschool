/**
 * Dictionnaire central des codes de succès métier → messages français
 * destinés aux bannières `?ok=…`.
 *
 * Symétrique de `errorLabels.ts` : les codes internes et les paramètres
 * d'URL restent inchangés ; tout code inconnu reçoit un message
 * générique — jamais de valeur technique brute à l'écran.
 */

const OK_LABELS: Record<string, string> = {
  // Générique
  created: "Création enregistrée.",
  updated: "Modification enregistrée.",
  saved: "Enregistrement effectué.",
  removed: "Élément supprimé.",
  cancelled: "Annulation enregistrée.",
  unchanged: "Aucune modification : tout était déjà à jour.",
  status: "Statut mis à jour.",
  draft: "Brouillon enregistré.",

  // Élèves / inscriptions / parents / utilisateurs
  enrolled: "Inscription enregistrée.",
  transferred: "Transfert enregistré.",
  linked: "Association enregistrée.",
  unlinked: "Dissociation enregistrée.",
  consent: "Consentement enregistré.",
  teacher: "Enseignant enregistré.",
  admin: "Administrateur créé.",
  reset: "Mot de passe réinitialisé.",
  invite: "Invitation envoyée.",
  access: "Accès accordé.",

  // Scolarité / pédagogie
  current: "Année courante mise à jour.",
  closed: "Clôture enregistrée.",
  level: "Coefficient enregistré.",
  subject: "Matière enregistrée.",
  session: "Séance enregistrée.",
  moved: "Séance déplacée.",
  started: "Séance ouverte.",
  ended: "Séance terminée.",
  attendance: "Appel enregistré.",
  justified: "Justification enregistrée.",
  assigned: "Affectation enregistrée.",
  content: "Contenu enregistré.",

  // Notes / résultats / bulletins
  computed: "Moyennes calculées.",
  validated: "Résultats validés.",
  published: "Résultats publiés — bulletins consultables.",
  annual: "Résultats annuels calculés.",
  generated: "Bulletins générés.",
  rectified: "Bulletin rectifié.",
  appreciation: "Appréciation enregistrée.",
  annotations: "Annotations enregistrées.",
  archived: "Archivage effectué.",
  activated: "Activation effectuée.",

  // Finances
  registered: "Inscription enregistrée et créances générées.",
  registered_no_tariffs:
    "Inscription enregistrée. Aucun tarif n'est configuré pour cette année : le dossier financier est prêt, les créances seront à générer après configuration.",
  charges_checked: "Inscription déjà active — créances vérifiées et complétées si nécessaire.",
  registered_charges_failed:
    "Inscription enregistrée, mais la génération des créances a échoué. Relancez la génération depuis le tableau de bord financier.",
  payment: "Paiement encaissé.",
  recorded: "Paiement enregistré.",
  payment_cancelled: "Paiement annulé.",
  charges: "Frais générés.",
  tariff: "Tarif enregistré.",
  category: "Catégorie enregistrée.",
  discount: "Remise enregistrée.",
  discount_archived: "Remise archivée.",
  installment: "Échéance mise à jour.",
  credit: "Avoir enregistré.",
  reminded: "Relance envoyée.",
  account: "Compte enregistré.",
  expense: "Dépense enregistrée.",
  expense_paid: "Dépense marquée payée.",
  expense_cancelled: "Dépense annulée.",

  // Admissions (G2-B)
  campaign: "Campagne enregistrée.",
  secret_rotated: "Code de suivi régénéré.",
  privacy: "Politique de confidentialité enregistrée.",

  // Documents (G2-A)
  uploaded: "Document déposé.",
  replaced: "Document remplacé.",
  deleted: "Document supprimé.",

  // Communication / plateforme
  sent: "Envoi lancé.",
  request: "Demande envoyée.",
  reviewed: "Demande traitée.",
  subscription: "Abonnement enregistré.",
  suspended: "Suspension effectuée.",
  reactivated: "Réactivation effectuée.",
  renewed: "Renouvellement enregistré.",
  trial: "Essai prolongé.",
  plan: "Offre modifiée.",
  module: "Module mis à jour.",
  sweep: "Traitement exécuté.",
};

/** Message français d'un code de succès — générique si inconnu. */
export function okMessage(code: string | null | undefined): string {
  if (!code) return "";
  return OK_LABELS[code] ?? "Opération effectuée.";
}
