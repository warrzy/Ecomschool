# Audit d'internationalisation — dépendances pays / SYSCOHADA

> Date : 2026-11-15 · Périmètre : code actuel `main` (`dfaab8f`)
> Objectif : identifier chaque couplage Burkina Faso / zone UEMOA /
> référentiel SYSCOHADA et mesurer le risque de généralisation.

## 1. Synthèse

Le socle est **mieux préparé que prévu** : le modèle `School` porte déjà
`country`, `currency`, `timezone`, `locale` ; le plan comptable est
**par école** (aucun référentiel imposé en base) ; le moteur de paie est
déclaratif, versionné et déjà doté du verrou `isRegulatory` ; les
fournisseurs de paiement sont des adaptateurs.

Les couplages réels sont **ponctuels** : littéraux monétaires "FCFA"
dans ~60 fichiers, codes de comptes SYSCOHADA résolus par code dans le
posting de paie, structure de classes 1-7 supposée par les états
financiers, onboarding qui fige `country:"BF"`.

**Verdict : aucune réécriture nécessaire.** Une couche d'abstraction
pays suffit si elle est introduite aux 7 points identifiés ci-dessous.

## 2. Ce qui est déjà internationalisable (à préserver)

| Élément | Localisation | État |
|---|---|---|
| `School.country` (défaut `"BF"`), `currency` (`"XOF"`), `timezone`, `locale` | `schema.prisma:156-171` | Champs présents, non exploités par les calculs |
| Plan comptable par école (`AccountingAccount`, `AccountingJournal`, `AccountingAccountMap`) | `accounting.ts` | Aucun référentiel imposé ; `SYSCOHADA_STARTER` est un **plan d'installation**, pas une règle du moteur |
| Moteur de paie déclaratif (`fixed`, `percent`, `rate_x_qty`, `table`), `version`, `activeFrom/activeTo`, `formulaSnapshot` | `hr/payroll.ts` | Générique par conception — aucune loi codée |
| Verrou `isRegulatory` (composant ignoré du calcul) | `payroll.ts`, `schema.prisma:4201` | Mécanisme « pack non validé » déjà en place à l'échelle du composant |
| `PayrollConfig` par école (`workdaysPerMonth`, `prorateUnpaidLeave`, `prorateAbsences`, `advanceCapBp`) | `schema.prisma` | Paramétrage local, aucune valeur légale présumée |
| Congés : types génériques (`ANNUAL`, `SICK`, `MATERNITY`, `UNPAID`, `OTHER`), soldes provisionnés par règles de l'école | `hr/leaves.ts` | Aucune durée légale en dur |
| Providers de paiement en adaptateurs (`types.ts`, `paydunya.ts`, `sandbox.ts`) | `services/payments/providers/` | Ajouter un provider pays = ajouter un adaptateur |
| Téléphones en format international E.164 | `validations/profile.ts` | Compatible tous pays |
| Immutabilité comptable + contre-passation | `accounting.ts` | Principe universel (SYSCOHADA et anglo-saxon) |

## 3. Couplages à traiter — inventaire précis

### C1 — Littéraux monétaires « FCFA » / « fr-FR » — **impact fort, effort faible**

~60 sites formattent en dur : `` `${n.toLocaleString("fr-FR")} FCFA` ``.

Exemples représentatifs :
- `src/app/app/(tenant)/page.tsx:21` — `const fmt = (n) => `${n.toLocaleString("fr-FR")} FCFA``
- `src/app/parent/page.tsx:1027`, `src/lib/services/finance/reports.ts:73` (`fmtXof`),
- `src/lib/pdf/receipt.ts:41`, `src/lib/pdf/invoice.ts:65`, `src/lib/pdf/finance-report.ts:23`.

**Problème** : suffixe « FCFA » et locale `fr-FR` figés ; ignore
`School.currency` et les conventions du pays (GHS ₵, NGN ₦, EUR €,
position du symbole, séparateurs).

**Correction cible** : un unique `fmtMoney(amount, { currency, locale })`
résolu depuis le contexte école (helper côté serveur + prop passée aux
composants ; `Intl.NumberFormat(locale, { style:"currency" })`).

### C2 — Posting de paie résolu par codes SYSCOHADA — **impact fort, effort moyen**

`hr/payrollPosting.ts:37-40` cherche les comptes **par code littéral**
dans le plan de l'école : `"66"` (charges), `"422"` (rémunérations
dues), `"431"` (dettes sociales), `"421"`/`"425"` (avances) →
`MISSING_ACCOUNTS` si le plan national n'a pas ces codes.

**Problème** : la sémantique métier (« compte de charges de personnel »,
« compte de dettes sociales ») est confondue avec le code OHADA.

