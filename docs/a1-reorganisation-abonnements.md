# Lot A1 — Réorganisation des abonnements (analyse, sans implémentation)

> Références : `docs/matrice-fonctionnalites-par-abonnement.md`, `docs/ecarts-permissions-abonnements.md`,
> `src/lib/services/platform/modules.ts`, base locale (lecture seule).
> Tarifs inchangés : Essentiel 15 000 / Pro 30 000 / Premium 50 000 FCFA/mois.

## 1. Matrice commerciale actuelle (base réelle)

| Module | Essentiel | Professionnel | Premium | Contrôle serveur effectif ? |
|---|:-:|:-:|:-:|---|
| ADMINISTRATION | ✓ | ✓ | ✓ | Partiel (écritures `school.manage`, `user.*`, `academic.manage`, `portal.manage`) |
| STUDENTS | ✓ | ✓ | ✓ | **Non** — clés mappées inexistantes |
| TEACHERS | ✓ | ✓ | ✓ | **Non** — idem |
| CLASSES_SUBJECTS | ✓ | ✓ | ✓ | Seulement `rooms.*` |
| SCHEDULES | ✗ | ✓ | ✓ | Oui (sauf `schedules.print`, `coursecontent.manage`) |
| ATTENDANCE | ✗ | ✓ | ✓ | Oui (sauf `attendance.justify`) |
| GRADES | ✗ | ✓ | ✓ | Oui |
| REPORT_CARDS | ✗ | ✓ | ✓ | Oui |
| FINANCE | ✗ | ✗ | ✓ | Oui — bloc indivisible |
| COMMUNICATION | ✗ | ✗ | ✓ | Oui (`announcements.*`, `messages.*`) |
| PARENT_PORTAL | ✗ | ✗ | ✓ | Oui |
| STUDENT_PORTAL | ✗ | ✗ | ✓ | Oui |
| REPORTS | ✗ | ✗ | ✓ | **Module mort** — aucune permission mappée |
| Quotas | 300 élèves / 15 users | 1 000 / 50 | illimité | `checkLimit` effectif (sauf invitations portail) |

## 2. Matrice cible proposée (objectif utilisateur)

| Fonctionnalité | Module technique | Essentiel | Pro | Premium |
|---|---|:-:|:-:|:-:|
| Administration, élèves, classes, enseignants | noyau | ✓ | ✓ | ✓ |
| Emplois du temps | SCHEDULES | ✓ | ✓ | ✓ |
| Présences et absences | ATTENDANCE | ✓ | ✓ | ✓ |
| Notes, moyennes, bulletins | GRADES + REPORT_CARDS | ✓ | ✓ | ✓ |
| Encaissements et reçus | FINANCE_CORE *(à créer)* | ✓ | ✓ | ✓ |
| Suivi des impayés | FINANCE_CORE | ✓ | ✓ | ✓ |
| Portails parents / élèves | PARENT_PORTAL + STUDENT_PORTAL | ✗ | ✓ | ✓ |
| Communication enrichie (annonces, messages) | COMMUNICATION | ✗ | ✓ | ✓ |
| Rapports détaillés | REPORTS *(à câbler)* | ✗ | ✓ | ✓ |
| Gestion des dépenses / trésorerie | TREASURY *(futur)* | ✗ | ✓* | ✓* |
| Communication avancée (programmation, WhatsApp, modèles) | COMMUNICATION_ADVANCED *(futur)* | ✗ | ✗ | ✓ |
| Rapports avancés (audit, multi-années, consolidés) | REPORTS_ADVANCED *(futur)* | ✗ | ✗ | ✓ |
| Budgets et fournisseurs | BUDGETS / SUPPLIERS *(futur)* | ✗ | ✗ | ✓ |
| Configuration finance avancée (tarifs, remises, clôtures) | FINANCE_MGMT *(à créer ou conserver dans FINANCE)* | ✗ | ✓ | ✓ |
| Comptabilité générale avancée | — | ✗ | ✗ | ✗ (évolution future) |
| Quotas | — | 300 / 15 | 1 000 / 50 | illimité |

\* lorsque développée.

## 3. Différences actuel → cible

