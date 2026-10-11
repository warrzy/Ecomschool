# Phase 6 — Finalisation des bulletins et portails Parents / Élèves

Branche : `phase-6-portals` (depuis `phase-5-evaluations-bulletins`).

## Étape 0 — Audit et corrections

### Périodes scolaires (bug résiduel Phase 3/5)
- Correctif amont (Phase 5) : `periodTemplates` découpe désormais l'année en tranches égales au lieu de dates identiques.
- `scripts/phase6/audit-periods.ts` : audit non destructif.
  - `--report` (défaut) : détecte les périodes qui se chevauchent par école/année et indique les données verrouillées (résultats `VALIDATED/PUBLISHED/RECTIFIED`, bulletins).
  - `--fix` : redécoupe **uniquement** les années sans aucune donnée verrouillée ; jamais de recalcul ni de mutation de résultats validés.
- Exécution : 14 années affectées → **13 corrigées**, **1 verrouillée laissée intacte** (jeu de test Phase 5 avec résultats/bulletins — nécessiterait une correction manuelle supervisée).

### Autres vérifications
- Versions de bulletins : immuables (`ReportCardVersion.payload` JSON) ; rectification = nouvelle version, jamais de mutation silencieuse (testé).
- Publication : workflow `VALIDATED → PUBLISHED` inchangé, permissions `results.validate`/`results.publish`/`reportcards.*` vérifiées côté serveur.
- PDF : routes admin (`reportcards.print`) et portails (vérification parent↔enfant / élève↔compte **en base à chaque requête**).

## Étape 1 — Bulletins professionnels (3 modèles distincts)

`src/lib/pdf/report-card.ts` : moteur de rendu partagé pdfkit, 3 mises en page réellement différentes :

| Modèle | Spécificités |
|---|---|
| `primary` | « Disciplines » sans coefficients/rangs ; résultat général ; appréciation professeur principal ; décision pédagogique ; bloc signatures professeur + direction |
| `college` | Matières + coefs + rangs ; synthèse (moyenne, rang, mention, absences/retards) ; appréciation générale ; décision direction ; formule « Fait à… » |
| `lycee` | Matières **regroupées par `Subject.subjectGroup`** avec sous-total par groupe ; points pondérés ; classement ; mention ; décision conseil + observation direction + date de validation |

- Visibilité des champs configurable par modèle via `ReportCardTemplate.layout` (JSON : `showRank`, `showCoefficients`, `showPoints`, `showGroups`, `showMention`, etc., fusionné avec les défauts du modèle).
- Sélection du modèle : `levelId` du bulletin → template par défaut, surcharge `?template=` possible.
- `Subject.subjectGroup` ajouté (migration `phase6_subject_groups`).
- Aucune prétention d'homologation officielle.

## Étape 2 — Appréciations et décisions

- Nouveaux champs `StudentPeriodResult` : `headTeacherNote`, `generalAppreciation`, `councilDecision`, `directionNote`, `directionSignedById`, `directionSignedAt`.
- `updateSubjectAppreciation` (par matière) et `updateResultAnnotations` (professeur principal, générale, conseil, direction, signature horodatée) — permission `results.validate`, audit log.
- UI : `/app/report-cards/[id]` — saisie + historique des versions. Modification post-publication → régénération = nouvelle version (payload enrichi, anciennes versions conservées).

## Étapes 3-5 — Portails et accès

### Modèle d'accès
- `Student.userId` et `Guardian.userId` (nouvelles colonnes) relient un compte `User` au dossier.
- Rôles système `PARENT` / `STUDENT` (scope SCHOOL, `schoolId: null`) avec `portal.parent` / `portal.student` + `announcements.read` ; permission `portal.manage` pour l'admin.
- Layout `/app` redirige `PARENT → /parent`, `STUDENT → /student`.

