# Audit global ECOM-SCHOOL

**Date de l'audit :** 14 novembre 2026, 15 h 54 (Europe/Paris)  
**Périmètre lu :** dépôt `github.com/warrzy/Ecomschool`  
**Code applicatif analysé :** `origin/phase-10-production-readiness` @ `ec62b59` (8 novembre 2026, 14 h 49, Europe/Paris) — 766 fichiers, 202 commits devant `main`  
**Documentation non fusionnée :** `origin/devin/1794223531-manuel-utilisateur` @ `8a790c9` (9 novembre 2026, 12 h 34, Europe/Paris), pull request [#1](https://github.com/warrzy/Ecomschool/pull/1) ouverte, base `phase-10-production-readiness`  
**Branche de travail au moment de l'audit :** `main` @ `9811e0a` (9 octobre 2026, 02 h 59, Europe/Paris) — 57 fichiers  
**Nature de cet audit :** lecture seule. Aucune fonctionnalité modifiée, aucune migration exécutée, aucun déploiement, aucune donnée supprimée, aucun secret recopié.

Les anciens rapports (`docs/phase*-log.md`, `docs/f2e*.md`, `docs/strategie-produit/inventaire-fonctionnel.md`, `docs/phase10-audit.md`) ont été confrontés au code. Plusieurs sont périmés : l'inventaire stratégique affirme encore que la comptabilité SYSCOHADA est absente, alors que le lot H12 est dans le schéma et dans `src/lib/services/accounting.ts`. Une fonctionnalité n'est tenue pour présente que si le modèle, le service ou la page existent dans `ec62b59`.

---

## 1. Synthèse générale

### État global

ECOM-SCHOOL est un **logiciel de gestion scolaire SaaS déjà substantiel** (maternelle au lycée, dans un modèle de niveaux libres), avec finances de scolarité, caisse, dépenses, trésorerie, une **comptabilité auxiliaire partielle**, des portails, des admissions et un socle multi-établissements.

Ce n'est **pas** un ERP scolaire 360°. Il n'y a **pas de module RH**, **pas de paie**, **pas de comptabilité générale complète** (pas de bilan, pas de compte de résultat, pas d'immobilisations, pas de rapprochement bancaire, pas de budgets) et **pas de gestion universitaire LMD**.

Le fait le plus important pour reprendre le projet : **`main`, branche par défaut et copie de travail locale, ne contient que le socle d'octobre 2026**. Tout le produit construit ensuite vit sur `phase-10-production-readiness`, qui n'a pas été fusionnée. La préproduction `https://preprod.ecomschool.fr` et `https://ecomschool.fr` répondent et servent l'application ECOM-SCHOOL ; le SHA exact déployé n'est pas exposé.

### Principales réalisations (vérifiées dans le code de `ec62b59`)

- Application Next.js 16 (App Router) + React 19 + Prisma 7 + PostgreSQL, authentification NextAuth credentials, RBAC, cloisonnement par `schoolId`.
- Référentiel scolaire : établissement, années, périodes, niveaux, classes, matières, coefficients, salles, emplois du temps.
- Vie scolaire : élèves, tuteurs, inscriptions, admissions publiques, réinscriptions, absences, notes, moyennes, bulletins PDF, délibérations, passage / redoublement / orientation.
- Finances de scolarité : tarifs, échéanciers, encaissements, reçus, impayés, clôture de caisse, dépenses, trésorerie, rapports CSV / Excel / PDF.
- Comptabilité de démarrage SYSCOHADA : plan, journaux, exercices, écritures générées depuis les paiements et les dépenses, balance à l'écran, exports CSV.
- SaaS : plans, modules, quotas, factures plateforme, supervision, audit, demandes d'inscription d'établissements.
- Mobile Money : encaissement manuel Orange Money / Moov Money ; intentions, webhooks, rapprochement et adaptateur PayDunya, avec verrou serveur des paiements réels.
- 55 migrations SQL, 102 modèles Prisma, 75 enums, 93 pages, 41 routes, 70 services, 16 specs Playwright, 87 scripts de recette ou de contrôle.

### Principaux manques

- RH et paie : aucune table, aucune page (`/app/rh` et `/app/paie` renvoient HTTP 404 sur la préproduction).
- Comptabilité générale : pas de bilan, de compte de résultat, d'immobilisations, d'amortissements, de budgets, de tiers auxiliaires, de rapprochement bancaire. La saisie manuelle d'écriture (`createManualEntry`) n'a pas d'écran. Le grand livre existe en service et en route CSV, sans bouton dans la page.
- Université : pas de faculté, département, filière, UE, crédits, stage ni mémoire.
- Maternelle spécifique (cahier de vie, compétences) : absente. Le type `PRIMARY` et le gabarit de bulletin `primary` couvrent l'école primaire, pas un cycle maternelle dédié.
- Communications externes (SMS, e-mail, WhatsApp) : code présent, envoi réel non prouvé sur les environnements déployés.
- Paiements réels : désactivés tant que `MOBILE_MONEY_LIVE_ENABLED` n'est pas exactement `true`, en plus des secrets et du drapeau par prestataire.

### Risques critiques

1. **La branche par défaut n'est pas le produit.** Cloner `main` ou déployer `main` livre le socle du 9 octobre 2026 (écoles, utilisateurs, années), pas la plateforme.
2. **Aucun pipeline CI** (pas de `.github/workflows`). Les recettes sont des scripts lancés à la main. Elles n'ont pas été relancées pendant cet audit.
3. **SHA déployé non identifiable.** Préproduction et production servent les mêmes empreintes de chunks Next.js au moment du sondage. On ne peut pas affirmer qu'elles sont exactement à `ec62b59`.
4. **Fiabilité financière partielle.** La caisse scolaire est outillée. La comptabilité ne produit pas les états OHADA de fin d'exercice. Une dépense « salaires » n'est pas une paie.
5. **Conformité non close.** `docs/production-checklist.md` laisse ouverts la politique de confidentialité (données de mineurs), le registre des traitements et la validation juridique Burkina Faso.
6. **Page « Documents administratifs » hors menu.** Le service G4 et la page `/app/documents-administratifs` existent ; `src/app/app/(tenant)/ui/nav.ts` ne les référence pas. Le portail parent, lui, affiche ces documents.

---

## 2. Architecture technique réelle

### Stack (`package.json` de `ec62b59`)

| Couche | Technologie |
|---|---|
| Application | Next.js `^16.4.1`, React `19.3.0`, TypeScript 5, Tailwind CSS 4 |
| Données | PostgreSQL, Prisma `^7.10.0`, `@prisma/adapter-pg`, `pg` |
| Auth | `next-auth` `^4.24.15`, mots de passe `bcryptjs` |
| Validation | Zod 4 |
| Documents | `pdfkit`, `exceljs`, `qrcode` |
| Tests navigateur | `@playwright/test` (dépendance de dev, **aucun script `npm test`**) |
| Processus | PM2 (`deploy/pm2/ecosystem.config.cjs`), Nginx, cron système |

Scripts npm : `dev`, `build`, `start`, `lint`, `typecheck`, `db:migrate`, `db:generate`, `db:seed`. Pas de commande de test unifiée.

Le `README.md` de `ec62b59` est encore le texte généré par `create-next-app`. Il ne décrit pas le produit. Le guide utile est `deploy/README.md`.

### Organisation du code

```
src/app/                  pages et routes (établissement, portails, plateforme, API)
src/lib/services/         70 services métier
src/lib/permissions/      RBAC
src/lib/tenant/           contexte d'établissement
src/lib/pdf/              bulletins, reçus, documents, délibérations
src/lib/export/           CSV / Excel
prisma/schema.prisma      102 modèles
prisma/migrations/        55 migrations
scripts/                  recettes par lot (phase2…phase15, f2, f3, g2, g3, g4, h1, h5, h6, h12)
e2e/                      16 fichiers Playwright
deploy/                   scripts VPS, Nginx, cron, sauvegardes
docs/                     journaux de phases et audits antérieurs
```

Il n'y a pas de dossier `.github`. Il n'y a pas de middleware Next.js à la racine : les gardes sont appelés dans chaque page (`requireSchoolPermission`, `requirePlatformPermission`, `requireSchoolContext`).

### Multi-établissements

- `School` porte le tenant (pays `BF`, devise `XOF`, fuseau `Africa/Ouagadougou` par défaut).
- `SchoolMembership` relie un utilisateur à un établissement (phase 2). L'unicité e-mail est devenue globale puis le rattachement passe par l'appartenance.
- Les services financiers et scolaires consultés filtrent par `schoolId`.
- Les rôles système seedés incluent `PLATFORM_OWNER`, `ADMIN_SCHOOL`, `TEACHER`, `PARENT`, `STUDENT`, `FINANCE_MANAGER`, `CASHIER`.
- Les modules d'abonnement (`PlatformModule`, `PlanModule`, `SchoolModuleOverride`) peuvent couper une permission. Les quotas `maxStudents` et `maxUsers` sont appliqués dans `src/lib/services/platform/modules.ts`.

### Sécurité observée dans le code (non rejouée de bout en bout)

- Verrouillage de compte après échecs (`User.lockedUntil`) et throttle mémoire (`src/lib/auth/ratelimit.ts`). Le throttle mémoire n'est pas partagé entre plusieurs instances : risque documenté si l'application est un jour multi-processus. Le déploiement PM2 prévu est mono-instance.
- `/api/cron` exige `CRON_SECRET`. Le vhost Nginx limite cette route à localhost (`deploy/nginx/preprod.ecomschool.fr.conf`, même principe pour la prod).
- En-têtes observés sur les deux domaines le 14 novembre 2026 : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS `max-age=63072000`.
- Secrets de prestataires résolus en mémoire (`src/lib/services/payments/providers/secrets.ts`), pas stockés en clair dans le schéma au-delà d'une référence.
- `docs/phase10-audit.md` (11 octobre 2026) signalait l'absence d'anti-brute-force, la suppression physique des annonces et l'absence de reset de mot de passe. Le code ultérieur contient le verrou, l'archivage et `/reset-password`. Ce rapport d'octobre ne décrit plus l'état de `ec62b59`.

---

## 3. Inventaire fonctionnel

Légende d'état utilisée partout :

| État | Sens dans cet audit |
|---|---|
| Code complet + recette versionnée | Modèle, service, page et script de recette présents. **La recette n'a pas été relancée le 14 novembre 2026.** |
| Partiel | Le parcours existe avec une limite explicite dans le code. |
| Backend / route seule | Service ou route sans entrée de menu. |
| Absent | Aucune occurrence utile dans `ec62b59`. |
| Non vérifiable | L'environnement déployé ne publie pas l'information. |

### A. Gestion scolaire

| Domaine | État | Preuve |
|---|---|---|
| Établissement, paramètres, type `PRIMARY/MIDDLE/HIGH/MIXED/OTHER` | Code complet + recette versionnée | `School`, `/app/settings`, `src/lib/services/schools.ts` |
| Années et périodes (trimestre, semestre, autre) | Code complet + recette versionnée | `AcademicYear`, `AcademicPeriod`, `/app/academic-years` |
| Niveaux et classes | Code complet + recette versionnée | `Level`, `Classroom`, `/app/levels`, `/app/classrooms` |
| Matières et coefficients | Code complet + recette versionnée | `Subject`, `LevelSubject`, `ClassroomSubject` |
| Programme officiel (référentiel national, progressions de cours) | Absent | Pas de modèle de programme. `CourseContent` est un contenu de séance. `/app/courses` redirige vers l'emploi du temps. |
| Élèves, tuteurs, inscriptions | Code complet + recette versionnée | `Student`, `Guardian`, `Enrollment`, imports `/app/students/import` |
| Admissions et conversion en inscription | Code complet + recette versionnée | `AdmissionCampaign`, `AdmissionApplication`, `src/lib/services/admissions.ts`, `admissionConversion.ts`, portail `/candidature`, scripts `scripts/g2/` |
| Réinscriptions | Code complet + recette versionnée | `ReenrollmentCampaign`, `src/lib/services/reenrollment.ts` |
| Emplois du temps, salles, séances | Code complet + recette versionnée | `Room`, `CourseSchedule`, `CourseSession`, `/app/schedules` |
| Enseignants et affectations **pédagogiques** | Code complet + recette versionnée | `Teacher` (prénom, nom, e-mail, téléphone, statut, lien `User`), `TeachingAssignment`. Ce n'est pas un dossier RH. |
| Absences et retards **des élèves** | Code complet + recette versionnée | `AttendanceRecord`, `/app/attendance`, portail enseignant |
| Notes, moyennes, classements, règles | Code complet + recette versionnée | `Assessment`, `Grade`, `SubjectPeriodResult`, `StudentPeriodResult`, `GradingPolicy` |
| Bulletins PDF | Code complet + recette versionnée | `ReportCard`, gabarits `primary` / `college` / `lycee` / `standard` (`docs/f2e4-audit-cycles-scolaires.md` et `src/lib/pdf`) |
| Délibérations | Code complet + recette versionnée | `DeliberationSession`, `DeliberationDecision`, `scripts/h5/` |
| Passage, redoublement, orientation | Code complet + recette versionnée | `deliberations.ts` écrit `StudentAnnualResult.decision` et `progression` (lignes 1047 et 1121). `scripts/h6/`. Le rapport F2-E4 du 18 octobre 2026, qui disait ce champ jamais écrit, est périmé. |
| Documents administratifs (attestation, certificat, carte, QR) | Backend + page **hors menu** | `AdministrativeDocument`, `/app/documents-administratifs`, vérificateur public `/verifier/[code]`. Absent de `appNav`. Visible côté parent (`src/app/parent/page.tsx`). `scripts/g4/`. |
| Portails parent, élève, enseignant | Code complet + recette versionnée | `/parent`, `/student`, `/teacher`. Consultation (notes, finances parent, demandes). Pas de devoirs en ligne. |
| Annonces et notifications internes | Code complet + recette versionnée | `Announcement`, `Notification`, `/app/announcements`, `/app/notifications` |
| Messagerie | Partiel | `SchoolMessage` + file `Job`. Émission. Pas de réponse entrante. Canaux externes dépendants de variables d'environnement. |
| Cycles et séries | Partiel | Niveaux en liste plate. Séries de lycée = nom de niveau ou `Classroom.section` libre. Pas d'entité `Cycle` ni `Serie`. |
| Maternelle dédiée | Absent | Lot H14 encore dans `docs/strategie-produit/roadmap-priorisee.md`, non implémenté. |

### B. Finances et comptabilité

Voir le rapport dédié `AUDIT_RH_COMPTABILITE_360.md`. Résumé :

- La **gestion des frais, de la caisse, des impayés, des dépenses et de la trésorerie de flux** est développée, avec recettes versionnées (`scripts/phase7`, `scripts/f3`, `scripts/g3`).
- La **comptabilité** (lot H12) génère des écritures de partie double à partir des paiements, annulations, remboursements et dépenses payées. Elle affiche une balance et exporte des journaux CSV. Elle n'est pas une comptabilité générale SYSCOHADA complète.
- Relances d'impayés : notifications **internes** (`FeeReminder`). Pas de SMS prouvé.

### C. Ressources humaines

**Module RH absent.** Détail dans `AUDIT_RH_COMPTABILITE_360.md`.  
`Teacher` est un annuaire pédagogique. Les salaires, s'ils sont suivis, le sont comme lignes de `Expense` (cadrage `docs/f3a-cadrage-depenses-tresorerie.md`, toujours vrai dans le schéma : aucun modèle `Payroll`, `Contract`, `Leave`).

### D. Université

**Absente en tant que produit.** `SchoolType` s'arrête à `PRIMARY | MIDDLE | HIGH | MIXED | OTHER`. Aucun modèle faculté, département, filière, UE, crédit, stage ou mémoire. La roadmap interne classe H15 « enseignement supérieur » en vision cible, produit dérivé. Un champ texte de candidature peut porter le mot « filière » ; ce n'est pas un référentiel.

Le semestre scolaire (`AcademicPeriodType.SEMESTER`) est un découpage d'année d'établissement, pas un semestre LMD.

### E. Administration SaaS

| Fonction | État | Preuve |
|---|---|---|
| Multi-établissements et cloisonnement | Code complet + specs e2e versionnées | `SchoolMembership`, `e2e/security.spec.ts`, `e2e/nav-rbac.spec.ts` |
| Utilisateurs, rôles, permissions | Code complet | `Role`, `Permission`, `UserRole`, `docs/permissions.md` |
| Plans, modules activables, quotas | Code complet | `SubscriptionPlan.maxStudents` / `maxUsers`, `src/lib/services/platform/modules.ts` |
| Facturation des établissements clients | Code complet | `PlatformInvoice`, `PlatformPayment`, `PlatformCreditNote`, `/platform/invoices` |
| Supervision, automatisations, audit | Code complet | `/platform/monitoring`, `/platform/automations`, `/platform/audit`, `AuditLog` |
| Sauvegardes | Scripts présents et testés en stub | `deploy/scripts/backup.sh`, `restore.sh`, `restore-verify.sh`. **39/39** checks de `deploy/tests/run.sh` passés le 14 novembre 2026 (sans VPS, sans base réelle). Restauration sur le serveur de production : non vérifiée. |
| Journalisation | Code complet | `src/lib/services/audit.ts` |
| Paramétrage par établissement | Code complet | `/app/settings` |
| Demandes d'inscription d'établissement | Code complet | `SchoolSignupRequest`, `/inscription`, `/platform/signup-requests` |
| Groupe scolaire / consolidation multi-sites | Absent | Lot H7 non implémenté. Pas de modèle `SchoolGroup`. |

### F. Paiements et communications

| Intégration | État réel | Preuve |
|---|---|---|
| Espèces, virement, chèque, autre | Code complet + recette versionnée | `PaymentMethod`, `src/lib/services/finance/payments.ts` |
| Orange Money et Moov Money **au guichet** (référence saisie, pas d'appel opérateur) | Code complet + recette versionnée | `src/lib/services/finance/manualMobileMoney.ts`, `scripts/g3/manual-momo-recette.ts` |
| Orange Money API directe | Absente | Aucun adaptateur Orange. L'opérateur est un enum de saisie manuelle. |
| Moov Money API directe | Absente | Idem. |
| PayDunya | Adaptateur codé, inerte sans verrou et secrets | `src/lib/services/payments/providers/paydunya.ts`, `index.ts` (« enregistré mais inerte »). Recettes `scripts/g3/`. Aucune preuve d'appel LIVE réussi en production. |
| Simulateur sandbox | Code complet | `payments/providers/sandbox.ts`. Les prestataires `SANDBOX` ne sortent pas sur le réseau. |
| Webhooks, rapprochement, reversements, remboursements | Code complet + recettes versionnées | `webhooks.ts`, `reconciliation.ts`, `refunds.ts`, modèles `PaymentIntent`, `WebhookEvent`, `PaymentReconciliation`, `PaymentSettlement`, `PaymentRefund` |
| Verrou des paiements réels | Présent | `isLivePaymentsEnabled()` vrai seulement si `MOBILE_MONEY_LIVE_ENABLED=true`. `isRemoteTestEnabled()` distinct. L'état de ces variables **sur le serveur** n'est pas lisible depuis ici. |
| SMS | Code prêt, non prouvé configuré | `SMS_PROVIDER_URL` + `SMS_PROVIDER_TOKEN`. Passerelle HTTP générique, pas un opérateur nommé. |
| E-mail | Code prêt, non prouvé configuré | `EMAIL_PROVIDER_URL`. Pas de Resend/SMTP nommé dans le code. |
| WhatsApp | Code Meta + mode dry-run | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Si `WHATSAPP_DRY_RUN=1`, aucune requête Meta, `providerRef = DRYRUN`. |
| Notifications internes | Code complet | `Notification`, centre `/app/notifications` |
| Alerting d'exploitation | Code présent, activation serveur non vérifiable | `deploy/scripts/lib.sh` envoie un JSON `{"content":...}` vers `ALERT_WEBHOOK_URL` (format compatible Discord). Sans variable, le moniteur journalise qu'aucun canal n'est configuré. |

---

## 4. Fonctionnalités dans le code et peu accessibles

| Élément | Constat |
|---|---|
| `/app/documents-administratifs` | Page et actions complètes. Absente de `appNav`. Accessible par URL et, en lecture, dans le portail parent. |
| Grand livre CSV | `exportCsv(..., "ledger")` et la route `/app/comptabilite/export?kind=ledger&account=`. La page ne propose que journal et balance. |
| Écriture manuelle | `createManualEntry` dans `accounting.ts` uniquement. Aucun appel depuis `src/app`. |
| `/app/courses` | Redirection permanente vers `/app/schedules`. |
| `/app/preferences` | Page réelle, liée depuis les notifications, pas depuis le menu principal. |
| `/app/fees/unpaid`, `/app/fees/payments`, `/app/fees/accounts`, `/app/fees/settings` | Pages présentes. Le menu pointe vers `/app/fees` ; les sous-pages sont atteintes depuis l'écran Finances (liens internes). |
| Ancien rapport « comptabilité absente » | `docs/strategie-produit/inventaire-fonctionnel.md` section G. Contredit par H12. |

---

## 5. Tests

### Ce qui existe

- **Playwright** : `e2e/*.spec.ts` (sécurité, navigation RBAC, imports, exports, inscriptions, annonces, rôles démo, UX P6). `playwright.config.ts` présent. Pas de script npm `test`.
- **Recettes métier** : scripts `tsx` par lot, de `scripts/phase2` à `scripts/h12`, plus `g2`, `g3`, `g4`. Elles exigent une base déjà migrée et des variables d'environnement.
- **Scripts de déploiement** : `deploy/tests/run.sh` — stubs, sans base et sans VPS.

### Ce qui a été exécuté le 14 novembre 2026

| Commande | Résultat |
|---|---|
| `bash deploy/tests/run.sh` (sur l'arbre `ec62b59`) | **39 PASS / 0 FAIL** — sauvegarde, restauration témoin, moniteur, healthcheck, en environnement simulé |
| Recettes Prisma / Playwright / `tsc` | **Non lancées.** Elles exigent `npm ci`, une base et `prisma migrate`. La consigne d'audit interdit les migrations. Aucun PostgreSQL de projet n'a été créé. |

### Ce que disent les documents, sans rejeu

`docs/production-checklist.md` coche « E2E Playwright 30/30 » et « typecheck / lint / build » à la date de la phase 10 (octobre 2026). Des centaines de commits G et H ont suivi. Ces coches ne couvrent pas l'état `ec62b59` tant qu'une recette n'est pas relancée.

---

## 6. Déploiement

### Écart local / distant / déployé

| Emplacement | Contenu | Écart |
|---|---|---|
| Copie de travail locale et `origin/main` | Identiques. `9811e0a`. Socle : auth, écoles, utilisateurs, années, périodes. 13 commits. | 202 commits derrière le produit. |
| `origin/phase-10-production-readiness` | Produit complet décrit ici. `ec62b59`. | Non fusionné dans `main`. Aucune pull request de fusion ouverte. |
| `origin/phase-2-multitenant` | 100 fichiers, 11 octobre 2026. | Ancêtre, dépassé par la phase 10. |
| `origin/devin/1794223531-manuel-utilisateur` | Phase 10 + manuel `docs/manuel-utilisateur/` (texte + 41 captures). | PR #1 ouverte, non fusionnée. Documentation seule. |
| `https://preprod.ecomschool.fr` | HTTP 200, Nginx 1.24, Next.js, titre « ECOM-SCHOOL — Pilotez votre établissement… », `/login` 200. | SHA exact **non vérifiable** (pas de route de version). |
| `https://ecomschool.fr` | Même titre, **mêmes 10 empreintes de chunks** que la préproduction au sondage de 15 h 54 (Europe/Paris). `www` redirige en 301. | Même limite sur le SHA. Les deux hôtes semblent servir **le même build** à cet instant. |
| Port 3001 public de l'IP documentée dans `deploy/README.md` | Timeout. | Cohérent avec l'écoute `127.0.0.1` décrite dans le guide. Ce n'est pas une preuve que le processus tourne ou ne tourne pas. |
| Routes `/app/rh` et `/app/paie` sur la préproduction | HTTP 404. | Le build servi n'a pas de module RH. Cohérent avec le code de `ec62b59`. |
| `/app/comptabilite` et `/app/documents-administratifs` | HTTP 200 (coquille Next, chargement). | Les routes existent dans le build. L'accès authentifié n'a pas été testé : aucun identifiant n'a été utilisé. |

`deploy/README.md` décrit un VPS, des releases versionnées, `prisma migrate deploy` au déploiement, PM2, cron et sauvegardes. `docs/preprod-deploy-audit.md` est un audit **de préparation** (il liste encore des décisions « avant déploiement » et pointe un commit antérieur `f6b3260`). Le fait que les domaines répondent le 14 novembre 2026 prouve qu'un déploiement a eu lieu après ce document. Il ne prouve pas que les sauvegardes hors site, le cron et le webhook d'alerte sont actifs.

### Fonctionnalités développées et peut-être non déployées

Impossible à trancher sans le SHA de la release. Si le build en ligne est antérieur à `ec62b59` (8 novembre 2026), les derniers correctifs (durcissement comptable H12, alerting, ressources prod) peuvent manquer. Si le build est ce commit ou le manuel du 9 novembre, le fonctionnel est le même : le manuel ne change pas l'application.

---

## 7. Qualité et commercialisation

### Peut-on commercialiser aujourd'hui ?

**Pas comme ERP 360°.**  
**Pas sans une recette fraîche et une décision de branche**, même pour une première offre « gestion scolaire + frais ».

Le cœur scolaire et la caisse sont assez avancés pour une **offre limitée** (établissement du primaire au lycée, frais, notes, bulletins, portails de consultation), à condition de traiter les bloquants ci-dessous. Les modules avancés (RH, paie, comptabilité certifiable, LMD, Mobile Money live, SMS) doivent rester hors promesse commerciale.

### Grille

| Critère | Constat | Bloquant pour une première offre scolaire ? |
|---|---|---|
| Stabilité | Beaucoup de durcissements versionnés (atomicité, idempotence). Pas de CI. Recette non relancée ici. | Oui, tant que la recette n'est pas rejouée sur la préproduction actuelle. |
| Parcours complets | Rentrée → inscription → notes → bulletin → délibération → encaissement : les pages et services s'enchaînent. | Non, sous réserve de recette. |
| Documents administratifs | Parcours staff dépend d'une URL non menu. | Oui, correctif petit, à faire avant démo direction. |
| Sécurité des données | Cloisonnement et RBAC structurés. Checklist juridique ouverte (mineurs). | Le juridique est bloquant pour une mise en production nominative, pas pour une préproduction de recette. |
| Erreurs | Libellés centralisés `src/lib/ui/errorLabels.ts`. | Non. |
| Sauvegardes | Scripts et tests stub OK. Preuve d'exploitation réelle absente. | Oui avant clients payants. |
| Performances | `docs/phase10-performance.md` mesure un banc ancien. Pas de mesure sur le VPS dans cet audit. | À rejouer, pas un stop immédiat. |
| Mobile | Revues UX P6 et captures 320 px dans `docs/recette/`. Pas de PWA (`manifest` non recherché comme livré ; le lot H2 est encore dans la roadmap stratégique). | Non pour un pilote. Oui si la promesse est « mobile d'abord ». |
| Fiabilité financière | Encaissements entiers XOF, idempotence, reçus snapshot, clôture de caisse. Comptabilité non certifiable. | Bloquant si le contrat promet une comptabilité OHADA. Acceptable si le contrat limite la promesse à la caisse scolaire. |
| PDF et Excel | pdfkit et exceljs branchés (reçus, bulletins, rapports, factures plateforme). Qualité visuelle non rejouée ici. | Recette visuelle à refaire. |
| Permissions | Menu filtré par les mêmes clés que les pages. Écart connu : documents administratifs. | Correctif ciblé. |
| Tests | Riches et manuels. | Industrialiser (CI) avant plusieurs clients. |
| Préproduction | Le site répond. Exploitabilité quotidienne (cron, backup, alerte, compte admin) non prouvée dans cet audit. | À vérifier sur le serveur, sans y déployer depuis cet audit. |

### Indispensable pour une première commercialisation

1. Fusionner ou désigner officiellement `phase-10-production-readiness` comme branche de release, et faire pointer `main` dessus.
2. Rejouer typecheck, lint, build, recettes critiques (scolarité, finances, délibérations, caisse) et un parcours Playwright sur la préproduction.
3. Rendre les documents administratifs visibles dans le menu.
4. Vérifier sauvegarde, cron et restauration témoin **sur le VPS** (les scripts existent ; l'exécution réelle n'a pas été vue).
5. Rédiger la promesse commerciale : scolaire + caisse, explicitement sans paie, sans bilan, sans LMD, sans Mobile Money automatique tant que le verrou live n'est pas recetté.
6. Traiter la politique de confidentialité et le registre des traitements avant d'héberger des élèves réels.
7. Remplacer le README `create-next-app`.

### Reportable après les premiers établissements

RH, paie, comptabilité générale, LMD, maternelle par compétences, cantine, transport, PWA, messagerie bidirectionnelle, rapprochement bancaire, groupe scolaire.

---

## 8. Conclusion — réponses explicites

1. **ECOM-SCHOOL est-il un ERP scolaire 360° ?**  
   Non. C'est une plateforme de gestion scolaire et de caisse, multi-établissements, avec une amorce de comptabilité d'encaissements. L'administratif RH, la paie et la comptabilité générale n'y sont pas.

2. **Dispose-t-il d'un module RH complet ?**  
   Non. Il dispose d'un annuaire d'enseignants et d'affectations de cours. Indice de couverture du référentiel RH demandé : **4 %** (1,4 / 34, méthode dans `MATRICE_FONCTIONNELLE.md`).

3. **Dispose-t-il d'une comptabilité générale complète ?**  
   Non. Il dispose d'une génération d'écritures SYSCOHADA de démarrage (paiements, annulations, remboursements, dépenses) et d'une balance. Indice sur le référentiel « comptabilité générale » : **22 %** (2,65 / 12). L'indice « finances de scolarité » est de **85 %** (10,2 / 12).

4. **Peut-il gérer une école de la maternelle au lycée ?**  
   Du **primaire au lycée**, oui dans le code : niveaux libres, périodes, coefficients, bulletins par gabarit, délibérations, finances. La **maternelle** (suivi par compétences, sans notes) n'est pas développée. Les séries de lycée se contournent par le nom du niveau. Le type d'établissement est déclaratif et ne change pas le comportement.

5. **Peut-il gérer un institut supérieur ou une université ?**  
   Non. Indice sur le référentiel universitaire demandé : **7 %** (0,8 / 12 : texte libre, semestre scolaire et bulletins réutilisables, rien du LMD).

6. **Peut-on déjà commercialiser la plateforme ?**  
   Pas dans l'état de branche et de preuve actuelle, et pas sous l'étiquette 360°. Une offre bornée « gestion scolaire + frais », après recette sur la préproduction et mise à jour de `main`, est le seul périmètre défendable. Les domaines `https://preprod.ecomschool.fr` et `https://ecomschool.fr` répondent déjà ; cela ne remplace pas la recette ni le cadrage contractuel.

7. **Dix prochaines actions**

   1. Décider que `phase-10-production-readiness` (plus le manuel de la PR #1 si on le retient) devient la ligne de release, et mettre `main` à jour. Ne pas redévelopper par-dessus `9811e0a`.
   2. Identifier le SHA réellement servi sur `ecomschool.fr` et `preprod.ecomschool.fr` (release PM2 / `git rev-parse` sur le serveur).
   3. Rejouer sur une base jetable, hors production : `npm run typecheck`, `npm run lint`, `npm run build`, puis les recettes `scripts/h5`, `scripts/h6`, `scripts/h12`, `scripts/g2`, `scripts/g3`, `scripts/phase7`.
   4. Vérifier cron, sauvegarde du jour et dernier `restore-verify` sur le VPS. Ne pas restaurer la base active.
   5. Ajouter « Documents administratifs » au menu `appNav`, avec la permission `administrative-docs.read`.
   6. Écrire un README produit et une page « ce que le contrat couvre / ne couvre pas ».
   7. Mettre un workflow CI minimal (typecheck, lint, recettes sans secrets) — il n'en existe aucun.
   8. Clore les cases ouvertes de `docs/production-checklist.md` qui conditionnent des élèves réels (confidentialité, rétention, alertes).
   9. Geler le périmètre comptable vendable : caisse + exports + balance de démarrage, jusqu'à bilan et compte de résultat.
   10. N'ouvrir le chantier RH / paie qu'après les points 1 à 5. Le schéma actuel n'a aucune fondation salarié à étendre : ce sera un domaine nouveau, branché ensuite sur `Expense` et `AccountingEntry`.

---

## 9. Méthode et limites

**Faits vérifiés :** lecture du schéma, des services, des menus, des routes, des scripts, des documents de déploiement ; comparaison git des branches ; sondages HTTP ; `deploy/tests/run.sh`.

**Hypothèses :** le build en ligne est proche de `ec62b59` parce que les routes comptabilité et documents administratifs répondent et que les routes RH répondent 404, et parce que les chunks des deux domaines coïncident. Ce n'est pas une identification de commit.

**Non vérifiable depuis cet environnement :** contenu de la base préproduction ou production, valeur des variables `MOBILE_MONEY_LIVE_ENABLED`, `SMS_PROVIDER_URL`, `ALERT_WEBHOOK_URL`, succès réel des sauvegardes nocturnes, identité des établissements déjà saisis, résultat d'une connexion utilisateur.

**Interdit et respecté :** aucune modification applicative, aucune migration, aucun déploiement, aucun secret publié, aucune donnée supprimée.
