# ARCHITECTURE — Comptabilité générale SYSCOHADA (extension H12)

Statut : conception pour revue Cursor — **aucune migration exécutée**. Base existante : `AccountingAccount`, `AccountingJournal`, `AccountingExercise`, `AccountingEntry`(+Line), `AccountingAccountMap` (`src/lib/services/accounting.ts`).

## 1. Principe directeur : comptabilité d'engagement

Distinguer 3 flux (correction AUD-019) :

| Événement | Écriture | Aujourd'hui |
|---|---|---|
| Facturation (`StudentFeeCharge` créée) | D 411 Élèves / C 706 Produits | **absent** |
| Encaissement (`Payment`) | D 571/521 caisse-banque / C 411 | crédite 706 directement (caisse) |
| Régularisation | OD : contre-passation, avoir, remise | partiel (annulation/remboursement) |

**Règle anti double-comptage** : les écritures `PAYMENT` existantes créditant 706 restent valides. L'engagement n'est activé que via `School.settings.accountingMode = "ACCRUAL"` ; en mode `"CASH"` (défaut) comportement actuel conservé — pas de réécriture rétroactive, écritures de bascule explicites à l'ouverture d'exercice.

## 2. Modèles Prisma proposés (nouveaux)

```prisma
model AccountingThirdParty {           // Tiers auxiliaire (élève, fournisseur)
  id String @id @default(cuid())
  schoolId String
  kind ThirdPartyKind                  // STUDENT | SUPPLIER | STAFF | OTHER
  refId String?                        // Student.id / Employee.id / null
  name String
  collectiveAccountId String           // → 411 / 401 / 421 …
  entries AccountingEntryLine[]
  @@unique([schoolId, kind, refId])
}

model AccountingAsset {                // Immobilisation
  id String @id @default(cuid())
  schoolId String
  label String
  acquisitionDate DateTime
  acquisitionCost Int                  // XOF entier
  accountAssetId String                // compte classe 2
  accountDepreciationId String         // compte 28x
  accountChargeId String               // compte 68x
  method DepreciationMethod            // LINEAR | DECLINING
  durationMonths Int
  status AssetStatus                   // ACTIVE | SOLD | SCRAPPED
  schedules AssetSchedule[]
}

model AssetSchedule {                  // Dotation périodique
  id String @id @default(cuid())
  assetId String
  periodStart DateTime
  amount Int
  entryId String? @unique              // écriture générée (idempotence)
}

model BankStatement {                  // Relevé bancaire importé
  id String @id @default(cuid())
  schoolId String
  journalId String                     // journal BQ
  periodStart DateTime / periodEnd DateTime
  closingBalance Int
  lines BankStatementLine[]
}

model BankStatementLine {
  id String @id @default(cuid())
  statementId String
  date DateTime / label String / amount Int
  matchedEntryLineId String?           // lettrage pointage
}

model AccountingBudget {               // Budget prévisionnel (P3)
  id String @id @default(cuid())
  schoolId String / exerciseId String
  accountId String / amountPlanned Int
}
```

`AccountingEntryLine` reçoit `thirdPartyId String?` (auxiliaire) et `reconciledAt DateTime?` (lettrage). `AccountingEntry.sourceType` reçoit `CHARGE` (facturation), `PAYROLL`, `DEPRECIATION`, `CLOSING`, `OPENING`.

## 3. Services (`src/lib/services/accounting/`)

| Service | Rôle | Idempotence |
|---|---|---|
| `engagement.ts` | `postChargeEntry(charge)` → 411/706 à la facturation ; `postSettlementEntry(payment)` → 571/411 | unique `sourceType+sourceId` (déjà indexé) |
| `thirdParty.ts` | création/solde auxiliaire, balance âgée (bucket 30/60/90 sur `dueDate`) | — |
| `assets.ts` | CRUD immo, `generateDepreciation(exercise, month)` → OD 68x/28x | `AssetSchedule.entryId @unique` |
| `reconciliation.ts` | import relevé CSV, pointage auto (montant+date±3j), écarts | — |
| `statements.ts` | `trialBalance`, **`incomeStatement(exercise)`** (classes 6/7), **`balanceSheet(exercise)`** (classes 1-5) par agrégation soldes ; `closingEntries` → à-nouveaux | gel exercice CLOSED |
| `manualEntry.ts` | exposer `createManualEntry` existant à l'UI | équilibre refusé si D≠C |

## 4. Permissions (nouvelles clés)

`accounting.entries.manage` (OD manuelles), `accounting.assets.manage`, `accounting.reconcile.manage`, `accounting.statements.read`. Rôle `BURSAR` reçoit toutes ; `FINANCE_MANAGER` read+export seulement.

## 5. Dépendances et risques

- **Migration additive** : 5 modèles + 3 champs, jamais de données modifiées.
- Risque double-comptage bascule CASH→ACCRUAL : résolu par mode explicite + à-nouveaux.
- `PaymentReconciliation` existant = rapprochement **paiements MoMo**, ne pas réutiliser pour bancaire (AUD-023).

## 6. Lots

| Lot | Contenu | Charge | CA |
|---|---|---|---|
| CG-1 | Migrations + engagement 411 + écran OD + bouton GL | 5 j | recette type H12, aucun double comptage |
| CG-2 | Tiers + balance âgée | 3 j | solde auxiliaire = collectif |
| CG-3 | Bilan + compte de résultat + PDF | 4 j | totaux = balance, exercice clos figé |
| CG-4 | Immobilisations + dotations auto | 3 j | 1 écriture/mois idempotente |
| CG-5 | Rapprochement bancaire | 3 j | import + pointage + écart |
| CG-6 | Clôture + à-nouveaux | 2 j | reprise classes 1-5 |
