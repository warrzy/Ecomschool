# Phase 8 — Plateforme SaaS commerciale ECOM-TOUCH

Branche : `phase-8-saas-commercial` (depuis `phase-7-finance`).

## Étape 0 — Audit et corrections

- `/platform/modules`, `/platform/subscriptions`, `/platform/support` étaient des placeholders — remplacés par de vraies interfaces.
- L'activation des modules n'existait pas : les permissions scolaires ne dépendaient d'aucun abonnement — corrigé au niveau du guard (`requireSchoolPermission`).
- `listUnpaid` (finances scolaires) réécrit : déduction des réductions/exonérations sur les créances, distinction **échéances exigibles** (`due`, `late`, `daysLate`) vs **montants futurs** (`remaining`).
- Branche créée depuis l'état validé ; Prisma 7 et migrations existantes préservés ; backup `phase8-pre-*.sql` avant `migrate deploy`.

## Schéma (migration `20261011023728_phase8_saas_commercial`)

- `PlatformModule` : catalogue commercialisable (code unique, dépendances `dependsOn[]`, flag `commercial`).
- `SubscriptionPlan` + `PlanModule` : prix mensuel/annuel en entiers XOF, limites `maxStudents`/`maxUsers`, `trialDays`, `graceDays`, statut.
- `SchoolSubscription` : `TRIALING → ACTIVE/PAST_DUE → GRACE → SUSPENDED → EXPIRED`, `CANCELLED` ; dates de période, essai, grâce.
- `SubscriptionEvent` : historique horodaté (attribution, prolongation, changement d'offre, renouvellement, suspension, réactivation, résiliation).
- `SchoolModuleOverride` : activation/blocage par école, prioritaire sur le plan.
- `SubscriptionChangeRequest` : demande d'offre côté école, validation ECOM-TOUCH obligatoire.
- `PlatformInvoice` (+`PlatformInvoiceLine`) : `snapshot` JSON **immuable** (émetteur, client, lignes, dates), numérotation `INV-YYYY-#####` unique avec retry sur collision.
- `PlatformPayment` : `idempotencyKey` unique, statut `VALIDATED/CANCELLED` (contre-écriture auditée).
- `PlatformCreditNote` : `AV-YYYY-#####` unique.
- `PlatformConfig` : informations légales/fiscales configurables (nom, adresse, NIF, pied de facture) — aucune mention réglementaire inventée.
- `SupportSession` : motif obligatoire, durée plafonnée 72 h, `ACTIVE/ENDED/EXPIRED`.

## Services (`src/lib/services/platform/`)

- `modules.ts` : `PERMISSION_MODULE` mappe chaque permission `school.*` à un module ; `isPermissionCoveredBySubscription` applique les droits réels — sans abonnement (écoles historiques) tout est autorisé ; en suspension/expiration/résiliation **lecture seule** (`*.read`, `*.print`, portails) ; `checkLimit`/`usageSnapshot` pour élèves et utilisateurs.
- `plans.ts` : CRUD offres, recomposition des modules, code unique refusé.
- `subscriptions.ts` : attribution (l'ancienne souscription est résiliée, historisée), changement d'offre, prolongation d'essai, renouvellement, suspension, réactivation, résiliation ; `sweepSubscriptions()` idempotent (fin de période → grâce `graceDays` → suspension → expiration après 90 jours) — **aucune suppression de données** ; demandes de changement d'offre.
- `billing.ts` : factures (lignes explicites ou prix de l'offre), règlements partiels idempotents, avoirs, annulations auditées, impayés échus ; statut recalculé depuis les écritures réelles.
- `support.ts` : sessions d'assistance motivées, limitées, expirées automatiquement — **aucun contournement de permission**, simple traçabilité visible côté école.
- `monitoring.ts` : mesures réelles (latence BDD mesurée, uptime, compteurs, migrations `_prisma_migrations`, erreurs du journal d'audit) — aucune valeur statique.
- `dashboard.ts` : écoles actives, abonnements par statut/offre, CA facturé, encaissé, impayés échus, **MRR** (équivalent mensuel), échéances 30 j, demandes en attente.
- `src/lib/pdf/invoice.ts` : facture A4 rendue depuis le snapshot.

## Application des droits et limites (serveur)

- `guard.ts` : après le check de permission métier, `isPermissionCoveredBySubscription` — un module non souscrit ou une suspension bloque l'accès côté serveur, pas seulement la navigation.
- `enrollments.ts` / `users.ts` : `checkLimit` avant création — dépassement refusé (`LIMIT_REACHED`), downgrade ne supprime rien.

## Interface

- `/platform` : 8 KPI réels (écoles, essais, suspendus/expirés, CA facturé ≠ encaissé ≠ MRR, impayés) + répartition par offre + échéances 30 j.
- `/platform/modules` : catalogue avec dépendances et nombre d'offres.
- `/platform/plans` : création/édition (prix, limites, essai, grâce, modules).
- `/platform/subscriptions` : liste, statuts, sweep manuel du cycle de vie, approbation des demandes d'offre.
- `/platform/invoices` (+`[id]` + `[id]/pdf`) : liste, impayés échus, règlement, avoir, annulation, PDF.
- `/platform/monitoring` : BDD (latence mesurée), app, usage, abonnements, migrations, erreurs, audit.
- `/platform/support` : ouverture/clôture de sessions, motif et durée obligatoires.
- `/platform/schools/[id]` : + sections Abonnement (actions complètes), Modules (droits effectifs + overrides), Facturation SaaS, Historique d'abonnement.
- `/app/subscription` : offre, statut, échéances, limites d'usage, modules, factures — **lecture seule** ; demande de changement d'offre (admin école, activation jamais automatique).
- Layout `/app` : bannière visible pendant toute session d'assistance active (agent, motif, expiration).

## Politique suspension/expiration

- `TRIALING/ACTIVE/PAST_DUE/GRACE` : accès normal aux modules souscrits.
- `SUSPENDED/CANCELLED/EXPIRED` : lecture seule (`*.read`, `*.print`, portails parent/élève) — données conservées, restitution garantie ; réactivation = nouvelle période si l'ancienne est dépassée.

## Résultats

- **Phase 8 : 59/59** — offres, modules, overrides, limites serveur, upgrade, downgrade sans perte, essai, grâce, suspension lecture seule, réactivation, facture, numérotation, snapshot, règlement partiel/total, idempotence, avoir, impayés, isolation A/B, demande d'offre, permissions platform, assistance, supervision, dashboard, PDF.
- Régressions : P2 32/32 · P3 39/39 · P4 47/47 · P5 44/44 · P6 39/39 · P7 49/49.
- `typecheck` ✅ `lint` ✅ `build` ✅ (~75 routes).

## Limites connues

- Pas de tâche planifiée automatique : `sweepSubscriptions()` est exposé via `/platform/subscriptions` (bouton) et appelable par cron ; `expireSupportSessions()` s'exécute à la lecture.
- Pas de passerelle de paiement en ligne (règlements saisis manuellement).
- Le balayage PAST_DUE est directement suivi de GRACE (pas d'état intermédiaire persistant).
