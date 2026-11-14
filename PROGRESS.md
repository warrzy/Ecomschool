# PROGRESS — Chantier Compta générale + RH/Paie

## État au commit courant (`feat/compta-generale`)

| Élément | État | Commit |
|---|---|---|
| Migration CG additive (tiers, allocations, immos, relevés, `ExerciseMode`) | ✅ validée, NON appliquée | `cae6d79` |
| `engagement.ts` : `postChargeEntry`, `allocate`, `thirdPartyBalance` | ✅ typecheck | `1f8fa37` |
| `generateEntries` : règlement ACCRUAL → crédit 411 | ✅ | `1f8fa37` |
| `generateEntries` : passe `CHARGE` (D411/C706, exercices ACCRUAL) | ✅ typecheck | HEAD |
| UI : formulaire export grand livre (sélect compte) | ✅ | HEAD |
| UI : formulaire OD manuel (`manualEntryAction` → `createManualEntry`) | ✅ | HEAD |

## Reste CG-1 (prochaine session, dans l'ordre)

1. `prisma migrate deploy` sur `ecomschool_verify` (isolation) — migration `20261115_cg1_comptabilite_generale`.
2. Recette `scripts/cg1/recette.ts` : fixtures complètes (école, user+BURSAR, charge+échéances, paiement partiel) → CHARGE D411/C706 → SETTLEMENT D57x/C411 → allocate partiel + OVER_ALLOCATED → re-run idempotent → isolation école B. Réutiliser les helpers `makeMember`/`cleanupSchool` de `scripts/h12/comptabilite-recette.ts`.
3. Rejouer H12 68/68 (non-régression CASH).
4. Permissions : rien à ajouter (OD/GL sous `accounting.manage`/`accounting.export` existants) — vérifier en recette.
5. Merge `feat/compta-generale` → `main` après recettes vertes → CG-2 (tiers, balance âgée).

## Bloquages connus

- Barème CNSS/ITS BF : requis avant RH-3 (taux officiels non inventés).
- `WHATSAPP_DRY_RUN` / providers non configurés : hors scope CG/RH.

## Jalons

- `main` aligné sur produit (`ec62b59`) ; docs architecture v2 publiés ; CI corrigée (Node 24, vars admin, bootstrap compta) ; nav+ BURSAR sur `lot0/nav-permissions`.

## CG-1 TERMINÉ ✅ (merge `4da5b3c` → main, 15/11)

- Recette `scripts/cg1/recette-cg1.ts` : **14/14 PASS** sur `ecomschool_verify` (migration 56/56)
- H12 non-régression : **68/68 PASS** (mode CASH inchangé)
- Vérifié : CHARGE D411/C706, règlement D571/C411 sans 706, lettrage partiel + OVER_ALLOCATED, solde tiers 60k, auxiliaire auto-provisionné, idempotence, isolation B, créance hors exercice → `skipped` (jamais perdue)
- Correctif apporté : lignes d'écriture portent `thirdPartyId` ; passe CHARGE + règlement ACCRUAL provisionnent l'auxiliaire élève (upsert idempotent)

## PROCHAINE SESSION → CG-2

Tiers : référentiel CRUD (`AccountingThirdParty`), balance âgée 30/60/90 sur `dueDate` des échéances, page `/app/comptabilite/tiers` (liste+recherche+filtre kind+export CSV), soldes par tiers. Helpers dispo : `thirdPartyBalance`, `allocate`. Base isolée : tunnel `ssh -N -L 5433:127.0.0.1:5432 ecomschool-preprod` + URL `/tmp/vdb.txt` (reconstruire).

## CG-2 TERMINÉ ✅ (tiers & créances)

- `src/lib/services/accounting/thirdparty.ts` : référentiel tiers (élève/parent/fournisseur/autre), `studentAging` (buckets non échu/1-30/31-60/61-90/+90 sur `dueDate` − `PaymentAllocation`), `agingCsv`, `upsertThirdParty`, `listThirdParties` (recherche insensible casse + filtre kind)
- UI `/app/comptabilite/tiers` + `export-tiers` CSV + actions serveur `actions-tiers.ts`, entrée nav ajoutée
- Recette `scripts/cg1/recette-cg2.ts` : **13/13 PASS** — 4 buckets âgés, paiement partiel 400/1000, CRUD fournisseur, FORBIDDEN sans membership/permission, isolation B, CSV
- Non-régression : CG-1 14/14, H12 68/68 ; typecheck + eslint verts

## PROCHAINE SESSION → CG-3

