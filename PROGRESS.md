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
