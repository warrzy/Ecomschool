# Audit recette ECOM-SCHOOL — 9 lots (octobre 2026)

Base : analyse du code (`phase-10-production-readiness @ 22f33aa`) + données
réelles `ecomschool_preprod`. Aucune modification effectuée.

Légende : ✅ fonctionnel · 🎨 ergonomie à améliorer · ⚠️ anomalie confirmée · ❌ absent.

---

## LOT 1 — RBAC : rôles, permissions, menus

### Matrice effective (extraite de la base préprod)

| Rôle | Périmètre réel | Permissions clés |
|---|---|---|
| `PLATFORM_OWNER` | plateforme | tout `platform.*` + `school.*` + `user.*` (17 perm.) |
| `PLATFORM_SALES` | plateforme | plans.read, subscriptions.manage/read, invoices.*, payments.manage, modules.manage — **pas** schools.* ni users.manage ni signup-requests |
| `ADMIN_SCHOOL` | école | intégralité des 68 permissions école |
| `TEACHER` | école | academic/classroom/subject/rooms/schedules/sessions/school `.read`, student.read, attendance.manage+read, assessments.create+read, grades.enter+read, results.read, reportcards.read+print, coursecontent.manage, announcements.read |
| `FINANCE_MANAGER` | école | tout `finance.*` (11 perm.) |
| `CASHIER` | école | finance.read, payments.create, receipts.print+read |
| `PARENT` | école | portal.parent, announcements.read |
| `STUDENT` | école | portal.student, announcements.read |

### État des gardes serveur — ✅ solide

- Chaque page `/app/(tenant)/*` exige sa permission (`requireSchoolPermission`), avec filtrage abonnement (`isPermissionCoveredBySubscription`).
- Chaque Server Action exige la permission d'écriture correspondante (`user.manage`, `student.manage`, `finance.*`, `announcements.manage`…).
- Portails : `/parent` → `portal.parent`, `/student` → `portal.student`, `/app` redirige PARENT/STUDENT vers leurs portails.
- Portée enseignant : `assertTeacherScope` limite la saisie de notes aux couples classe+matière affectés ; idem présences (`sessions/[id]`, `teacherIdForUser`).
- Isolation tenant : requêtes bornées `ctx.schoolId`, `assertSchoolResourceAccess` ; vérifiée en E2E (403/404 inter-écoles et intra-école).

### Anomalies confirmées

| # | Anomalie | Sévérité | Détail |
|---|---|---|---|
| A1 | **Navigation non filtrée** | 🔴 critique (UX) | `appNav` = 22 entrées statiques visibles par tous (un enseignant voit Utilisateurs, Finances, Règles de notation, Mon abonnement, Paramètres). Clic → redirection `/app`. Idem `platformNav` (13 entrées) pour PLATFORM_SALES. |
| A2 | `setAssessmentStatusAction` gardé par `assessments.read` | 🟡 mineur | Une permission *read* protège une action d'écriture (le service borne quand même par `asTeacher`). |
| A3 | `/app/notifications` n'exige pas `notifications.read` | 🟡 mineur | Page sous `requireSchoolContext` ; TEACHER n'a pas `notifications.read` mais peut ouvrir la page. |
| A4 | Portée `student.read` de l'enseignant = toute l'école | 🟡 à confirmer | La liste élèves n'est pas bornée aux classes de l'enseignant (lecture seule). Justification pédagogique possible — à valider. |
| A5 | `CASHIER` sans `finance.reports.read` | 🟡 à confirmer | Le caissier enregistre des paiements mais n'ouvre pas le journal `/app/fees/payments` ni `/app/fees/unpaid`. |
| A6 | `/teacher` accessible à tout membre école | 🟢 bénin | `requireSchoolContext` seul ; un parent/élève voit « compte non rattaché à une fiche enseignant ». Durcissement simple (rôle TEACHER requis). |
| A7 | Pages sous `requireSchoolContext` seul | 🟢 bénin | `courses` (placeholder), `preferences`, `sessions/[id]` — cohérent, à documenter. |

**Conclusion lot 1** : la sécurité serveur est correcte ; le défaut est la **visibilité** (menus/boutons non filtrés). Correction = filtrer `appNav`/`platformNav` par permission + audit des boutons dans les pages (pattern `canManage` déjà présent sur students).

