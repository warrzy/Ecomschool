# Lot F1 — Audit fonctionnel : profil FINANCE_MANAGER (Responsable financier)

**Périmètre :** audit lecture seule, fondé sur le code réel. Aucune recette
authentifiée exécutée (pas de compte de démonstration — voir §6).

**Permissions du rôle en base (11/12, vérifiées par requête DB en lecture) :**
`finance.read`, `finance.configure`, `finance.fees.manage`,
`finance.discounts.manage`, `finance.payments.create`,
`finance.payments.validate`, `finance.payments.cancel`,
`finance.receipts.print`, `finance.receipts.read`, `finance.reports.read`,
`finance.cash.close`.

Seule permission financière absente du rôle : `finance.manage` — permission
morte (aucune route, action ou service ne la consomme).

---

## 1. Menus visibles dans la sidebar

| Entrée | URL | Condition | Visible |
|---|---|---|---|
| **Finances** | `/app/fees` | `finance.read` | ✅ — même entrée unique que le caissier |

Le responsable financier n'a pas plus de menus que le caissier : toute la
hiérarchie interne se joue sur la page `/app/fees` (liens « Journal »,
« Impayés », « Configuration » affichés conditionnellement) et dans les fiches.

## 2. Inventaire écran par écran

| Écran | URL | Informations affichées | Actions possibles | Permission requise | Fonctionnement vérifié |
|---|---|---|---|---|---|
| Tableau de bord Finances | `/app/fees` | 8 KPI (facturé, remises, encaissé, reste dû, jour, mois, retards, exigible) ; ventilation par catégorie et par mode | **Générer les frais** (panneau de confirmation) ; liens Journal / Impayés / Configuration / Exports | `finance.read` (+ `finance.fees.manage` pour génération, `finance.reports.read`/`finance.configure` pour les liens) | ✅ `fees/page.tsx` |
| Comptes élèves | `/app/fees/accounts` | Liste financière par année/classe (facturé, remises, payé, solde) | Filtres ; liens exports CSV/XLSX ; dossiers | `finance.read` ; exports `finance.reports.read` | ✅ |
| Fiche compte élève | `/app/fees/accounts/[id]` | Situation complète, échéances, remises, historique | **Encaisser** ; **modifier une échéance** (montant/date) ; **créer/archiver une remise** ; reçu PDF | `finance.read` + `fees.manage` + `discounts.manage` + `payments.create` + `receipts.print` | ✅ `accounts/[id]/page.tsx` |
| Journal des paiements | `/app/fees/payments` | Tableau : date, reçu, élève, mode, référence, montant, statut ; total du jour ; liste des clôtures | Filtres année/mode/dates/annulés ; exports CSV/XLSX ; **annuler un paiement** (motif + confirmation) ; **clôturer la journée** | `finance.reports.read` ; `payments.cancel` ; `cash.close` | ✅ `payments/page.tsx` |
| Impayés / retards | `/app/fees/unpaid` | Soldes par échéance, retards par classe et par niveau, jours de retard | Filtres année/classe ; exports (impayés, retards seuls) ; **relance interne** (note → notification portail parent/élève) | `finance.reports.read` ; relance `finance.read` | ✅ `unpaid/page.tsx` |
| Configuration | `/app/fees/settings` | Catégories de frais ; tarifs par niveau/classe/année | Créer/archiver catégories ; créer tarifs ; modifier montants | `finance.configure` ; `fees.manage` pour les tarifs | ✅ `settings/page.tsx` |
| Exports | `/app/fees/{accounts,installments,payments,unpaid}/export`, `/app/fees/payments/csv` | CSV / XLSX | Téléchargement | `finance.reports.read` | ✅ |
| Reçu PDF | `/app/fees/receipts/pdf?payment=…` | Reçu A5/A4 depuis snapshot | Impression | `finance.receipts.print` | ✅ |

**Le responsable financier accède à 100 % de l'espace financier implémenté.**

## 3. Capacités de supervision — vérification

