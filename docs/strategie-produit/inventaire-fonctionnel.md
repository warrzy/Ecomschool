# Inventaire fonctionnel — ECOM-SCHOOL

> État au commit `a4ce423` (release préprod `20261022_163919`).
> Statuts : **✅ opérationnel+testé** · **🟡 développé-incomplet** · **🔶 backend-seul** · **❌ absent** · **◌ non vérifié**
> « Testé » = recette script (`scripts/`) ou spec Playwright (`e2e/`) effectivement exécutée.

## A. Admissions et inscriptions

| Fonctionnalité | Statut | Preuves |
|---|---|---|
| Portail public `/inscription` | 🟡 | Existe mais c'est le **signup B2B d'un établissement** (`SchoolSignupRequest`, honeypot, throttle IP, anti-doublon), pas une candidature élève. `src/app/inscription/`, `services/platform/signup-requests.ts` |
| Candidature élève sans compte | ❌ | Aucun modèle Application/Candidature |
| Création compte parent en ligne | ❌ | Comptes créés par invitation admin (`AccountInvite`, `/invite/[token]`) |
| Pièces justificatives | ❌ | **Aucun upload binaire** dans tout le codebase ; `photoUrl`/`logoUrl` = URL texte |
| Tests d'admission | ❌ | `Assessment` = évaluations internes en classe uniquement |
| Frais de candidature | 🟡 | `FeeCategory` générique peut porter « CANDIDATURE » mais sans workflow derrière |
| Liste d'attente | ❌ | |
| Inscription interne (guichet) | ✅ | `/app/fees/registration` — nouvel/existant en 1 transaction, alerte doublons, génération créances post-commit, réinscription idempotente. `services/registration.ts` |
| Affectation en classe | ✅ | Via `enrollment.classroomId`, transferts `transferStudent` (même année) |
| Réinscription en masse | 🟡 | Pas de fonction dédiée ; possible via import CSV colonne `classe` + guichet individuel |
| Réinscription en ligne par les parents | ❌ | Portail `/parent` 100 % lecture seule |
| Notifications d'admission | ❌ | |

## B. Administration scolaire

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Dossiers élèves CRUD | ✅ | `Student` matricule unique/école, archivage protégé, fiche complète (`students/[id]`) |
| Historique / parcours | ✅ | Section parcours + exports inscriptions |
| Redoublement | ❌ | Aucun indicateur `isRepeat` |
| Transferts / changement classe | ✅ | `transferStudent` transactionnel (même année) ; inter-écoles absent |
| Retrait / fin d'inscription | ✅ | `closeEnrollment` → WITHDRAWN/COMPLETED |
| Attestations / certificats / cartes scolaires | ❌ | Aucun template ni génération |
| Tuteurs et liens | ✅ | `Guardian`+`StudentGuardian` (FATHER/MOTHER/FINANCIAL/EMERGENCY), create-and-link |
| Classes / niveaux / salles | ✅ | `Classroom` (capacité, titulaire, archivage protégé), `Level`, `Room` ; **pas de modèle Cycle** (seulement `School.type`) |
| Années scolaires + périodes | ✅ | Génération auto périodes (trim/sem), `isLocked`, `setCurrentYear`, `closeYear` + pré-clôture |
| Affectations enseignants | ✅ | `TeachingAssignment`, `ClassroomSubject`, `LevelSubject` (coefficients) |
| Import/Export élèves | ✅ | Wizard CSV/XLSX signé HMAC, upsert matricule, `__EFFACER__`, enrollment + créances ; exports 2 niveaux de permission |
| Utilisateurs + rôles | ✅ | `SchoolMembership` + `UserRole`/`RolePermission`, invitations |
| Paramètres école | ✅ | nom, logo URL, type, système — `school.manage` |

