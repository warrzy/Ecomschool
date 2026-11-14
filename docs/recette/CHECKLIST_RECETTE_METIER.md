# Checklist de recette métier — ECOM-SCHOOL

À parcourir sur https://preprod.ecomschool.fr (école « ÉCOLE DÉMO
VALIDATION »). Cocher ✅ / ❌, noter les écarts en fin de document.
Chaque refus attendu est indiqué — c'est un **résultat correct**, pas un
bug.

## 1. Accès & sécurité

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 1.1 | Connexion avec identifiants valides | tous | Redirection vers l'espace du rôle | |
| 1.2 | Connexion avec mauvais mot de passe | tous | Refus générique (pas d'indice) | |
| 1.3 | `/app` depuis un compte parent | parent | Redirection `/parent` | |
| 1.4 | `/teacher` depuis un compte admin | admin | Redirection `/app` | |
| 1.5 | `/app/rh` depuis compte comptable | compta | **403** | |
| 1.6 | `/app/rh/paie` depuis compte RH | rh | **403** | |
| 1.7 | `/app/rh/paie` depuis compte paie | paie | 200 | |
| 1.8 | `/app/comptabilite` depuis compte paie | paie | **403** | |
| 1.9 | `/app/students` depuis compte parent | parent | Redirection `/parent` | |
| 1.10 | Menu latéral | chaque profil | Seules les entrées permises s'affichent | |

## 2. Scolarité

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 2.1 | Liste des élèves | admin | 13 élèves, filtres année/classe | |
| 2.2 | Créer un élève + inscrire | admin | Inscription visible, **créance auto-générée** | |
| 2.3 | Classes & niveaux | admin | 5 classes, 4 niveaux 2026-2027 | |
| 2.4 | Matières par classe | admin | Coefficients affichés (MATH coef 4) | |
| 2.5 | Emploi du temps | admin | Créneaux Math 6e A / 5e A | |
| 2.6 | Devoir publié | admin | « Devoir n°1 Mathématiques — 6e A » PUBLIÉ | |

## 3. Finances

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 3.1 | Encaisser un paiement | admin | Reçu `REC-…` numéroté | |
| 3.2 | Rejouer la même soumission | admin | **Même reçu** — aucun doublon | |
| 3.3 | Paiement > reste dû | admin | Refus `OVERPAYMENT` | |
| 3.4 | Impayés | admin | Liste des soldes dus | |
| 3.5 | Relance impayé | admin | Relance enregistrée + tracée | |
| 3.6 | Trésorerie | compta | Journée de caisse, encaissements du jour | |
| 3.7 | Enregistrer une dépense | compta | Dépense créée → payée → OD générable | |

## 4. Comptabilité SYSCOHADA

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 4.1 | Plan de comptes | compta | Comptes starter (411, 571, 706…) | |
| 4.2 | « Générer les écritures » | compta | Écritures équilibrées par source | |
| 4.3 | Bilan | compta | **Actif = Passif** | |
| 4.4 | Compte de résultat | compta | Produits / charges cohérents | |
| 4.5 | Écriture manuelle déséquilibrée | compta | **Refusée** | |
| 4.6 | Ligne débit ET crédit | compta | **Refusée** | |
| 4.7 | Balance âgée tiers | compta | Créances élèves par ancienneté | |
| 4.8 | Clôturer un exercice avec opérations non postées | compta | **Refusée** (UNPOSTED_OPERATIONS) | |

## 5. RH & paie

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 5.1 | Liste employés + contrats | rh | 7 employés, CDI actifs | |
| 5.2 | Dotations de congés | rh | Soldes ANNUAL 30 j / SICK 10 j provisionnés | |
| 5.3 | Approuver la demande en attente | rh | Solde déduit, demande APPROVED | |
| 5.4 | Créer contrat activé | rh | Dotation automatique, **aucun doublon** | |
| 5.5 | Campagne paie + calcul | paie | Bulletins déterministes | |
| 5.6 | Bulletin détaillé | paie | Brut, retenues, net, snapshot formule | |
| 5.7 | Octroyer une avance | paie | Restant suivi, recouvrement **plafonné** | |
| 5.8 | Valider → comptabiliser | paie | OD équilibrée postée, run POSTED | |
| 5.9 | Rectifier un run posté | paie | Contre-passation + run correctif DRAFT | |
| 5.10 | Retenues CNSS/ITS sur bulletin | paie | **Absent — normal** (barème non validé) | |

## 6. Portails

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 6.1 | Tableau de bord enseignant | enseignant | Cours semaine (4), classes (2) | |
| 6.2 | Faire l'appel | enseignant | Liste de classe, présents/absents | |
| 6.3 | Cahier de textes | enseignant | Séance avec chapitre/devoirs | |
| 6.4 | Aperçu enfant | parent | Awa 6e A + Mariam 5e A | |
| 6.5 | Notes enfant | parent | « Mathématiques 14,5/20 » visible | |
| 6.6 | Finances enfant | parent | Créances + reçu téléchargeable | |
| 6.7 | Absences enfant | parent | Retard 15 min d'Awa listé | |
| 6.8 | Annonces | parent | « Conseil d'école » visible | |
| 6.9 | Notifications | parent | « Tout marquer lu » fonctionne (POST) | |

## 7. Robustesse

| # | Vérification | Profil | Résultat attendu | ☐ |
|---|---|---|---|---|
| 7.1 | Double-clic sur un formulaire | tous | 1 seule opération enregistrée | |
| 7.2 | Rafraîchir après succès | tous | Pas de duplication | |
| 7.3 | Aucune erreur 500 rencontrée | tous | Zéro erreur serveur | |
| 7.4 | URL d'un autre rôle saisie directement | tous | 403 ou redirection — jamais de données | |

## Écarts constatés

| # | Écart | Page | Gravité | Commentaire |
|---|---|---|---|---|
| | | | | |
