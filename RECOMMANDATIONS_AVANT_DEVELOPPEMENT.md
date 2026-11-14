# RECOMMANDATIONS AVANT DÉVELOPPEMENT

## Corrections à apporter aux documents d'architecture (avant GO dev)

### Comptabilité — obligatoires avant CG-1
1. **CG-A** Ajouter `AccountingAllocation { chargeEntryLineId, paymentEntryLineId, amount, @@unique(...) }` — lettrage partiel/acomptes.
2. **CG-B** Procédure de bascule : à l'activation ACCRUAL, OD d'ouverture des `StudentFeeCharge` non soldées (D411/C706 ou C119). Mode par **exercice** — bascule au prochain exercice ouvert.
3. **CG-E** Mapping rubriques bilan/CR → classes SYSCOHADA à spécifier avec un référent comptable avant CG-3.

### RH/Paie — obligatoires avant RH-1
4. **RH-A** `PayrollStatus` + `CORRECTED`/`CANCELLED`, `rectifiesRunId`, contre-passation — jamais d'UPDATE sur bulletin émis.
5. **RH-B** Grammaire `SalaryComponent.formula` : `{type:fixed|percent|rate_x_qty, base:BASE|GROSS|TAXABLE, rate}` + pipeline ordonné documenté.
6. **RH-D** `Employee.status=EXITED` → révocation `SchoolMembership`/`User` transactionnelle.
7. **RH-F** Modéliser `AdvanceRecovery` ou expliciter la récupération via `PayslipLine`.
8. **M-3** Bloquer clôture d'exercice si `PayrollRun` non posté dans la période.
9. **M-5** `Expense` catégorie « paie » exclue de `generateEntries` dès RH-5 déployé.

### PR lot0 — avant fusion ci-github
10. Vars `PREPROD_PLATFORM_ADMIN_*` factices dans `env:` du job recette.
11. `node-version: 24` (parité prod).
12. Appeler `bootstrap-accounting-permissions.ts` dans la chaîne CI **et** l'ajouter à `bootstrap.sh` (oubli constaté en recette verify).

## Décisions

| Module | Décision |
|---|---|
| Comptabilité générale | **GO SOUS RÉSERVES** (CG-A, CG-B, CG-E) |
| RH & Paie | **GO SOUS RÉSERVES** (RH-A, RH-B, RH-D, RH-F + barème BF externe) |
| PR lot0 | `nav-permissions` **GO** ; `ci-github` **GO sous réserves** (3 correctifs) |

## Ordre d'exécution recommandé

1. Corriger les documents d'architecture (points 1-9) — revalidation Cursor.
2. Corriger `ci-github` (points 10-12) puis fusionner les 2 PR lot0.
3. Lot **CG-1** (migrations + engagement + OD écran + GL) avant RH — la paie en dépend (OD 66x).
4. Obtenir le **barème CNSS/impôts BF officiel** avant RH-3 — aucun taux inventé.
5. Recette systématique type H12 (isolation + idempotence + équilibre) par lot livré.
