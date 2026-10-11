# Phase 10 — Rapport d'audit initial

Branche : `phase-10-production-readiness` (depuis `phase-9-communications`).
Date : 2026-10-11. Périmètre : schéma Prisma, services, routes, auth, permissions, jobs, PDF, dépendances, config.

## Méthode

Revue statique de tout `src/`, `prisma/`, `scripts/`, `package.json`, configs. Grep systématique : `where: { id }` sans `schoolId`, guards par page, `npm audit`, fichiers sensibles, `User.schoolId`. Vérifications confirmées par lecture du code — pas de tests d'exécution à ce stade (Étape 1+).

## Synthèse des constats positifs

- **Couverture des guards : 100 %.** Toutes les pages (sauf `/` redirect) passent par `requireSchoolPermission`/`requireSchoolContext`/`requirePlatformPermission`/`requireSessionUser`. Aucune page orpheline.
- **Isolation tenant systématique** : services filtrent `schoolId` ; routes PDF (bulletins élève/parent, reçus, factures SaaS) revérifient l'appartenance (`verifyChildAccess`, `resolveStudent`, `schoolId`).
- **Comptes désactivés** : `requireSessionUser` re-vérifie `User.status` en base à chaque requête → révocation immédiate malgré le JWT.
- **Suspension SaaS = lecture seule** : permissions `.read`/`.print` + portails conservés, écritures bloquées côté serveur.
- **Secrets** : aucun identifiant/mot de passe réel dans les fichiers trackés ; `.env*` ignoré ; seeds exigent `SEED_TEST_PASSWORD` ; credentials providers = env serveur.
- **Invitations** : tokens 24 octets, TTL 7 j, usage unique, révocation des anciens tokens au renvoi ; comptes `DISABLED` avant acceptation.
- **Finances** : montants entiers XOF, idempotencyKey, reçus/factures rendus depuis snapshots immuables, annulation par contre-écriture, clôture de caisse bloquante.
- **File de jobs** : dédup par clé unique, verrou optimiste, backoff, DEAD, reprise RUNNING stale — testée 54/54.

## Anomalies identifiées

### CRITICAL

Aucune anomalie d'isolation multi-tenant critique constatée en revue statique. À confirmer par tests IDOR exécutés (Étape 1) avant de figer ce verdict.

### HIGH

| ID | Constats |
|---|---|
| **P10-H1** | **Aucune protection anti-force-brute ni rate limiting.** `authorize()` (credentials) illimité, `/invite/[token]` (devinette de token = 96 bits, mais coût nul à réessayer), `/api/cron` (secret comparaison non constante + illimitée), server actions sans throttle. `authorize` échoue instantanément user inconnu vs mauvais mot de passe (timing oracle mineur — bcrypt non appelé si user absent). *Fichiers* : `src/lib/auth/options.ts`, `src/app/api/cron/route.ts`, `src/app/invite/actions.ts`. *Correction proposée* : compteur d'échecs persisté (table `LoginAttempt` ou colonnes `User`), backoff exponentiel, verrouillage temporaire, comparaison constante pour le secret cron, hash "dummy" bcrypt si user absent. |
| **P10-H2** | **Suppression physique des annonces** (`archiveAnnouncement` → `prisma.announcement.delete`) alors que la règle produit impose conservation. *Correction* : colonne `archivedAt`, filtrage dans les listes, conservation de l'historique — migration create-only. |
| **P10-H3** | **Pas de mécanisme de réinitialisation de mot de passe** hors invitation initiale. Un utilisateur actif qui perd son mot de passe ne peut être récupéré que par un admin qui réécrit `passwordHash` (`updateSchoolUser`) — aucun flux de reset auto-servi traçable. *Correction* : réutiliser `AccountInvite` (reset = nouveau token sur compte ACTIVE) ou table dédiée + email via canal Phase 9. |

### MEDIUM

