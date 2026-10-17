# Écarts permissions ↔ abonnements — diagnostic et recommandations

> Diagnostic en lecture seule, commit `352ad56`. Aucune correction appliquée.
> Échelle : **P0** = sécurité/commercial majeur · **P1** = incohérence fonctionnelle · **P2** = nettoyage.

## P0 — Critique

### 1. Le mapping `PERMISSION_MODULE` utilise des clés inexistantes → 3 modules commerciaux sans effet réel
`src/lib/services/platform/modules.ts:9-87` mappe `students.*`, `guardians.*`, `enrollments.*`, `teachers.*`, `classes.*`, `levels.*`, `subjects.*`, `courses.*`, `teacher.dashboard` — **aucune de ces clés n'existe en base ni n'est vérifiée dans le code** (clés réelles : `student.*`, `guardian.*`, `enrollment.*`, `teacher.*`, `classroom.*`, `subject.*`).

Conséquence : les permissions effectives des modules `STUDENTS`, `TEACHERS`, `CLASSES_SUBJECTS` (sauf `rooms.*`) ne sont **jamais** évaluées par `permissionCoveredByEntitlements` → « permission non mappée → autorisée ».
- Désactiver le module `STUDENTS` via `SchoolModuleOverride` ne retire **rien** à l'école.
- Le menu est cohérent avec le garde (même mapping), donc l'incohérence est invisible en surface — mais la promesse commerciale « modules désactivables » est inopérante sur ces trois modules.

**Recommandation** : corriger les clés du mapping (`student.*`, `guardian.*`, `enrollment.*`, `teacher.*`, `classroom.*`, `subject.*`) et ajouter `academic.read`, `grade.*`… ou documenter que ces blocs sont des modules « noyau » non désactivables.

### 2. Quota utilisateurs contournable par les invitations portail
`src/lib/services/portal/accounts.ts` (`inviteStudentAccount`, `inviteGuardianAccount`) crée `User` + `SchoolMembership(ACTIVE)` **sans `checkLimit("users")`**, contrairement à `users.ts:164`. `usageSnapshot` compte pourtant ces memberships → l'établissement peut dépasser `maxUsers` par les portails.

**Recommandation** : appliquer `checkLimit` aux invitations (ou exclure les rôles PARENT/STUDENT du compteur — choix commercial à trancher).

### 3. Permissions définies en base jamais vérifiées → faux sentiment de contrôle
En base mais **jamais évaluées** dans le code : `grade.read`, `grade.manage`, `reports.attendance`, `finance.manage`, `notifications.read`, `messages.read`, `preferences.read`. Elles sont attribuées aux rôles (ex. `notifications.read` à ADMIN_SCHOOL) sans aucun effet.

**Recommandation** : soit vérifier ces clés aux routes concernées (`/app/notifications` n'exige actuellement aucune permission), soit les retirer du catalogue.

## P1 — Incohérences fonctionnelles

### 4. Module `REPORTS` vendu mais sans contrôle
`REPORTS` est inclus dans PREMIUM et affiché « Rapports et statistiques » sur `/tarifs`, mais aucune permission ne lui est mappée. Les rapports réels dépendent de `finance.reports.read` → module `FINANCE`. Conséquence : une école Premium sans FINANCE… n'existe pas, mais un override désactivant `REPORTS` ne changerait rien ; et un plan futur « REPORTS sans FINANCE » ne fonctionnerait pas.

### 5. `schedules.print` non mappée → export PDF accessible hors module SCHEDULES
Sous Essentiel (sans `SCHEDULES`), `schedules.print` reste autorisée : `/app/schedules/pdf` et l'export CSV (`req:schedules.read`… celui-ci est mappé) — le PDF passe, la page est bloquée. Même problème pour `coursecontent.manage` et `attendance.justify` (écriture d'une justification possible hors module ATTENDANCE — action serveur `req:attendance.justify` non mappée → autorisée).

### 6. Pages sans garde de permission
- `/app` (dashboard) et `/app/notifications` : `requireSchoolContext` seul — toute membership (y compris PARENT/STUDENT en tant que membres école) peut charger la page ; les données sont filtrées par permissions `has:` côté rendu, mais le rôle PARENT voit les cartes autorisées par ses clés seulement. Acceptable mais à noter.
- `/teacher` : idem — un membre non-enseignant obtient la vue vide ; la fiche session exige `isOwnSession` ou permission, correct.

### 7. `userHasSchoolPermission` (RBAC seul) en marge des contrôles d'abonnement
Les `has:` servent à l'affichage — normal — mais certains chemins de visualisation ouvrent malgré un plan restrictif : `isOwnSession` permet au prof de consulter sa session (élèves + présences) sous Essentiel sans `SCHEDULES` ; les actions restent bloquées, l'information reste lisible. Décision produit à documenter.

### 8. Invite portail possible sous plan sans portail
`portal.manage` → module `ADMINISTRATION` (dans tous les plans) : un admin Essentiel peut créer des comptes parent/élève… qui ne pourront jamais se connecter (`portal.*` → `PARENT_PORTAL`/`STUDENT_PORTAL`, Premium). UX trompeuse : masquer l'action quand le module portail est inactif.

## P2 — Nettoyage

### 9. Données de test en catalogue
10 modules `P8CORE-*`/`P8EXTRA-*` (`commercial: true`) et 14 plans `P8-*`/`P9-*` (`commercial: false`) en base — visibles dans `/platform/modules` et l'admin des offres. Non exposés publiquement (filtre `commercial`) mais source de confusion.

### 10. Fail-open sans abonnement
`!ent.subscription → tout autorisé` : préserve les écoles historiques mais permet à toute école créée hors flux d'échapper à toute limite commerciale. À documenter ou à inverser (fail-closed) avec migration des écoles legacy.

### 11. SALES possède `platform.modules.manage`
Un profil commercial peut activer/désactiver des modules par école — droit sensible plutôt réservé à OWNER.

### 12. Suspension : portails ouverts en lecture
`ALWAYS_ALLOWED_IN_SUSPENSION` (portal.parent/student) : les familles gardent l'accès — choix UX cohérent, à confirmer commercialement.

## Synthèse des priorités

| # | Écart | Impact | Effort |
|---|---|---|---|
| 1 | Clés plurielles mortes dans `PERMISSION_MODULE` | Modules STUDENTS/TEACHERS/CLASSES_SUBJECTS indésactivables | Faible (renommage + tests) |
| 2 | `checkLimit` absent des invitations portail | Quota `maxUsers` contournable | Faible |
| 3 | 7 permissions jamais vérifiées | RBAC incomplet en surface | Faible |
| 4 | `REPORTS` module mort | Offre commerciale trompeuse | Moyen |
| 5 | `schedules.print`/`coursecontent`/`attendance.justify` non mappées | Fuites d'écriture/export hors module | Faible |
| 8 | Invitations portail sans module portail | UX incohérente | Faible |
