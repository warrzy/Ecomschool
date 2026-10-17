# Lot A2 — Préparation technique des abonnements (prêt, non activé)

> Suite de `docs/a1-reorganisation-abonnements.md`.
> **Rien n'est activé** : la matrice V2 est derrière le drapeau
> `SUBSCRIPTION_MATRIX_V2=1`, PlanModule et les abonnements sont inchangés.

## 1. Mécanisme d'activation contrôlé

`subscriptionMatrixV2Enabled()` (`src/lib/services/platform/modules.ts`) lit
`SUBSCRIPTION_MATRIX_V2 === "1"` au moment de l'appel. Sans la variable,
le comportement est **strictement identique** à aujourd'hui.

Effets du drapeau activé :
- `permissionCoveredByEntitlements` utilise `PERMISSION_MODULE_V2` au lieu
  de `PERMISSION_MODULE`.
- Les invitations de portail vérifient le module cible + le quota
  `maxUsers` (`checkInviteAllowed` dans `src/lib/services/portal/accounts.ts`).

## 2. Corrections préparées

| # | Correction | Où | État |
|---|---|---|---|
| C1 | Clés de mapping corrigées (singulier `student.*`, `teacher.*`, `classroom.*`, `subject.*`, `enrollment.*`, `guardian.*` ; les anciennes clés plurielles sont conservées en alias) | `PERMISSION_MODULE_V2` | Prête, inactive |
| C2 | `schedules.print`→SCHEDULES, `coursecontent.manage`→SCHEDULES, `attendance.justify`→ATTENDANCE, `academic.read`/`school.read`/`notifications.read`/`preferences.read`→ADMINISTRATION | idem | Prête, inactive |
| C3 | Éclatement finance : `finance.read`, `finance.payments.create/read`, `finance.receipts.*`, `finance.reports.read` → **FINANCE_CORE** ; `finance.configure`, `finance.fees.manage`, `finance.discounts.manage`, `finance.payments.validate/cancel`, `finance.cash.close`, `finance.manage` → **FINANCE_MGMT** | idem | Prête, inactive |
| C4 | `reports.attendance`→REPORTS (le module devient contrôlant pour les futures permissions de rapports) | idem | Prête, inactive |
| C5 | `checkLimit("users")` sur `inviteStudentAccount`/`inviteGuardianAccount` | `accounts.ts` | Prête, inactive |
| C7 | Module portail cible exigé pour inviter (PARENT_PORTAL / STUDENT_PORTAL) → erreur `MODULE_DISABLED` | `accounts.ts` + `errorLabels.ts` | Prête, inactive |
| C6/C8 | Permissions mortes restantes et catalogue de test | — | À décider au lot suivant |

## 3. Sécurité — comportement sans abonnement (fail-open)

**Constat** : une école sans `SchoolSubscription` obtient
`planModules = null` → toute permission autorisée, en V1 comme en V2
(invariant conservé volontairement).

**Proposition (à valider, non implémentée)** :

1. Phase d'observation : journaliser dans `getEntitlements` les écoles
   sans abonnement (un warn audité par jour et par école), sans blocage.
2. Après inventaire réel, introduire `NO_SUBSCRIPTION_PLAN` (code de plan,
   défaut : comportement actuel) — les écoles sans abonnement seraient
   évaluées contre ce plan (recommandé : ESSENTIEL, lecture + écriture
   de base) plutôt que tout-autorisé.
3. Garde-fous : exclure les écoles `demo` marquées en base, conserver la
   règle de suspension (lecture seule) en priorité, et ne jamais bloquer
   `portal.parent`/`portal.student` en lecture.

Aucun changement n'a été fait ici — la décision reste ouverte.

## 4. Procédure d'activation coordonnée (ordre impératif)

> ⚠️ Activer le drapeau **avant** l'étape 2 retire des accès
> (cf. `scripts/a2/matrix-check.ts` section 2b : `finance.*` sur PREMIUM,
> `schedules.print`/`coursecontent.manage`/`attendance.justify` sur ESSENTIEL).

