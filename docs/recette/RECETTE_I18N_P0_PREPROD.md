# Recette i18n P0 — scénarios préproduction par pays

> Prérequis : merge de `feat/i18n-p0` + déploiement préprod + `npx tsx scripts/i18n/backfill-payroll-maps.ts` (optionnel, repli hérité sinon).
> Cible : `https://preprod.ecomschool.fr`. Aucun test sur la production.
> Rappel : **aucun pack comptable/payroll non-OHADA n'existe encore** (P1) — les refus explicites font partie du périmètre testé, pas des bugs.

## Matrice de disponibilité par pays

| Capacité | BF | CI | SN | GH | NG | FR |
|---|---|---|---|---|---|---|
| Onboarding pays/devise/fuseau | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Affichage montants (devise école) | FCFA | FCFA | FCFA | GH₵ | ₦ | € |
| Scolarité/élèves/finances internes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Plan comptable de démarrage | ✅ SYSCOHADA | ✅ SYSCOHADA | ✅ SYSCOHADA | ⚠️ SYSCOHADA installé mais états refusés¹ | ⚠️ idem | ⚠️ idem |
| Bilan / compte de résultat | ✅ | ✅ | ✅ | ❌ `STATEMENT_MAPPING_MISSING`² | ❌ idem | ❌ idem |
| Écritures de paie (compta) | ✅ via `PAYROLL:*` | ✅ | ✅ | ⚠️ poste vers plan installé ; états refusés | ⚠️ | ⚠️ |
| Paiement mobile money | ✅ XOF | ✅ XOF | ✅ XOF | ❌ `INVALID_CURRENCY` | ❌ `INVALID_CURRENCY` | ❌ `INVALID_CURRENCY` |
| Paie réglementaire (cotisations) | ❌ non validée | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ Le plan SYSCOHADA s'installe partout (comportement P0 inchangé) mais les états exigent le référentiel OHADA ou un mapping valide.
² Sauf déclaration explicite `settings.accountingFramework="OHADA_SYSCOHADA"` ou `settings.statementMapping` valide — cf. scénario R5.

---

## Scénarios transverses

### R1 — Onboarding pays/devise/fuseau (tous pays)

1. `/platform/onboarding` → le champ **Pays** propose les 10 pays du registre.
2. Sélectionner chaque pays → l'aperçu affiche devise + fuseau dérivés :
   BF→XOF/Africa-Ouagadougou · CI→XOF/Abidjan · SN→XOF/Dakar · GH→GHS/Accra · NG→NGN/Lagos · FR→EUR/Paris.
3. Créer l'établissement → vérifier en base/admin : `country`, `currency`, `timezone`, `locale` = défauts du pays (pas de BF en dur).
4. **Négatif** : soumettre `country=GH` + `currency=XOF` → rejet `CURRENCY_MISMATCH`, école non créée.
5. **Négatif** : pays hors registre → `COUNTRY_UNKNOWN`.

### R2 — Affichage des montants (BF/CI/SN vs GH/NG/FR)

1. École XOF (BF/CI/SN) : pages finances/trésorerie/dépenses/reçus → montants `… FCFA`, groupage espace identique à l'existant.
2. École GH : mêmes pages → `… GH₵` avec 2 décimales (locale `en-GH`) ; labels « Montant (GH₵) », pas de « FCFA ».
3. École NG → `₦` ; école FR → `€`.
4. Reçu PDF : devise = snapshot de l'école — régénérer un reçu sur chaque école.
5. **Régression** : captures avant/après sur l'école BF existante → rendu pixel-identique.

### R3 — Écritures de paie et états (pays OHADA : BF/CI/SN)

1. `installStarterPlan` → 4 mappings `PAYROLL:*` présents (vérif. écran Comptabilité ou requête).
2. Campagne de paie → bulletin → posting → écriture équilibrée, comptes `66/422/431/421` résolus via clés.
3. Supprimer les mappings sur une école de test → posting **fonctionne encore** (repli codes hérités) → restaurer via `backfill-payroll-maps.ts`.
4. Bilan : actif=passif, sections OHADA ; compte de résultat ; export CSV.

### R4 — Refus explicite des référentiels manquants (GH/NG/FR)

1. École GH → `/app/comptabilite/etats` → message d'erreur explicite (`STATEMENT_MAPPING_MISSING`), **aucun état partiel affiché**.
2. Idem export CSV → `error=STATEMENT_MAPPING_MISSING`.
3. `settings.statementMapping={bogus}` → `STATEMENT_MAPPING_INVALID`.
4. Réparer via `settings.accountingFramework="OHADA_SYSCOHADA"` → états générés (documenter comme déclaration explicite).

### R5 — Paiements selon devise

1. École XOF + provider sandbox : intention parent + admin → `currency="XOF"`, cycle complet.
2. École GH/NG/FR : tentative d'intention → `INVALID_CURRENCY` explicite (la devise école est propagée, le gate provider bloque proprement — adaptateurs P2).
3. Remboursement : initié dans la devise de l'intention.

### R6 — Non-régression établissements BF existants

1. Écoles préexistantes : `country=BF`, `currency=XOF` inchangés, `settings` inchangé.
2. Paie, encaissements, états, reçus : comportement identique (comparer avec les captures de `docs/demo/screenshots/`).
3. `platformUpdateSchool` reste la seule voie d'édition pays/devise — auditée.

## Ordre d'exécution suggéré (préprod)

1. Backfill mappings → 2. R6 non-régression BF → 3. R1 onboarding (créer 6 écoles pays) → 4. R2 affichage → 5. R3 OHADA → 6. R4 refus → 7. R5 paiements.

Durée estimée : ~1 h avec données minimales par école (1 élève, 1 reçu, 1 employé, 1 bulletin).
