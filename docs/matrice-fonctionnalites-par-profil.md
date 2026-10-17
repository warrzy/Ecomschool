# Matrice des fonctionnalités par profil — ECOM-SCHOOL

> Diagnostic réalisé sur le commit `352ad56` (branche `phase-10-production-readiness`).
> Sources : `prisma/schema.prisma`, `src/lib/permissions/rbac.ts`, `src/lib/permissions/guard.ts`,
> `src/lib/services/platform/modules.ts` (PERMISSION_MODULE), garde réelle de chaque route dans `src/app/`.
> Base de référence : locale (rôles/permissions seedés identiques à la préprod).

## 1. Profils réellement définis (8)

| Profil | Scope | Nb permissions | Source |
|---|---|---|---|
| PLATFORM_OWNER | PLATFORM | 19 | Rôle global (`UserRole`) |
| PLATFORM_SALES | PLATFORM | 8 | Rôle global (`UserRole`) |
| ADMIN_SCHOOL | SCHOOL | 75 | Rôle global + déclinaison par école |
| FINANCE_MANAGER | SCHOOL | 11 | Rôle global |
| CASHIER | SCHOOL | 4 | Rôle global |
| TEACHER | SCHOOL | 21 | Rôle global |
| PARENT | SCHOOL | 2 | Rôle global |
| STUDENT | SCHOOL | 2 | Rôle global |

85 clés de permission existent en base (`Permission.key`). Mécanique d'autorisation :