| Capacité | État | Mécanisme |
|---|---|---|
| Gestion des catégories de frais | ✅ | `settings` + `createCategoryAction` / `archiveCategoryAction` (`finance.configure`) ; archivage non destructif |
| Paramétrage des tarifs | ✅ | Tarifs par catégorie × niveau/classe × année (`finance.fees.manage`) |
| Génération des frais | ✅ | `generateChargesAction` (`finance.fees.manage`, confirmation UI) |
| Gestion des remises | ✅ | Création/archivation sur fiche élève (`finance.discounts.manage`) ; PERCENT, FIXED, EXEMPTION |
| Suivi créances / échéances | ✅ | Échéances modifiables (montant/date) sur fiche ; export échéances |
| Suivi des impayés | ✅ | Page dédiée + relances internes (`FeeReminder` + notification portail, aucun envoi externe) |
| Rapports de recettes | ⚠️ partiel | Journal + exports + ventilation par catégorie/mode sur dashboard — **pas de rapport agrégé par période/classe/caissier** |
| Validation des paiements | ❌ concept absent | Les paiements naissent `VALIDATED` à l'encaissement ; `finance.payments.validate` est **morte** |
| Annulation des paiements | ✅ | `cancelPayment` : statut `CANCELLED` + motif obligatoire + `cancelledById` + audit — **jamais de suppression** ; refusé si jour clôturé |
| Contrôle des opérations caissiers | ⚠️ partiel | `Payment.receivedById` stocké, mais le journal **n'affiche pas** le caissier et ne permet pas de filtrer par caissier (filtre `receivedById` disponible dans `listPayments` mais non exposé) |
| Clôture de caisse | ✅ | `closeCashDay` : total figé, blocage des encaissements/annulations du jour (`CLOSED_DAY`) ; liste des clôtures sur le journal |
| Export des données | ✅ | 5 routes CSV/XLSX (`finance.reports.read`) |
| Tableaux de bord / KPI | ✅ | 8 indicateurs + ventilations |
| Audit | ✅ | `logAudit` sur paiement/annulation/clôture |

## 4. Fonctionnalités absentes — vérification explicite

Recherche dans `prisma/schema.prisma` et `src/` : **aucun modèle ni écran** pour :

| Fonctionnalité | État |
|---|---|
| Dépenses | ❌ Absent |
| Fournisseurs | ❌ Absent |
| Comptes de trésorerie | ❌ Absent — `CashClosure` est un marqueur journalier, pas un compte |
| Banques / Mobile Money | ❌ Absent — les modes sont de simples libellés sur `Payment`, sans comptes associés |
| Budgets | ❌ Absent |
| Comptabilité générale (plan comptable, écritures) | ❌ Absent |
| Journaux comptables | ❌ Absent |
| Rapprochements | ❌ Absent |
| États financiers | ❌ Absent |

L'application finance **des créances et des encaissements élèves** — pas de la
comptabilité. Cohérent avec le périmètre annoncé (trésorerie = Pro futur,
budgets/fournisseurs = Premium futur).

## 5. Incohérences relevées

1. **`finance.payments.validate` morte** : accordée au rôle, mappée
   `FINANCE_MGMT`, mais aucun code ne l'exige — pas de statut `PENDING` dans
   `PaymentStatus` (`VALIDATED`/`CANCELLED` uniquement).
2. **`finance.receipts.read` morte** : aucune page de liste des reçus ; le seul
   consommateur de reçus est la route PDF (`finance.receipts.print`).
3. **`remindAction` sous-protégée** : garde `finance.read` alors que la page qui
   l'appelle exige `finance.reports.read` — un caissier pourrait invoquer
   l'action serveur directement (impact faible : notification interne).
4. **Journal sans caissier** : ni colonne ni filtre `receivedById` → impossible
   de contrôler « qui a encaissé quoi » sans requête SQL.
5. **Clôture unique par école** : un seul `CashClosure` par jour pour tout
   l'établissement — pas de caisses séparées par agent/guichet.
6. **Surpaiement accepté** : `recordPayment` n'impose pas `amount ≤ solde` —
   `balanceAfter` peut devenir négatif sans avertissement.

## 6. Recette authentifiée proposée (à exécuter ultérieurement)

Pré-requis : un utilisateur démo avec membership `FINANCE_MANAGER` sur l'école
de démonstration — **création non autorisée dans le cadre F1**.

Scénario lecture seule proposé (extension de `scripts/a3/subscription-recette.ts`) :

| # | Contrôle | Attendu |
|---|---|---|
| 1 | `/app/fees` | 200, KPI visibles, liens Journal/Impayés/Configuration présents |
| 2 | `/app/fees/settings` | 200 (vs `forbidden` pour CASHIER) |
| 3 | `/app/fees/payments` | 200, liste + lien annulation + bloc clôture |
| 4 | `/app/fees/unpaid` | 200, tableau retards + formulaire relance |
| 5 | `/app/fees/accounts` | 200, liens exports visibles |
| 6 | `/app/fees/accounts/[id]` | 200, formulaires échéance + remise + encaissement |
| 7 | `/app/fees/accounts/export?format=csv` | 200, contenu CSV |
| 8 | `/app/fees/receipts/pdf?payment=<id>` | 200 PDF |
| 9 | Sous scénario Essentiel (overrides) | `settings` → forbidden (FINANCE_MGMT absent) ; `payments`/`unpaid`/exports restent ouverts (FINANCE_CORE) |
| 10 | Aucune action d'écriture exécutée | — |

Règles : aucun clic sur Encaisser/Annuler/Clôturer/Relancer/Générer ; vérifier
uniquement l'affichage et les refus.
