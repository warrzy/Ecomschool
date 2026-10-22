# Clôture du cycle G2 — Admissions et renouvellement de scolarité

Document de synthèse technique et fonctionnelle du cycle G2 (G2-A → G2-E),
validé en préproduction. Release de référence stable : **`20261022_223122`**,
commit applicatif **`4dc3128`** sur `phase-10-production-readiness`.

## Vue d'ensemble

Le cycle G2 connecte le parcours public de candidature aux modules existants
de scolarité (élèves, responsables, inscriptions) et de finances (créances,
échéanciers), puis boucle la gestion annuelle avec les réinscriptions.
Aucune logique métier parallèle n'a été créée : chaque lot réutilise les
services existants (`createStudent`, `enrollStudent`, `generateStudentCharges`,
`recordPayment`, `findPotentialDuplicates`, `inviteGuardianAccount`).

## Les cinq lots

| Lot | Objet | Livrables principaux | Résultat préprod |
|---|---|---|---|
| G2-A | Campagnes d'admission | `AdmissionCampaign` (fenêtre, niveaux, pièces exigées, capacité, frais), CRUD back-office, statuts DRAFT/OPEN/CLOSED/ARCHIVED | 38 PASS |
| G2-B | Candidatures publiques | Dépôt public multi-enfants avec pièces, numéro de dossier `DOS-YYYY-#####`, code de suivi secret, suivi public par ticket HMAC, pièces téléchargeables par jeton signé, page confidentialité | 72 PASS |
| G2-C | Instruction des dossiers | Transitions de statut, entretiens, notes internes (invisibles publiquement), demandes de complément, décision admis/refusé/conditionnelle, réexamen, liste d'attente | 63 PASS |
| G2-D | Conversion en inscription | `previewConversion`, `liftConditions`, `convertApplication`, `inviteConvertedAccount` ; transaction advisory-lock, idempotence, doublons bloquants, créances idempotentes, préparation du compte portail | 56 PASS |
| G2-E | Réinscriptions annuelles | `ReenrollmentCampaign/Request/Message`, éligibilité + suggestions de progression, dépôt parent ou administratif, instruction, décision avec classe cible, finalisation transactionnelle, traitement en masse, onglet portail parent | 91 PASS + 20 PASS UI |

## Migrations

| Migration | Contenu |
|---|---|
| (G2-A/B, antérieures) | `AdmissionCampaign`, `AdmissionApplication`, `AdmissionMessage`, `AdmissionEvent`, `Document`, secret de suivi |
| (G2-C) | `AdmissionInterview`, statuts d'instruction |
| `20261022203506_add_admission_conversion` | `conditionsLiftedAt/ById`, `convertedAt/ById` sur `AdmissionApplication` |
| `20261022231500_add_reenrollment` | `ReenrollmentCampaign`, `ReenrollmentRequest`, `ReenrollmentMessage`, enums de statut/progression |

Toutes les migrations sont **additives** : aucune colonne ou contrainte
existante n'a été modifiée, garantissant la compatibilité avec les
données de production.

## Permissions ajoutées (bootstrap idempotent)

- `admissions.read / review / decide / manage / convert`
- `reenrollments.read / review / decide / manage`
- Toutes liées à `ADMIN_SCHOOL` ; `portal.parent` réutilisé pour le
  portail famille sans extension de droits.

## Tests de bout en bout

| Suite | Périmètre | Résultat |
|---|---|---|
| `scripts/g2/admissions-recette.ts` | G2-B : dépôt, suivi, tickets, pièces | 72 PASS |
| `scripts/g2/admissions-g2c-recette.ts` | G2-C : instruction, décisions, confidentialité | 63 PASS |
| `scripts/g2/admissions-g2d-recette.ts` | G2-D : conversion, concurrence, rollback, isolation | 56 PASS |
| `scripts/g2/reenrollment-g2e-recette.ts` | G2-E : campagnes → finalisation, lot, impayés | 91 PASS |
| `scripts/g2/g2-transversal-recette.ts` | Cycle complet : candidature → conversion → réinscription, dettes préservées | 31 PASS |
| `scripts/g2/admissions-ui-check.ts` | Parcours UI admission → conversion | 35 PASS local / 33+1 SKIP préprod |
| `scripts/g2/reenrollment-ui-check.ts` | Parcours UI campagne → dépôt parent → finalisation | 20 PASS local / 19+1 SKIP préprod |
| Non-régressions | Guichet d'inscription, F3 dépenses/trésorerie/rapports | 101 PASS |

Fixtures : données 100 % synthétiques, supprimées après chaque recette
(`G2*_CLEANUP=1`), y compris les comptes utilisateurs orphelins créés
sans `schoolId` (corrigé dans les helpers de nettoyage).

## Garanties transactionnelles validées

- Conversion : verrou advisory par dossier, `CONVERTED` en fin de
  transaction, rejeu idempotent, deux conversions simultanées → une
  seule inscription (correctif : contrôles d'ambiguïté déplacés sous
  le verrou).
- Réinscription : verrou advisory par demande, unicité
  `(studentId, targetYearId)`, une seule inscription `ENROLLED` par
  élève/année, créances idempotentes par
  `@@unique(studentId, academicYearId, categoryId)`.
- Aucun paiement fictif, aucune dette antérieure annulée, historique
  d'admission et inscriptions sources préservés.

## Risques résiduels ouverts

| Risque | État | Action requise |
|---|---|---|
| Restauration PostgreSQL en base témoin jamais exercée | Bloqué par `CREATEDB` absent sur `ecomschool_app` | Exécuter une fois en admin : `CREATE DATABASE ecomschool_verify OWNER ecomschool_app;` |
| Sauvegardes locales uniquement (`BACKUP_LOCAL_ONLY=1`) | Choix documenté | Activer une destination distante avant production réelle |
| Jetons d'invitation portail remis manuellement | Volontaire | Canal d'envoi à traiter dans G1 communications |
| Rapprochement responsables par téléphone exact | Blocage ambigu = choix humain | Normalisation de format optionnelle |
| Politique de blocage impayés = booléen par campagne | Simple | Règle fine (seuil, exonération) à valider métier |
| Pas de notification interne aux familles sur complément/décision | Fil de demande existant | G1 communications |
| Pas de modèle d'écriture comptable ni de code compte sur `FeeCategory` | Attendu | Chantier SYSCOHADA dédié |

## Points d'exploitation

- Rollback : releases antérieures conservées (`20261022_212356`, …),
  procédure `deploy/scripts/rollback.sh`.
- Voisins du VPS (`wendyam-finance`, `tme-machinery`) : aucun impact
  constaté aux déploiements G2.
- Cron `/api/cron` actif (jobs + automatisations + purge de rétention).
