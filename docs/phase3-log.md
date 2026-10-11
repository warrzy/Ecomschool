# Phase 3 log

## 2026-10-11 — Étape 0 : sécurisation complémentaire

- Inventaire `User.schoolId` : `docs/user-schoolid-migration.md` (champ conservé, bascule planifiée Phase 4)
- Modèle `AuditLog` + service `src/lib/services/audit.ts` (`logAudit`, `listAuditLogs`) — l'audit ne bloque jamais une opération métier
- `School` : champs `type`, `schoolSystem`, `logoUrl`, `settings` ajoutés
- `requireSchoolContext` : exige `School.status = ACTIVE` (établissement suspendu → `/app/onboarding?reason=suspended`)
- `updateSchoolUser` : interdit de changer son propre rôle (`CANNOT_TARGET_SELF`) et de se désactiver
- Protection dernier admin actif : `LAST_ACTIVE_ADMIN` sur update (désactivation/rétrogradation) et remove si le compte est le seul membre actif détenant `user.manage`
- Audit émis sur `user.create` / `user.update` / `user.remove`
- Migration `20261010235244_phase3_audit_school_fields` : backup préalable `backups/`, `migrate dev --create-only`, revue SQL (aucun DROP INDEX sur les index partiels Role), `migrate deploy`, `generate`
- Vérifié : migrations `2026*phase2*` intactes, sauvegardes présentes dans `backups/`
- Les changements de rôle prennent effet immédiatement : permissions résolues en base à chaque requête via `userHasSchoolPermission` (aucune permission n'est figée dans le JWT)

## 2026-10-11 — Étape 1 : gestion des établissements (8160211)

- `src/lib/services/schools.ts` + `src/lib/validations/schools.ts` : fiche école, édition infos/type/système/logo/coordonnées/settings, statut, admin école
- `/platform/schools` liste enrichie + `/platform/schools/[id]` fiche détaillée (effectifs, modules)
- `/platform/audit` et `/platform/administrators` alimentés par des données réelles
- `/app/settings` : paramètres établissement éditables par l'admin école

## 2026-10-11 — Étape 2 : années scolaires et périodes (c15ef95)

- `src/lib/services/academic.ts` : createYear (génère périodes trimestre/semestre), setCurrentYear (unicité de la courante), closeYear, updatePeriod (verrouillage)
- Permissions `academic.read`/`academic.manage` ; bootstrap phase3 (24 clés, rôle système TEACHER)
- `/app/academic-years` (CRUD + bascule courante + clôture), `/app/academic-years/[id]/periods` (édition + verrouillage)
- Périodes vérifiées via `academicYear.schoolId` ; année clôturée non modifiable

## 2026-10-11 — Étape 3 : niveaux et classes (80aab5d)

- Modèles `Level` (par école, ordonné, archivable), `Teacher` (socle), `Classroom` (année+niveau+PP, capacité, salle, section)
- `src/lib/services/classes.ts` : CRUD scopé école, refus année CLOSED, cohérence relations
- `/app/levels`, `/app/classrooms` (recherche/filtres/pagination), `/app/classrooms/[id]` fiche à onglets (non développés explicitement marqués)
- Migration `20261011000049_phase3_levels_classrooms_teachers`

## 2026-10-11 — Étape 4 : enseignants (e0c8337)

- `Teacher` complet + `Subject` (socle) + `TeachingAssignment` (enseignant/classe/matière/année)
- Index unique partiel manuel `TeachingAssignment_noSubject_key` (affectations sans matière)
- `src/lib/services/teachers.ts` : CRUD, affectations, activation facultative du compte utilisateur (rôle TEACHER via createSchoolUser)
- `/app/teachers` + fiche : identité, coordonnées, affectations, classes PP, emploi du temps futur marqué
- Migration `20261011000331_phase3_teachers_subjects_assignments`

## 2026-10-11 — Étape 5 : élèves (6f3d358)

- `Student` : matricule unique par école, identité complète, statut
- `src/lib/services/students.ts` : CRUD, import CSV (upsert par matricule, rapport par ligne), export CSV (`/app/students/export`)
- `/app/students` + fiche avec sections futures explicitement marquées
- Migration `20261011000601_phase3_students`

## 2026-10-11 — Étape 6 : parents et tuteurs (02a709a)

- `Guardian` + `StudentGuardian` (N-N, relation : FATHER/MOTHER/GUARDIAN/FINANCIAL/EMERGENCY)
- `src/lib/services/guardians.ts` : CRUD + link/unlink avec contrôles tenant
- `/app/guardians` + fiche ; fiche élève : section Parents réelle (lier existant, créer+lier, détacher)
- Migration `20261011000900_phase3_guardians`

## 2026-10-11 — Étape 7 : inscriptions (5bccb16)

- `Enrollment` (école/élève/classe/année, statut, enrolledAt/leftAt)
- Index unique partiel manuel `Enrollment_active_per_year_key` : un seul ENROLLED par élève/année
- `src/lib/services/enrollments.ts` : enroll (année courante par défaut, classe de la bonne année, règle multi-inscriptions via `School.settings.allowMultipleEnrollments`), transfer (atomique, historise TRANSFERRED), withdraw/complete
- `/app/enrollments` ; parcours réel sur fiche élève ; onglet Élèves réel sur fiche classe
- Migration `20261011001153_phase3_enrollments`

## 2026-10-11 — Étape 8 : matières et coefficients (88d018e)

- `LevelSubject` (coefficient par défaut par niveau) + `ClassroomSubject` (coefficient + enseignant par classe)
- `src/lib/services/subjects.ts` : CRUD matière + upsert coefficients niveau/classe
- `/app/subjects` + fiche ; onglets Matières et Enseignants réels sur fiche classe
- Migration `20261011001445_phase3_subject_coefficients`

## 2026-10-11 — Étape 9 : dashboard école (aff4d6e)

- `src/lib/services/dashboard.ts` : année courante, inscrits/élèves actifs, enseignants, classes, filles/garçons, effectifs par niveau, dernières inscriptions — données réelles
- Emplacements marqués pour présences/notes/bulletins/paiements

## 2026-10-11 — Étape 10 : tests métier

- `scripts/phase3/business-test.ts` : 39 checks — écoles A/B, années, périodes, niveaux, classes, enseignants, affectations, coefficients, élèves, parents, inscriptions, transferts, archivage, isolation cross-tenant (NOT_FOUND systématique), protection dernier admin
- Résultat : 39/39 OK ; typecheck/lint OK ; build OK