---

## LOT 2 — Compte PLATFORM_OWNER (préprod)

| Élément | État |
|---|---|
| Compte | `benzywarren@gmail.com` — **unique**, ACTIVE, non verrouillé (1 échec), créé au bootstrap du 11/10 |
| Portail | `/login` → `/platform` (les rôles plateforme sont redirigés de `/app` vers `/platform`) |
| Accès | mot de passe initial = `PREPROD_PLATFORM_ADMIN_PASSWORD` dans `/var/www/ecomschool-preprod/shared/.env` (mode 600) |
| Permissions | les 17 permissions plateforme confirmées : écoles, demandes d'inscription, abonnements, admins, supervision, audit |
| Isolation | les comptes école n'ont aucune permission `platform.*` (vérifié : admin école → `/platform` refusé en recette) |

**Récupération si mot de passe perdu** (aucune réinitialisation faite) :
1. `ssh ecomschool-preprod`, `grep PREPROD_PLATFORM_ADMIN_PASSWORD shared/.env` — c'est le mot de passe initial.
2. Si modifié/oublié : flux `/reset-password` (nécessite le provider email — non configuré actuellement) **ou** script serveur `hashPassword()` + `user.update` sur ce seul compte, exécuté sous `deploy`.

---

## LOT 3 — Règles de notation

### Fonctionnement réel (vérifié dans `calculation.ts`, `policy.ts`, `results.ts`, `reportcards.ts`)

