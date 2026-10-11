# Phase 4 — Gestion pédagogique : emplois du temps, cours, absences et retards

Branche : `phase-4-pedagogie` (depuis l'état validé de `phase-2-multitenant` / Phase 3).

## Modèles Prisma ajoutés

- `Room` : salle (`code` unique par école, capacité, bâtiment, étage, `RoomType`, `RecordStatus`).
- `CourseSchedule` : créneau récurrent hebdomadaire (`weekday` LUN–SAM via enum `Weekday`, `startMin`/`endMin` en minutes UTC-midnight cohérent, `validFrom`/`validUntil`, liens classe/enseignant/matière/salle/année).
- `CourseSession` : séance réelle à date précise (`SessionStatus` : PLANNED/DONE/CANCELLED/POSTPONED), `scheduleId` optionnel (séances ponctuelles supportées), champs de déplacement `movedTo*` et `cancellationReason`, `replacementTeacherId`.
- `CourseContent` : cahier de textes par séance (thème, chapitre, objectif, contenu, devoirs, observations, `doneAt`/`doneById`).
- `AttendanceRecord` : présence par élève ; liée soit à une séance (`sessionId`), soit à un appel journalier (`sessionId NULL` + `date`) ; statuts `AttendanceStatus` (PRESENT/ABSENT/LATE/EXCUSED/UNMARKED), durée, horaires prévu/arrivée, justification (`justifiedAt`/`justifiedById`), `recordedById`.

## Migrations appliquées

- `20261011002635_phase4_pedagogy` : modèles ci-dessus (backup pg_dump préalable).
- `20261011024717_phase4_attendance_unique_indexes` : index uniques partiels manuels —
  - `AttendanceRecord_session_student_key` : `(sessionId, studentId)` où `sessionId IS NOT NULL` ;
  - `AttendanceRecord_daily_student_key` : `(studentId, date)` où `sessionId IS NULL` (anti-doublon entre appel par séance et appel journalier).
  - Déploiement initial échoué sur doublons historiques → déduplication conservant l'enregistrement le plus récent (status le plus avancé), puis `migrate resolve --rolled-back` + `migrate deploy`.

## Services (`src/lib/services/`)

- `rooms.ts` : CRUD salle scopé école, code unique, archivage (RecordStatus).
- `schedules.ts` : création/édition/archivage de créneaux, matérialisation idempotente des séances (`ensureSession`, semaine → `CourseSession`), séances ponctuelles, déplacement, annulation/restauration, remplacement d'enseignant ; détection de conflits classe/enseignant/salle dans transaction `Serializable` (anti double réservation), exclusion du créneau/séance parent lors d'édition ; créneaux adjacents autorisés ; dates normalisées en UTC-midnight.
- `attendance.ts` : roster d'une séance depuis les inscriptions actives à la date, appel par séance, appel journalier, historique élève, listes absences/retards, justification avec audit log, compteurs (absences, justifiées, non justifiées, retards, minutes de retard).
- `dashboard.ts` : indicateurs temps réel — cours prévus/réalisés aujourd'hui, enseignants et classes en cours, absences/retards du jour, taux de présence, séances annulées (filtres année/période).

## Permissions ajoutées (bootstrap : `scripts/phase4/bootstrap-permissions.ts`)

`rooms.read`, `rooms.manage`, `schedules.read`, `schedules.manage`, `schedules.print`, `sessions.read`, `sessions.manage`, `coursecontent.manage`, `attendance.read`, `attendance.manage`, `attendance.justify`, `reports.attendance`.

Enseignants : `sessions.read`, `attendance.read/manage`, `coursecontent.manage`, `schedules.read` — et limitation aux séances dont ils sont titulaires ou remplaçants (vérifié côté service).

## Pages & routes

- `/app/rooms` : liste + CRUD salles.
- `/app/schedules` : grille hebdomadaire Lun–Sam (enseignant/classe/salle/matière, filtres année/classe/enseignant/salle, création/édition/archivage), `/app/schedules/pdf` : export PDF A4 paysage via pdfkit (`schedules.print`), en-tête école + année + date.
- `/app/sessions/[id]` : détail séance — appel des élèves, cahier de textes, déplacement, annulation/restauration.
- `/app/attendance` : appel journalier, absences et retards, justification.
- `/app/students/[id]` : onglet absences réel (compteurs + historique, années précédentes incluses).
- `/app/classrooms/[id]` : onglets emploi du temps, cours/séances, absences, statistiques réelles.
- `/teacher` : dashboard enseignant — cours du jour/de la semaine, classes, appels à faire, cahier de textes.
- `/app` dashboard : indicateurs pédagogiques temps réel.
- Placeholder `/app/timetable` supprimé (remplacé par `/app/schedules`).

## Tests

- `scripts/phase4/business-test.ts` : **47/47** — 2 écoles, conflits salle/enseignant/classe, créneaux adjacents, séance, appel, absence, retard, justification, fiches élève/classe, PDF, permissions enseignant (appel refusé si non affecté), cross-tenant, déplacement/remplacement, modifications concurrentes.
- Régressions : Phase 2 `security-test` **31/31** ; Phase 3 `business-test` 0 échec (rendu idempotent : réutilisation des fixtures existantes).
- `typecheck` ✅ · `lint` ✅ · `build` ✅ (50 routes).

## Limites connues

- Pas de vue calendaire graphique avancée (grille HTML tabulaire, responsive de base).
- Export PDF : une page par classe sélectionnée ; pas d'export par salle groupé.
- Warning dev `randomBytes` en prerender sur routes authentifiées (Next 16) — non bloquant, sessions accédées en request-time.
- Taux de présence calculé sur les enregistrements marqués uniquement (UNMARKED exclus).