- **Page/action école** : `requireSchoolPermission(key)` = membership ACTIVE + `RolePermission(key)` **+ couverture abonnement** (`isPermissionCoveredBySubscription`, `src/lib/permissions/guard.ts:26-42`).
- **Affichage conditionnel** : `userHasSchoolPermission` / `userHasPlatformPermission` (RBAC seul, sans contrôle abonnement).
- **Page/action plateforme** : `requirePlatformPermission(key)` = rôle PLATFORM + `RolePermission(key)` (pas de notion d'abonnement).
- **Isolation tenant** : contexte `requireSchoolContext` + filtre `schoolId` systématique ; `assertSchoolResourceAccess` pour les ressources.

## 2. PLATFORM_OWNER — Super Admin

Permissions (19) : `platform.audit.read`, `platform.invoices.read/manage`, `platform.modules.manage`, `platform.monitoring.read/manage`, `platform.payments.manage`, `platform.plans.read/manage`, `platform.schools.read/manage`, `platform.subscriptions.read/manage`, `platform.support.access`, `platform.users.manage`, `school.manage`, `school.read`, `user.manage`, `user.read`.

| Module | Action précise | C | Cr | M | S | I | E | V | Permission | Conditions |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| Établissements | Lister / fiche école | ✓ | | | | | | | `platform.schools.read` | |
| Établissements | Créer (onboarding), suspendre, réactiver | | ✓ | ✓ | | | | | `platform.schools.manage` | Via `/platform/onboarding` + actions |
| Établissements | Forcer/désactiver un module (override) | | | ✓ | | | | | `platform.modules.manage` | `SchoolModuleOverride`, audité |
| Demandes | Traiter demandes d'inscription (approuver/rejeter) | ✓ | | | | | | ✓ | `platform.schools.manage` | Cycle PENDING→CONTACTED→APPROVED→CONVERTED |
| Offres | Lire / modifier les formules | ✓ | | ✓ | | | | | `platform.plans.read/manage` | |
| Abonnements | Consulter, changer d'offre, suspendre, réactiver, sweep cycle de vie | ✓ | | ✓ | | | | ✓ | `platform.subscriptions.read/manage` | Événements historisés |
| Facturation | Émettre facture, encaisser, émettre avoir | ✓ | ✓ | ✓ | | | | | `platform.invoices.read/manage` + `platform.payments.manage` | |
| Administrateurs | Gérer les comptes plateforme | | ✓ | ✓ | ✓* | | | | `platform.users.manage` | *désactivation, pas de purge |
| Supervision | Monitoring, automatisations, jobs | ✓ | | | | | | | `platform.monitoring.read/manage` | Exécution des jobs dus |
| Audit | Consulter le journal d'audit | ✓ | | | | | | | `platform.audit.read` | |
| Assistance | Sessions de support (accès en écriture à une école) | | | | | | | | `platform.support.access` | Fenêtre limitée, tracée |
| Toutes pages école | Accès direct | | | | | | | | — | NON : les rôles PLATFORM n'ont pas de membership école ; l'accès passe par `platform.support.access` |

## 3. PLATFORM_SALES — Commercial

Permissions (8) : `platform.invoices.read/manage`, `platform.modules.manage`, `platform.payments.manage`, `platform.plans.read`, `platform.subscriptions.read/manage`.

| Module | Action | Permission | Restrictions mesurées |
|---|---|---|---|
| Offres | Consulter le catalogue | `platform.plans.read` | Pas de modification |
| Abonnements | Consulter + gérer (changement d'offre, suspension, sweep) | `platform.subscriptions.read/manage` | — |
| Factures / paiements | Lire, émettre, encaisser | `platform.invoices.read/manage`, `platform.payments.manage` | — |
| Modules | Modifier les overrides | `platform.modules.manage` | Droit large pour un profil commercial |
| Établissements | — | — | `platform.schools.*` **absent** : pas de liste écoles, pas de demandes d'inscription, pas d'onboarding (menus masqués, pages `/platform/forbidden`) |
| Administrateurs / audit / monitoring / support | — | — | permissions absentes |

## 4. ADMIN_SCHOOL — Administrateur d'établissement

75 permissions — périmètre complet de l'école (sauf `results.publish`… si, inclus ; seules absences notables : `finance.manage` hérite, `assessments.manage` inclus). Toutes les actions école listées ci-dessous sont **également soumises à la couverture abonnement** (voir matrice abonnements).

| Module | Action précise | C | Cr | M | S | I | E | V | Permission | Conditions |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| Élèves | Consulter liste/fiche | ✓ | | | | | | | `student.read` | |
| Élèves | Créer, modifier, désactiver | | ✓ | ✓ | ✓ | | | | `student.manage` | Suppression = action confirmée |
| Élèves | Importer (assistant CSV/XLSX) | | | | | ✓ | | | `student.manage` | Aperçu + confirmation |
| Élèves | Exporter (CSV/XLSX, fiche complète) | | | | | | ✓ | | `student.read` | Fiche complète réservée `student.manage` |
| Parents | Consulter / gérer responsables | ✓ | ✓ | ✓ | | | | | `guardian.read/manage` | |
| Inscriptions | Consulter, inscrire, transférer, annuler | ✓ | ✓ | ✓ | ✓ | | ✓ | | `enrollment.read/manage` | Quota `maxStudents` contrôlé |
| Portails | Inviter compte parent/élève | | ✓ | | | | | | `portal.manage` | Token d'invitation, compte DISABLED |
| Classes | Consulter, créer, modifier, archiver | ✓ | ✓ | ✓ | ✓ | | ✓ | | `classroom.read/manage` | |
| Niveaux | Gérer | ✓ | ✓ | ✓ | | | | | `classroom.read/manage` | Même permission que classes |
| Matières | Gérer + coefficients par niveau | ✓ | ✓ | ✓ | | | | | `subject.read/manage` | |
| Salles | Gérer | ✓ | ✓ | ✓ | | | | | `rooms.read/manage` | |
| Enseignants | Consulter, créer, affecter | ✓ | ✓ | ✓ | | | ✓ | | `teacher.read/manage` | |
| Utilisateurs | Consulter, créer, modifier, réinit. MDP, désactiver, supprimer | ✓ | ✓ | ✓ | ✓ | | ✓ | | `user.read/manage` | Quota `maxUsers` ; auto-ciblage interdit |
| Années scolaires | Consulter, créer, définir courante, verrouiller périodes | ✓ | ✓ | ✓ | | | | ✓ | `academic.read/manage` | Clôture = action confirmée |
| EDT | Consulter, créer cours/sessions, exporter PDF | ✓ | ✓ | ✓ | | | ✓ | | `schedules.read/manage/print`, `sessions.manage` | |
| Présences | Consulter, appel journalier, saisir absence/retard, justifier | ✓ | ✓ | ✓ | | | | | `attendance.read/manage/justify` | |
| Évaluations | Consulter, créer, saisir/modifier notes, importer notes, soumettre, valider, annuler | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | `assessments.read/create/manage`, `grades.read/enter/update/validate` | Import via wizard |
| Moyennes | Consulter, recalculer, valider, publier résultats | ✓ | | | | | ✓ | ✓ | `results.read/validate/publish`, `grades.calculate` | |
| Bulletins | Consulter, générer classe, valider, publier, PDF | ✓ | ✓ | | | | ✓ | ✓ | `reportcards.read/generate/validate/publish/print` | Versions conservées |
| Règles de notation | Configurer barème/arrondis | | ✓ | ✓ | | | | | `gradingpolicy.manage` | |
| Finances | Tableau de bord, comptes élèves | ✓ | | | | | | | `finance.read` | |
| Finances | Configurer catégories/tarifs | | ✓ | ✓ | | | | | `finance.configure`, `finance.fees.manage` | |
| Finances | Remises | | ✓ | ✓ | | | | | `finance.discounts.manage` | |
| Finances | Encaisser, valider, annuler paiement | | ✓ | | ✓* | | | ✓ | `finance.payments.create/validate/cancel` | *annulation confirmée, historique conservé |
| Finances | Reçus PDF | | | | | | ✓ | | `finance.receipts.read/print` | |
| Finances | Rapports, impayés, exports CSV/XLSX | ✓ | | | | | ✓ | | `finance.reports.read` | |
| Finances | Clôturer la caisse | | | | | | | ✓ | `finance.cash.close` | |
| Annonces | Consulter, créer, programmer, publier, supprimer | ✓ | ✓ | ✓ | ✓ | | | ✓ | `announcements.read/manage` | Brouillon/programmation/publication |
| Messagerie | Composer, envoyer (canales), historique | ✓ | ✓ | | | | | | `messages.manage` | Envoi externe via adaptateurs |
| Notifications | Consulter ses notifications | ✓ | | | | | | | — | Aucune permission requise (centre personnel) |
| Préférences | Consulter canaux/consentements | ✓ | | | | | | | `preferences.read` | |
| Abonnement | Consulter statut/quota/factures | ✓ | | | | | | | `school.read` | |
| Abonnement | Demander un changement d'offre | | | | | | | | `school.manage` | Validation plateforme |
| Paramètres | Modifier infos établissement | | | ✓ | | | | | `school.manage` | |

## 5. FINANCE_MANAGER — Responsable financier

Permissions (11) : `finance.cash.close`, `finance.configure`, `finance.discounts.manage`, `finance.fees.manage`, `finance.payments.cancel/create/validate`, `finance.read`, `finance.receipts.print/read`, `finance.reports.read`.

| Action | Autorisé | Restriction |
|---|---|---|
| Consulter finances, comptes, impayés | ✓ | — |
| Configurer catégories/tarifs, remises | ✓ | — |
| Encaisser / valider / annuler paiement | ✓ | annulation confirmée |
| Reçus PDF, exports, clôture caisse | ✓ | — |
| Tout le reste (pédagogie, élèves, utilisateurs…) | ✗ | menus et pages masqués — `redirect /app/forbidden` |

## 6. CASHIER — Caissier

Permissions (4) : `finance.payments.create`, `finance.read`, `finance.receipts.print/read`.

| Action | Autorisé | Restriction |
|---|---|---|
| Consulter journal des paiements / tableau finance | ✓ | `finance.read` |
| Enregistrer un encaissement | ✓ | `finance.payments.create` |
| Imprimer reçu | ✓ | `finance.receipts.print` |
| Valider / annuler paiement, remises, config, clôture | ✗ | — |

## 7. TEACHER — Enseignant

Permissions (21) : `academic.read`, `announcements.read`, `assessments.create/read`, `attendance.manage/read`, `classroom.read`, `coursecontent.manage`, `grades.enter/read`, `reportcards.print/read`, `results.read`, `rooms.read`, `schedules.print/read`, `school.read`, `sessions.read`, `student.read`, `subject.read`.

| Action | Autorisé | Restriction |
|---|---|---|
| Dashboard `/teacher` (cours du jour/semaine, appels à faire) | ✓ | `requireSchoolContext` seul — aucune permission exigée |
| Consulter EDT, salles, classes, matières, élèves | ✓ | lectures uniquement |
| Ouvrir la fiche de session | ✓ | ses propres sessions (`isOwnSession`) ou `sessions.manage`/`attendance.manage` |
| Faire l'appel (marquer présences) | ✓ | `attendance.manage` **ou session à soi** |
| Compléter le contenu pédagogique d'une session | ✓ | `coursecontent.manage` **ou session à soi** |
| Créer une évaluation | ✓ | `assessments.create` |
| Saisir / modifier des notes | ✓ | `grades.enter` (modification via `grades.enter` sur grille ouverte) |
| Importer des notes | ✓ | `grades.enter` (wizard) |
| Imprimer/export EDT | ✓ | `schedules.print` |
| Consulter bulletins/résultats | ✓ | `reportcards.read`, `results.read` |
| Valider notes/moyennes/bulletins, publier | ✗ | pas de `grades.validate`, `results.validate/publish`, `reportcards.*` gestion |
| Créer sessions/cours, gérer élèves/classes/finance/users | ✗ | — |

## 8. PARENT — Parent d'élève

Permissions (2) : `announcements.read`, `portal.parent`.

| Action | Autorisé | Restriction |
|---|---|---|
| Portail `/parent` (scolarité, notes, absences, finances de ses enfants, reçus/bulletins PDF) | ✓ | `portal.parent` + rattachement `StudentGuardian` — données limitées à ses enfants |
| Consulter annonces publiées | ✓ | `announcements.read` |
| Toute action d'écriture | ✗ | aucun droit de modification |

## 9. STUDENT — Élève

Permissions (2) : `announcements.read`, `portal.student`.

| Action | Autorisé | Restriction |
|---|---|---|
| Portail `/student` (notes, bulletins PDF, emploi du temps, absences) | ✓ | `portal.student` + `Student.userId` — ses données uniquement |
| Consulter annonces | ✓ | `announcements.read` |
| Toute action d'écriture | ✗ | — |

## Rappel transversal

Chaque droit « école » ci-dessus est **un prérequis RBAC** ; la disponibilité effective dépend en plus de l'abonnement de l'établissement (module commercial + statut) — voir `matrice-profils-abonnements.md`. Une permission non mappée dans `PERMISSION_MODULE` n'est **jamais** restreinte par l'abonnement (cf. `ecarts-permissions-abonnements.md`).
