# Lot F1 — Audit fonctionnel : profil CASHIER (Caissier)

**Périmètre :** audit lecture seule, fondé sur le code réel (routes, services, gardes,
modèles Prisma). Aucune exécution métier, aucune donnée créée.
**Référence rôle (base) :** `CASHIER` = `finance.read`, `finance.payments.create`,
`sfinance.receipts.print`, `finance.receipts.read` (4 permissions sur 12 définies).

> Rôle par défaut : les écoles peuvent ajuster les permissions de leurs rôles ;
> l'audit porte sur le rôle livré en standard.

---

## 1. Menus visibles dans la sidebar

Source : `src/app/app/(tenant)/ui/nav.ts`.

| Entrée | URL | Condition d'affichage | Visible CASHIER |
|---|---|---|---|
| **Finances** | `/app/fees` | `finance.read` | ✅ Oui — seule entrée du volet financier |

Le caissier n'a **aucun autre menu financier** : pas de « Journal », « Impayés »,
« Configuration », ni « Reçus » dans la navigation — tout passe par le tableau de
bord Finances, qui redirige ensuite vers les sous-écrans selon les permissions.

## 2. Inventaire écran par écran

| Écran | URL | Informations affichées | Actions possibles | Permission requise | Fonctionnement vérifié |
|---|---|---|---|---|---|
| Tableau de bord Finances | `/app/fees` | 8 KPI : facturé, remises, encaissé, reste dû, encaissé aujourd'hui, encaissé du mois, échéances en retard (nombre + montant), exigible ; ventilation par catégorie et par mode de paiement ; lien « Comptes élèves » | Navigation vers `/app/fees/accounts` | `finance.read` | ✅ `fees/page.tsx` — données réelles via `financeDashboard()` |
| Comptes élèves | `/app/fees/accounts` | Tableau : matricule, nom, classe, montant facturé, remises, payé, **solde** ; filtre année + classe ; n'affiche que les dossiers avec charges ou paiements | Filtres année/classe ; lien « Dossier » par élève | `finance.read` | ✅ `accounts/page.tsx` + `listAccounts()` |
| Fiche compte élève | `/app/fees/accounts/[id]` | Totaux (facturé/remises/dû/payé/solde), échéances avec statuts, remises appliquées, **historique des paiements** (date, n° reçu, mode, référence, montant, statut) | **Encaisser** (montant, mode, référence, observation) ; lien reçu PDF par paiement | `finance.read` + `finance.payments.create` (formulaire) + `finance.receipts.print` (PDF) | ✅ `accounts/[id]/page.tsx` |
| Reçu PDF | `/app/fees/receipts/pdf?payment=…` | PDF A5 (ou `format=A4`) généré depuis le snapshot immuable du reçu | Impression/téléchargement | `finance.receipts.print` | ✅ `receipts/pdf/route.ts` — snapshot JSON, jamais régénéré |

### Écrans financiers INACCESSIBLES au caissier

| Écran | URL | Garde | Conséquence |
|---|---|---|---|
| Journal des paiements / caisse | `/app/fees/payments` | `finance.reports.read` ❌ | Redirection `/app/forbidden` — vérifié A3 |
| Impayés / retards | `/app/fees/unpaid` | `finance.reports.read` ❌ | Refusé |
| Configuration frais | `/app/fees/settings` | `finance.configure` ❌ | Refusé |
| Exports CSV/XLSX (comptes, échéances, paiements, impayés) | `/app/fees/*/export` | `finance.reports.read` ❌ | Refusé — liens masqués **et** refusés côté serveur |

## 3. Gestion financière des élèves — capacité réelle

La liste `/app/fees/accounts` est une **vraie liste financière** (pas la liste
élèves générale) : `listAccounts()` agrège charges + remises + paiements validés
par élève inscrit, et la page exclut les dossiers vides.

| Capacité demandée | État | Détail |
|---|---|---|
| Rechercher par nom/matricule | ❌ **Absent** | `listAccounts` n'accepte que `academicYearId` + `classroomId` ; aucun champ de recherche dans l'UI → défilement manuel dans la liste |
| Filtrer par classe / année | ✅ | Selects année + classe (GET) |
| Identité utile (nom, matricule, classe) | ✅ | Exactement ce qu'il faut — rien de superflu (pas d'infos personnelles non nécessaires affichées) |
| Frais applicables | ✅ | Charges par catégorie sur la fiche |
| Échéances | ✅ | Libellé, date, montant, solde résiduel, statut |
| Total dû / payé / reste | ✅ | En-tête de fiche + colonnes de la liste |
| Historique des paiements | ✅ | Table sur la fiche (reçu, mode, montant, statut) |
| Reçus | ✅ | Lien PDF par paiement validé |
| Enregistrer un paiement depuis la fiche | ✅ | Formulaire « Encaisser » |

