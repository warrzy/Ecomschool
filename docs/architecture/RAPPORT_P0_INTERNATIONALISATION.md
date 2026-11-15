# Rapport P0 — Internationalisation (branche `feat/i18n-p0`)

> Statut : **implémenté, testé, non fusionné, non déployé.**
> Périmètre : fmtMoney centralisé · clés sémantiques paie · registre pays + sélecteur onboarding · mappings d'états externalisés.
> Aucune activation réglementaire — aucune règle de paie pays n'a été créée ni validée.

## Résultat des tests

| Suite | Environnement | Résultat |
|---|---|---|
| `scripts/i18n/test-i18n-p0.ts` | schéma Postgres isolé `i18np0` | **37 PASS / 0 FAIL** |
| `scripts/preprod/test-stabilisation.ts` | même schéma | **44 PASS / 0 FAIL** |
| `tsc --noEmit` | repo complet | 0 erreur |

Points vérifiés notamment : équivalence bit-à-bit `fmtMoney` vs ancien littéral XOF sur 7 montants (dont négatif) ; GHS/NGN/EUR ; écriture de paie postée via clés `PAYROLL:*` équilibrée ; repli sur codes hérités quand les mappings sont absents ; bilan équilibré et sections OHADA ; surcharge `settings` prise en compte et repli OHADA sur mapping invalide ; cohérence GH+GHS acceptée / GH+XOF rejetée `CURRENCY_MISMATCH`.

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `src/lib/format/money.ts` | `fmtMoney`, `fmtMoneyCompactM`, `moneyFormatter`, `schoolMoneyFormatter` — Intl + `CURRENCY_DISPLAY` |
| `src/lib/config/countries.ts` | `COUNTRY_DEFAULTS` (8 pays), `countryDefaultsFor`, `assertCountryCurrencyCoherence` |
| `src/lib/services/accounting/statementMaps.ts` | `OHADA_STATEMENT_MAPPING` par défaut + `statementMappingFor(settings)` avec repli |
| `scripts/i18n/test-i18n-p0.ts` | suite de non-régression P0 |
| `scripts/i18n/backfill-payroll-maps.ts` | backfill idempotent `PAYROLL:*` sur plans existants (gardé `assertRecetteEnv`) |

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `src/lib/services/hr/payrollPosting.ts` | résolution des comptes via `AccountingAccountMap` (`PAYROLL:EXPENSE/PAYABLE/SOCIAL/ADVANCES`) avec repli codes "66/422/431/421" |
| `src/lib/services/accounting.ts` | `STARTER_MAPPINGS` += les 4 clés `PAYROLL:*` ; `openExercise` conservé |
| `src/lib/services/accounting/statements.ts` | bilan/CR pilotés par `statementMapping` (settings → OHADA par défaut) au lieu de `classNumber` en dur |
| `src/lib/validations/onboarding.ts` | + `country` (2 lettres) dans le schéma |
| `src/app/platform/onboarding/actions.ts` | sélecteur pays : défauts `COUNTRY_DEFAULTS` + `assertCountryCurrencyCoherence` avant création |
| `src/app/platform/onboarding/ui/onboarding-school-form.tsx` | champ Pays + aperçu devise/fuseau dérivé |
| ~30 pages/PDF `src/app/**`, `src/lib/pdf/*`, `src/lib/services/finance/reports.ts`, `comm/automations.ts` | littéraux `` `${n.toLocaleString("fr-FR")} FCFA` `` → `fmtMoney(n)` ; variantes `M FCFA` → `fmtMoneyCompactM` |

## Comportement préservé

- Rendu XOF identique à l'ancien littéral (vérifié bit-à-bit, 7 montants) — même espace, même suffixe « FCFA ».
- Écoles existantes non migrées : `country` inchangé (`"BF"` Prisma default), mappings absents → repli codes hérités, `fmtMoney()` sans école → XOF/fr-FR.
- `platformUpdateSchool` peut toujours éditer pays/devise (action plateforme auditée) — mais l'onboarding n'écrit plus de BF en dur.
- Aucun schéma Prisma modifié : migrations = zéro → **aucun risque de migration**, déploiement réversible.

## Régressions / écarts connus