Clients/fournisseurs complets + règlements + rapprochement bancaire (`BankStatement`/`BankStatementLine` déjà migrés en CG-1), lettrage fournisseur, dettes fournisseurs (D6xx/C401 à la dépense engagée ?). Voir `BACKLOG_DEVELOPPEMENT.md` CG-3..CG-6 puis RH-1..RH-8.

## COMPTABILITÉ GÉNÉRALE TERMINÉE ✅ (CG-1→CG-6, migration 57/57)

| Lot | Livré | Recette |
|---|---|---|
| CG-1 | Engagement CHARGE D411/C706, règlement ACCRUAL D57x/C411, lettrage partiel, écran OD, export GL | 14/14 |
| CG-2 | Référentiel tiers, balance âgée 5 buckets, `/app/comptabilite/tiers`, CSV | 13/13 |
| CG-3 | Bilan + compte de résultat (actif=passif, résultat croisé, perte→actif), `/app/comptabilite/etats`, CSV+PDF | 16/16 |
| CG-4 | Immobilisations + dotations mensuelles idempotentes D681/C281, unique(assetId,periodStart) | 15/15 |
| CG-5 | Rapprochement bancaire : import relevé, pointage auto montant+date±3j, écarts | 10/10 |
| CG-6 | À-nouveaux OPENING équilibrés (classes 1-5 + résultat→12), bascule CASH→ACCRUAL (D411/C12, auxiliaires auto), garde PAYROLL_UNPOSTED sur clôture | 16/16 |

- H12 non-régression : **68/68** (assertion starter 10→14 comptes mise à jour : +12/201/281/681)
- Bug réel corrigé par recette : `carryForward` créait un exercice orphelin au rejeu → contrôle ALREADY_CARRIED en amont
- Garde paie : `closeExercise` interroge `PayrollRun` en SQL brut tolérant (table absente → pas de blocage) — test réel à la recette RH-5

## PROCHAINE SESSION → RH-1

`Employee` + `EmployeeContract`(+`amendsContractId`) + documents + matricule. Voir `BACKLOG_DEVELOPPEMENT.md` RH-1→RH-8. Séparation des fonctions : `PAYROLL_OFFICER` à créer, HR_MANAGER sans `payroll.*`. Barème BF officiel requis avant RH-3.

## RH-1 TERMINÉ ✅ (référentiel personnel, migration 58/58)