**Correction cible** : des **clés de mapping sémantiques** réutilisant
le mécanisme existant `AccountingAccountMap` (`PAYROLL:EXPENSE`,
`PAYROLL:PAYABLE`, `PAYROLL:SOCIAL`, `PAYROLL:ADVANCES`) — le pack pays
fournit les valeurs par défaut, l'école peut les ajuster.

### C3 — États financiers supposent les classes 1-7 OHADA — **impact moyen**

`accounting/statements.ts` : bilan = actif (classes 2,3,4d,5d) / passif
(1,4c,5c) ; résultat = 7 − 6. Structure fidèle au référentiel OHADA
révisé, incorrecte pour un PCG générique ou un plan anglo-saxon
(Ghana/Nigeria IFRS-style : actif/passif/capitaux sans classes
numériques 1-7).

**Correction cible** : le mapping rubrique ⇄ compte doit être porté par
le **pack référentiel** (table de correspondance déclarative), pas par
des `classNumber === n` dans le code. À court terme, documenter que
`classNumber` est une clé de regroupement libre que chaque plan définit.

### C4 — Plan de démarrage unique SYSCOHADA — **impact moyen, effort faible**

`SYSCOHADA_STARTER` (comptes, journaux, mappings) est le seul plan
installable (`installStarterPlan`). L'intention est déjà correcte —
« aucun référentiel imposé » — mais il n'existe pas d'alternative.

**Correction cible** : transformer en registre `STARTER_PLANS[countryCode]`
fourni par chaque pack référentiel ; `installStarterPlan(ctx, planId)`.

### C5 — Onboarding fige le pays — **impact fort, effort faible**

`platform/onboarding/actions.ts:79-80` : `country:"BF", currency:"XOF"`
codés en dur à la création d'école. Une école ghanéenne naîtrait en
« BF / XOF ».

**Correction cible** : champs pays/devise/locale/timezone dans le
formulaire d'onboarding, déduits du pack pays sélectionné.

### C6 — Providers de paiement par zone — **impact moyen**

PayDunya = UEMOA ; `mobileIntents.ts` gère les méthodes de manière
générique mais la disponibilité par pays n'est pas modélisée. Ghana
(MTN MoMo, Paystack, Hubtel) et Nigeria (Paystack, Flutterwave)
utilisent d'autres providers ; l'Europe : Stripe/SEPA.

**Correction cible** : registre `providers × countries` déclaré par
pack pays + `availableCountries` dans le descripteur de provider.

### C7 — Divers — **impact faible**

| Point | Fichier | Note |
|---|---|---|
| Timezone défaut `Africa/Ouagadougou` | `schema.prisma:166` | Correct pour BF ; à dériver du pays à l'onboarding |
| Facture plateforme `country ?? "Burkina Faso"` | `platform/billing.ts:55` | Défaut émetteur ECOM-TOUCH — métier, pas tenant |
| Libellés « SYSCOHADA » dans l'UI comptabilité | `comptabilite/page.tsx:75`, `etats/page.tsx` | Affichage : doit refléter le référentiel de l'école |
| Docs/manuels « FCFA » | `docs/` | Documentation à dupliquer/généraliser par pays plus tard |

### C8 — Ce qui n'est PAS couplé (confirmé)

- Créances/échéanciers/paiements/reçus : aucun code pays.
- Moteur de formules : aucun taux ni assiette nationale en dur.
- Congés : durées provisionnées par règles de l'école, pas par la loi.
- Délibérations, admissions, emplois du temps : neutres.
- Idempotence, audit, immutabilité : principes universels.

## 4. Matrice risque × effort

| Couplage | Risque si non traité | Effort | Priorité |
|---|---|---|---|
| C5 onboarding fige BF | École créée avec mauvais référentiel | ½ j | **P0** |
| C2 codes paie en dur | `MISSING_ACCOUNTS` hors OHADA | 1-2 j | **P0** |
| C1 littéraux FCFA | Affichage faux dans tous les écrans | 2-3 j (mécanique) | **P1** |
| C4 plan de démarrage unique | Pas de comptabilité hors OHADA | 1 j + contenu packs | **P1** |
| C3 états classes 1-7 | États faux hors OHADA | 2-3 j | **P2** |
| C6 providers par pays | Mobile Money indisponible | par provider | **P2** |
| C7 divers | Cosmétique | < 1 j | **P3** |

## 5. Conclusion d'audit

L'architecture existante est **compatible** avec une extension
multi-pays : elle stocke déjà les données pays sur l'école, ne code
aucune règle légale dans les moteurs, et dispose des mécanismes
(versioning, snapshot, verrou réglementaire, adaptateurs providers)
sur lesquels bâtir les packs. Les corrections à apporter sont des
**points d'injection**, pas des refactorings : résolution de mapping
sémantique (C2), formateur monétaire centralisé (C1), pays explicite à
l'onboarding (C5), registre de plans de démarrage (C4).