| Changement | Sens | Impact sur les écoles actuelles |
|---|---|---|
| SCHEDULES passe en Essentiel | Élargissement | gain de fonctionnalités |
| ATTENDANCE passe en Essentiel | Élargissement | idem |
| GRADES + REPORT_CARDS passent en Essentiel | Élargissement | idem |
| FINANCE éclatée : encaissements/reçus/impayés en Essentiel | Élargissement (socle caisse) | écoles Essentiel gagnent la caisse de base |
| FINANCE_MGMT (config tarifs, remises, clôture) en Pro+ | Restriction vs aujourd'hui | attention : Premium actuel garde tout |
| PARENT_PORTAL / STUDENT_PORTAL : Premium → Pro | Élargissement | écoles Pro gagnent les portails |
| COMMUNICATION : Premium → Pro | Élargissement | idem |
| REPORTS : Premium → Pro (avec câblage) | Élargissement + correction module mort | — |
| TREASURY, BUDGETS, SUPPLIERS, COMMUNICATION_ADVANCED, REPORTS_ADVANCED | Nouveaux modules | aucun — à développer |

**Bilan** : la cible est **globalement élargissante** — aucune école existante ne perd une fonctionnalité, ce qui simplifie la migration.

## 4. Faisabilité par fonctionnalité

| Fonctionnalité | Module | Développée ? | Correction nécessaire |
|---|---|---|---|
| Gestion élèves/classes/enseignants | STUDENTS/CLASSES_SUBJECTS/TEACHERS | Oui | Corriger `PERMISSION_MODULE` (clés singulières) **ou** retirer ces modules du contrôle (noyau implicite) — décision à prendre |
| EDT | SCHEDULES | Oui | Mapper `schedules.print` ; décider du cas `isOwnSession` |
| Présences | ATTENDANCE | Oui | Mapper `attendance.justify` |
| Notes/bulletins | GRADES/REPORT_CARDS | Oui | Aucune — mapping complet |
| Encaissements/reçus/impayés | FINANCE_CORE | Oui | **Éclater `finance.*`** : `finance.read`, `finance.payments.create/read`, `finance.receipts.*`, `finance.reports.read` (impayés) → FINANCE_CORE ; `finance.configure`, `finance.fees.manage`, `finance.discounts.manage`, `finance.payments.validate/cancel`, `finance.cash.close` → FINANCE_MGMT |
| Portails | PARENT/STUDENT_PORTAL | Oui | Aligner `portal.manage` (invitations) sur le module portail correspondant ; ajouter `checkLimit` aux invitations |
| Communication enrichie | COMMUNICATION | Oui | Clarifier `announcements.read` vs `.manage` (lecture publique ?) ; `notifications.read`/`messages.read`/`preferences.read` : vérifier ou retirer |
| Rapports détaillés | REPORTS | Non (module mort) | Câbler `finance.reports.read`, `reports.attendance` (mort), exports ; ou créer `SCHOOL_REPORTS` |
| Dépenses/trésorerie | TREASURY | **À développer** | modèle + écrans + permissions `treasury.*` |
| Communication avancée | COMMUNICATION_ADVANCED | Partiel (jobs, programmation, adaptateurs existent) | découper `messages.manage` en niveaux |
| Rapports avancés | REPORTS_ADVANCED | **À développer** | nouvelles vues/permissions |
| Budgets/fournisseurs | BUDGETS/SUPPLIERS | **À développer** | modèles + écrans + permissions |
| Comptabilité générale | — | **À développer** | hors périmètre A1 |

## 5. Corrections techniques nécessaires (avant ou pendant A1)

| # | Correction | Pourquoi | Effort |
|---|---|---|---|
| C1 | Réparer `PERMISSION_MODULE` (clés singulières : `student.*`, `classroom.*`, `teacher.*`, `subject.*`, `guardian.*`, `enrollment.*`) | rend l'inclusion/retrait de modules réelle | Faible |
| C2 | Mapper `schedules.print`, `coursecontent.manage`, `attendance.justify`, `academic.read` | ferme les fuites hors module | Faible |
| C3 | Éclater `finance.*` en FINANCE_CORE / FINANCE_MGMT | condition du socle caisse en Essentiel | Moyen (mapping + décision par permission) |
| C4 | Câbler REPORTS (ou créer module dédié) | « rapports détaillés » Pro vendable | Moyen |
| C5 | `checkLimit("users")` sur invitations portail | cohérence quota | Faible |
| C6 | Décider permissions mortes (`grade.*`, `reports.attendance`, `finance.manage`, `notifications.read`, `messages.read`, `preferences.read`) | hygiène RBAC | Faible |
| C7 | Masquer « inviter parent/élève » si module portail inactif | UX | Faible |
| C8 | Nettoyer modules/plans de test `P8*`/`P9*` (ou `commercial:false` partout) | catalogue | Faible |

