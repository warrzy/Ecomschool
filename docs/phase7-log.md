# Phase 7 — Gestion financière des établissements

Branche : `phase-7-finance`
Migration : `20261011020248_phase7_finance`

## Périmètre livré

### Modèle de données
- `FeeCategory` — catégories configurables (inscription, réinscription, scolarité, cantine, transport, uniformes, examens, activités, autres), code unique par école.
- `FeeTariff` — tarif par année, niveau, classe, catégorie ; obligatoire/facultatif ; paiement unique ou échelonné (`installmentCount`) ; **historisé** : réviser un montant archive l'ancien tarif et en crée un nouveau. Les créances déjà établies conservent leur montant figé.
- `StudentFeeCharge` — créance par élève × année × catégorie (unicité, montant figé).
- `FeeInstallment` — échéances (date, montant) ; le statut métier (à venir / partiel / payé / en retard / annulé) est **calculé** depuis les allocations réelles, jamais stocké.
- `FeeDiscount` — remises fixes, %, bourses, exonérations, réductions familiales, ajustements ; motif + auteur obligatoires ; archivage sans suppression.
- `Payment` — encaissement validé/annulé ; `idempotencyKey` unique par école ; `receiptNumber` unique `REC-YYYY-#####` ; `receiptSnapshot` JSON **immuable** (école, élève, classe, agent, solde après paiement).
- `PaymentAllocation` — répartition d'un paiement sur plusieurs échéances (unicité paiement×échéance).
- `CashClosure` — clôture journalière : total figé, unicité école×jour, blocage des encaissements et annulations postérieurs.
- `FeeReminder` — relances internes historisées + notification `FINANCE_REMINDER` (aucun envoi externe).

### Services (`src/lib/services/finance/`)
- `fees.ts` — catégories (défauts idempotents), tarifs avec révision historisée.
- `accounts.ts` — génération des créances (idempotente, upsert par unicité naturelle), dossier financier élève (charges/réductions/exigible/payé/solde/échéances/historique), liste agrégée par classe, réductions.
- `payments.ts` — `recordPayment` (transaction **Serializable** + retry sur P2034/P2002 ; répartition explicite ou FIFO sur les échéances les plus anciennes ; refus si jour clôturé ; snapshot de reçu dans la même transaction), `cancelPayment` (contre-écriture auditée, jamais de suppression), `closeCashDay`, `listUnpaid` (ancienneté en jours), `remindUnpaid`, `financeDashboard` (facturé/encaissé/solde/retards/jour/mois/par catégorie/par mode).

### Interface établissement (`/app/fees`)
- Dashboard : 8 KPI + répartitions catégorie/mode, filtre année, génération des créances (globale ou par classe).
- `/app/fees/settings` — catégories + tarifs, révision de montant historisée.
- `/app/fees/accounts` + `/accounts/[id]` — liste agrégée et dossier élève : échéances éditables, réductions, formulaire d'encaissement, historique des paiements, liens reçus PDF.
- `/app/fees/payments` — journal (filtres date/mode/annulés), total du jour, annulation motivée, **export CSV**, clôture de caisse et historique des clôtures.
- `/app/fees/unpaid` — soldes restants par élève, agrégats par classe et niveau, ancienneté des retards, relances + historique.
- `/app/fees/receipts/pdf?payment=&format=A4|A5` — reçu rendu depuis le snapshot (impression/téléchargement, `finance.receipts.print`).

### Portail parent
- Onglet **Finances** : situation (frais/réductions/payé/solde), échéances avec statuts, paiements et reçus téléchargeables (`/parent/receipts/[id]/pdf`, A5). Lien tuteur↔élève revérifié en base à chaque accès ; aucun paiement en ligne.

### Permissions (bootstrap `scripts/phase7/bootstrap-permissions.ts`)
11 clés : `finance.read`, `finance.configure`, `finance.fees.manage`, `finance.discounts.manage`, `finance.payments.create`, `finance.payments.validate`, `finance.payments.cancel`, `finance.receipts.read`, `finance.receipts.print`, `finance.reports.read`, `finance.cash.close`.
Rôles : `ADMIN_SCHOOL` (toutes), **`FINANCE_MANAGER`** (toutes), **`CASHIER`** (lecture + encaissement + reçus uniquement).

## Règles financières
- Montants en **entiers XOF** (`Int`), champ `currency` conservé pour multi-devise future ; aucun calcul flottant.
- Soldes toujours **dérivés** des enregistrements réels : `exigible = Σ charges actives − réductions`, `solde = exigible − Σ paiements validés`. Aucun total stocké qui puisse dériver.
- `EXEMPTION` = 100 % ; `PERCENT` appliqué sur le total des charges ; les autres types sont des montants fixes.
- Un paiement validé n'est **jamais supprimé** : annulation = statut `CANCELLED` + motif + auteur + audit.
- Reçu historiquement identique : tout le rendu vient du `receiptSnapshot` figé à l'émission.
- Paiements des familles ≠ abonnements SaaS ECOM-TOUCH (aucun couplage).

## Vérifications — 49/49 (`scripts/phase7/business-test.ts`)
Catégories et doublons · tarifs et révision historisée · génération idempotente (montants figés) · échéancier 3× · statuts calculés (retard détecté) · paiement partiel/total/réparti FIFO · **idempotence** (même clé → même reçu) · numérotation unique · remise fixe/%/exonération · annulation auditée · clôture de caisse bloquante · impayés + relance + notification · portail parent autorisé/refusé · séparation des rôles (caissier ≠ config ≠ annulation) · **isolation inter-écoles** complète · **concurrence 4/4** (retry sérialisation, aucun doublon de reçu) · cohérence solde/dashboard vs références calculées indépendamment en base · snapshot immuable (renommage de l'école sans effet) · PDF reçu généré.

## Régressions
- Phase 2 : 31/31 · Phase 3 : 39/39 · Phase 4 : 47/47 · Phase 5 : 44/44 · Phase 6 : 39/39
- `tsc --noEmit` ✅ · `eslint` ✅ · `next build` ✅ (63 routes)

## Correctifs connexes
- `scripts/phase6/business-test.ts` : assertions sur les annonces rendues idempotentes (comptage par id au lieu du total — les runs précédents laissaient des annonces publiées).

## Limites connues
- Pas de prestataire de paiement en ligne (volontaire — hors périmètre de la phase).
- Export PDF du journal non implémenté (CSV livré) ; la fermeture de caisse bloque les dates déjà clôturées sans possibilité de réouverture (par conception).
- Les échéances d'un élève exonéré restent listées dans les impayés bruts (montant > 0 même si exigible à 0) — filtrage métier à affiner si besoin.
