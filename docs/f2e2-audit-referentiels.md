# F2-E2 — Audit de sécurisation des référentiels scolaires

Audit lecture seule. Aucune modification, aucune migration. Date : 2026-10-18.
Périmètre : classes, niveaux, matières, années scolaires, périodes de notation,
inscriptions et transferts.

## 1. Matrice des opérations et contrôles existants

| Objet | Créer | Modifier | Archiver / clôturer | Supprimer | Permission serveur |
|---|---|---|---|---|---|
| `Level` (niveau) | `createLevel` | `updateLevel` (nom, ordre) | `updateLevel(status=ARCHIVED)` | Non (Restrict) | `classroom.manage` |
| `Classroom` (classe) | `createClassroom` | `updateClassroom` (nom, niveau, section, capacité, salle, PP) | `updateClassroom(status=ARCHIVED)` | Non (Restrict) | `classroom.manage` |
| `Subject` (matière) | `createSubject` | `updateSubject` (nom, code) | `updateSubject(status=ARCHIVED)` | Non | `subject.manage` |
| `LevelSubject` (coefficient niveau) | `setLevelCoefficient` | idem (upsert) | — | `removeLevelCoefficient` (delete physique du lien) | `subject.manage` |
| `ClassroomSubject` (matière/classe) | `setClassroomSubject` | idem (upsert) | — | `removeClassroomSubject` (delete physique du lien) | `subject.manage` |
| `AcademicYear` | `createYear` (+ périodes auto) | — | `closeYear(status=CLOSED)`, `setCurrentYear` | Non | `academic.manage` |
| `AcademicPeriod` | auto à la création d'année | `updatePeriod` (nom, dates, `isLocked`) | verrou via `isLocked` | Non | `academic.manage` |
| `Enrollment` | `enrollStudent`, `transferStudent` | `closeEnrollment` (WITHDRAWN/COMPLETED) | — | Non | `enrollment.manage` |
| `Assessment` | `createAssessment` | `setAssessmentStatus` (DRAFT→OPEN→SUBMITTED→VALIDATED→PUBLISHED / CANCELLED) | — | Non | `assessments.create` |
| `Student` | `createStudent` | `updateStudent` | `updateStudent(status=ARCHIVED)` | Non | `student.manage` |

Contrôles serveur déjà en place :
- Isolation `schoolId` systématique sur toutes les lectures/écritures.
- `createClassroom` / `updateClassroom` : refus si `academicYear.status = CLOSED` (`YEAR_CLOSED`).
- `enrollStudent` : `STUDENT_INACTIVE`, `YEAR_CLOSED`, `CROSS_YEAR`, `ALREADY_ENROLLED`, quota `checkLimit`.
- `updatePeriod` : refus si l'année est `CLOSED`.
- `closeYear` : refus si l'année est `isCurrent` (`IS_CURRENT`).
- `setCurrentYear` : refus si `CLOSED`.
- `saveGrades` : refus si `academicPeriod.isLocked` ou évaluation VALIDATED/PUBLISHED/CANCELLED.
- `createAssessment` : `teacherAllowed` pour les comptes enseignants.
- Schéma : `onDelete: Restrict` généralisé ; aucun historique supprimable.
- Index unique partiel `Enrollment_active_per_year_key` : un seul `ENROLLED` par (élève, année) — filet de sécurité PostgreSQL réel.

## 2. Écarts classés

### P0 — Incohérences fonctionnelles directes

**P0-1. Inscription et transfert vers une classe archivée.**
`enrollStudent` et `transferStudent` sélectionnent `classroom.status` mais ne le
testent jamais (`src/lib/services/enrollments.ts:133-150, 220-227`). Un élève
peut être inscrit ou transféré dans une classe `ARCHIVED` — depuis l'UI, le
guichet F2-D **et l'import** (la résolution par nom dans
`src/lib/import/students.ts:396-403` ne filtre pas `status`).
Correctif minimal : `if (classroom.status === "ARCHIVED") return CLASSROOM_ARCHIVED` dans les deux services + filtrage `status:"ACTIVE"` dans la résolution d'import.

**P0-2. `allowMultipleEnrollments` est un paramètre inopérant.**
Réglé à `true`, `enrollStudent` saute le contrôle `ALREADY_ENROLLED`
(`enrollments.ts:152-164`) mais l'index unique partiel
`Enrollment_active_per_year_key` provoque un P2002 → `CREATE_FAILED`
générique. Le réglage promet une fonctionnalité que PostgreSQL interdit —
erreur silencieuse pour l'utilisateur.
Options : (a) retirer/masquer le réglage tant que l'index existe ;
(b) documenter que l'index prime et renvoyer `ALREADY_ENROLLED` explicite.
Ne pas lever l'index sans décision métier (il protège l'unicité réelle).

