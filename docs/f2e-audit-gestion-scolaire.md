# F2-E — Audit : gestion des élèves, imports/exports et référentiels

Audit réalisé en lecture seule (code + base locale). Aucune modification
de code, de données, de permissions ; aucun déploiement.

## 1. Export des élèves par classe — EXISTANT (quasi complet)

| Capacité demandée | État | Détail |
|---|---|---|
| Liste des élèves d'une classe | ✅ | `/app/students` (filtre statut) + export filtré classe |
| Filtre par année scolaire | ✅ | paramètre `year` sur l'export |
| Export Excel / CSV | ✅ | `GET /app/students/export?format=csv\|xlsx` |
| Seulement les inscrits de la classe | ✅ | filtre via `enrollments.some({academicYearId, classroomId})` — l'élève apparaît s'il a une inscription dans le couple année/classe |
| Choix des colonnes | ⚠️ partiel | 2 presets fixes : standard `student.read` (matricule, nom, prénom, sexe, classe, année, statut) et complet `student.manage` (+naissance, lieu, tél, email, adresse). Pas de sélection colonne par colonne |
| Permissions + isolation | ✅ | `student.read` / `student.manage` (fiche complète) ; `schoolId` imposé partout |

Routes et fichiers :
- `src/app/app/(tenant)/students/export/route.ts` — élèves (std/complet).
- `src/app/app/(tenant)/enrollments/export/route.ts` — inscriptions par année/classe (historique TRANSFERRED/WITHDRAWN/COMPLETED inclus).
- `src/app/app/(tenant)/classrooms/export/route.ts` — classes (effectifs) + synthèse par niveau, `classroom.read`.
- `src/lib/export/students.ts`, `src/lib/export/classes.ts`, `src/lib/export/respond.ts` (CSV/XLSX, plafond 50 000 lignes + indicateur de troncature).
- UI : formulaire d'export sur `/app/students` (année, classe, statut, format, « fiche complète » admin).

Test local (lecture seule) : `buildStudentsExport` filtré classe « 6e A (démo) » → 26 lignes cohérentes avec `buildEnrollmentsExport` (26 inscriptions).

## 2. Import des élèves — EXISTANT (pipeline complet)

`/app/students/import` : assistant 3 étapes + routes `template` (modèle
CSV/XLSX), `preview` (analyse sans écriture), `commit` (écriture).

| Capacité demandée | État | Détail |
|---|---|---|
| Excel / CSV | ✅ | `src/lib/import/{csv,xlsx}.ts`, formules refusées, ≤ 2 Mo / 2000 lignes |
| Choix année + classe | ✅ | année explicite dans l'UI ; classe par nom dans la colonne `classe` (insensible casse) |
| Création des fiches | ✅ | `createStudent` par ligne, transaction par ligne |
| Rattacher élèves existants | ✅ | upsert par matricule ; `enrollStudent` pour la colonne classe |
| Anti-doublons | ✅ | matricule unique (fichier + base), index partiel `Enrollment_active_per_year_key`, une ligne = une transaction |
| Détection déjà inscrits | ✅ | « existing » si même classe ; erreur si déjà ENROLLED ailleurs (sauf `allowMultipleEnrollments`) |
| Prévisualisation | ✅ | diff champ par champ, marqueur `__EFFACER__`, jeton signé + empreinte (STALE → 409), jeton consommé une fois |
| Lignes incorrectes | ✅ | erreurs par ligne/colonne avec motif ; lignes valides importées seules |
| Bilan d'import | ✅ | créés / modifiés / inchangés / inscriptions / erreurs + audit `student.import` |
| **Créances après import** | ❌ **absent** | `commitStudentsImport` appelle `enrollStudent` mais **jamais** `generateStudentCharges` — un élève importé+inscrit n'a aucune créance et ne peut rien payer (blocage OVERPAYMENT F2-C). Écart majeur vs guichet F2-D |

Permissions : `student.manage` pour l'import ; la colonne `classe` exige en
plus `enrollment.manage`. → **CASHIER et FINANCE_MANAGER ne peuvent pas
importer** (cohérent avec la matrice F2-D qui ne leur donne pas `.manage`,
mais à trancher si le guichet doit rester leur seule voie).

