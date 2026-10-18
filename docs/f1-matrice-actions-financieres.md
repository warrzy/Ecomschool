# Lot F1 — Matrice des actions financières

Croisement **action × permission RBAC × contrôle serveur × module d'abonnement
V2 × plan × profil**. Sources : `fees/actions.ts`, `fees/*/route.ts`,
`fees/*/page.tsx`, `src/lib/services/platform/modules.ts` (`PERMISSION_MODULE_V2`).

---

## 1. Matrice principale

| Action | Contrôle serveur | Module V2 | Essentiel | Professionnel | Premium | CASHIER | FINANCE_MANAGER | ADMIN_SCHOOL |
|---|---|---|---|---|---|---|---|---|
| Consulter dashboard `/app/fees` | `finance.read` | FINANCE_CORE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lister comptes élèves | `finance.read` | FINANCE_CORE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ouvrir fiche compte élève | `finance.read` | FINANCE_CORE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Encaisser** (`recordPaymentAction`) | `finance.payments.create` | FINANCE_CORE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reçu PDF (`receipts/pdf`) | `finance.receipts.print` | FINANCE_CORE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Journal des paiements | `finance.reports.read` | FINANCE_CORE | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Page impayés + relances | `finance.reports.read` (page) | FINANCE_CORE | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Exports CSV/XLSX (×5 routes) | `finance.reports.read` | FINANCE_CORE | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Relance impayé (`remindAction`) | `finance.read` ⚠️ | FINANCE_CORE | ✅ | ✅ | ✅ | ⚠️* | ✅ | ✅ |
| Page configuration `/app/fees/settings` | `finance.configure` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Créer/archiver catégorie | `finance.configure` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Créer/modifier tarifs | `finance.fees.manage` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Générer les frais | `finance.fees.manage` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Modifier une échéance | `finance.fees.manage` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Créer/archiver remise | `finance.discounts.manage` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Annuler un paiement | `finance.payments.cancel` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Clôturer la journée | `finance.cash.close` | FINANCE_MGMT | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Valider un paiement | `finance.payments.validate` | FINANCE_MGMT | — | — | — | ❌ | ✅† | ✅† |

\* `remindAction` n'exige que `finance.read` : le caissier ne peut pas ouvrir la
page (`finance.reports.read`) mais l'action serveur elle-même l'autoriserait —
écart documenté §4.
† Permission accordée au rôle mais **sans consommateur** : aucun flux de
validation n'existe.

## 2. Permissions financières — état de consommation

| Permission | Rôle(s) | Consommateur réel | Verdict |
|---|---|---|---|
| `finance.read` | Cashier, FM, admin | pages + `remindAction` | utilisée |
| `finance.reports.read` | FM, admin | journal, impayés, 5 exports | utilisée |
| `finance.payments.create` | les 3 | `recordPaymentAction` | utilisée |
| `finance.receipts.print` | les 3 | route PDF | utilisée |
| `finance.configure` | FM, admin | settings + catégories | utilisée |
| `finance.fees.manage` | FM, admin | tarifs, génération, échéances | utilisée |
| `finance.discounts.manage` | FM, admin | remises | utilisée |
| `finance.payments.cancel` | FM, admin | `cancelPaymentAction` | utilisée |
| `finance.cash.close` | FM, admin | `closeCashAction` | utilisée |
| `finance.payments.validate` | FM, admin | **aucun** | **morte** |
| `finance.receipts.read` | les 3 | **aucun** | **morte** |
| `finance.manage` | admin seul | **aucun** | **morte** |

## 3. Séparation FINANCE_CORE / FINANCE_MGMT — vérification

| Périmètre attendu | Couverture effective | Conforme |
|---|---|---|
| FINANCE_CORE : caisse, encaissements, reçus, impayés | `finance.read`, `payments.create`, `receipts.print`, `receipts.read`, `reports.read` | ✅ — inclut journal/impayés/exports dans Essentiel (choix A1 assumé) |
| FINANCE_MGMT : config, remises, validation, annulation, clôture | `configure`, `fees.manage`, `discounts.manage`, `payments.validate`, `payments.cancel`, `cash.close` | ✅ |

**Conséquence vérifiée en recette A3** : sous Essentiel, un utilisateur avec un
rôle « gestionnaire » verrait journal/impayés/exports ouverts mais `settings`,
remises, annulations et clôtures refusées — frontière exacte CORE/MGMT.

## 4. Robustesse contre les appels directs

Chaque server action de `fees/actions.ts` appelle `requireSchoolPermission`
avant tout traitement : un caissier appelant directement
`cancelPaymentAction`/`closeCashAction`/`createTariffAction` reçoit `FORBIDDEN`.
Les routes d'export et le PDF ont leur propre garde. **Aucune fuite RBAC
constatée** à l'exception de `remindAction` (`finance.read` au lieu de
`finance.reports.read`, impact : notification interne uniquement).

Double couche confirmée : la permission est d'abord filtrée par
`permissionCoveredByEntitlements` (module du plan) puis accordée par le rôle —
un caissier sous Essentiel ne peut jamais atteindre `finance.configure` même en
forçant un appel.

## 5. Modèles Prisma concernés

`FeeCategory`, `FeeTariff`, `StudentFeeCharge`, `FeeInstallment`,
`FeeDiscount`, `Payment` (+`receiptSnapshot`, `receivedById`, `idempotencyKey`),
`PaymentAllocation`, `CashClosure`, `FeeReminder`. Aucun modèle de dépense,
compte bancaire, budget ou écriture comptable.