**P0-3. `createAssessment` ignore l'année fermée et la période verrouillée.**
`checkRefs` charge `period.isLocked` sans le tester et ne lit pas
`year.status` (`assessments.ts:111-133`). On peut créer une évaluation sur une
année `CLOSED` ou une période verrouillée — mais impossible d'y saisir des
notes (`saveGrades` refuse). Objet mort créé dans le système.
Correctif minimal : `YEAR_CLOSED` + `PERIOD_LOCKED` dans `checkRefs` ;
vérifier aussi `classroom.academicYearId === input.academicYearId`
(actuellement non contrôlé → évaluation datée d'une année sur une classe
d'une autre année).

### P1 — Archivages sans garde de dépendances

**P1-1. Archiver une classe contenant des élèves ENROLLED.**
`updateClassroom(status=ARCHIVED)` sans aucun contrôle : les élèves restent
`ENROLLED` dans une classe archivée, leurs créances et notes sont orphelines
fonctionnellement. Avertissement ou blocage minimal : compter les `ENROLLED`
et exiger une confirmation explicite (ou refuser avec `HAS_ENROLLED`).

**P1-2. Archiver un niveau ou une matière encore utilisés.**
`updateLevel` et `updateSubject` archivent sans vérifier : classes actives
rattachées, `ClassroomSubject`, `LevelSubject`, `TeachingAssignment`,
évaluations ouvertes. L'historique n'est pas perdu (Restrict) mais les listes
déroulantes et l'affectation deviennent incohérentes.
Correctif minimal : compter les dépendances actives et afficher un avertissement
bloquant (`HAS_DEPENDENCIES`) ou une confirmation forcée.

**P1-3. Archiver un élève encore ENROLLED.**
`updateStudent(status=ARCHIVED)` sans vérifier les inscriptions actives
(`students.ts:210+`). Même pattern déjà corrigé côté `enrollStudent`
(`STUDENT_INACTIVE`) mais pas dans l'autre sens.
Correctif minimal : `HAS_ACTIVE_ENROLLMENT` ou fermeture d'abord requise.

**P1-4. `closeYear` sans garde sur le contenu.**
Ferme une année même s'il reste des inscriptions `ENROLLED`, des périodes non
verrouillées, des évaluations ouvertes ou des bulletins non générés.
Correctif minimal : rapport de clôture (compteurs) + confirmation, ou blocage
sur inscriptions actives. Périodes : verrouillage automatique à la clôture ?

### P2 — Cohérences d'interface et de cycle de vie

- **P2-1. `setAssessmentStatus` ignore le verrou de période** : une évaluation
  peut être rouverte (VALIDATED→OPEN) sur une période verrouillée ; seule la
  saisie de notes est bloquée.
- **P2-2. `setClassroomSubject` / `setLevelCoefficient`** ne vérifient ni le
  statut de la classe/matière/niveau ni l'année (lien possible sur une classe
  archivée ou une année close).
- **P2-3. UI** : les formulaires d'archivage (`classrooms/[id]` select status,
  niveaux, matières) n'affichent pas le nombre de dépendances — l'utilisateur
  archive sans visibilité. Le bouton/classement existe, l'avertissement non.
- **P2-4. Pas de cycle « réactivation »** : `CLOSED` est irréversible pour les
  années (cohérent), mais rien ne signale qu'une année `DRAFT` non courante
  peut recevoir des classes mais pas d'inscriptions lisibles par défaut —
  comportement acceptable, à documenter.
- **P2-5. Import : homonymie de classes.** La résolution par nom en minuscules
  (`classroomsByName`) prend le premier candidat si doublons de nom dans la
  même année — le `@@unique([schoolId, academicYearId, name])` empêche les
  doublons exacts mais pas les variantes de casse/accents.

## 3. Ce qui est déjà sain (à préserver)

- Aucune suppression définitive des historiques (`Restrict` partout) — conforme.
- Suppression des liaisons coefficient (`removeLevelCoefficient`,
  `removeClassroomSubject`) sans impact sur les notes : `Grade` référence
  `Assessment` qui porte `classroomId`/`subjectId` directement.
- Transferts transactionnels avec double écriture ENROLLED/TRANSFERRED + audit.
- Verrou `isLocked` effectif sur la saisie des notes ; `updatePeriod` refuse
  une année close.
- Index partiel `Enrollment_active_per_year_key` = garde-fou transactionnel
  même si `allowMultipleEnrollments` est mal réglé.

## 4. Plan de corrections minimales (lots — à implémenter après GO)

**Lot E2-A — Gardes d'aiguillage (P0)** : classe archivée dans `enrollStudent`,
`transferStudent` + résolution d'import ; cohérence année/classe et verrous
dans `createAssessment`/`checkRefs` ; explication `ALREADY_ENROLLED` si
`allowMultipleEnrollments` actif. ~3 fichiers, zéro migration.

**Lot E2-B — Gardes d'archivage (P1)** : compteurs de dépendances avant
archivage classe/niveau/matière/élève ; blocage ou confirmation explicite ;
bandeau d'information dans les pages détail (nombre d'inscrits, de liens).

**Lot E2-C — Clôture d'année (P1/P2)** : rapport de clôture (ENROLLED
résiduels, périodes non verrouillées, évaluations ouvertes) + confirmation ;
verrou `isLocked` sur `setAssessmentStatus` ; statuts dans
`setClassroomSubject`.

**Lot E2-D — Décision `allowMultipleEnrollments` (P0)** : trancher (a) ou (b)
avec le métier ; si (a), retirer le réglage de l'UI settings ; si (b), message
d'erreur dédié. Aucune migration sauf décision contraire documentée.

Chaque lot est indépendant, testable en recette locale isolée, sans migration
ni changement de permission.