- **Aucune régression détectée** (81 assertions PASS sur les deux suites).
- Libellés statiques contenant « FCFA » (labels de formulaires, titres, placeholders) non traduits : cosmétique, périmètre P2/i18n UI.
- `receipt.ts` expose déjà `currency` — harmonisé sur `fmtMoney`.
- `School.settings.statementMapping` : accepté si structurellement valide, sinon repli OHADA silencieux (loggué côté serveur via le fallback — pas d'alerte dédiée en P0).

## Prochaines étapes

**P1 — modèle de packs (schéma + moteur)**
1. Prisma : `RegulatoryPack`, `PackVersion`, `SchoolPackActivation`, `PackValidationEvent` (4 yeux), immutabilité `PUBLISHED` (verrou applicatif + trigger DB si souhaité).
2. Résolution `packFor(school, domain, date)` → version `PUBLISHED` dont `validFrom≤date<validTo` ; snapshot JSON copié sur le bulletin/l'écriture.
3. Refactor `PayrollComponent` : source des règles = pack `PAYROLL` publié (le verrou `isRegulatory` actuel devient « non publié → non applicable »).
4. Domaines : `PAYROLL`, `ACCOUNTING`, `LEAVE`, `DECLARATION`, `PEDAGOGY` — `countryCode === school.country` imposé serveur.

**P2 — contenus & UI**
5. Pack `ACCOUNTING_OHADA` comme donnée (plan + `statementMapping`) partagé BF/CI/SN/BJ/TG.
6. i18n UI : extraction des libellés FR, locale `en` minimale (GH/NG).
7. Providers paiement par pays (Paystack NG, MoMo GH) derrière l'interface existante.

**P3 — pays**
8. UEMOA d'abord (CI/SN/BJ/TG : mutualisation SYSCOHADA+XOF) → GH/NG → FR.

## Consignes de merge

- Merger `feat/i18n-p0` en `main` après revue — aucune migration à jouer.
- Optionnel après merge : `tsx scripts/i18n/backfill-payroll-maps.ts` sur preprod/prod (idempotent, ajoute les 4 mappings ; sans lui le repli hérité fonctionne).

---

## Addendum — durcissements post-revue (avant merge)

### 1. `statementMapping` sécurisé (demande explicite)

`statementMappingFor` retourne désormais une **résolution** (`ok/mapping` ou `ok:false/error`), plus un mapping muet :

- surcharge `settings.statementMapping` **valide** → utilisée (tout référentiel) ;
- repli OHADA **uniquement** si référentiel `OHADA_SYSCOHADA` — déclaré via `settings.accountingFramework` ou déduit de `School.country` ;
- école non-OHADA + mapping **absent** → `STATEMENT_MAPPING_MISSING` ;
- école non-OHADA + mapping **invalide** → `STATEMENT_MAPPING_INVALID` ;
- `incomeStatement`/`balanceSheet`/`statementCsv` propagent l'erreur — **aucun état potentiellement incorrect n'est généré**.

Échappatoire légitime : une école GH tenant ses livres en SYSCOHADA peut déclarer `settings.accountingFramework = "OHADA_SYSCOHADA"` → repli autorisé (décision explicite, pas implicite).

### 2. Audit libellés « FCFA » — soldé

| Cas | Statut |
|---|---|
| `admissions/campaigns` « Frais de candidature (FCFA) » | **Corrigé** → `({cur})` devise école |
| `expenses` « Montant (FCFA) » + `fmt` | **Corrigé** → `moneyFormatter(école)` + `({cur})` |
| `fees/settings` placeholder « Montant FCFA » + `fmt` | **Corrigé** |
| `treasury` `unit="FCFA"` + `fmt` | **Corrigé** → `unit={cur}` + formateur école |
| `parent` « Montant à payer (FCFA) » + `fmtN` | **Corrigé** → formateur école (le parent voit la devise de l'école) |
| `immobilisations` « Coût FCFA » + indices SYSCOHADA « (2x)/(28x)/(68x) » | **Corrigé** → `({cur})`, indices de classes retirés (couplage OHADA) |
| `platform/plans` placeholders « Prix … FCFA » vs labels « (XOF) » | **Harmonisé** → XOF (devise de facturation plateforme — décision P2) |
| `page.tsx` « 90 000 F CFA » (tarifs publics) | Documenté P2 — pricing plateforme en XOF |
| `paiements-mobile/actions.ts` `currency:"XOF"` | **Corrigé** → devise école (rejet explicite `INVALID_CURRENCY` si provider incompatible) |
| `parentPayments.ts` `currency:"XOF"` | **Corrigé** → devise école |
| `refunds.ts` `currency:"XOF"` | **Corrigé** → `intent.currency` (remboursement dans la devise de l'intention) |
| `mobileIntents.ts` gate `!== "XOF"` | **Conservé** — providers UEMOA XOF-only ; échec explicite, jamais d'intention en mauvaise devise. P2 : adaptateurs GH/NG |
| `billing.ts` / `payments.ts` | XOF plateforme / déjà school-aware — OK |

**Zéro littéral « FCFA » restant dans `src/`** hors `format/money.ts`.

### 3. Tests ajoutés (60 assertions, 0 échec)

- Négatifs multi-devises (EUR/GHS), compact négatif, arrondis (XOF 0 déc. `999,9→1 000`, GHS 2 déc.), devise inconnue → code ISO ;
- `checkCountryCoherence` : NG+GHS rejeté, FR+EUR ok, pays inconnu → `COUNTRY_UNKNOWN` ;
- `statementMappingFor` : 8 cas (BF/GH/FR, invalide, framework déclaré, mapping valide, pays inconnu) ;
- **Écoles multi-pays** : GH → `STATEMENT_MAPPING_MISSING` sur bilan + résultat ; +OHADA déclaré → états générés ; +mapping invalide → `INVALID` ;
- **Compat existant** : école aux défauts schéma (BF/XOF, `settings:null`) → OHADA + bilan équilibré.

Suites : `test-i18n-p0` **60/60** · `test-stabilisation` **44/44** · `tsc` propre.