| Paramètre | Rôle réel |
|---|---|
| `academicYearId` | une politique par année scolaire |
| `levelId` | politique spécifique à un niveau (optionnel) — **prime sur** la politique générale de l'année (`orderBy levelId desc`) ; sinon `DEFAULT_RULES` (/20, seuil 10, HALF_UP…) |
| `maxScore` | barème de sortie : toutes les notes sont **normalisées** vers cette échelle (ex. 14/40 → 7/20) |
| `minScore` | valeur plancher appliquée quand une politique « zéro » s'applique (pas nécessairement 0) |
| `precision` | décimales de l'arrondi des moyennes |
| `rounding` | HALF_UP / FLOOR / CEIL, appliqué sur `precision` décimales |
| `passMark` | seuil de réussite — sert au **taux de réussite** (nombre d'élèves ≥ seuil, results.ts:230) |
| `missingGradePolicy` | note non saisie : `EXCLUDE` (ni note ni coefficient ne comptent) ou `ZERO` (= `minScore`, coefficient conservé) |
| `absentPolicy` | statut ABSENT : mêmes règles |
| `exemptPolicy` | statut EXEMPT (dispense) : mêmes règles |
| `tieRule` | SHARED_RANK (ex æquo partagent le rang, rangs suivants sautés : 1,2,2,4) ou DENSE_RANK (1,2,2,3) |
| `perSubjectRank` | calcule en plus un classement par matière (results.ts:213) |
| `mentions` | JSON `[{label,min}]` — mention la plus haute dont le seuil est atteint. **Saisie = texte brut** `Excellent:16;Très bien:14` (parsé dans l'action) |
| `annualWeights` | JSON `{periodId: coefficient}` pour la moyenne annuelle pondérée — **non exposé dans le formulaire** (champ mort côté UI) |
| `version` | compteur incrémenté à chaque mise à jour (même ligne `@@unique[academicYearId,levelId]` — **pas** de lignes d'historique séparées) |

- Moyenne de matière = Σ(note normalisée × coef évaluation) / Σ(coefs applicables) ; moyenne générale = même principe avec le coefficient de matière (`ClassroomSubject > LevelSubject > 1`).
- Bulletins : chaque publication stocke un **snapshot** dans `ReportCardVersion.payload` — une modification de politique ne touche jamais les bulletins publiés. ✅
- Cycle de vie : `status` ACTIVE/ARCHIVED existe en base mais **rien dans l'UI** (ni archivage, ni brouillon, ni suppression). Audit log sur create/update. ✅ partiel.

### Anomalies / manques confirmés

- ⚠️ **Formulaire = placeholders sans libellés** (`placeholder="Barème (max)"`, `defaultValue=20/0/2/10`), syntaxe mentions obscure, aucun regroupement ni aide.
- ⚠️ `annualWeights` configurable en service mais **inaccessible dans l'UI**.
- ❌ Pas de notice d'utilisation, pas de prévisualisation du calcul, pas de liste des versions (le compteur n'est pas un historique consultable).
- ❌ Pas d'état brouillon/désactivation en UI.

---

## LOT 4 — Annonces

| Capacité | État |
|---|---|
| Créer (titre, contenu, audience ALL/PARENTS/STUDENTS/TEACHERS) | ✅ `announcements.manage` |
| Publier immédiatement ou programmer (`scheduledAt`) | ✅ — programmation traitée par `runSchoolAutomations` via `/api/cron` (**cron non installé en préprod → ne se déclenche pas**) |
| Notification aux rôles de l'audience à la publication | ✅ `notifyAnnouncementPublished` |
| Archiver (soft-delete `archivedAt`, historique conservé) | ✅ |
| Modifier / supprimer | ❌ par conception (« jamais de suppression physique ») — cohérent avec la demande |

Anomalies : ⚠️ impossible d'**ouvrir une annonce** pour lire le contenu (la table n'affiche que le titre) ; ⚠️ les **archivées disparaissent sans trace** (`includeArchived` existe au service mais n'est jamais utilisé) ; 🎨 formulaire sans libellés ; ⚠️ statut affiché en texte brut (« Publiée le… ») sans badge.

---

## LOT 5 — Imports / exports / impression

| Module | Existant | Permission | Manquant |
|---|---|---|---|
| Élèves | ✅ export CSV (`/app/students/export`), ✅ import CSV (résumé créés/maj/échecs) | student.read / student.manage | xlsx, modèle téléchargeable, prévisualisation |
| Notes | ✅ import CSV par collage (matricule;note;observation), matricules inconnus **ignorés silencieusement** | grades.enter | export notes élève/classe/matière/période, xlsx, aperçu+rapport d'erreurs |
| Paiements | ✅ export CSV journal filtré (année, dates, mode) | finance.reports.read | xlsx |
| Reçus | ✅ PDF A4/A5 | finance.receipts.print | — |
| Bulletins | ✅ PDF individuel + classe+période (`reportcards.print`), portails parent/élève | ✅ | registre CSV/XLSX des bulletins (liste élèves × moyenne × statut) |
| Emplois du temps | ✅ PDF (vue classe/enseignant/école, par semaine) | schedules.print | — |
| Factures SaaS | ✅ PDF plateforme | platform.invoices.read | — |
| Classes, salles, matières, enseignants, inscriptions, employés, présences, évaluations, moyennes, comptes élèves, créances, clôtures, états financiers | ❌ aucun import/export | — | tout à créer |

Constats transverses : ❌ **aucun XLSX** (pas de dépendance exceljs/xlsx) ; 🎨 les imports n'offrent ni modèle téléchargeable ni aperçu préalable ; ⚠️ rapport d'erreurs minimal. Filtrage abonnement : aucune restriction import/export par formule actuellement (à décider).

---

## LOT 6 — Ergonomie, formulaires, navigation

| Constat | État |
|---|---|
| Boutons « Retour » présents | students/[id], guardians/[id], teachers/[id], classrooms/[id], subjects/[id], report-cards/[id], users, periods |
| ⚠️ Boutons retour **absents** | `fees/accounts/[id]` (compte élève), `grades/[id]`, `sessions/[id]`, `fees/unpaid`, `fees/settings` (payments a un fil d'Ariane partiel) |
| 🎨 Libellés de champs | hétérogène : onboarding et signup ont de vrais `<label>` ; grading-policy, announcements et la plupart des formulaires internes = placeholders uniquement |
| ⚠️ Messages d'erreur | codes bruts affichés (`?error=NOT_FOUND`, `INVALID_STATUS`…), pas de mapping utilisateur systématique |
| Confirmations de suppression | absentes (boutons d'action directs, ex. Archiver sans confirmation) |

---

## LOT 7 — Abonnements

| Fonctionnalité | État |
|---|---|
| Page « Mon abonnement » (`/app/subscription`) | ✅ complète : formule, statut, échéance, limites d'usage (élèves/utilisateurs vs quotas), modules, factures SaaS |
| États | ✅ TRIALING/ACTIVE/PAST_DUE/GRACE/SUSPENDED/EXPIRED/CANCELLED + sweep automatique (`sweepSubscriptions` : dépassement → GRACE + `graceDays` puis suspension ; lecture seule en suspension) |
| Alertes expiration | ✅ J-7 dédupliquées → admin école + owners plateforme ; rappel hebdo factures échues — **mais dépendent de `/api/cron`, non planifié en préprod** |
| Demande de changement d'offre | ⚠️ **BUG** : le formulaire teste `roleName === "SCHOOL_ADMIN"` alors que le rôle est `ADMIN_SCHOOL` → **jamais affiché**. Le service `requestPlanChange` et le modèle `SubscriptionChangeRequest` (PENDING) existent et fonctionnent |
| Renouvellement même formule | ❌ la liste exclut la formule courante — impossible de « renouveler à l'identique » |
| Contact commercial depuis l'app | ❌ |
| Paiement en ligne | ❌ (conforme : validation commerciale manuelle) |

---

## LOT 8 — Notifications WhatsApp aux commerciaux

### Existant (majeur) ✅

L'infrastructure est **déjà construite** :
- `MessageDelivery` (file de livraison, `dedupKey`, statuts) + `Job` Postgres (retries backoff 2,4,8…60 min, idempotent).
- Provider **WhatsApp Cloud API officiel implémenté** (`whatsappProvider` : Meta Graph v21.0, templates `fr`, gestion erreurs/retryable) — variables `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`.
- Consentement : `canContactUser` (WhatsApp = **opt-in obligatoire**), préférences par canal/topic, `canContactGuardian`.
- Pattern « job `delivery.send` » déjà utilisé par les automatisations.

### Manquant ❌

- Déclencheur : `createSignupRequest` n'émet **aucun** événement — pas de notification aux commerciaux.
- Champ d'attribution (commercial responsable) sur `SchoolSignupRequest` — ou routage « tous les PLATFORM_SALES ».
- Numéro WhatsApp du commercial : `User.phone` existe — non renseigné pour les comptes plateforme ; opt-in WhatsApp à créer pour les comptes internes.
- Template Meta `signup_request_new` à créer/approuver côté Business Manager (obligatoire hors fenêtre 24 h).
- Affichage des livraisons dans `/platform/monitoring` (la page existe ; à confirmer qu'elle expose les deliveries — probablement partiel).

### Rappel coûts (Meta, depuis 01/07/2025)

Facturation **par message délivré** ; catégorie *utility* ≈ 0,011–0,02 $/message pour l'Afrique hors grands marchés ; réponses dans la fenêtre 24 h gratuites. Prérequis : compte Meta Business + WABA + numéro dédié + template approuvé + opt-in des destinataires.

**Règle d'architecture validée par l'existant** : `createSignupRequest` → `enqueueJob` (dedupKey = request id) → livraison WhatsApp asynchrone ; l'échec WhatsApp ne bloque jamais l'enregistrement. Aucun envoi réel sans configuration ni validation.

---

## LOT 9 — Documentation

- ✅ Docs techniques/ops dans `docs/` (permissions.md, deployment-guide, backup-restore, demo-accounts, demo-acceptance, phases).
- ❌ Aucune aide in-app : pas d'infobulle, pas de notice, pas de page guide ; aucun composant d'aide réutilisable.
- ❌ Pas de guide utilisateur destiné aux établissements (règles de notation, imports, annonces, abonnement).

---

# RAPPORT D'ÉCARTS — SYNTHÈSE

| Élément | Existant | Problème | Correction | Priorité |
|---|---|---|---|---|
| Menus filtrés par permission | ❌ | 22+13 entrées visibles par tous | filtrer `appNav`/`platformNav` par `userHasSchoolPermission`/`userHasPlatformPermission` | **Critique** |
| Boutons/formulaires par permission | ✅ partiel | pattern `canManage` présent mais non systématique | généraliser le masquage des actions interdites | Haute |
| `SCHOOL_ADMIN` vs `ADMIN_SCHOOL` | ⚠️ bug | formulaire de changement d'offre jamais visible | corriger la comparaison (1 ligne) | **Critique** |
| Cron `/api/cron` préprod | ⚠️ ops | aucun appel planifié → annonces programmées, alertes expiration, rappels impayés ne partent jamais | installer `/etc/cron.d/ecomschool-preprod` (sudo requis) | **Critique** |
| Grading-policy UI | ⚠️ | placeholders nus, mentions en texte libre, `annualWeights` absent | formulaire sectionné + libellés + infobulles + notice | Haute |
| Notice d'utilisation in-app | ❌ | — | composant d'aide + notice règles de notation | Haute |
| Vue détail annonce | ❌ | contenu non consultable, archivées invisibles | modale/page détail + onglet archivées | Moyenne |
| Exports notes/moyennes/bulletins/finance | ❌ partiel | seuls élèves CSV + journal paiements CSV | routes CSV/XLSX permissionnées (exceljs) | Haute |
| Modèles + aperçu d'import | ❌ partiel | pas de template, erreurs silencieuses (notes) | template téléchargeable + rapport d'erreurs | Haute |
| Renouvellement même formule | ❌ | formule courante exclue du choix | autoriser la formule courante comme « renouvellement » | Moyenne |
| Déclencheur WhatsApp signup | ❌ | infra complète mais aucun hook | `enqueueJob` dans `createSignupRequest` + attribution + opt-in commercial | Moyenne (après validation) |
| Boutons retour manquants | ❌ | 5 pages concernées | lien retour avec destination de repli | Basse |
| Messages d'erreur bruts | ⚠️ | codes techniques affichés | mapping code → phrase utilisateur | Moyenne |
| Brouillon/archivage politique de notation | ❌ | `status` existe, pas d'UI | afficher statut + archiver (pas de nouveau cycle sans validation) | Basse |
| Documentation in-app | ❌ | aucune | notices contextualisées par module | Progressive |

# PLAN DE CORRECTION PROPOSÉ

| Étape | Contenu | Fichiers principaux | Risque | Effort |
|---|---|---|---|---|
| **P1** | Nav filtrée par permissions (app + platform) ; correction `SCHOOL_ADMIN`→`ADMIN_SCHOOL` ; boutons retour ; `/teacher` restreint au rôle | `app/(tenant)/ui/nav.ts`, `platform/ui/nav.ts`, layouts, `subscription/page.tsx`, `teacher/layout.tsx`, pages détail | très faible | ½ j |
| **P2** | Installation cron préprod (manuel, sudo) + doc | `deploy/cron`, serveur | faible | ½ h (VPS) |
| **P3** | Grading-policy : formulaire sectionné, libellés, infobulles, mentions en éditeur structuré, `annualWeights` exposé, statut/archivage visible, notice « Comment fonctionnent les règles ? » | `grading-policy/{page,actions}`, nouveau composant `help-panel` | faible (aucun calcul touché) | 1-1,5 j |
| **P4** | Annonces : vue détail, onglet archivées, badges statut, labels, confirmation d'archivage | `announcements/page.tsx` (+ service `includeArchived`) | faible | ½ j |
| **P5** | Exports CSV/XLSX : notes (élève/classe/matière/période), moyennes, registre bulletins, comptes/créances/clôtures ; ajout `exceljs` ; permissions dédiées (`*.export` à créer si besoin) | nouvelles `route.ts` + services read-only | moyen | 2 j |
| **P6** | Imports : modèles téléchargeables + aperçu + rapport d'erreurs (élèves, notes) | `students/actions`, `grades/actions` | moyen | 1 j |
| **P7** | Abonnement : formule courante autorisée (renouvellement), CTA contact, vérification des alertes après cron | `subscription/page.tsx`, `subscriptions.ts` | faible | ½ j |
| **P8** | WhatsApp : champ assigné/téléphone commercial, hook `enqueueJob` dans signup, template Meta, opt-in — **développement uniquement, aucun envoi sans GO** | `signup-requests.ts`, `automations.ts`, schema (champ `assignedToId`?) | moyen | 1 j |
| **P9** | Documentation : notices in-app (composant réutilisable) + guides `docs/` par module | `components/help/*`, `docs/guide-*.md` | faible | continu |

Dépendances : P3 doit précéder la notice du lot 9 ; P8 dépend de la validation commerciale Meta ; P2 est hors code (accès sudo requis).

**J'attends ton GO par étape** (recommandé : P1 + P2 d'abord — fort impact, risque minimal). Aucun développement ni déploiement n'a été effectué.