| ID | Constats |
|---|---|
| **P10-M1** | **Durées de conservation non implémentées** — exigence Phase 9 (« durées de conservation configurables ») non livrée : pas de purge de `Notification`, `AuditLog`, `MessageDelivery`, `CommConsentEvent`, `Job`, `TaskRun`. Croissance non bornée + non-conformité rétention. *Correction* : `RetentionPolicy` par entité + job de purge planifié. |
| **P10-M2** | **Pas d'UI de consentement tuteur** : `setGuardianConsent` existe mais aucune page ne collecte `smsOptIn`/`whatsappOptIn` → de fait, SMS/WhatsApp vers tuteurs sans compte sont **impossibles** en production (toujours refusés). Fiche `/app/guardians/[id]` à compléter. |
| **P10-M3** | **Consentement WhatsApp en opt-out pour les comptes** : `canContactUser` considère `enabled ?? true` — non conforme au modèle Meta (opt-in explicite requis). *Correction* : défaut `enabled=false` pour `WHATSAPP`, ou mapping sujet→opt-in obligatoire. |
| **P10-M4** | **Validation d'entrée inconstante** : actions `announcements`, `messages`, `preferences`, `fees`, `platform`, `invite`, `automations` n'utilisent pas les schémas Zod de `src/lib/validations/` (validation manuelle, bornes absentes — ex. `datetime-local` parsé sans borne, `note` de rappel sans longueur max, sujets/corps sans limite). Risque : payloads aberrants, erreurs 500 sur dates invalides (`new Date("")` → Invalid Date → `scheduledAt` null silencieux ou crash DB). |
| **P10-M5** | **`logAudit` avale toutes les erreurs** (`catch {}` sans trace) — une panne d'audit est invisible. Ajouter au minimum un `console.error` / compteur, sinon supervision impossible. |
| **P10-M6** | **N+1 dans `runSchoolAutomations`** : par échéance (≤500), requêtes `studentGuardian.findMany` + `student` unitaires → jusqu'à ~1000 requêtes/école/run. *Correction* : `findMany` groupé par `studentId in`. |
| **P10-M7** | **Session JWT sans borne courte ni révocation** : stratégie `jwt` sans `maxAge` explicite (défaut NextAuth ~30 j). La base compense (re-check à chaque requête), mais fixer `maxAge` raisonnable + documenter l'absence de révocation de token avant échéance. |
| **P10-M8** | **Politique de mot de passe faible** : `acceptInvite` exige ≥ 8 caractères seulement ; `updateSchoolUser` n'impose aucun minimum. *Correction* : ≥ 10 + règle de complexité, appliquée aux deux chemins. |
| **P10-M9** | **Marqueurs de déduplication mélangés aux livraisons réelles** : `dedupMarker()` crée des `MessageDelivery` `INTERNAL/SENT` qui gonflent les statistiques par canal des dashboards (exigence « pas de statistiques fictives »). *Correction* : champ `kind`/`isMarker` ou table `DedupKey` dédiée + exclure des agrégats. |
| **P10-M10** | **`User.schoolId` toujours décisionnel** : `requireSchoolContext` sélectionne le tenant via `User.schoolId`, pas via la membership. Cas multi-écoles impossible ; incohérence possible si `schoolId` ≠ membership ACTIVE. Plan de retrait déjà documenté (`docs/user-schoolid-migration.md`) — à exécuter en phase finale, migration non destructive, rollback = re-écriture du champ depuis la membership. |
| **P10-M11** | **Permissions `/app/messages` vs `announcements`** : `messages.manage` n'existait pas dans les rôles antérieurs à P9 — vérifier que le bootstrap a bien peuplé les rôles existants en production (fait en bootstrap ; à documenter dans la checklist déploiement). |
| **P10-M12** | **Absence de headers de sécurité HTTP** : `next.config.ts` ne définit ni CSP, ni `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. |
| **P10-M13** | **Notification « absence non justifiée » immédiate** : envoyée à l'enregistrement, avant tout délai de justification — libellé trompeur si le parent justifie ensuite. *Décision produit à prendre* : délai de grâce ou mention « à justifier ». |

### LOW

| ID | Constats |
|---|---|
| **P10-L1** | `prisma-8.md` (brouillon à la racine) + dossiers `.agents/`, `.claude/`, `.cursor/`, `.devin/` non trackés — politique de commit à décider (les skills projet méritent d'être versionnées ou ignorées proprement). |
| **P10-L2** | npm audit : `deepmerge-ts` (via CLI Prisma — pile dev, pas de chemin requête HTTP) et `mysql2` (transitif, **jamais chargé** — le runtime utilise `@prisma/adapter-pg`/`pg`). `npm audit fix --force` rétrograderait Prisma 7→6 : **interdit**. Documenter comme risque résiduel accepté, patcher quand Prisma corrige. |
| **P10-L3** | `next-auth@4.24.15` : vérifier fin de support vs NextAuth v5/Auth.js ; aucune CVE ouverte connue à ce jour sur 4.24.15 mais la branche 4 est en maintenance. |
| **P10-L4** | `/app/report-cards/pdf?id=` ne filtre pas le statut : un membre avec `reportcards.print` peut imprimer un bulletin `DRAFT`/`IN_PROGRESS`. Mineur (personnel de confiance) mais à corriger : `status in (VALIDATED, PUBLISHED, RECTIFIED)` hors aperçu brouillon explicite. |
| **P10-L5** | `Notification` : pas de purge/`take` par défaut limité — croissance non bornée (couvert par P10-M1). |
| **P10-L6** | `canContactGuardian` : `optOutAll` bloque aussi le transactionnel pour les comptes ? Non — corrigé : optOutAll bloque tout sauf TRANSACTIONAL (déjà ajusté). Cohérence à documenter. |
| **P10-L7** | Sessions d'assistance = traçage sans octroi d'accès réel. Conforme au principe « jamais de contournement silencieux » mais signifie qu'aucun support en consultation n'est possible — décision produit à confirmer. |
| **P10-L8** | `dedupKey` des alertes SaaS utilise `YYYY-Www` approximatif : un run en chevauchant le changement de semaine peut envoyer 2 alertes rapprochées. Tolérable. |
| **P10-L9** | Renvoi d'email non existant révèle l'existence d'un compte ? `authorize` renvoie null générique — OK ; `acceptInvite` : token invalide → message générique — OK. |
| **P10-L10** | Timezone : toutes les dates sont manipulées en UTC (`toISOString().slice(0,10)`) — cohérent pour le Burkina Faso (UTC+0) mais fragile si une école d'un autre fuseau s'abonne. `School.timezone` existe mais inutilisé. |

## Plan de correction proposé (ordre)

1. **H1** — anti-brute-force : table `LoginAttempt`, backoff + lockout, timing-constant authorize, comparaison sécurisée du secret cron.
2. **H2** — `Announcement.archivedAt` (migration create-only) + filtrage listes + suppression physique retirée.
3. **H3** — flux de reset de mot de passe via `AccountInvite` existant + email template `PASSWORD_RESET`.
4. **M1** — `RetentionPolicy` + purge job dans `runPlatformAutomations` + config `PlatformConfig`.
5. **M2** — consentement tuteur dans `/app/guardians/[id]` (toggles SMS/WhatsApp/opt-out + traçabilité).
6. **M3** — WhatsApp = opt-in par défaut pour comptes utilisateurs.
7. **M4** — schémas Zod `comm.ts`/`announcements.ts`/`finance` complétés et appliqués aux actions manquantes.
8. **M5** — `logAudit` : erreur loggée (console) sans bloquer.
9. **M6** — batching des lookups d'échéances.
10. **M9** — séparer marqueurs de dédup des livraisons réelles (exclure des stats ou table dédiée).
11. **M7/M8/M12** — `session.maxAge`, politique mot de passe, headers de sécurité.
12. **L4** — filtre statut sur PDF bulletins admin.
13. **M10** — exécution du plan `User.schoolId` (déjà documenté) en fin de phase avec tests.
14. **L1** — nettoyage fichiers (`.devin/skills/` à commiter ; `.agents/.claude/.cursor` dupliquent la même source → `.gitignore` ou conserver une seule racine).

## Points confirmés sains (pas de correction)

- Guards sur 100 % des pages et des routes PDF/CSV/PDF-facture.
- `verifyChildAccess` parent↔élève et `resolveStudent` sur tous les PDF portails.
- Idempotence paiements (P2034 retry + clé), numérotation reçus/factures, snapshots.
- File de jobs : verrou optimiste, dédup, reprise — démontrée en test.
- Invitations : usage unique, révocation anciens tokens, compte DISABLED avant accept.
- Suspension SaaS : lecture seule, données conservées, pas de suppression au downgrade.
- Aucun secret tracké dans le repository.

## Tests de validation prévus (par anomalie)

- H1 : script `phase10/security-test.ts` — 6 échecs → refus/throttle ; cron rejeté sans header.
- H2 : annonce archivée reste en base, absente des listes.
- H3 : reset complet via token, ancien mot de passe refusé après reset, tokens révoqués.
- M1 : purge dédupliquée et bornée par `RetentionPolicy`.
- M2/M3 : envoi WhatsApp refusé sans opt-in explicite (compte et tuteur).
- M4 : payloads invalides → erreurs 4xx contrôlées, jamais 500.
- M9 : stats canaux excluent les marqueurs.
- IDOR : suite de permutations d'IDs (élève/classe/tuteur/paiement/bulletin/reçu/facture/message) cross-tenant → 404/403.
