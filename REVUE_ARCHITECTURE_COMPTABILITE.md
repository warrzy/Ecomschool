# REVUE ARCHITECTURE — Comptabilité générale SYSCOHADA

Document revu : `docs/architecture/comptabilite-generale-syscohada.md` (branche `docs/architecture-rh-compta`). Code de référence : `main` = `ec62b59`. Revue indépendante — inclut l'autocritique.

## Points validés

| Exigence | Constat | Preuve |
|---|---|---|
| Intégration modèles existants | ✅ Extension additive, rien de modifié | `AccountingEntry.sourceType` + `@@unique([schoolId,sourceType,sourceId])` existe (`schema.prisma:3768`) — l'idempotence proposée s'appuie sur une contrainte réelle |
| Séparation facturation/créances/encaissements | ✅ D411·C706 à la charge / D57x·C411 au règlement | `StudentFeeCharge` (:446) est la source `CHARGE` ; `Payment` (:536) devient settlement |
| Anti double-comptage | ✅ Mode `ACCRUAL` explicite, défaut `CASH`, pas de réécriture rétroactive | paramètre école, écritures de bascule à l'ouverture d'exercice |
| Partie double | ✅ Réutilise `createEntry`/`postEntrySafe` (équilibre + P2002 sûr) | `accounting.ts` H12, recette 68/68 |
| Permissions | ✅ 4 clés nouvelles, BURSAR reçoit tout | cohérent `accounting.read/manage/export` |
| Traçabilité | ✅ `AuditLog` déjà branché partout | pattern existant |

## Anomalies identifiées

| # | Criticité | Anomalie | Preuve | Correction |
|---|---|---|---|---|
| CG-A | **P1** | **Lettrage partiel impossible** : `reconciledAt` sur EntryLine ne permet pas N paiements ↔ 1 créance ni acomptes. La balance âgée exige un lien charge↔règlement | doc §2 — champ unique insuffisant | Ajouter `AccountingAllocation { chargeEntryLineId, paymentEntryLineId, amount }` — lettrage partiel, solde auxiliaire correct |
| CG-B | **P1** | **Bascule CASH→ACCRUAL incomplète** : les créances **impayées antérieures** au switch n'entrent pas en 411 → auxiliaire incomplet | doc §1 | Procédure de bascule : à l'activation, énumérer `StudentFeeCharge` non soldées → OD d'ouverture D411/C706 (ou C119 report à nouveau) datée ouverture d'exercice |
| CG-C | P2 | Balance âgée suppose `dueDate` sur `StudentFeeCharge` | champ à confirmer dans le schéma (échéancier existe — probablement `dueDate`) | Confirmer à l'implémentation ; sinon ajouter migration champ |
| CG-D | P2 | `ThirdParty.refId` polymorphe sans FK | doc §2 `refId String?` | Acceptable (pattern souple) mais ajouter contrôle applicatif `kind↔table` dans le service |
| CG-E | P2 | États SYSCOHADA : agrégation soldes non spécifiée (rubriques, signes, actif/passif) | doc §3 `statements.ts` | Spécifier le mapping rubrique→classes SYSCOHADA avant CG-3 (référent métier requis) |
| CG-F | P3 | `AccountingBudget` hors périmètre P3 mêlé au lot | doc §2 | Sortir du schéma initial ou marquer différé |

## Incohérences historiques ACCRUAL/CASH

Mode par école, défaut `CASH` = comportement actuel inchangé → **aucune régression**. Seule lacune = CG-B (bascule). Exercices CLOSED figés — les anciens exercices ne sont jamais retouchés.

## DÉCISION : **GO SOUS RÉSERVES**

Corriger le schéma d'allocation (CG-A) et la procédure de bascule (CG-B) dans le document **avant** lot CG-1. CG-E à spécifier avant CG-3.