## C. Pédagogie

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Matières + coefficients | ✅ | `Subject`, coefficients par niveau/classe |
| Programmes | ❌ | Substitut : coefficients LevelSubject/ClassroomSubject |
| Emplois du temps | ✅ | `CourseSchedule` récurrent + `CourseSession` datées, **détection conflits classe/enseignant/salle**, déplacement/annulation/remplacement, PDF hebdo 4 vues. Pas de génération en masse des séances (matérialisation à la demande) |
| Cahier de textes | ✅ | `CourseContent` 1:1 séance (thème, chapitre, devoirs-champ texte) |
| Devoirs assignés/rendus | ❌ | Champ texte seulement |
| Types d'évaluations | ✅ | INTERROGATION/DEVOIR/COMPOSITION/EXAMEN_BLANC + personnalisés |
| Workflow évaluation | ✅ | `DRAFT→OPEN→SUBMITTED→VALIDATED→PUBLISHED` + CANCELLED, verrous période/année, périmètre enseignant |
| Saisie notes | ✅ | grille, statuts ENTERED/MISSING/ABSENT/EXEMPT, barème contrôlé, import XLSX/CSV atomique |
| Révisions de notes | ✅ | `GradeRevision` auto à chaque modification |
| Règles de notation | ✅ | `GradingPolicy` versionnée : barème, arrondi, seuil, mentions, ex æquo, pondérations annuelles |
| Moyennes période + annuelles | ✅ | `computeAndStore` → `SubjectPeriodResult`/`StudentPeriodResult`, stats classe ; `decision` annuelle non saisissable en UI (🟡) |
| Bulletins | ✅ | `ReportCard`+`ReportCardVersion` snapshots immuables, templates par niveau (standard/primary/college/lycee), génération individuelle/classe, PDF A4 individuel+collectif |
| Publication / rectification | ✅ | `ResultValidation` DRAFT→CALCULATED→VALIDATED→PUBLISHED→RECTIFIED, motif obligatoire, notification parents |
| Conseils de classe / délibérations | 🟡 | Champs (`headTeacherNote`, `councilDecision`, `directionNote`, signature) éditables **par élève** ; pas de process collégial |
| Classements / rangs | ✅ | Rang général + par matière (SHARED/DENSE_RANK) |
| Rattrapages | ❌ | |

