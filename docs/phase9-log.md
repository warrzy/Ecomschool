# Phase 9 — Communication, notifications multicanales et automatisations SaaS

Branche : `phase-9-communications` (depuis `phase-8-saas-commercial`).

## Étape 0 — Audit

- Réutilisation des notifications internes Phase 6 (`Notification`, `notifyUsers`, hooks absence/bulletin/annonce) — aucun modèle dupliqué.
- `Announcement` : ajout de `scheduledAt` pour la publication programmée.
- Consentement : `UserCommPreference` (opt-in/out par canal+sujet), `GuardianCommConsent` (SMS/WhatsApp/opt-out global pour les tuteurs sans compte), `CommConsentEvent` (historique).
- Traitements planifiés identifiés : publication d'annonces, envoi de messages programmés, rappels d'échéances financières, alertes SaaS — implémentés via file de jobs + `/api/cron`.
- Backup `backups/backup_20261011_052630.dump` avant `migrate deploy` (migration create-only relue).

## Schéma (migration `20261011032654_phase9_communications`)

- `SchoolMessage` : brouillon/programmé/envoyé, audience (`ALL_PARENTS`, `CLASS_PARENTS`, `GUARDIAN`, `STUDENTS`, `TEACHERS`, `STAFF`), canaux multiples, sujet métier (`TRANSACTIONAL`/`ACADEMIC`/`FINANCE`/`ANNOUNCEMENT`/`OPTIONAL`).
- `MessageDelivery` : livraison par destinataire+canal — statuts QUEUED/SENT/FAILED/SKIPPED/BLOCKED, `dedupKey` unique, `attempts`, `providerRef`, `costUnits` (estimation coût SMS).
- `MessageTemplate` : templates email configurables (8 codes bootstrappés : invitation, bulletin, annonce, absence, échéance, facture SaaS, renouvellement, suspension proche).
- `Job` + `TaskRun` : file persistante et historique d'exécution.

## File de jobs (`comm/queue.ts`)

- Persistée en base (`Job`), `dedupKey` unique → pas de doublon même en ré-enfilement.
- Verrou optimiste (`updateMany` PENDING→RUNNING), retry backoff `2^n` min (max 60), `DEAD` au-delà de `maxAttempts`.
- Reprise après interruption : `RUNNING` stale > 10 min → repassé `PENDING`.
- `JobHandler` par type : `delivery.send`, `automation.platform`, `automation.school`.
- Aucune dépendance externe (pas de Redis/Bull) — adapté au déploiement Next.js + Postgres actuel ; déclenché par `/api/cron` (Bearer `CRON_SECRET`).

## Canaux (`comm/providers.ts`)

- Interface `ChannelProvider` commune (configured/send). Credentials **serveur uniquement** via env :
  - `EMAIL_PROVIDER_URL`(+`EMAIL_PROVIDER_TOKEN`) — passerelle HTTP générique.
  - `SMS_PROVIDER_URL`/`SMS_PROVIDER_TOKEN` + `SMS_COST_PER_SEGMENT` (estimation coût par segment 160 car.) — compatible passerelles type Orange/Twilio utilisables au Burkina Faso.
  - `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` — **API officielle Meta Graph** (`/messages`, type `template` approuvé uniquement, langue fr).
- Canal non configuré → `FAILED / PROVIDER_NOT_CONFIGURED` (jamais d'envoi simulé en production). `registerTestProvider` réservé aux tests.
- `processDelivery` : consentement → résolution d'adresse → disponibilité → envoi ; échec retryable → remise en file.

## Préférences & confidentialité (`comm/preferences.ts`)

- `TRANSACTIONAL` jamais désinscriptible (refus `TRANSACTIONAL_REQUIRED`).
- Opt-out par canal × sujet, historique `CommConsentEvent`, page `/app/preferences`.
- Tuteur sans compte : `smsOptIn`/`whatsappOptIn` requis avant tout envoi ; `optOutAll` bloque tout sauf transactionnel.
- Contenu des notifications limité (titres courts, pas de notes/montants détaillés hors portail).

## Messagerie (`comm/messages.ts`)

- Résolution des audiences strictement scopée `schoolId` ; classe/tuteur cible re-vérifiés côté serveur (`NOT_FOUND` si étranger).
- Brouillon → envoi immédiat ou `SCHEDULED` ; canal interne = notification Phase 6 ; canaux externes = `MessageDelivery` en file avec `dedupKey msg:{id}:{channel}:{destinataire}`.
- Page `/app/messages` (permission `messages.manage`) : composition, historique, statuts, stats par canal réelles, état de disponibilité des fournisseurs.

## Automatisations (`comm/automations.ts`)

- `runSchoolAutomations` : annonces programmées dues (claim `updateMany` anti-course), messages `SCHEDULED` dus, rappels d'échéances `FeeInstallment` J-3/en retard — dédupliqués par jour via `dedupKey fin-reminder:{id}:{date}`, réductions/exonérations déduites.
- `runPlatformAutomations` : `sweepSubscriptions()` (cycle TRIAL→GRACE→SUSPENDED→EXPIRED — plus dépendant d'un bouton), expiration des sessions d'assistance, alerte J-7 aux admins d'école + owners plateforme, rappel hebdomadaire des factures SaaS échues — tout dédupliqué, `TaskRun` tracé.
- Route `/api/cron` : `runDueJobs` + automatisations plateforme + boucle écoles ; requiert `CRON_SECRET`. À brancher sur un planificateur externe (cron système, GitHub Actions `schedule`, etc.).

## Interfaces

- `/app/notifications` : filtres par type, filtre « non lues », marquage individuel, tout-marquer, lien préférences.
- `/app/preferences` : toggles canal×sujet, état fournisseurs, historique de consentement.
- `/app/messages` : composition multi-audience/multi-canal, programmation, historique, stats de livraison.
- `/app/announcements` : champ « programmée ».
- `/platform/automations` : compteurs de jobs, état des canaux, livraisons par canal, coût SMS cumulé, jobs récents, `TaskRun`, boutons manuels (exécuter jobs / planifier sweep).

## Tests — 54/54

`scripts/phase9/business-test.ts` : notifications internes (dédup, filtres, marquage), audiences (parents/classe/tuteur/élèves/enseignants/personnel), refus inter-écoles, programmation, préférences/opt-out/transactional, consentements tuteur, templates, provider absent (`PROVIDER_NOT_CONFIGURED`), provider simulé (SENT, coût, référence), WhatsApp template requis, blocage opt-out, dédup jobs, backoff, DEAD, reprise RUNNING stale, annonce programmée, idempotence des automatisations, alerte pré-expiration + admin notifié, supervision.

## Résultats

- Phase 9 : **54/54** · Régressions : P2 31/31 (+login) · P3 39/39 · P4 47/47 · P5 44/44 · P6 39/39 · P7 49/49 · P8 59/59
- `typecheck` ✅ `eslint` ✅ `build` ✅ (74 routes, `/api/cron` incluse)

## Correctifs connexes

- Test Phase 8 rendu idempotent : purge des `SchoolModuleOverride` de l'école de test (laissés par le run précédent).

## Limites connues

- Pas de planificateur embarqué : `/api/cron` doit être appelé périodiquement (recommandé : toutes les 5–15 min) — documenté ci-dessus.
- Email via passerelle HTTP générique (pas de SDK SMTP embarqué) ; WhatsApp exige des templates approuvés Meta.
- `archiveAnnouncement` supprime physiquement (comportement hérité des phases antérieures, hors historique de livraison).
- Recherche de tuteur par ID dans le formulaire « un parent » (pas d'autocomplétion).
