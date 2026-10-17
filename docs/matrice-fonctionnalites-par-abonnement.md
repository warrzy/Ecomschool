# Matrice des fonctionnalités par abonnement — ECOM-SCHOOL

> Sources : `SubscriptionPlan`/`PlanModule`/`PlatformModule` (base, lecture seule),
> `src/lib/services/platform/modules.ts` (`PERMISSION_MODULE`, `getEntitlements`, `checkLimit`),
> `src/lib/permissions/guard.ts`, page publique `/tarifs`.

## 1. Offres commerciales réelles (`commercial: true`)

| Code | Nom | Mensuel | Annuel | maxStudents | maxUsers | Essai | Grâce |
|---|---|---|---|---|---|---|---|
| `ESSENTIEL` | Essentiel | 15 000 FCFA | 150 000 FCFA | 300 | 15 | 30 j | 7 j |
| `PROFESSIONNEL` | Professionnel | 30 000 FCFA | 300 000 FCFA | 1 000 | 50 | 30 j | 7 j |
| `PREMIUM` | Premium | 50 000 FCFA | 500 000 FCFA | illimité | illimité | 30 j | 7 j |

14 autres plans existent en base (`P8-SMALL-*`, `P8-BIG-*`, `P9-PLAN-*`) : plans techniques de test, `commercial: false`, jamais affichés publiquement.

## 2. Catalogue de modules

Modules commerciaux réels (13) : `ADMINISTRATION`, `ATTENDANCE`, `CLASSES_SUBJECTS`, `COMMUNICATION`, `FINANCE`, `GRADES`, `PARENT_PORTAL`, `REPORTS`, `REPORT_CARDS`, `SCHEDULES`, `STUDENT_PORTAL`, `STUDENTS`, `TEACHERS`.

10 modules de test (`P8CORE-*`, `P8EXTRA-*` ×5) : `commercial: true` en base mais uniquement liés aux plans de test — à nettoyer (voir écarts).

## 3. Matrice modules × formules (données réelles `PlanModule`)

| Module | Libellé public | Essentiel | Professionnel | Premium |
|---|----|:-:|:-:|:-:|
| ADMINISTRATION | Administration scolaire | ✓ | ✓ | ✓ |
| STUDENTS | Gestion des élèves | ✓ | ✓ | ✓ |
| TEACHERS | Gestion des enseignants | ✓ | ✓ | ✓ |
| CLASSES_SUBJECTS | Classes et matières | ✓ | ✓ | ✓ |
| SCHEDULES | Emplois du temps | ✗ | ✓ | ✓ |
| ATTENDANCE | Présences et absences | ✗ | ✓ | ✓ |
| GRADES | Évaluations et notes | ✗ | ✓ | ✓ |
| REPORT_CARDS | Bulletins | ✗ | ✓ | ✓ |
| PARENT_PORTAL | Portail parents | ✗ | ✗ | ✓ |
| STUDENT_PORTAL | Portail élèves | ✗ | ✗ | ✓ |
| FINANCE | Finances scolaires | ✗ | ✗ | ✓ |
| COMMUNICATION | Communication | ✗ | ✗ | ✓ |
| REPORTS | Rapports et statistiques | ✗ | ✗ | ✓ |

## 4. Application effective du mapping permission → module

Le contrôle `PERMISSION_MODULE` (`modules.ts:9-87`) ne couvre **qu'une partie** des permissions réelles. Statut vérifié dans le code :

