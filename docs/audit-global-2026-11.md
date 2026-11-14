# Audit global fonctionnel et technique — ECOM-SCHOOL (v2 consolidée)

**Date :** 2026-11-08 · **Release :** `20261108_095415` · **Migrations :** 55/55 · **Next.js :** 16.4.1
**Portée :** lecture seule. **v2 :** décompte corrigé (32 modules = 22 C + 8 P + 2 M) et preuves techniques par module.

Sources : `prisma/schema.prisma`, `src/lib/services/` (33), routes App Router (120 du build), `src/app/app/(tenant)/` (40 pages), `src/app/platform/` (16), portails, `scripts/` (recettes a2→h12), `deploy/scripts/`, RBAC/auth, `npm audit --omit=dev`.

---

## 1. Inventaire exhaustif — 32 modules (22 COMPLET · 8 PARTIEL · 2 MANQUANT)

État : **C** = COMPLET · **P** = PARTIEL · **M** = MANQUANT.
Preuve = service · routes · modèles clés · recettes.

| # | Module | État | Preuves techniques | Manques / risques | Prio·Effort |
|---|---|---|---|---|---|
| 1 | Admin SaaS & abonnements plateforme | C | `services/platform/*` · `/platform/{plans,subscriptions,invoices,schools,administrators,automations,monitoring}` · PlatformPlan, PlatformSubscription, PlatformInvoice, PlatformPayment · scripts a2/a3/phase* | Paiement abonnements manuel | P2·S |
| 2 | Onboarding école + signup public | C | `schools.ts` (provisionne admin via rôle global `ADMIN_SCHOOL` — `schools.ts:203-227`) · `/platform/{signup-requests,onboarding}`, `/app/onboarding` · SignupRequest · scripts a2/a3 | Le rôle global reçoit les nouvelles clés par bootstrap **au déploiement** (`scripts/h*/bootstrap-*.ts`) — aucune action par école requise | P2·S (documenter) |
| 3 | Multi-établissements / isolation | C | `schoolId` sur tous modèles métier · isolation prouvée école B dans chaque recette (H5/H6/H12/G3-C/G2-E) | — | — |
| 4 | Paramétrage école | C | `schools.ts`, `/app/{schools,settings}` · School (logo pour PDF) | — | — |
| 5 | Années/cycles/niveaux/classes/salles | C | `academic.ts`, `classes.ts`, `rooms.ts` · `/app/{academic-years,levels,classrooms,rooms}` · AcademicYear, AcademicPeriod, Level.order, Classroom | — | — |
| 6 | Admissions | C | `admissions.ts`, `admissionConversion.ts` · `/app/admissions`, `/candidature` public + pièces par token · AdmissionCampaign/Application · G2-E 91 | — | — |
| 7 | Inscriptions / guichet | C | `enrollments.ts`, `registration.ts` · `/app/{enrollments,fees/registration}` · Enrollment unique studentId+yearId | — | — |
| 8 | Élèves | C | `students.ts` · `/app/students`, import/export CSV · Student | — | — |
| 9 | Parents / responsables légaux | C | `guardians.ts` · `/app/guardians` · Guardian + lien élève | — | — |
| 10 | Enseignants & personnel | P | `teachers.ts`, `users.ts` · `/app/{teachers,users}`, `/app/courses` (affectations matières) · Teacher, User, Membership | Pas de fiche RH/contrat/approbations | P2·M |
| 11 | Emplois du temps | P | `schedules.ts` · `/app/schedules` · TimetableEntry, Room | Détection conflits non vérifiée en audit | P2·S |
| 12 | Présences/absences/retards | P | `attendance.ts` · `/app/attendance` + justifications parent (H1) · Attendance | Pas de stats/extracts avancés | P2·S |
| 13 | Notes/évaluations/moyennes | C | `grading/*` · `/app/{grades,grading-policy,averages,results}` · Grade, GradingPolicy, ComputedAverage+Rank | — | intégrité 34, F2E |
| 14 | Bulletins | C | report-cards service + PDF versionnés, rectifications tracées · `/app/report-cards` | — | F2E, H5 117 |
| 15 | Délibérations | C | `deliberations.ts` · `/app/deliberations` · DeliberationSession/Rule/Decision, PV DOC-*, CSV | — | H5 117 |
| 16 | Passage/redoublement/orientation | C | `deliberations.ts`+`reenrollment.ts` · progression structurée StudentAnnualResult.progression · H6 110 | — | — |
| 17 | Réinscription | C | `reenrollment.ts` · `/app/reinscriptions` · ReenrollmentCampaign/Request, conflits RETRACTED/MODIFIED | — | G2-E 91 |
| 18 | Frais scolaires & échéanciers | C | `finance/*` · `/app/fees` · FeeCategory/Tariff/Charge/Installment/Discount | — | G2-E |
| 19 | Encaissements & remboursements | C | `finance/*` reçus PDF+numérotation, PaymentRefund REQUESTED→CONFIRMED · `/app/fees` | Exécution refund manuelle (pas de rail) | — |
| 20 | Mobile Money | P | `finance/manualMobileMoney.ts`, `payments/*` (intents, idempotence, réconciliation, divergences) · `/app/paiements-mobile` · **sandbox+manuel, aucun LIVE** | Rail live absent (par design, lot I4) | P1·L |
| 21 | Dépenses & trésorerie | C | expenses DRAFT→PAID→CANCELLED, CashClosure unique/jour, `dashboard.ts` · `/app/{expenses,treasury}` | — | G3-C 71 |
| 22 | Comptabilité & exports | C | `accounting.ts` · `/app/comptabilite[/export]` · AccountingAccount/Journal/Exercise/Entry(+lines)/Mapping · H12 68 | Compta de trésorerie ; créances à l'émission = choix fonctionnel | — |
| 23 | Documents administratifs | C | `administrative-docs.ts` · `/app/documents-administratifs`, `/verifier/[code]` public · numérotation DOC, filigrane TEST | — | G4 46 |
| 24 | Communication & messagerie interne | P | `comm/*`, `notifications.ts`, `announcements.ts` · `/app/{announcements,notifications,messages}` · Notification, Message, Announcement | **Pas de canal sortant email/SMS** | P1·M |
| 25 | Portail parent | C | `portal/*`, `parent-requests.ts` · `/parent/{page,receipts,report-cards,documents}`, `/app/demandes` (file admin) · H1 62, G3-C | — | — |
| 26 | Portail enseignant | P | `/teacher/page` (accueil seul) | **Saisie notes/présences self-service absente** | P1·M |
| 27 | Portail élève | P | `/student/{page,report-cards}` · bulletins PDF | Pas de calendrier/ressources/détail résultats | P2·M |
| 28 | Rapports & dashboards | C | `dashboard.ts` · `/app/fees/reports`+export, `/app/{averages,results}`, trésorerie | — | partiels |
| 29 | Gestion documentaire fichiers | C | `documents.ts` · `/app/documents/[id]/download` permissionné, pièces par token · Document | — | G4 |
| 30 | Sécurité / RBAC / audit | C | `permissions/rbac.ts`, `auth/{options,ratelimit}.ts`, `audit.ts` · Role/RolePermission/Permission, AuditLog, lockedUntil | — | toutes recettes |
| 31 | Sauvegardes/restauration/supervision | P | `deploy/scripts/{backup,backup-uploads,restore,restore-verify,monitor,healthcheck}.sh` · dumps SHA-256 + rétention | Restauration non testée en récurrence ; pas d'alerting | P1·S |
| 32 | RH/paie | M | Aucun service/modèle | Hors périmètre actuel — lot J3 | P3·L |