- `Employee` (matricule unique/école, catégorie TEACHING/NON_TEACHING, liens optionnels Teacher+User, statuts ACTIVE/SUSPENDED/DEPARTED), `EmployeeContract` (CDI/CDD/VACATION/INTERN, `amendsContractId` chaîné), `EmployeeDocument`
- Avenant transactionnel : parent → ENDED à la date de début ; 1 seul contrat ACTIVE (activation clôt l'existant) ; avenant sur contrat non actif refusé
- Sortie transactionnelle : DEPARTED + fin de tous les contrats (révocation accès = RH-8)
- Permissions `hr.read`/`hr.manage` (+`payroll.*` pré-créées), rôle global HR_MANAGER bootstrappé — séparation RH/paie respectée
- UI `/app/rh` : liste, recherche, fiche (contrats/avenants/documents), sortie
- Recette `scripts/rh1/recette-rh1.ts` : **20/20 PASS** ; non-régression CG-1 14/14 ; typecheck vert
- Bug corrigé par recette : `activate` passé dans `data` Prisma → destructuré

## PROCHAINE SESSION → RH-2

`LeaveRequest`/`LeaveBalance`/`StaffAttendance` — cycle congé complet ; absence élève ≠ solde congé. Puis RH-3 (moteur paie — **barème BF officiel requis**), RH-4 avances ≤30% net, RH-5 OD paie→compta, RH-6 rectifications, RH-7 pilotage, RH-8 sortie+révocation+vacations.

## RH-2 TERMINÉ ✅ (congés/présences, migration 59/59)

- `LeaveBalance` (droit/consommé par type+année, unique), `LeaveRequest` (PENDING→APPROVED/REJECTED/CANCELLED), `StaffAttendance` (unique employé+jour)
- Approbation transactionnelle avec décompte du solde ; INSUFFICIENT_BALANCE ; UNPAID sans solde ; CANCELLED restaure ; jours calendaires
- UI `/app/rh` : bandeau demandes en attente (approuver/rejeter), section congés sur fiche (soldes, demande, annulation, droits), pointage présence
- Recette `scripts/rh1/recette-rh2.ts` : **16/16 PASS** ; non-régression CG-1 OK
- Incident isolé résolu : migration partielle (doublon enum AttendanceStatus — réutilisé celui des élèves, UNMARKED inclus) → `db execute` manuel + `migrate resolve --applied` sur verify uniquement

## PROCHAINE SESSION → RH-3

Moteur paie : `SalaryComponent` (grammaire fixed/percent/rate_x_qty/table, bases nommées, pipeline ordonné, formulaSnapshot figé) + `PayrollRun`/`Payslip` + bulletin. **AUCUN taux BF non vérifié** — paramètres configurables inactifs. Puis RH-4 avances ≤30% net, RH-5 OD paie→compta (champ `postedEntryId` lu par la garde CG-6), RH-6 rectifications rectifiesRunId, RH-7 dashboard, RH-8 sortie+révocation+vacations.

## RH/Paie — TERMINÉ (lots RH-1 → RH-8)

| Lot | Livré | Recette |
|---|---|---|
| RH-1 | Référentiel employés, contrats, avenants chaînés, documents, sorties | 20/20 |
| RH-2 | Congés (soldes, approbations), présences, calendrier absences | 16/16 |
| RH-3 | Moteur de paie configurable (grammaire v2, snapshots, bulletins) | 23/23 |
| RH-4 | Avances, recouvrement FIFO ≤30% net, recalcul idempotent | 17/17 |
| RH-5 | OD paie D66/C422/C431, garde PAYROLL_UNPOSTED, M-5 dépenses | 14/14 |
| RH-6 | Rectification : contre-passation, RECTIFIED, bulletins immuables | 15/15 |
| RH-7 | Dashboard : effectifs, masse salariale, alertes contrats J-30 | 13/13 (RH-7/8) |
| RH-8 | Sortie transactionnelle + révocation accès ; vacations = séances DONE vérifiées | idem |

Non-régressions : H12 68/68, CG-1→6 84/84, RH-1→6 rejouées vertes.
Paramètres CNSS/fiscaux BF : moteur configurable, aucun taux activé (isRegulatory exclu du calcul).
Prochaine étape possible : exports paie complémentaires, PDF bulletin enrichi, paramètres réglementaires officiels.

## Point technique migrations (post RH-8)
- Verifie : 62/62 migrations `migrate deploy` propres sur namespace neuf (schema migcheck) — aucune correction manuelle.
- `migrate diff` DB migrée vs schema.prisma : zero derive.
- `prisma.config.ts` : `shadowDatabaseUrl` optionnel ajoute (Prisma 7).
- CI : branches lot0 (nav-permissions, ci-github) fusionnees dans main ; nouveau job `migrations` (deploy depuis zero + detection de derive) pour detecter les migrations defectueuses.

## Déploiement PRÉPRODUCTION — 2026-11-14
- Release : 327f655 sur https://preprod.ecomschool.fr (healthcheck 200, 62/62 migrations).
- Sauvegardes : ecomschool_preprod_20261114_195200.dump + pre-migrate-<ts>.dump (deploy.sh).
- Incident : `deploy.sh main` a résolu un `main` local obsolète (9811e0a) → service restauré sur release précédente, redéploié avec origin/main, script corrigé (origin/<ref> prioritaire).
- Permissions : bootstrap RH exécuté (ADMIN_SCHOOL ×4, HR_MANAGER ×2) ; ajouté à bootstrap.sh.
- Comptes démo (école ÉCOLE DÉMO VALIDATION, slug demo-validation) :
  demo-compta@demo.ecomschool.test / <DEMO_COMPTA_PASSWORD> (accounting.*)
  demo-rh@demo.ecomschool.test / <DEMO_RH_PASSWORD> (hr.*)
  demo-paie@demo.ecomschool.test / <DEMO_PAIE_PASSWORD> (payroll.* + hr.read)
  (M6 : mots de passe retirés du dépôt — variables d'environnement requises)
- Données démo : 2 employés fictifs, run paie DRAFT non validé (prime fictive 10 %).
- Recettes E2E rejouées sur preprod : CG-1 14/14, RH-1 20/20, RH-3 23/23, RH-5 14/14, RH-7/8 13/13.
- Routes : /app/rh, /app/rh/paie, /app/comptabilite{,/tiers,/etats,/immobilisations,/rapprochement} → 200 ; modules scolaires OK.
- Rollback : repointer current → release précédente + pm2 start (deploy/scripts/rollback.sh) ; dumps disponibles.
- Production : non touchée. CNSS/fiscaux : non activés.

## Recette métier 360° — préproduction (2026-11-14)
- scripts/preprod/recette-metier-360.ts : **25/25 PASS** sur ecomschool_preprod.
- S1 : élève → charge 75 000 → paiement partiel 50 000 → D411/C706 + D571/C411 → bilan=passif, CR produits 75 000.
- S2 : congé approuvé (après dotation), présence, paie validée → garde PAYROLL_UNPOSTED → OD D66/C422 → POSTED.
- S3 : avance 20 000 → recouvrement ≤30 % → rectification POSTED → contre-passation → RECTIFIED.
- S4 : RH⊄paie, paie⊄RH, compta⊄bulletins (confidentialité salaires), isolation inter-écoles.
- Anomalie observée : recordPayment a renvoyé une erreur sur un appel dont le paiement a commité (retry → OVERPAYMENT correctement refusé, aucune donnée en double) — à investiguer en tâche de fond.
- demo-admin@demo.ecomschool.test ajouté (rôle DEMO_ADMIN, 21 permissions) — mot de passe via DEMO_ADMIN_PASSWORD.
- Deploy durci : fusionné main (f39e09d) + présent dans la release courante — sera dans toute prochaine release.

## RH-9 — Corrections post-recette 360° (2026-11-22)

Correctifs des deux anomalies de la recette métier + cap avances configurable.

### `recordPayment` — fiabilité post-commit (`src/lib/services/finance/payments.ts`)
- Filet 1 : épuisement des retries → lookup par `idempotencyKey` avant de propager l'échec.
- Filet 2 : erreur non retriable (timeout/coupure) après commit → lookup `idempotencyKey` dans le catch externe ; un paiement réellement enregistré n'est jamais présenté comme échoué. Aucun doublon : la clé unique `schoolId+idempotencyKey` demeure le garde-fou.

### Dotations de congés assistées (`leaves.ts`, migration `20261122_rh9_dotations_config`)
- `LeaveRule` (unique `schoolId+type`) : règles configurées par l'établissement, **aucun droit légal présumé**.
- `upsertLeaveRule` / `listLeaveRules` / `provisionLeaveBalances` (dotation assistée tous employés actifs, ne crée que les soldes manquants — les corrections via `setEntitlement` sont préservées) / `provisionForEmployee` (auto à l'activation d'un contrat).
- UI `/app/rh` : carte « Dotations de congés » (règles + provisionnement annuel).

### Plafond avances configurable (`payroll.ts`, `PayrollConfig.advanceCapBp`)
- `computeRun` lit `PayrollConfig.advanceCapBp` (points de base, défaut 3000 = 30 %) — **valeur indicative non réglementaire**, libellé explicite dans l'UI `/app/rh/paie`.
- `setAdvanceCap` : 0–10000 pb, entier uniquement, audité.

### Recette 360° corrigée
- Sous-totaux réels par scénario (`subtotal()`) — le total affiché = checks exécutés.
- S2 : dotation via règles+provisionnement (plus de `setEntitlement` manuel).
- S3 : période N+1 = lendemain du dernier run principal (anti-RUN_OVERLAP) + ouverture auto de l'exercice couvrant N+1 ; plafond lu depuis `PayrollConfig`.
- Résultat preprod : **30/30 PASS** ; RH-9 isolé **11/11** ; non-régressions schéma vierge : RH-2 16/16, RH-3 23/23, RH-4 17/17, RH-5 14/14, RH-6 15/15, RH-7/8 13/13. Migration 63 appliquée sur preprod (additive).

## STABILISATION POST-AUDIT — Bloquantes B1-B5 + Majeures M1-M11 (2026-11-23)

Audit indépendant : NO-GO → phase de stabilisation complète autorisée en autonomie.

### Bloquantes
- **B1 uploads** : `experimental.serverActions.bodySizeLimit: "10mb"` (Next 16.4.1) aligné sur `client_max_body_size 10m` nginx ; plafonds métier (5/25 Mo) cohérents.
- **B2 generateEntries** : `tryPost` par source — une source fautive est tracée dans `stats.errors[]` et ignorée au lieu d'avorter le batch ; `postPaymentTx` exige Σ allocations = montant (UNALLOCATED_AMOUNT) ; `updateInstallment` refuse un montant < déjà alloué (BELOW_ALLOCATED).
- **B3 atomicité** : `postEntrySafe(ctx, input, inTx)` exécute l'effet de bord DANS la transaction de l'écriture — payroll POSTED+postedEntryId, dotations AssetSchedule+entryId, statut SOLD, contre-passations RECTIFIED, annulation dépense.
- **B4 monitoring** : `monitor.sh` lit `APP_PORT`/`PUBLIC_URL` (dérivés de l'env : prod→3002/ecomschool.fr, preprod→3001) — la sonde prod ne vise plus la preprod.
- **B5 rollback/healthcheck** : `rollback.sh`, `healthcheck.sh`, `restore.sh` paramétrés (`PM2_APP`/`APP_PORT`/`PUBLIC_URL`) + confirm explicite + backup pré-restore + SHA-256 optionnel.

### Majeures
- **M1 idempotence** : `Payment.idempotencyHash` (SHA-256 du payload canonique) ; même clé + payload divergent → `IDEMPOTENCY_CONFLICT` sur les 3 chemins de lookup ; repli comparaison de champs pour les paiements legacy sans hash.
- **M2 bascule CASH→ACCRUAL** : les créances existant avant `postedAt` de l'écriture `MIGRATION_ACCRUAL` ne sont pas re-facturées en CHARGE (cutoff par exercice) — plus de produit doublé ni de 411 fantôme.
- **M3 closeExercise** : refus `UNPOSTED_OPERATIONS` si paiements, dépenses, remboursements, annulations (à écriture d'origine existante), créances (ACCRUAL post-migration) ou runs VALIDATED de l'exercice ne sont pas postés.
- **M4 immobilisations** : écriture d'acquisition D2xx/C481-404 atomique avec `createAsset` ; écriture de sortie D28x+D81x/C2xx atomique avec `disposeAsset` ; dotation + `AssetSchedule.entryId` dans une seule transaction.
- **M5 notifications** : `schoolId` sur list/unread/markAll/markOne — un utilisateur multi-écoles ne voit ni ne marque les notifications de l'autre tenant (plateforme `null` incluse côté tenant).
- **M6 secrets démo** : mots de passe hors du dépôt (`DEMO_*_PASSWORD`), garde anti-prod sur le script de seed.
- **M7 IP forgée** : extraction `X-Forwarded-For` = **dernier** élément de liste (ajouté par nginx, non falsifiable client) ; sweep throttle périodique.
- **M8 assiduité paie** : `PayrollConfig.workdaysPerMonth/prorateUnpaidLeave/prorateAbsences` ; `Payslip.daysWorked/unpaidDays` ; déduction `ABS_NP` = brut×jours non payés/base — configurée par l'établissement, aucune règle légale présumée ; UI `/app/rh/paie`.
- **M9 UI** : section avances (octroi/annulation/liste) + fiche bulletin détaillée (`?slip=`) sur `/app/rh/paie`.
- **M10 enrollments** : `enrollStudent` appelle `generateStudentCharges` dans la même transaction — `/app/enrollments` crée les créances comme les autres parcours.
- **M11 createManualEntry** : montants entiers ≥ 0, XOR débit/crédit, ≥ 2 lignes, équilibre non nul, comptes/journal/exercice même école, exercice ouvert, date dans l'exercice.

### Mineurs traités
- Oracle `validateRun` scopé `schoolId` ; mutations GET notifications/parent → server actions POST ; `allocate` durcie (permission + plafond) ; `cancelPayment` refuse si remboursement confirmé (REFUNDED) ; `cancelExpense` → contre-passation `EXPENSE_CANCEL` atomique si déjà postée ; `rectifyRun` : contre-passation dans l'exercice ouvert courant si l'origine est clôturée ; avances ventilées 425 (pas 431) dans l'OD de paie ; tokens reset/invite hashés SHA-256 au repos ; `restore.sh` : existence dump + `pg_restore -l` + confirm + pré-backup ; garde `ALLOW_RECETTE=1` sur toutes les recettes destructives (`scripts/lib/recette-guard.ts`).

### Validation (schéma isolé `stab2`, 64/64 migrations propres)
- Recette stabilisation `scripts/preprod/test-stabilisation.ts` : **44/44 PASS** (7 scénarios : B2/B3/M1/M3/M4/M5/M8/M10/M11 + annulations + legacy).
- Tests ciblés `scripts/rh1/test-fixes-cibles.ts` : **34/34 PASS** (concurrence paiements, dotations auto, cap configurable, déterminisme).
- Non-régressions RH : RH-2 16/16, RH-3 23/23, RH-4 17/17, RH-5 14/14, RH-6 15/15, RH-7/8 13/13.
- Typecheck + lint propres. Production non touchée.