| Module | Permissions réellement contrôlées | Efficace ? |
|---|---|---|
| ADMINISTRATION | `school.manage`, `user.read`, `user.manage`, `academic.manage`, `portal.manage` | Partielle — `academic.read`, `school.read` non mappées (lecture toujours libre) |
| ATTENDANCE | `attendance.read`, `attendance.manage` | Oui — mais `attendance.justify` non mappée |
| CLASSES_SUBJECTS | `rooms.read`, `rooms.manage` | **Ineffective** — `classroom.*`, `subject.*`, `levels.*` (mappe des clés inexistantes) |
| COMMUNICATION | `announcements.read/manage`, `notifications.read`, `messages.read/manage`, `preferences.read` | Oui pour `announcements.*`, `messages.*` ; `notifications.read`/`preferences.read` jamais vérifiées |
| FINANCE | `finance.read`, `finance.configure`, `finance.fees.manage`, `finance.discounts.manage`, `finance.payments.*`, `finance.receipts.*`, `finance.reports.read`, `finance.cash.close` | Oui — `finance.manage` non mappée (jamais utilisée) |
| GRADES | `assessments.read/create/manage`, `grades.read/enter/update/validate/calculate` | Oui — `grade.read/manage` (DB) non mappées et inutilisées |
| PARENT_PORTAL | `portal.parent` | Oui |
| REPORTS | *(aucune permission mappée)* | **Module mort — ne contrôle rien** |
| REPORT_CARDS | `results.*`, `reportcards.*`, `gradingpolicy.manage` | Oui — `reports.attendance` non mappée |
| SCHEDULES | `schedules.read/manage`, `sessions.read/manage` (+ `courses.*`, `teacher.dashboard` : clés inexistantes en base) | Partielle — `schedules.print`, `coursecontent.manage` non mappées |
| STUDENT_PORTAL | `portal.student` | Oui |
| STUDENTS | `students.read/manage`, `guardians.*`, `enrollments.*` | **Ineffective** — les clés réelles sont `student.*`, `guardian.*`, `enrollment.*` (singulier) |
| TEACHERS | `teachers.*` | **Ineffective** — clé réelle `teacher.*` |

## 5. Quotas (contrôlés côté serveur)

| Quota | Contrôle | Points d'application | Statut |
|---|---|---|---|
| `maxStudents` | `checkLimit(schoolId, "students")` compte `Enrollment(status=ENROLLED)` | `enrollments.ts:163` (inscription), `import/students.ts:448` (import) | Appliqué |
| `maxUsers` | `checkLimit(schoolId, "users")` compte `SchoolMembership(status=ACTIVE)` | `users.ts:164` (création utilisateur) | Partiel — les invitations portail (`portal/accounts.ts`) créent des memberships sans `checkLimit` |

## 6. Règles de statut d'abonnement

`permissionCoveredByEntitlements` + `getEntitlements` :

| Statut | Effet |
|---|---|
| `TRIALING`, `ACTIVE`, `PAST_DUE`, `GRACE` | Modules du plan actifs (`+ dependsOn`, `± overrides`) |
| `SUSPENDED`, `CANCELLED`, `EXPIRED` | Lecture seule : seules les permissions `*.read`, `*.print`, `portal.parent`, `portal.student` passent |
| Aucun abonnement | **Tout autorisé** (écoles historiques — fail-open) |
| `SchoolModuleOverride` | force `enabled` par école ; un override désactivé reste inactif hors statut actif |

## 7. Ce que l'abonnement NE contrôle PAS (techniquement)

- Gestion élèves/parents/inscriptions (`student.*`, `guardian.*`, `enrollment.*`) : clés non mappées → disponibles **quel que soit le plan**.
- Gestion enseignants (`teacher.*`), classes (`classroom.*`), matières (`subject.*`), années (`academic.read`) : idem.
- Export PDF des emplois du temps (`schedules.print`), contenu pédagogique (`coursecontent.manage`), justification d'absences (`attendance.justify`) : non mappés.
- Page `/app/subscription` : `school.read` — lisible même en suspension.
- Tableaux de bord `/app` et `/teacher` : `requireSchoolContext` seul, aucune permission ni contrôle d'abonnement.

## 8. Concordance page Tarifs ↔ application

La copie publique (`/tarifs`) reflète fidèlement les `PlanModule` : les intitulés et prix correspondent exactement aux données. En revanche, la promesse « Gestion des élèves/enseignants/classes » est **sans effet de restriction réel** (mapping mort, cf. §4) : ces fonctionnalités ne peuvent pas être retirées par l'abonnement. « Rapports et statistiques » (module `REPORTS`) ne contrôle aucune permission — les rapports financiers sont en réalité couverts par `finance.reports.read` → module `FINANCE`.
