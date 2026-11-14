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