## D. Vie scolaire

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Appels présences | ✅ | Par séance (roster auto) + journalier, ABSENT/LATE, retards calculés |
| Justifications | ✅ | `justifyAttendance` → EXCUSED horodaté ; **parentales : ❌** (justification par l'école uniquement) |
| Alertes absence/retard | ✅ | Job différé (grâce 120 min, annulé si justifié) → notification interne parents/élève |
| Incidents / sanctions / discipline | ❌ | |
| Autorisations de sortie | ❌ | |
| Suivi éducatif / carnet de vie | ❌ | |

## E. Portails

| | Statut | Contenu |
|---|---|---|
| `/parent` | ✅ (lecture) | sélecteur enfant, EDT, notes/résultats **PUBLISHED uniquement**, bulletins PDF A4, absences, finances (charges/remises/échéances/paiements + reçus PDF A5), annonces, notifications |
| `/student` | ✅ (lecture) | profil, EDT, matières, notes PUBLISHED, résultats, bulletins PDF, absences, annonces ; **pas de finances** |
| `/teacher` | ✅ | dashboard (séances jour/semaine, appels à faire, contenus manquants), appel séance, saisie notes (périmètre affectations), cahier de textes |
| Messagerie bidirectionnelle | ❌ | `/app/messages` = émission admin uniquement |
| RDV parents-professeurs | ❌ | |
| Paiement en ligne (parent) | ❌ | |

## F. Finances scolaires

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Grilles de frais | ✅ | `FeeCategory` (8 défauts) + `FeeTariff` par année/niveau/classe, repricing archivé |
| Créances + échéanciers | ✅ | `StudentFeeCharge` unique élève/année/catégorie, `FeeInstallment` N tranches |
| Remises / bourses | ✅ | 6 types (FIXED/PERCENT/SCHOLARSHIP/EXEMPTION/FAMILY/EXCEPTIONAL), FIFO ; pas de remise ciblée par catégorie (🟡) |
| Paiements | ✅ | Serializable+retry, idempotence, FIFO ou allocations explicites (UI : FIFO seul 🟡), OVERPAYMENT refusé, reçu `REC-YYYY-#####` + snapshot immuable, annulation motivée non destructive |
| Clôture de caisse | ✅ | `CashClosure` mono-caisse, bloque encaissements et paiements de dépenses |
| Relances | ✅ | Manuelles (`remindUnpaid` → notification interne) + automatiques cron J-3/retards — **internes seulement, aucun SMS/WhatsApp** |
| Impayés / comptes / journal | ✅ | `/app/fees/unpaid` (retards, par classe, export, relance), `/app/fees/accounts`, `/app/fees/payments`, `/app/fees/my-payments` |
| Dépenses | ✅ | DRAFT→PAID/CANCELLED, paidAt conservé à l'annulation, idempotence stricte |
| Trésorerie | ✅ | `/app/treasury` — règles documentées (entrées=VALIDATED@paidAt, sorties=paidAt≠null), non certifié assumé |
| Rapports / exports | ✅ | F3-D : 6 rapports CSV/XLSX/PDF, troncature signalée 413, anti-injection |
| Mobile Money / paiement en ligne | ❌ | `MOBILE_MONEY` = enum sans intégration ; aucun gateway |
| Reçus par SMS/WhatsApp | ❌ | |
| Remboursements | ❌ | Choix documenté (aucune écriture de remboursement) |
| Multi-caisses / comptes bancaires | ❌ | Mono-caisse |

## G. Comptabilité générale — ❌ ABSENT

Aucun plan comptable, journal, écriture, grand livre, balance, OHADA/SYSCOHADA, immobilisations, budgets, fournisseurs, rapprochement bancaire. Périmètre assumé hors-scope dans `docs/f1-ecarts-et-recommandations.md`.

## H. RH & paie — ❌ ABSENT

`Teacher` = identité + contact + compte seulement. Aucun contrat, congé, pointage, bulletin de paie, vacataire, matricule paie. Salaires = simples lignes de dépense catégorisées.

## I. Services scolaires — ❌ ABSENT

Cantine, transport, bibliothèque, internat, infirmerie, stocks, maintenance : aucun module. CANTINE/TRANSPORT/SALAIRES existent comme **catégories de frais/dépenses** uniquement.

## J. Enseignement supérieur — ❌ ABSENT

Aucune faculté, UE, crédit LMD, stage, mémoire, soutenance.

## K. Communication

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Annonces | ✅ | audiences, programmation, archivage ; suppression interdite si publiée |
| Notifications internes | ✅ | centre, badge, dédup, événements métier |
| Messagerie multi-canal | ✅ (émission) | `SchoolMessage` 6 audiences × 4 canaux (INTERNAL/EMAIL/SMS/WHATSAPP), file `Job` retries/dedup/backoff, `MessageDelivery` avec erreurs détaillées |
| Providers externes | ◌ | EMAIL/SMS = HTTP générique ; WhatsApp = API Meta réelle mais `WHATSAPP_DRY_RUN=1` ; aucun envoi réel en préprod |
| Templates | ✅ | `MessageTemplate` `{{var}}` |
| Consentements | 🟡 | Opt-out appliqué ; consentement tuteur **déclaré par l'admin** sans `CommConsentEvent` de preuve |
| Accusés de réception | ❌ | `SENT` = en file, pas confirmé fournisseur |

## L. Direction & pilotage

| Fonctionnalité | Statut |
|---|---|
| Dashboard admin `/app` | ✅ KPI réels (inscrits, présences, évaluations, finances) |
| Dashboard finance + trésorerie + rapports | ✅ |
| Analytics par classe/cycle/site | 🟡 stats par classe dans moyennes ; pas de vue consolidée pilotage |
| Prévisions | ❌ |

## M. Administration SaaS

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Multitenancy + isolation | ✅ | schoolId partout, tests IDOR |
| RBAC | ✅ | 6 rôles école + 2 plateforme, permissions en base |
| Abonnements | ✅ | plans, modules V1/V2, overrides, statuts, limites élèves/utilisateurs |
| Signup → onboarding | ✅ | demande → revue → conversion atomique école+admin+abonnement |
| Facturation plateforme | ✅ | `PlatformInvoice` INV-YYYY-#####, paiements, avoirs, PDF, rappels auto |
| Support sessions | ◌ | avec autorisation école, TTL, audit — non testé e2e |
| Audit | ✅ | `AuditLog` + `/platform/audit` |
| Admins plateforme | 🟡 | page lecture seule |
| Monitoring / cron / rétention | ✅ | `/api/cron`, purge rétention, healthcheck |

## N. UX / transversal

| Élément | Statut |
|---|---|
| Design system maison + tokens | ✅ |
| Responsive mobile | ✅ (MobileNav, 267 utilitaires responsifs) |
| Accessibilité | ✅ (583 aria, skip-link, focus-trap, reduced-motion) |
| Pages publiques | ✅ (`/`, `/tarifs`, `/inscription`, login) |
| PWA / offline | ❌ |
| i18n | ❌ (fr en dur ; `School.locale` non lu) |
| Recherche globale | ❌ (listes seulement) |
| Dark mode | ❌ (quasi — bascule CSS racine cassée) |
| Apps mobiles natives | ❌ |
| Tests | ✅ e2e Playwright + ~100 recettes ; pas de tests unitaires |
| Infra | ✅ PM2 releases atomiques, nginx, backups SHA256, cron, rollback |

## Constats transverses

- Clés de permission mortes documentées : `finance.payments.validate` (pas de statut PENDING), `finance.manage`, `finance.payments.read`.
- `ResultStatus.PENDING_VALIDATION` jamais produit ; `allowMultipleEnrollments` inopérant.
- `SchoolMessage.SENT` = « en file », pas réception fournisseur.