## 6. Stratégie de migration recommandée

Principe : **élargissement uniquement** — aucune école ne perd d'accès. Trois options :

| Option | Description | Recommandation |
|---|---|---|
| A. Modifier `PlanModule` des plans existants | Ajouter SCHEDULES/ATTENDANCE/GRADES/REPORT_CARDS/FINANCE_CORE à ESSENTIEL, portails/comm/reports à PRO | **Recommandée** — simple, instantané, rétrocompatible ; effet immédiat via `getEntitlements` |
| B. Nouveaux codes de plan (V2) + migration opt-in | Laisse les abonnements actifs inchangés | Sûre mais complexifie l'offre ; utile seulement si des retraits étaient prévus — ce n'est pas le cas |
| C. Overrides par école | Cas par cas | À réserver aux exceptions commerciales |

Étapes proposées :
1. C1–C2 (mapping) — **attention** : corriger les clés rendra le retrait de modules effectif ; à livrer **avec** la nouvelle répartition pour ne pas casser d'écoles.
2. Mettre à jour `PlanModule` (option A) + scripts de vérification.
3. C3 : éclatement finance — mapping uniquement, aucune migration de données.
4. C4–C8 : corrections associées.
5. Mise à jour `/tarifs` (copie) après activation — contenu dynamique déjà alimenté par `PlanModule`/`SubscriptionPlan`.
6. Les abonnements actifs (ex. Collège Démo = PREMIUM) ne changent ni de statut ni de période : seuls les droits s'élargissent.

## 7. Tests à prévoir (profil × abonnement)

| Combinaison | Vérifications clés |
|---|---|
| ADMIN_SCHOOL × Essentiel | élèves/EDT/présences/notes/bulletins/encaissement OK ; portails/communication/rapports détaillés masqués |
| ADMIN_SCHOOL × Pro | + portails, annonces, messages, rapports ; pas FINANCE_MGMT avancé si retenu Pro+ |
| TEACHER × Essentiel | appel + saisie notes possibles (nouveau vs aujourd'hui bloqué) |
| CASHIER × Essentiel | encaisser/reçu possibles (nouveau) ; valider/annuler/clôturer bloqués |
| PARENT/STUDENT × Essentiel vs Pro | portail refusé en Essentiel, ouvert en Pro |
| FINANCE_MANAGER × Essentiel | caisse socle uniquement |
| N'importe × SUSPENDED | lecture seule + portails ouverts |
| Overrides | activation/désactivation unitaire effective après C1 |
| Quotas | blocage `maxStudents`/`maxUsers` aux seuils ; invitations portail comptées |
| Sans abonnement | comportement fail-open documenté (décision : conserver ou durcir) |

## 8. Fonctionnalités futures (hors implémentation A1)

- TREASURY : dépenses, trésorerie (Pro/Premium)
- COMMUNICATION_ADVANCED : envois programmés/WhatsApp/modèles (Premium) — socle jobs/adaptateurs déjà présent
- REPORTS_ADVANCED : consolidations multi-années, audit financier (Premium)
- BUDGETS, SUPPLIERS : achats et budgets (Premium)
- Comptabilité générale avancée : à étudier

## 9. Limites du système actuel à connaître

- Le contrôle d'abonnement agit **par permission**, pas par écran : découper un écran (ex. page finances avec onglets caisse/config) exige que chaque action ait sa propre permission — c'est le cas.
- `userHasSchoolPermission` (affichage) ne connaît pas l'abonnement : les `has:` restent décoratifs ; le garde serveur fait foi.
- Le fail-open « sans abonnement » neutralise toute répartition pour les écoles legacy.
- Le module REPORTS mort montre qu'un module sans permission mappée est purement cosmétique.
