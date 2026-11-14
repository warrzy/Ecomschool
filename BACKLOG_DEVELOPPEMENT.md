# BACKLOG DE DÉVELOPPEMENT DÉFINITIF — ECOM-SCHOOL

15 novembre 2026 — ordre des lots, dépendances, critères d'acceptation. Références : `AUD-*` (Cursor), `B-*` (Devin), `CG-*`, `RH-*` (architecture v2).

## Phase F — Fondations (avant tout dev métier)

| Lot | Contenu | Dépendances | CA | Charge |
|---|---|---|---|---|
| F-1 | Merger `lot0/nav-permissions` | — | Menu docs admin visible, BURSAR créé | S |
| F-2 | Merger `lot0/ci-github` (corrigé) | F-1 | CI verte : typecheck+lint+build+recette H12 | S |
| F-3 | Décision produit AUD-041 (retirer `allowMultipleEnrollments`) + AUD-042 (`closeYear` bloquant sauf `forceClose`) | — | Tests associés verts | S |

## Phase CG — Comptabilité générale (architecture v2)

| Lot | Contenu | Dépendances | CA | Charge |
|---|---|---|---|---|
| CG-1 | Migrations additives (tiers, `AccountingAllocation`, `Asset`, `BankStatement`, `AccountingExercise.mode`) + source `CHARGE` (D411/C706) + écran OD + bouton GL | F-* | Recette type H12 : engagement + lettrage partiel + 0 double comptage ; H12 68/68 toujours vert | 5 j |
| CG-2 | Tiers auxiliaires + balance âgée (30/60/90 sur `dueDate`) | CG-1 | Solde auxiliaire = collectif | 3 j |
| CG-3 | Bilan + compte de résultat + PDF (rubriques §CG-E validées par référent) | CG-2 + référent comptable | actif=passif, résultat croisé, exercice clos figé | 4 j |
| CG-4 | Immobilisations + dotations mensuelles (OD 68x/28x idempotente) | CG-1 | 1 écriture/mois, rejeu sans doublon | 3 j |
| CG-5 | Rapprochement bancaire (`BankStatement`, lettrage auto montant+date±3j) | CG-1 | import + pointage + écarts | 3 j |
| CG-6 | Clôture + à-nouveaux + garde `PAYROLL_UNPOSTED` (M-3) + bascule ACCRUAL (CG-B) | CG-3 | reprise classes 1-5, OD OPENING créances | 2 j |

## Phase RH — Ressources humaines & paie (architecture v2)

| Lot | Contenu | Dépendances | CA | Charge |
|---|---|---|---|---|
| RH-1 | `Employee`+`EmployeeContract`(+`amendsContractId`)+documents+matricule | F-* | CRUD + isolation + avenant chaîné | 4 j |
| RH-2 | `LeaveRequest`/`LeaveBalance`/`StaffAttendance` | RH-1 | cycle congé complet ; absence élève ≠ solde | 3 j |
| RH-3 | `SalaryComponent` (grammaire v2 + `formulaSnapshot`) + `PayrollRun`/`Payslip` + bulletin PDF | RH-1 + **barème BF officiel** | double run = 1 bulletin ; pipeline ordonné ; aucun taux non référencé | 6 j |
| RH-4 | `Advance`/`AdvanceRecovery` (≤30 % net) | RH-3 | retenue jamais > net | 2 j |
| RH-5 | OD paie → compta (mappings `MAP:PAYROLL:*`) + exclusion `Expense` paie (M-5) | RH-3 + CG-1 | OD équilibrée idempotente ; pas de double charge | 2 j |
| RH-6 | Rectification (`rectifiesRunId`, contre-passation, `RECTIFIED/CANCELLED`) | RH-5 | bulletin corrigé sans UPDATE | 2 j |
| RH-7 | Pilotage : effectifs, masse salariale, alerte contrats J-30 | RH-1 | dashboard + alerte unique | 2 j |
| RH-8 | Sortie salarié (RH-D transaction) + vacations (RH-C après vérif `CourseSession`) | RH-1/3 | accès révoqués ; taux × séances validées | 2 j |

## Phase N — Notifications (débloqueur commercial)

| Lot | Contenu | CA | Charge |
|---|---|---|---|
| N-1 | Compte provider email (Resend/Brevo) + envoi test autorisé | `EMAIL_PROVIDER_URL` renseigné, 1 mail reçu | 1 j |
| N-2 | Provider SMS BF (Africa's Talking/Hub2) | 1 SMS test reçu | 1 j |
| N-3 | Relances `FeeReminder` via canal actif | relance réelle tracée | 2 j |

## Phase U — Université (après CG/RH, hors scope immédiat)

Spec LMD → référentiels UE/crédits → sessions → stages. ~15-20 j. `schoolType` feature flag.

## Règles d'exécution

- Chaque lot = branche `feat/<lot>` + PR + recette isolation/idempotence/équilibre avant merge.
- CG avant RH (paie dépend des journaux/OD). N en parallèle dès F-2 (débloqueur commercial).
- Aucun taux réglementaire BF sans source officielle attachée au `tableRef`.
- Jamais de migration destructive ; données démo purgées uniquement sur ton ordre.
