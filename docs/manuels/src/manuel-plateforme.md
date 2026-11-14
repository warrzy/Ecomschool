<!-- title: Manuel Administrateur plateforme ECOM-TOUCH -->
# Manuel administrateur plateforme — ECOM-TOUCH

Manuel de l'équipe ECOM-TOUCH : supervision multi-établissements sous
`/platform`. Cet espace est **distinct** des espaces écoles — il gère
les établissements clients, les offres commerciales, les abonnements et
la santé du service. Il n'accède **jamais** aux données des élèves.

## 1. Référentiel des établissements

**Menu :** Établissements (`/platform/schools`)

![Établissements](captures/platform-schools.png)

Table de tous les établissements : nom, code, ville, membres, années,
statut. Actions par ligne : **Fiche** (détail) et **Suspendre**
(suspension de l'accès — lecture seule côté école).

- **Créer un établissement** : identité, code unique, contact
  administrateur — l'onboarding invite ensuite le premier
  administrateur.

## 2. Onboarding

**Menu :** Création établissement (`/platform/onboarding`)

![Onboarding](captures/platform-onboarding.png)

Assistant de mise en service d'un nouveau client : création de
l'école → premier compte administrateur → vérifications de
provisionnement. À l'issue, l'école est autonome pour son paramétrage.

## 3. Offres et modules

**Menus :** Offres (`/platform/plans`), Modules (`/platform/modules`)

![Offres](captures/platform-plans.png)

- **Offres** : plans commerciaux (modules inclus, limites d'effectif,
  tarif).
- **Modules** : catalogue technique de la plateforme avec dépendances
  (ex. états comptables ⇒ comptabilité) — un module activé tire ses
  prérequis.

## 4. Abonnements et factures

**Menus :** Abonnements (`/platform/subscriptions`),
Factures (`/platform/invoices`)

![Abonnements](captures/platform-subscriptions.png)

- **Abonnements** : rattachement école ↔ offre, statut (essai, actif,
  impayé, grâce, suspendu). La suspension/expédition bascule l'école en
  lecture seule automatiquement.
- **Factures** : émission et suivi des factures plateforme.

## 5. Supervision

**Menu :** Supervision (`/platform/monitoring`)

![Supervision](captures/platform-monitoring.png)

Vue santé : jobs en file (emails, SMS, purges), jobs en échec (DEAD —
à rejouer), métriques de rétention. C'est votre tour de contrôle
quotidienne.

## 6. Autres entrées

| Menu | Fonction |
|---|---|
| Demandes | Demandes d'inscription publiques d'écoles prospects |
| Administrateurs | Comptes de l'équipe plateforme |
| Automatisations | Tâches planifiées (purges, rappels) |
| Audit | Journal d'audit plateforme — qui a fait quoi, quand |
| Assistance | Sessions d'assistance horodatées dans une école — **visibles par l'école** (bandeau) et tracées |
| Profil | Votre compte |

## 7. Règles d'exploitation

- **Principe du moindre accès** : `/platform` ne lit pas les données
  métier des écoles ; l'assistance se fait par session dédiée, visible
  et expirante.
- **Suspendre ≠ supprimer** : la suspension préserve toutes les
  données et coupe l'accès ; la suppression n'existe pas en self-service.
- **Audit first** : toute action sensible (suspension, changement de
  plan, session d'assistance) est journalisée.
