# F3-A — Cadrage Dépenses & Trésorerie

**Date :** 2026-10-21 · **Nature :** audit + cadrage fonctionnel · **Aucune implémentation**

Base : release préprod `20261021_220809` (`dc391eb`).

---

## 1. Surface financière existante (réutilisable)

### Modèles Prisma — recettes uniquement, aucune dépense

| Modèle | Rôle | Points forts réutilisables |
|---|---|---|
| `FeeCategory` | Catégories de frais (scolarité, cantine…) | Pattern `schoolId` + `code` unique + `RecordStatus` (archive, jamais delete) |
| `FeeTariff` | Tarifs par année/niveau/classe | Montants entiers XOF, plan d'échéances |
| `StudentFeeCharge` | Créance figée par élève/année | `@@unique(studentId, academicYearId, categoryId)` — anti-doublon |
| `FeeInstallment` | Échéances | Dates d'échéance, statut métier calculé |
| `FeeDiscount` | Réductions/bourses | ARCHIVED = annulée, historique conservé |
| `Payment` | Encaissements | `receiptNumber` unique/école, `receiptSnapshot` figé, `idempotencyKey` unique, `CANCELLED` non destructif, `receivedById` |
| `PaymentAllocation` | Répartition sur échéances | Traçabilité complète |
| `CashClosure` | Clôture de caisse journalière | `@@unique(schoolId, date)` — base du volet trésorerie |
| `FeeReminder` | Relances internes | Historique |

**Constat : aucun modèle de décaissement** (`Expense`, `ExpenseCategory`, `Supplier`, `Salary…` inexistants). Toute la mécanique existe côté recettes ; le versant dépenses est à créer.

### Services (`src/lib/services/finance/`)

- `accounts.ts` : génération idempotente de créances (`generateStudentCharges`, `generateCharges`, `missingStudentCharges` — reprise après échec), échéances, dossier financier, remises.
- `fees.ts` : catégories + tarifs (CRUD, archivage).
- `payments.ts` : `recordPayment` (idempotent, anti-surpaiement transactionnel, reçu figé), `cancelPayment` (annulation non destructive + motif), `listPayments` (journal), `paymentsStats`, `closeCashDay`, `listUnpaid`/`remindUnpaid`, `financeDashboard`.

### Interfaces (`/app/fees/*`)

Dashboard financier (collecté/dû/solde/retards/série 6 mois), comptes élèves (+ export), échéances (+ export), paiements (+ CSV/export + reçus PDF), guichet d'inscription, impayés (+ export + relances), paramètres tarifs, « Mes encaissements » caissier, clôture de caisse.

### Permissions (bootstrap phase7)

| Clé | ADMIN_SCHOOL | FINANCE_MANAGER | CASHIER |
|---|---|---|---|
| `finance.read` | ✓ | ✓ | ✓ |
| `finance.configure` | ✓ | ✓ | — |
| `finance.fees.manage` | ✓ | ✓ | — |
| `finance.discounts.manage` | ✓ | ✓ | — |
| `finance.payments.create` | ✓ | ✓ | ✓ |
| `finance.payments.validate` | ✓ | ✓ | — |
| `finance.payments.cancel` | ✓ | ✓ | — |
| `finance.receipts.read/print` | ✓ | ✓ | ✓ |
| `finance.reports.read` | ✓ | ✓ | — |
| `finance.cash.close` | ✓ | ✓ | — |

### Mécanismes transverses réutilisables

