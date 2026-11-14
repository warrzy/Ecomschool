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
