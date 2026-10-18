# Lot F1 — Écarts et recommandations

Synthèse transverse des deux audits. Chaque constat est classé et assorti des
chemins de code justificatifs.

---

## EXISTANT ET OPÉRATIONNEL

- Socle caisse complet : comptes élèves, échéances, encaissement FIFO
  (partiel/multi-échéances), 5 modes, reçus numérotés immuables + PDF,
  anti-doublons (idempotence + Serializable), clôture journalière bloquante,
  annulation auditée, relances internes, exports CSV/XLSX.
  `src/lib/services/finance/payments.ts`, `accounts.ts`, `fees.ts`.
- RBAC strict côté serveur sur chaque page/action/route ; double couche
  abonnement + rôle (`permissionCoveredByEntitlements`).
- Séparation V2 conforme : FINANCE_CORE (caisse) dès Essentiel, FINANCE_MGMT
  (supervision) dès Professionnel — vérifié en recette A3.

## EXISTANT MAIS INCOMPLET

| Écart | Détail | Code |
|---|---|---|
| Journal sans identité caissier | `receivedById` stocké à l'encaissement, filtre `receivedById` disponible dans `listPayments` — ni colonne ni filtre dans l'UI | `payments/page.tsx` (tableau), `payments.ts:345,369` |
| Total du jour non différencié | KPI « Encaissé aujourd'hui » = total école, pas par caissier | `financeDashboard` |
| Allocations manuelles invisibles | `recordPayment` accepte `allocations[]` — l'UI ne propose que le FIFO | `payments.ts:96-137`, formulaire `accounts/[id]/page.tsx` |
| Validation de paiement inexistante | statut créé `VALIDATED` ; `PaymentStatus` n'a pas `PENDING` ; `finance.payments.validate` morte | `payments.ts:195`, `schema.prisma` |
| `finance.receipts.read` morte | aucune page de liste de reçus | `fees/receipts/` ne contient que `pdf/` |
| `finance.manage` morte | aucun consommateur | modules.ts |
| `remindAction` sous-protégée | `finance.read` vs page `finance.reports.read` | `fees/actions.ts`, `unpaid/page.tsx` |
| Surpaiement silencieux | `recordPayment` n'exige pas `amount ≤ solde` ; `balanceAfter` peut passer négatif | `payments.ts:52,193` |
| Clôture unique | un `CashClosure` par jour et par école — pas de multi-caisses | `schema.prisma:556` |

## ABSENT

| Manque | Impact |
|---|---|
| Recherche élève (nom/matricule) dans l'espace financier | Parcours caissier pénalisé sur grands effectifs — `listAccounts` ne supporte que année/classe |
| « Mes opérations » du caissier | Le caissier ne peut pas consulter son propre journal ; dépend de la fiche élève ou du FM |
| Vue journalière par caissier / multi-caisses | Pas de réconciliation par agent en fin de journée |
| Dépenses, fournisseurs, trésorerie, banques/MoMo, budgets, comptabilité générale, journaux comptables, rapprochements, états financiers | Aucun modèle/écran — périmètre futur assumé (Pro/Premium) |

## RECOMMANDATION FUTURE — par priorité

**P1 — Expérience caissier (court terme, faible coût)**
1. Recherche nom/matricule sur `/app/fees/accounts` (paramètre `q` côté
   `listAccounts` + champ UI).
2. Onglet « Mes encaissements » : `listPayments` filtré `receivedById =
   ctx.userId` sous `finance.read` — réconcilie la journée sans ouvrir le
   journal global.
3. Plafonner l'encaissement au solde restant (validation `recordPayment`).

**P2 — Supervision**
4. Colonne + filtre « Caissier » dans le journal ; total du jour ventilé par
   `receivedById`.
5. Réaligner `remindAction` sur `finance.reports.read`.
6. Page « Reçus » listant les reçus émis (rend `receipts.read` utile).

**P3 — Décisions produit à trancher**
7. `finance.payments.validate` : implémenter un flux `PENDING → VALIDATED`
   (caissier propose, FM valide) **ou** supprimer la permission et son mapping.
8. Multi-caisses : clôture par agent (`CashClosure.receivedById`?) si plusieurs
   guichets réels.
9. Périmètre comptable futur (dépenses/fournisseurs/trésorerie) : nouveau lot —
   aucun modèle existant à réutiliser.

## Incohérences abonnements (rappel A3)

- Association `FINANCE` résiduelle sur Premium : inerte sous V2, visible sur
  `/tarifs` — nettoyage PlanModule à planifier.
- `REPORTS` (module) ne contrôle que `reports.attendance` ; les rapports
  financiers passent par `finance.reports.read` → FINANCE_CORE — périmètre du
  module à définir avant d'y rattacher d'autres rapports.

## Non-constats (points sains à conserver)

- Aucune donnée personnelle superflue dans les écrans financiers (identité
  limitée à nom/matricule/classe).
- Aucune fuite RBAC détectée sur actions sensibles (annulation, clôture, config).
- Snapshot de reçu immuable → reçus historiques préservés après annulation.
- Fail-open sans abonnement inchangé (décision documentée A2, hors périmètre F1).