- `requireSchoolPermission` serveur + `RecordStatus`/`onDelete: Restrict` (aucune suppression d'historique).
- `logAudit` sur chaque écriture.
- `idempotencyKey` + snapshots de reçus → à dupliquer pour les dépenses (justificatif/pièce, validation).
- `checkLimit` / gating abonnement (`PlanModule`) si le module dépenses doit être optionnel.
- Exports CSV/XLSX et PDF existants comme gabarits.

---

## 2. Besoin F3 exprimé

Permettre à l'école d'enregistrer et suivre :
1. **Dépenses de fonctionnement** (loyer, énergie, internet…).
2. **Salaires et indemnités** — dépenses simples dans un premier temps (pas de paie/paie-bulletins).
3. **Achats de fournitures et matériels**.
4. **Frais de maintenance et services**.
5. **Autres décaissements**.

Et une **vue trésorerie** : soldes et flux encaissements/décaissements par période.

---

## 3. Cadrage fonctionnel proposé

### 3.1 Modèle de données cible (proposition — soumise à validation avant toute migration)

```
ExpenseCategory   schoolId · code · label · status
Expense           schoolId · academicYearId? · categoryId
                  amount (Int XOF) · currency
                  label · beneficiary? · paidAt · method (PaymentMethod réutilisé)
                  reference? · attachment? (pièce/justificatif — ultérieur)
                  status: DRAFT → SUBMITTED → APPROVED → PAID / CANCELLED
                  recordedById · approvedById? · approvedAt?
                  cancelledAt/ById/Reason · idempotencyKey (unique/école)
                  audit via logAudit
```

Décisions à trancher (questions ouvertes, §5) :
- Lien année scolaire : recommandé (cohérence avec recettes/dashboards annuels) mais optionnel pour dépenses hors année.
- Workflow : minimal `DRAFT → PAID` avec validation `FINANCE_MANAGER`+ (`SUBMITTED`/`APPROVED` si on veut séparer saisie et validation — à trancher).
- Bénéficiaire libre (texte) vs référentiel fournisseurs — recommandé : **texte libre** en V1, référentiel plus tard si besoin.
- Salaires : **dépense simple catégorisée** en V1 (bénéficiaire = nom de l'agent, période en libellé) ; pas de modèle Employee/Payroll — explicitement hors F3 premier périmètre.
- Pièce justificative : V1 = champ référence + observation ; upload de pièce = lot ultérieur éventuel.

### 3.2 Trésorerie

Vue **calculée**, pas de modèle supplémentaire :
- `treasuryDashboard` = `Payment VALIDATED` (encaissements) − `Expense PAID` (décaissements), par année/période/mois.
- Solde, flux mensuels (série 6 mois — déjà un graphe côté recettes), top catégories de dépenses, clôtures de caisse existantes.
- Pré-requis : les dépenses portent `paidAt` réel (date de décaissement).

### 3.3 Permissions proposées

| Clé | Rôle |
|---|---|
| `expenses.read` | consultation |
| `expenses.create` | saisie d'une dépense (brouillon) |
| `expenses.approve` | validation/approbation + passage PAID |
| `expenses.cancel` | annulation motivée (non destructive) |
| `treasury.read` | vue trésorerie consolidée |
| `expenses.categories.manage` | référentiel catégories de dépenses |

Attribution suggérée : ADMIN_SCHOOL et FINANCE_MANAGER → tout ; CASHIER → `expenses.read` éventuellement (ou rien — à trancher). Bootstrap via script `permission.createMany skipDuplicates` + `rolePermission` — **même mécanisme que phase7/f2, aucune migration de schéma nécessaire pour les permissions**.

### 3.4 UI

- `/app/expenses` : liste + filtres (année, catégorie, statut, période) + export CSV/XLSX.
- Fiche dépense : cycle de vie, pièce/référence, audit.
- `/app/fees/settings` ou page dédiée : catégories de dépenses.
- `/app/treasury` (ou onglet du dashboard finances) : vue consolidée.
- Nav : section « Finances », entrées conditionnées par permission + module abonnement si requis.

### 3.5 Cohérence avec les règles existantes

- Pas d'impact sur les recettes, créances, paiements — les modèles sont disjoints.
- `closeCashDay` ne compte aujourd'hui que les paiements du jour ; intégrer les dépenses en caisse à la clôture = décision à trancher (recommandé : afficher le détail décaissé dans la clôture sans modifier l'historique existant).
- Année `CLOSED` : bloquer la création/validation de dépenses rattachées à l'année (miroir E2-A/E2-C bis) ; les dépenses sans année restent permises.

---

## 4. Découpage en lots proposé

| Lot | Contenu | Migration |
|---|---|---|
| **F3-A** | Cet audit/cadrage | — |
| **F3-B** | Modèles `ExpenseCategory` + `Expense` (migration Prisma — **GO explicite requis**) + services + permissions + UI liste/fiche + recette locale | 1 migration |
| **F3-C** | Trésorerie consolidée (dashboard + exports) + intégration clôture de caisse | aucune |
| **F3-D** | Justificatifs/pièces, référentiel fournisseurs, salaires enrichis — si souhaité | selon scope |

## 5. Questions à trancher avant implémentation

1. **Workflow** : simple (`saisie → payée`) ou approbation (`brouillon → soumise → approuvée → payée`) ? Recommandé : `DRAFT→SUBMITTED→APPROVED→PAID` si FINANCE_MANAGER distinct du saisissant ; sinon minimal.
2. **Lien année** : obligatoire ou facultatif ? (recommandé facultatif, avec garde année close quand renseigné).
3. **Module abonnement** : les dépenses sont-elles incluses dans un module `PlanModule` existant ou un nouveau module `expenses` à créer ?
4. **CASHIER** : peut-il saisir des dépenses ? (recommandé : non — saisie FINANCE_MANAGER/ADMIN).
5. **Catégories par défaut** : seedées (Fonctionnement, Salaires, Fournitures, Maintenance, Divers) comme `ensureDefaultFeeCategories` ?
6. **Justificatif** : upload de pièce en V1 ou champ référence suffisant ?

## 6. Limites de l'audit

- Lecture de code uniquement ; aucun test exécuté, aucune écriture.
- Les modèles proposés ne sont pas encore confrontés au schéma complet (relations `onDelete`, index) — à figer au GO F3-B.
- La clôture de caisse existante n'inclut pas les sorties ; l'intégration est une proposition, pas un constat.

**En attente de ton GO** — aucune implémentation, aucun push, aucun déploiement.