Écarts complémentaires :
- Pas d'alerte homonyme (nom+prénom+naissance) à l'import — le guichet
  l'a, l'import non ; risque de doublon fiche si le matricule diffère.
- Classe résolue par **nom** : deux classes homonymes dans l'année →
  ligne en erreur (sûr mais bloquant).
- Élève archivé dans le fichier : fiche mise à jour possible, mais
  l'inscription échoue (STUDENT_INACTIVE) — comportement correct.

## 3. Cycle de vie des référentiels — matrice

| Objet | Créer | Modifier | Supprimer | Archiver / désactiver | Permission | Objet utilisé → ? |
|---|---|---|---|---|---|---|
| Niveau | ✅ | ✅ nom/ordre | ❌ (impossible) | ✅ `ARCHIVED` | `classroom.manage` | Archivage libre même si des classes l'utilisent — **aucun contrôle** |
| Classe | ✅ | ✅ | ❌ | ✅ `ARCHIVED` | `classroom.manage` | Archivage libre **avec élèves inscrits** ; année CLOSED bloque la modif. `enrollStudent` et `transferStudent` **ne vérifient pas** `classroom.status` → inscription possible dans une classe archivée |
| Matière | ✅ | ✅ nom/code | ❌ | ✅ `ARCHIVED` | `subject.manage` | Archivage libre avec évaluations/notes existantes (historique préservé, juste masqué) |
| Année scolaire | ✅ (+ périodes auto) | périodes | ❌ | `CLOSED` via `closeYear` | `academic.manage` | Clôture libre **même avec inscriptions actives** ; **aucune réouverture** (irréversible via UI) ; année courante non clotûrable |
| LevelSubject (coef.) | ✅ upsert | ✅ | ✅ suppression dure | — | `subject.manage` | Config sans historique ; delete sûr |
| ClassroomSubject (coef.+prof) | ✅ upsert | ✅ | ✅ suppression dure | — | `subject.manage` | La suppression **révoque le périmètre enseignant** (`teacherAllowedPairs`) même si des notes existent — effet de bord non signalé |
| TeachingAssignment | ✅ | — | ✅ suppression dure | — | `teacher.manage` | Même effet de bord (scope enseignant) |
| Salle | ✅ | ✅ | ❌ | ✅ `ARCHIVED` | `rooms.manage` | Sessions/EDT : `roomId` SetNull-safe |
| Élève | ✅ | ✅ | ❌ | ✅ `ARCHIVED` (via update) | `student.manage` | **Archivage libre avec inscription ENROLLED active** → inscription orpheline |
| Inscription | via enroll | — | ❌ | TRANSFERRED / WITHDRAWN / COMPLETED | `enrollment.manage` | Confirmations UI (ConfirmPanel) ; transfert sans check statut classe cible ni année fermée |
| Catégorie de frais | ✅ | — | ❌ | ✅ ACTIVE/ARCHIVED | `finance.configure` | Archivage libre avec créances actives |
| Tarif | ✅ | **historisé** (modif = archive ancien + nouveau) | ❌ | ✅ | `finance.fees.manage` | ✅ bon : créances existantes gardent leur montant |

Suppression définitive : n'existe nulle part pour les référentiels métier —
uniquement sur les jonctions (coef/affectations) et `Announcement`,
`StudentGuardian` (lien), `User`. Le schéma est quasi intégralement
`onDelete: Restrict` → toute suppression d'un objet utilisé échouerait au
niveau base, mais le risque est réduit par l'absence de `delete` applicatif.

## 4. Cohérence métier — constats