1. **Créer les modules** `FINANCE_CORE` (« Caisse — encaissements et reçus »)
   et `FINANCE_MGMT` (« Finance — supervision et configuration ») dans
   `PlatformModule` (`commercial: true`), sans toucher à `FINANCE`
   (le conserver pour l'historique, éventuellement `commercial: false`
   et `status: INACTIVE` après bascule).
2. **Mettre à jour `PlanModule`** selon la matrice A1 :
   - ESSENTIEL : + SCHEDULES, ATTENDANCE, GRADES, REPORT_CARDS, FINANCE_CORE
   - PROFESSIONNEL : + PARENT_PORTAL, STUDENT_PORTAL, COMMUNICATION,
     REPORTS, FINANCE_CORE, FINANCE_MGMT
   - PREMIUM : + FINANCE_CORE, FINANCE_MGMT (conserver FINANCE le temps
     de la bascule si souhaité, ou le retirer — aucune permission V2 ne
     le cible).
3. **Déployer** le code A2, puis positionner `SUBSCRIPTION_MATRIX_V2=1`
   dans `.env` partagé et redémarrer (`pm2 restart ecomschool-preprod`).
   L'étape 2 peut précéder le déploiement : les modules inconnus de la
   carte V1 sont ignorés.
4. **Vérifier** : rejouer `scripts/a2/matrix-check.ts` + recette
   authentifiée par profil × plan ; contrôler qu'aucune école sans
   abonnement n'existe en préprod/prod (sinon effet fail-open attendu).
5. **Rollback** : retirer la variable et redémarrer — aucune donnée
   n'est modifiée par le drapeau (les lignes `PlatformModule`/
   `PlanModule` ajoutées restent inertes sous V1).

## 5. Tests

`scripts/a2/matrix-check.ts` (lecture seule) — **56 PASS / 0 FAIL** :
- cohérence de `PERMISSION_MODULE_V2` (70/85 permissions réelles mappées ;
  aucune permission école non mappée) ;
- **invariant d'activation coordonnée** : V1+plans actuels ⊆ V2+plans
  cibles pour les 3 plans × 6 rôles école — aucune perte d'accès ;
- 30 assertions profil × plan cible (caisse socle en ESSENTIEL, portails
  en PRO, supervision finance en PRO+, etc.) ;
- suspension (lecture seule + portails), overrides (ajout/retrait),
  fail-open sans abonnement.

Rapport 2b informatif : si le drapeau était activé seul (sans PlanModule),
les pertes seraient `finance.*` (PREMIUM) et les clés nouvellement mappées
hors plan (ESSENTIEL) — d'où l'ordre d'activation ci-dessus.

## 6. Risques et points ouverts

| Risque | Niveau | Mitigation |
|---|---|---|
| Activation du flag sans PlanModule | Élevé (perte finance Premium) | Procédure §4 ; test 2b la documente ; vérifier `SUBSCRIPTION_MATRIX_V2` avant déploiement |
| Écoles sans abonnement | Moyen | Fail-open inchangé ; proposition §3 à valider |
| `portal.manage` reste sous ADMINISTRATION | Faible | L'invitation peut s'afficher sous Essentiel/Pro ; l'erreur `MODULE_DISABLED` protège le serveur (C7). Masquage UI = lot suivant |
| Modules/plans de test `P8*`/`P9*` en base | Faible | Nettoyage à prévoir (C8) |
| `teacher.dashboard`, `finance.payments.read` mappés sans Permission DB | Nul | Clés prévues — inertes tant qu'absentes |
| Clés mortes (`grade.*`, `notifications.read`, …) mappées en V2 | Nul | Jamais vérifiées par le code — le mapping ne change rien à l'exécution |

## 7. Fichiers modifiés

- `src/lib/services/platform/modules.ts` — `PERMISSION_MODULE_V2`,
  `subscriptionMatrixV2Enabled()`, `permissionModuleMap()`
- `src/lib/services/portal/accounts.ts` — `checkInviteAllowed`, codes
  `MODULE_DISABLED`/`LIMIT_USERS`
- `src/lib/ui/errorLabels.ts` — libellé `MODULE_DISABLED`
- `.env.example`, `.env.preprod.example` — variable documentée
- `scripts/a2/matrix-check.ts` — matrice de tests (nouveau)

Aucun changement de schéma, de PlanModule, de tarif ou d'abonnement actif.