## 4. Encaissements et caisse — détail fonctionnel

| Fonction | État | Profil | Mécanisme |
|---|---|---|---|
| Créer un encaissement | ✅ | CASHIER | `recordPayment()` + `recordPaymentAction` (`finance.payments.create`) |
| Paiement partiel | ✅ | CASHIER | Montant libre (entier > 0), répartition FIFO automatique sur les échéances les plus anciennes |
| Payer plusieurs échéances | ✅ partiel | CASHIER | Le montant couvre plusieurs échéances via FIFO ; **l'allocation manuelle** (`allocations[]` dans `recordPayment`) existe côté service mais **n'est pas exposée dans l'UI** |
| Modes de paiement | ✅ | CASHIER | `CASH`, `BANK_TRANSFER`, `CHECK`, `MOBILE_MONEY`, `OTHER` |
| Numérotation reçus | ✅ | auto | `REC-YYYY-NNNNN`, unique par école (`@@unique[schoolId, receiptNumber]`) |
| Reçu PDF / impression | ✅ | CASHIER | Snapshot immuable + PDF A5/A4 |
| Historique des opérations | ⚠️ partiel | CASHIER | Historique **par élève** sur la fiche ; **aucun journal de caisse accessible** (journal global = `finance.reports.read`) |
| Identité du caissier | ⚠️ stocké, invisible | — | `Payment.receivedById` renseigné mais **jamais affiché** (pas de colonne « encaissé par » ni de filtre dans le journal) |
| Annulation / correction | ❌ | FINANCE_MANAGER+ | `finance.payments.cancel` absent du rôle CASHIER |
| Validation des paiements | — | n/a | Les paiements naissent `VALIDATED` — aucun flux de validation n'existe ; `finance.payments.validate` est une **permission morte** |
| Journal de caisse | ❌ | refusé | `/app/fees/payments` inaccessible |
| Clôture de caisse | ❌ | FINANCE_MANAGER+ | `finance.cash.close` absent du rôle |
| Totaux journaliers | ⚠️ partiel | CASHIER | KPI « Encaissé aujourd'hui » du dashboard = **total école**, pas total du caissier |
| Plusieurs caissiers | ⚠️ partiel | — | `receivedById` distingue les opérations en base, mais aucune vue par caissier |
| Anti-doublons | ✅ | auto | `idempotencyKey` unique + transaction Serializable + retry sur collisions |

### Pourquoi `/app/fees/payments` est refusé au caissier

Garde de la page : `requireSchoolPermission("finance.reports.read")`
(`fees/payments/page.tsx`). Le rôle CASHIER possède `finance.read` mais **pas**
`finance.reports.read` — c'est un choix RBAC (le journal est une vue de
supervision), **pas** une restriction d'abonnement : sous Essentiel,
`FINANCE_CORE` couvrirait déjà `finance.reports.read` si le rôle l'accordait.

### Écran de consultation de ses propres opérations

**Il n'en existe aucun.** Le caissier peut retrouver un paiement uniquement en
rouvrant la fiche de l'élève concerné. Il ne peut pas répondre à « qu'ai-je
encaissé ce matin ? » — le service `listPayments` accepte pourtant un filtre
`receivedById` (non exploité par l'UI).

## 5. Parcours réel — parent qui vient payer une partie de la scolarité

1. Sidebar → **Finances** → lien **Comptes élèves**.
2. Choisit l'année + la classe → **défile la liste** pour repérer l'élève
   (⚠️ pas de recherche : lourd à 300–1 000 élèves).
3. Ouvre le **Dossier** → voit dû/payé/solde, échéances, historique.
4. Saisit montant + mode (+référence/observation) → **Encaisser**
   (répartition FIFO automatique sur les plus anciennes échéances).
5. Clique **PDF** sur la ligne du paiement → imprime le reçu.
6. Plus tard : peut retrouver l'opération **seulement en rouvrant la même fiche**.

Étapes impossibles/lourdes : recherche élève absente (2), choix de l'échéance à
imputer absent (4), pas de vue « mes opérations du jour » ni de correction de sa
propre erreur sans responsable financier.

## 6. Classification

- **EXISTANT ET OPÉRATIONNEL** : dashboard, liste comptes, fiche élève complète,
  encaissement FIFO (partiel/pluri-échéances), 5 modes, reçu numéroté + PDF
  immuable, anti-doublons, blocage jour clôturé (`CLOSED_DAY`).
- **EXISTANT MAIS INCOMPLET** : allocations manuelles (service oui / UI non) ;
  `receivedById` (stocké / non affiché) ; total du jour (école / pas par caissier).
- **ABSENT pour le caissier** : recherche nom/matricule, journal personnel,
  annulation, clôture, exports, impayés.
- **Permissions mortes du rôle** : `finance.receipts.read` (aucune page « reçus »
  n'existe — les reçus ne s'atteignent que par le PDF).