| Situation | Comportement actuel | Verdict |
|---|---|---|
| Classe avec élèves → archivée | Autorisé sans avertissement | ⚠️ à durcir (au moins un avertissement + comptage) |
| Élève ENROLLED → archivé | Autorisé ; l'inscription reste active | ⚠️ orphelin fonctionnel (l'élève disparaît des recherches mais reste inscrit) |
| Inscription dans classe ARCHIVED | **Autorisé** (`classroom.status` lu, jamais testé — `enrollStudent` et `transferStudent`) | ❌ contrôle manquant |
| Année terminée (CLOSED) | Inscription/classe/EDT/périodes bloqués (`YEAR_CLOSED` partout vérifié) — **sauf** `createAssessment` qui ne teste ni `year.status` ni `period.isLocked` | ⚠️ évaluations créables sur année close (la saisie de notes est elle bloquée par `isLocked` dans grades.ts:120) |
| Matière avec notes → archivée | Historique préservé ; masquée des listes | ✅ acceptable |
| Réglage `allowMultipleEnrollments` | Lu par `enrollStudent` et l'import — **mais** l'index unique partiel `Enrollment_active_per_year_key` rend toute 2ᵉ inscription ENROLLED impossible → le réglage est une impasse latente | ⚠️ incohérence à documenter (ou à supprimer) |
| Retrait de ClassroomSubject / TeachingAssignment avec notes existantes | Delete accepté ; l'enseignant perd le droit de voir/saisir dans la paire classe/matière — les notes restent | ⚠️ à documenter ou garder soft-delete |
| Élève change de classe | `transferStudent` : même année imposée (CROSS_YEAR), TRANSFERRED + nouvelle ENROLLED, audit | ✅ correct (manque check classe cible archivée / année close) |
| Élève change d'année | Réinscription sur nouvelle année OK ; import couvre la réinscription de masse | ✅ |
| Import avec élèves déjà inscrits | Détecté (« existing » / erreur autre classe) | ✅ |
| Import → créances | **Non générées** — dossier vide, paiement impossible jusqu'à génération manuelle | ❌ écart fonctionnel majeur |

Isolation multi-tenant : `schoolId` filtré sur toutes les requêtes lues ;
imports/exports scopés école. Abonnements : `STUDENTS`,
`CLASSES_SUBJECTS`, `ADMINISTRATION`, `GRADES`, `SCHEDULES` couvrent les
permissions dans la matrice V2 (Essentiel/Pro/Premium) — aucun accès non
couvert.

## 5. Tests exécutés (lecture seule)

- Export `buildStudentsExport` filtré année+classe : 26 lignes / export
  inscriptions : 26 — cohérents (base locale démo).
- Revue de code des routes export/import + services référentiels +
  schéma `onDelete` + mapping modules V2 + permissions par rôle
  (ADMIN_SCHOOL complet ; TEACHER lecture+scope ; CASHIER/FM fines).

## 6. Recommandations par priorité

**P1 — bloquants fonctionnels**
1. **Créances après import** : appeler `generateStudentCharges` par élève
   inscrit à la fin de `commitStudentsImport` (post-commit, comme le
   guichet) + colonne « créances » dans le bilan. Ne jamais inventer de
   montant ; absence de tarifs = information, pas erreur.
2. **Refuser l'inscription/transfert vers une classe ARCHIVED** dans
   `enrollStudent` et `transferStudent`.

**P2 — intégrité**
3. `closeYear` : avertir/compter les ENROLLED actifs ; décider une
   réouverture encadrée ou documenter l'irréversibilité.
4. `updateStudent` archivage : avertir si ENROLLED actif (ou proposer
   clôture de l'inscription dans le même flux).
5. `createAssessment` : refuser année CLOSED / période `isLocked` /
   classe ou matière archivée.
6. Archivage niveau/classe/matière : compter les dépendances et afficher
   un avertissement préalable (ConfirmPanel existant).

**P3 — confort / complétude**
7. Export : sélection de colonnes optionnelle (preset métier suffisant aujourd'hui).
8. Import : alerte homonyme (nom+prénom+naissance) comme au guichet ;
   trancher si FM/caissier doivent importer (permissions fines
   `student.create`/`enrollment.create` vs `.manage` actuelles).
9. Lever l'incohérence `allowMultipleEnrollments` vs index unique partiel.
10. Signaler l'effet de bord « retrait d'affectation ⇒ retrait du scope
    enseignant » dans l'UI (ConfirmPanel avec compteurs).

## 7. Découpage proposé (non implémenté)

- **F3-A1** : créances post-import + bilan (dépend de `generateStudentCharges` F2-D2-A).
- **F3-A2** : gardes référentiels (classe archivée, année close sur
  assessments, archivage élève inscrit, avertissements de dépendances).
- **F3-A3** : ergonomie export (colonnes) + import (homonymes, colonne
  créances dans le bilan).
- Chaque lot : tests métier locaux + recette authentifiée, commit local,
  GO avant déploiement.

Aucune action supplémentaire sans GO explicite.