### Invitations (aucun mot de passe en clair)
- `AccountInvite` : token hex 48 car., expiration 7 j., `usedAt`, révocable.
- Compte créé `DISABLED` avec hash aléatoire inconnu ; `/invite/[token]` (publique) : définition du mot de passe (min. 8) → compte `ACTIVE`, token consommé, autres tokens révoqués.
- `resendInvite` : révoque les tokens actifs, en émet un nouveau. Le lien s'affiche à l'admin (pas d'envoi automatique).
- `setPortalAccountStatus` : activation/désactivation (user + membership), audit.

### Portail parent `/parent` (mobile-first, `portal.parent`)
- Sélecteur multi-enfants ; onglets : aperçu, emploi du temps, notes publiées, résultats publiés, bulletins PDF, absences/retards, annonces.
- `verifyChildAccess` revérifie `StudentGuardian` + statuts en base à chaque appel (pas le JWT). École B → aucune donnée.
- `/parent/report-cards/[id]/pdf` : bulletin `PUBLISHED`/`RECTIFIED` + lien parent vérifié, sinon 403/404.

### Portail élève `/student` (mobile-first, `portal.student`)
- Profil, classe, emploi du temps, matières, notes publiées, résultats publiés, bulletins PDF, absences/retards, annonces.
- `resolveStudent` vérifie `Student.userId` + statuts en base. Aucune donnée non publiée.
- `/student/report-cards/[id]/pdf` : uniquement son bulletin publié.

### Filtre « publié seulement »
- Notes : `assessment.status = PUBLISHED`.
- Résultats : `StudentPeriodResult.status ∈ {PUBLISHED, RECTIFIED}`.
- Bulletins : `ReportCard.status ∈ {PUBLISHED, RECTIFIED}`.

### Gestion des accès (fiche élève, `portal.manage`)
- Carte « Accès aux portails » : statut du compte élève + de chaque tuteur ; activer/inviter (email), renvoyer l'invitation, désactiver/réactiver ; affichage du lien d'invitation. Association multi-enfants via `StudentGuardian` existant.

## Étape 6 — Notifications et annonces

- `Notification` : interne, persistée, scopée école (`type`, `title`, `body`, `link`, `readAt`) — conçue pour canaux futurs (email/SMS/WhatsApp) ; **aucune donnée envoyée à un tiers**.
- Émissions : publication des résultats (`REPORT_CARD_PUBLISHED` → comptes élèves + tuteurs de la classe), annonce publiée (`ANNOUNCEMENT` → audience ciblée), absence non justifiée et retard (`addAttendanceRecord` → tuteurs + élève).
- `Announcement` : brouillon/publication, audience `ALL/PARENTS/STUDENTS/TEACHERS` ; `/app/announcements` (`announcements.manage`).
- `/app/notifications` : liste + tout marquer lu ; badge dans les layouts portails.

## Étape 7 — École de démonstration

`scripts/phase6/seed-demo.ts` (idempotent) : « Collège Démo ECOM (données fictives) » — année 2025-2026, classe 6e A, 3 élèves fictifs, parent fictif (2 enfants), enseignant, 3 matières, évaluations + notes T1, calcul → validation → publication, appréciations signées, annonce. Comptes `admin|enseignant|parent|eleve@demo.local` (mot de passe affiché par le script uniquement).

## Migrations

- `20261011012745_phase6_portals_announcements` : `Student.userId`, `Guardian.userId`, champs annotations `StudentPeriodResult`, tables `Announcement`/`Notification`/`AccountInvite`, enums associés.
- `20261011013018_phase6_subject_groups` : `Subject.subjectGroup`.
- Backup pg_dump préalable (`backups/backup_phase6_portals_*.dump`) ; `create-only` → SQL inspecté → `migrate deploy` → `generate`.

## Permissions ajoutées (`scripts/phase6/bootstrap-permissions.ts`)

`portal.manage`, `portal.parent`, `portal.student`, `announcements.read`, `announcements.manage`, `notifications.read` ; rôles système `PARENT`, `STUDENT` créés.

## Tests — `scripts/phase6/business-test.ts` (39/39)

Invitations (token consommé/révoqué/expiré, hash ≠ clair), lien parent↔enfant serveur, multi-enfants, refus cross-tenant (parent B → élève A, élève A → école B), invisibilité pré-publication, visibilité post-publication, notifications publication + annonce (audience respectée), annotations persistées + signature, rectification = nouvelle version avec payload enrichi, 3 PDF distincts (tailles différentes), annonces publiées par audience, désactivation/réactivation d'accès.

## Régressions

- Phase 2 : 31/31 · Phase 3 : 0 échec · Phase 4 : 47/47 · Phase 5 : 44/44
- `tsc --noEmit` ✅ · `eslint` ✅ · `next build` ✅ (58 routes)

## Limites connues

- Pas d'envoi externe (email/SMS/WhatsApp) : le lien d'invitation est affiché à l'admin pour transmission manuelle ; l'architecture `Notification` est prête pour un canal de livraison futur.
- Le bulletin `RECTIFIED` reste visible aux portails (version la plus récente) — comportement voulu.
- La configuration `layout` des modèles est honorée au rendu ; pas encore d'écran d'édition graphique des champs.
