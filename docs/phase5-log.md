# Phase 5 — Moteur de notation, moyennes, classements et bulletins

Branche : `phase-5-evaluations-bulletins` (depuis `phase-4-pedagogie` validé).

## Modèles Prisma ajoutés

- `GradingPolicy` : règles par année (+ niveau optionnel) — barème, précision, arrondi, seuil de réussite, politiques notes manquantes/absences/dispenses, ex æquo, mentions (JSON), pondérations annuelles (JSON), `version` incrémentée à chaque modification.
- `AssessmentType` : types configurables par école (Interrogation, Devoir, Composition, Examen blanc + personnalisés).
- `Assessment` : évaluation (année, période, classe, matière, enseignant, type, date, barème, coefficient, statut).
- `Grade` : note par élève/évaluation (`@@unique(assessmentId, studentId)`), statuts `ENTERED|MISSING|ABSENT|EXEMPT|CANCELLED`.
- `GradeRevision` : historisation de chaque modification de note.
- `SubjectPeriodResult` : moyenne de matière par élève/période (+rang, points pondérés, complétude).
- `StudentPeriodResult` : moyenne générale, rang, mention, statut workflow.
- `StudentAnnualResult` : moyenne annuelle pondérée, rang, mention, décision.
- `ResultValidation` : workflow par classe/période (CALCULATED→VALIDATED→PUBLISHED→RECTIFIED).
- `ReportCard` : bulletin (`identifier` unique/école, `currentVersion`, statut).
- `ReportCardVersion` : snapshot JSON figé utilisé pour le PDF — un bulletin publié n'est jamais altéré rétroactivement.
- `ReportCardTemplate` : modèles (primary/college/lycee/custom), optionnellement par niveau.

## Migration

- `20261011005934_phase5_grades_reportcards` : 12 tables + index uniques. Index partiel manuel `GradingPolicy_default_per_year_key` (une politique par défaut par année). Backup pg_dump préalable. Aucun DROP sur les index manuels existants.

## Correctif connexe

`academic.ts` : `periodTemplates` assignait les dates de l'année entière à chaque période — corrigé en découpage en tranches égales (le calcul des résultats par période l'exige).

## Services (`src/lib/services/grading/`)

- `calculation.ts` — **GradeCalculationService** (pur, sans Prisma) :
  - `subjectAverage` = Σ(note normalisée × coef évaluation) / Σ(coefs applicables) ;
  - normalisation `note/maxScore → maxScore école` (ex. 30/40 → 15/20) ;
  - `generalAverage` = Σ(moyenne matière × coef matière) / Σ(coefs) — priorité coefficients : `ClassroomSubject` > `LevelSubject` > 1 ;
  - `computeRanks` : `SHARED_RANK` (1,1,3) ou `DENSE_RANK` (1,1,2) ;
  - `mentionFor`, `annualAverage` (pondération par période), `roundScore` (HALF_UP/FLOOR/CEIL).
  - Politiques notes manquantes/absentes/dispensées : `EXCLUDE` (note et coefficient ignorés — une absence n'est jamais un zéro automatique) ou `ZERO`.
- `policy.ts` : upsert versionné, résolution niveau → défaut année → défauts système.
- `assessments.ts` : CRUD + transitions DRAFT→OPEN→SUBMITTED→VALIDATED→PUBLISHED, périmètre enseignant via `TeachingAssignment`/`ClassroomSubject`.
- `grades.ts` : grille (inscrits à la date), enregistrement en masse avec `GradeRevision`, rejet hors barème, import CSV (`;` ou tab, décimales FR), refus si période verrouillée ou évaluation validée.
- `results.ts` : `calculateClassPeriod` (aperçu), `computeAndStore` (persistance + statut CALCULATED), `setValidationStatus` (transitions contrôlées), `computeAnnualResults`.
- `reportcards.ts` : payload bulletin (école, élève, matières, moyennes, rangs, absences/retards de la période), génération individuelle/collective, rectification en nouvelle version, modèles.

## Pages & routes

- `/app/grades` : liste + filtres + création + transitions de statut ; `/app/grades/[id]` : grille de saisie (note/statut/observation), import CSV, soumission.
- `/app/averages` : sélection année/classe/période, « Calculer les moyennes », stats (moyenne classe, meilleure/faible, réussite, ex æquo), validation/publication, résultats annuels.
- `/app/report-cards` : liste, génération collective, rectification, PDF ; `/app/report-cards/pdf` : A4 portrait (individuel `?id=` ou collectif `?classroom=&period=`) depuis le snapshot de version.
- `/app/grading-policy` : configuration complète des règles.
- Fiche élève : sections Notes, Résultats par période, Bulletins (PDF) réelles.
- Fiche classe : onglets Notes (évaluations), Résultats (classements), Bulletins.
- `/teacher` : évaluations du périmètre avec lien de saisie.
- Dashboard `/app` : évaluations à venir/ouvertes, notes manquantes, résultats en attente, bulletins publiés.

## Permissions (17)

`assessments.read/create/manage`, `grades.read/enter/update/validate/calculate`, `results.read/validate/publish`, `reportcards.read/generate/validate/publish/print`, `gradingpolicy.manage`. Enseignant : `assessments.read/create`, `grades.read/enter`, `results.read`, `reportcards.read/print` + périmètre d'affectation vérifié en service.

## Tests — 44/44

Création évaluations (admin + enseignant affecté, refus hors périmètre), saisie, rejet hors barème, révision historisée, absence≠zéro / politique ZERO, normalisation /40, moyennes de référence calculées indépendamment (Alice maths 15,40 ; générale 15,30 ; Bob 9,50), coefficients classe>niveau, ex æquo partagés, workflow (publication directe refusée → validé → publié), bulletins v1→v3 historisés avec rectification, PDF, résultats annuels pondérés (15,77 vérifié), grille, cross-tenant intégral, CSV.

Régressions : Phase 2 **31/31** · Phase 3 **40/40** · Phase 4 **47/47** · `typecheck` ✅ `lint` ✅ `build` ✅.

## Limites connues

- Bulletin : mise en page unique (modèles `primary/college/lycee` enregistrés mais rendu identique — personnalisation de layout à venir).
- Appreciations par matière et décision de direction : champs présents, saisie UI à compléter.
- Portail parent/élève : consultation des bulletins publiés prévue Phase 6+.
