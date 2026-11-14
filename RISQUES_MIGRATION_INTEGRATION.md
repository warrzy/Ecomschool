# RISQUES MIGRATION & INTÉGRATION — Compta générale + RH/Paie

Référence : `main` = `ec62b59`, 55 migrations, base prod vivante (données réelles + comptes démo).

## Risques de migration

| # | Criticité | Risque | Mitigation |
|---|---|---|---|
| M-1 | **P1** | Bascule CASH→ACCRUAL sur école avec historique : créances impayées orphelines en 411 | CG-B : OD d'ouverture obligatoire à l'activation ; jamais de réécriture d'écritures postées |
| M-2 | **P1** | Rectification de paie post-`POSTED` sans flux prévu | RH-A : run rectificatif, jamais de `UPDATE` sur `Payslip` émis |
| M-3 | P2 | `Payslip` rattaché à `exerciseId` : exercice clos alors que paie du mois non postée | Bloquer clôture exercice si `PayrollRun` DRAFT/COMPUTED dans la période |
| M-4 | P2 | `Employee.userId` ≠ `SchoolMembership` : sortie sans révocation d'accès | RH-D : transaction sortie → membership désactivée |
| M-5 | P2 | `Expense` « salaires » historique coexisterait avec OD paie → double charge | Au déploiement RH-5 : mapper catégorie dépense « paie » → exclue de `generateEntries` quand un run posté couvre la période |
| M-6 | P3 | Champs ajoutés à `AccountingEntryLine` (`thirdPartyId`, `reconciledAt`) nullables — pas de backfill | Migration purement additive, défaut NULL |

## Risques d'intégration sur l'existant

| # | Criticité | Risque | Mitigation |
|---|---|---|---|
| I-1 | **P1** | `generateEntries` ignore `CHARGE`/`PAYROLL`/`DEPRECIATION` → en mode ACCRUAL, nouvelles sources non vues = écritures manquantes silencieuses | Étendre `generateEntries` aux nouveaux `sourceType` UNIQUEMENT en mode ACCRUAL ; recette rejouée 68/68 + cas engagement |
| I-2 | P2 | Écritures `PAYMENT` existantes créditant 706 vs nouvelles 571/411 : mélange des modes sur un même exercice | Mode par exercice : bascule effective au prochain exercice ouvert, jamais en cours d'exercice |
| I-3 | P2 | `PaymentReconciliation` (MoMo) confondu avec rapprochement bancaire | Nommer `BankReconciliation`, aucun réemploi (AUD-023) |
| I-4 | P2 | Permissions `hr.*`/`payroll.*` : bootstrap requis sur prod avant usage — oubli = écran vide silencieux (vu en recette verify : `accounting.*` absents de la chaîne) | Ajouter les bootstraps à `scripts/preprod/bootstrap.sh` + checklist déploiement |
| I-5 | P3 | `matricule` unique/école vs `Teacher` existants sans matricule | Backfill optionnel à la création du lien Employee↔Teacher, jamais obligatoire |

## Régression fonctionnelle

- Zéro table existante modifiée structurellement (que des ajouts) → risque structurel nul.
- Risque résiduel = **comportemental** : `generateEntries` (I-1), clôture année/exercice (M-3), `Expense` paie (M-5). Tous couverts par recette H12 étendue + nouveau lot de recettes RH type G2-E.