Modules sectoriels absents (regroupés en #32bis dans le plan, hors inventaire produit actuel) : cantine, transport, bibliothèque, internat — aucun modèle.

## 2. Parcours transversaux

| Parcours | État | Ruptures / manuels |
|---|---|---|
| A. École→abonnement→config→1er utilisateur | P | Signup→approbation→école→admin global `ADMIN_SCHOOL` provisionné automatiquement. **Manuels :** activation modules d'abonnement, doc de la procédure bootstrap permissions (une fois par déploiement, rôle global partagé) |
| B. Admission→inscription→frais→paiement→reçu→compta | C | Complet — `generateEntries` explicite (voulu) |
| C. Enseignant→affectation→EDT→notes→bulletin | P | **Rupture : saisie par profil admin/pédagogique, pas de portail enseignant** |
| D. Présence→absence→justification→traitement | C | Attendance→demande H1→`/app/demandes` |
| E. Résultats→délibération→passage→réinscription | C | H5→H6→G2-E complet, réconciliation explicite |
| F. Annulation→remboursement→contre-passation | C | Miroir PAYMENT_CANCEL + reprise refund ; exécution réelle manuelle |
| G. Parent→rattachement→consultation | C | Guardian→lien→portail (finances, bulletins, demandes) |
| H. Fin d'année→clôtures→année suivante | P | Year CLOSED bloque saisie ; exercice compta CLOSED bloque écritures. **Manuels :** créer année+campagnes+exercice, finaliser réinscriptions — pas de clôture unifiée |

## 3. Sécurité et exploitation (vérifiée)

| Contrôle | Constat |
|---|---|
| Isolation multi-tenant | `schoolId` systématique ; prouvé école B dans H5/H6/H12/G3-C |
| Permissions serveur | `requireSchoolPermission`/`userHasSchoolPermission` — jamais UI-only |
| Authentification | JWT + throttle mémoire + `lockedUntil` persistant (8 échecs/15 min) + anti-énumération |
| Journalisation | `auditLog` sur toutes mutations sensibles |
| Fichiers/exports | Téléchargements permissionnés ; CSV anti-injection (H12 revue) ; BOM UTF-8 |
| Secrets | `.env` hors git ; aucun secret en code/recette |
| **Dépendances vulnérables** | **`npm audit --omit=dev` : 8 vulns prod** — `zod <4.6.6` (high, DoS mémoire validation — **runtime réel**), `deepmerge-ts` (high, via prisma config), `fast-uri` (moderate ×4), `mysql2` (high ×2 — **sans impact : PostgreSQL**, mysql2 non chargé), `uuid` via exceljs (moderate — usage v4 attendu). + dev-deps restantes |
| Sauvegardes | dump+uploads SHA-256 chaque déploiement, rétention 29 |
| Restauration | `restore-verify.sh` autonome — exécuté une fois, **pas de récurrence** |
| Préprod/prod | Séparées ; filigrane TEST hors prod |
| Paiements LIVE | Désactivés |
| Erreurs/supervision | `monitor.sh` + healthcheck ; erreurs routes gérées (`error.tsx` par segment) ; **pas d'alerte sortante** |

## 4. Analyse commerciale

| Offre | Périmètre réel | État |
|---|---|---|
| Essentiel | Élèves/classes/années + notes/bulletins + frais/encaissements + rapports + dépenses | **Prêt** |
| Pro | + Admissions, réinscriptions, délibérations, portail parent, docs G4, trésorerie | **Prêt** (sans notifications sortantes) |
| Premium | + Compta SYSCOHADA, MoMo LIVE, portail enseignant | **Partiel** — compta OK, rail live + portail enseignant absents |
| Sectoriel | Cantine/transport/internat/bibliothèque/RH | **Absent** |

## 5. Risques priorisés

| # | Risque | Prio |
|---|---|---|
| R1 | Pas de rail paiement LIVE | P1 |
| R2 | `zod` DoS + transitives prod à corriger (`npm audit fix`) | P1 |
| R3 | Notifications sortantes absentes | P1 |
| R4 | Portail enseignant minimal | P1 |
| R5 | Restauration non récurrente + pas d'alerting | P2 |
| R6 | Clôture/ouverture d'année multi-manuelle | P2 |
| R7 | Modules sectoriels absents | P3 |

## 6. Évaluation GO / NO-GO

**GO conditionnel pilote** (Essentiel+Pro, guichet manuel). Blocants commercialisation : R1 (rail live), R3 (notifications). Premium : NO-GO (R4+R1). Détails et checklist : `docs/plan-finalisation-2026-11.md`.
