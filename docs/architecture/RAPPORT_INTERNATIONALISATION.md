# Rapport final — internationalisation multi-pays d'ECOM-SCHOOL

> Version 1.0 · 2026-11-15 · Basé sur `main` (`912f2e5`)
> Documents complémentaires : `AUDIT_INTERNATIONALISATION.md`,
> `ARCHITECTURE_MULTI_PAYS.md` (même dossier).
> Principe : **moteur commun générique + configuration par pays** —
> aucune réécriture, uniquement des points d'injection.

---

## R1 — Sélection du pays, devise, langue et fuseau à l'inscription

**État constaté.** `School` porte déjà `country` (`"BF"`),
`currency` (`"XOF"`), `timezone` (`"Africa/Ouagadougou"`),
`locale` (`"fr"`) — `schema.prisma:156-167`. L'onboarding les **fige**
en dur : `platform/onboarding/actions.ts:79-82`.

**Modification envisagée.**
- `platform/onboarding/actions.ts` : lire `country/currency/timezone/locale`
  depuis `input` validé — supprimer les 4 littéraux.
- `onboarding/ui/onboarding-school-form.tsx` : ajouter un **sélecteur de
  pays** (premier choix) qui pré-remplit devise/locale/fuseau depuis un
  registre `COUNTRY_DEFAULTS` ; les trois champs restent modifiables
  (une école du Ghana francophone existe).
- `lib/validations/onboarding.ts` : schéma étendu — `country` (ISO
  alpha-2 dans la liste supportée), `currency` (ISO 4217), `timezone`
  (IANA), `locale` (BCP-47).
- `lib/config/countries.ts` (**nouveau**) : registre déclaratif
  `{ code, name, currency, locale, timezone, accountingFramework,
  payrollPack, providers[] }` — c'est la table de vérité produit.

**Fichiers concernés** : `onboarding/actions.ts`,
`onboarding/ui/onboarding-school-form.tsx`,
`validations/onboarding.ts`, `platform/schools/actions.ts:36`
(création par admin), `settings/page.tsx:106` (édition ultérieure) —
`country` **non modifiable** après création (une école ne change pas de
juridiction ; migration = nouvelle école + export).

**Risques** : une école créée sous le mauvais pays porte le mauvais
référentiel → **verrou** : `country` en lecture seule après onboarding,
changement = procédure plateforme tracée.

**Complexité** : faible (1-2 j).

**Tests** : création d'écoles GH/FR en recette → `currency=GHS`,
`locale=en`, `timezone=Africa/Accra` persistés ; tentative de
modification de `country` refusée (`COUNTRY_IMMUTABLE`).

---

## R2 — Formatage monétaire international centralisé

**État constaté.** ~60 sites formattent en dur :
`` `${n.toLocaleString("fr-FR")} FCFA` `` — ex.
`app/(tenant)/page.tsx:21`, `fees/page.tsx:14`, `parent/page.tsx:1027`,
`lib/pdf/receipt.ts:41`, `lib/pdf/invoice.ts:65`,
`services/finance/reports.ts:73` (`fmtXof`).

**Modification envisagée.**
- `lib/format/money.ts` (**nouveau**) :
  `fmtMoney(n, { currency, locale, style? })` → `Intl.NumberFormat`.
  Support explicite XOF (0 décimales), GHS/NGN/EUR (2 décimales) ;
  option `compact` (remplace les `M` faits main, `page.tsx:24`).
- Côté serveur : `getSchoolCurrency(schoolId)` — lit `School.currency` +
  `locale` une fois par requête, injecté en prop dans les pages ; les
  PDF passent le code en paramètre (déjà le cas partiellement).
- Remplacement mécanique des ~60 sites — grep-driven, fichier par
  fichier, sans changement de signature métier.

**Fichiers concernés** : les ~60 sites listés dans l'audit (C1) —
UI `(tenant)`, `parent`, `student`, `platform`, `lib/pdf/*`,
`lib/services/finance/reports.ts`, `comm/automations.ts` (messages).

**Risques** : régression d'affichage si `Intl` formate XOF avec « XOF »
au lieu de « FCFA » — **décision** : mapping d'affichage explicite
`{ XOF: "FCFA", GHS: "GH₵", NGN: "₦", EUR: "€" }` pour préserver
l'affichage actuel au Burkina. Montants stockés en entiers → aucune
conversion de données.

**Complexité** : faible-moyenne, purement mécanique (2-3 j).

**Tests** : snapshot de rendu d'un reçu XOF identique à l'actuel ;
rendu GHS sur école de test ; montant 0 et grands montants ;
PDF reçu/facture inchangés en BF.

---

## R3 — Écritures de paie indépendantes des codes SYSCOHADA

**État constaté.** `hr/payrollPosting.ts:37-40` cherche des comptes
**par code littéral** dans le plan de l'école : `"66"`, `"422"`,
`"431"`, `"421"`/`"425"` → `MISSING_ACCOUNTS` hors OHADA.

**Modification envisagée.**
- Introduire des **clés sémantiques** dans `AccountingAccountMap`
  (mécanisme existant, déjà par école) :
  `PAYROLL:EXPENSE`, `PAYROLL:PAYABLE`, `PAYROLL:SOCIAL`,
  `PAYROLL:ADVANCES`, `PAYROLL:ABSENCES`, `PAYROLL:EMPLOYER`.
- `payrollPosting` : remplacer `acc(schoolId,"66")` par
  `mapLookup(schoolId,"PAYROLL:EXPENSE")` — même garde
  `MISSING_ACCOUNTS`, message enrichi de la clé manquante.
- `SYSCOHADA_STARTER.maps` : ajouter les clés `PAYROLL:*` → 66/422/431/421
  — **le code OHADA devient une valeur de configuration**, le moteur
  ignore ce qu'est un « 66 ».
- Écran Comptabilité : section « Mappings » pour ajuster ces clés.

**Fichiers concernés** : `hr/payrollPosting.ts` (~20 lignes),
`accounting.ts` (constante + `installStarterPlan`),
`comptabilite/page.tsx` (UI mappings).

**Risques** : écoles existantes sans les nouvelles clés → **backfill**
dans la migration (upsert des 6 clés d'après les comptes existants par
code, si présents). Un plan OHADA renommé (école qui a recodé 66→665)
continue de fonctionner.

**Complexité** : moyenne (1-2 j) — le mapping existe déjà, seule la
clé de résolution change.

**Tests** : run de paie posté avec plan OHADA (non-régression) ; plan
modifié avec codes différents → `MISSING_ACCOUNTS` explicite ; mapping
ajusté → posting correct ; recette RH 98/98 rejouée.

---

## R4 — Multi-référentiels comptables sans dupliquer le module

**État constaté.** Le moteur comptable est **déjà agnostique** : écritures
équilibrées, journaux, mappings, plan par école — aucun code SYSCOHADA
dans les mécanismes (`accounting.ts`, en-tête : « aucun référentiel
imposé »). Deux couplages seulement : `SYSCOHADA_STARTER` unique et les
états supposant les classes 1-7 (`statements.ts`).

**Modification envisagée.**
- `SYSCOHADA_STARTER` → **contenu de pack** `ACCOUNTING_OHADA` ;
  `installStarterPlan(ctx)` résout le plan depuis le pack comptable
  actif de l'école (`school.country` → `accountingFramework` du
  registre pays).
- `statements.ts` : remplacer `classNumber === n` par une **table de
  rubriques** fournie par le pack :
  `statementMapping: { "balance.actif.immobilise": ["class:2"], ... }`.
  `classNumber` reste une clé de regroupement **libre** — un plan GH/NG
  définit `["group:ASSET_NONCURRENT"]` etc.
- Règle de non-duplication : **aucun `if country` dans le moteur** —
  toute différence s'exprime en données (plan, mappings, rubriques).

**Fichiers concernés** : `accounting.ts` (constante + install),
`statements.ts` (~40 lignes de mapping), `export-etats/route.ts`,
`comptabilite/etats/page.tsx` (libellés lus depuis le pack).

**Risques** : états d'une école BF différents après refonte → test de
**non-régression visuelle** : bilan/compte de résultat BF identique
avant/après (mapping OHADA équivalent par construction).

**Complexité** : moyenne (2-3 j).

**Tests** : états BF identiques ; plan de test « référentiel X »
(3 comptes, 2 rubriques) → états cohérents ; export CSV inchangé.

---

## R5 — Packs réglementaires indépendants par pays

**État constaté.** Prérequis déjà présents : moteur de formules
déclaratif, `isRegulatory` (composant ignoré tant que non validé),
`PayrollConfig` par école, congés provisionnés par règles de l'école
(aucune durée légale en dur — `leaves.ts`).

**Modification envisagée** — les 3 modèles proposés dans
`ARCHITECTURE_MULTI_PAYS.md` §3.1 :
- `RegulatoryPack(countryCode, domain, name)` — domaine :
  `PAYROLL | ACCOUNTING | LEAVE | TAX | DECLARATION | FORMAT | PAYMENTS`.
- `RegulatoryPackVersion(version, status DRAFT→PUBLISHED, validFrom/To,
  payload Json schématisé, source officielle, checksum)`.
- `SchoolPackActivation(schoolId, packVersionId, status,
  effectiveFrom, activatedBy/approvedBy — 4 yeux)`.
- **Guard serveur** : activation refusée si
  `pack.countryCode !== school.country` ou `status !== PUBLISHED`.
- `PayrollComponent.packVersionId` : un composant réglementaire
  **appartient** à un pack ; `isRegulatory` devient dérivé
  (« pack activé ? ») — les composants internes de l'école
  (primes libres) restent hors pack.
- `Payslip.packSnapshots` : provenance complète par bulletin.

**Fichiers concernés** : `schema.prisma` (3 modèles + 2 champs),
`hr/payroll.ts` (résolution des composants via activations),
`platform/` (écran de bibliothèque de packs — nouveau),
`app/(tenant)/rh/paie` (badge « pack X v2026.1 actif »).

**Risques** : un pack mal conçu produit des calculs faux **silencieusement**
→ atténué par le statut `PUBLISHED` (4 yeux), les tests de référence
par pays et le mode simulation. Aucun taux pré-rempli sans source —
**les packs sont livrés vides de valeurs non validées**.

**Complexité** : moyenne-forte (5-8 j) — cœur de l'architecture.

**Tests** : activation d'un pack CI sur école BF refusée ; pack DRAFT
non utilisable en paie réelle ; checksum détecte une altération ;
deux écoles pays différents calculent en parallèle sans fuite.

---

## R6 — Calendrier scolaire, notation, organisation pédagogique

**État constaté — déjà largement prêt.**

| Besoin | Existant | Écart |
|---|---|---|
| Découpage année | `AcademicPeriodType` : TRIMESTER/SEMESTER/OTHER + `AcademicPeriod` libres | OK — ajouter QUARTER semestres/termes anglophones = renommage de labels, pas de logique |
| Barème de notation | `maxScore Float @default(20)` **par évaluation** (schema:1326) | OK — sur 20, sur 100, sur 10 : déjà supporté |
| Politique de calcul | `MissingGradePolicy` (EXCLUDE/ZERO), coefficients par matière | OK |
| Système de classes | `Level`, `Classroom`, `schoolSystem` | Couvert ; les **noms** de niveaux (CP/6e vs Primary/JHS) = données par école |
| Notes lettres / GPA (Ghana, Nigeria) | Non | **Écart réel** : notation littérale (A-F) ou GPA 4.0 non modélisée |
| Langue d'interface | `School.locale` stocké, UI 100 % FR | **Écart réel** : i18n à introduire pour écoles anglophones |

**Modification envisagée.**
- `School.gradingMode` (`NUMERIC | LETTER | GPA`) — **nouveau champ** ;
  `NUMERIC` = comportement actuel (non-régression totale).
- Pack `PEDAGOGY` par pays : gabarits de niveaux, barème, découpage
  — **données suggérées** à l'onboarding, modifiables ensuite.
- i18n : extraction des chaînes FR vers `lib/i18n` (dictionnaire
  `fr`/`en` en premier), `School.locale` sélectionne la langue —
  chantier indépendant et parallélisable.
- Calendrier : `AcademicPeriod` libre + `schoolSystem` couvrent
  trimestres/semestres/terms ; les noms sont localisés via i18n.

**Fichiers concernés** : `schema.prisma` (+`gradingMode`),
`results.ts`/`deliberations.ts` (rendu lettre/GPA le cas échéant),
`report-card.ts` (gabarit bulletin), i18n transverse (`lib/i18n` + tous
les libellés — chantier à part).

**Risques** : GPA/lettres touche au calcul de moyennes — **hors scope
initial** : livré NUMERIC-only au départ (les écoles anglophones sur 100
fonctionnent déjà via `maxScore`), lettres/GPA en phase ultérieure
documentée.

**Complexité** : faible pour NUMERIC (1 j, déjà fait) ; moyenne pour
lettres/GPA (3-4 j, phase 3) ; forte pour i18n complet (5-10 j,
parallèle).

**Tests** : école `gradingMode=NUMERIC` identique à l'actuel ; évaluation
sur 100 calculée ; bulletin BF inchangé.

---

## R7 — Immunité historique et inter-pays

**Garanties déjà en place** (à préserver) :
- `formulaSnapshot` dans chaque bulletin — reproductibilité.
- `version` + `activeFrom/activeTo` sur `PayrollComponent`.
- Écritures POSTED immuables ; correction = contre-passation.
- Isolation `schoolId` stricte + RBAC serveur.

**Ajouts proposés.**
- `RegulatoryPackVersion` **immuable** : `payload` gelé à `PUBLISHED`,
  `checksum` SHA-256 — toute modification = nouvelle version.
- `validFrom/validTo` : le calcul d'une période **résout la version
  applicable à la date de la période**, pas la dernière — un bulletin
  de 2026 n'applique jamais le barème de 2027.
- `Payslip.packSnapshots` : liste les `packVersionId` utilisés —
  rejeu strictement déterministe.
- Guard pays (R5) : un pack BF ne peut exister dans le contexte d'une
  école CI.
- RETIRED : une version remplacée reste lisible (historique) mais non
  activable ni applicable aux nouvelles périodes.

**Fichiers concernés** : `payroll.ts` (résolution version par date),
`schema` (champs ci-dessus), service `packs/resolve.ts` (nouveau).

**Tests** : scénario barème v2026 vs v2027 → même run recalculé
donne le même bulletin (snapshot) ; nouvelle période utilise v2027 ;
rejeu d'un bulletin ancien inchangé ; pack CI invisible d'une école BF.

**Complexité** : incluse dans R5 (+1-2 j pour la résolution par date).

---

## R8 — Compatibilité totale Burkina Faso

**Stratégie : tout est additif, tout a un repli.**

| Existant | Compatibilité assurée par |
|---|---|
| Écoles BF actuelles | `country` déjà `"BF"` — packs par défaut = BF/OHADA ; aucune action requise |
| `fmtXof` actuels | `fmtMoney(XOF, fr)` = rendu **strictement identique** (« FCFA », `fr-FR`) |
| Codes 66/422/431/421 | backfill des clés `PAYROLL:*` dans la migration sur les plans existants |
| États classes 1-7 | mapping OHADA fourni **équivalent par construction** — repli si pack absent |
| Composants `isRegulatory` | restent `false`/verrouillés jusqu'à activation du pack BF validé — comportement inchangé |
| Permissions/UI | aucune modification de routes ni de menus |

**Principe de la migration** (détaillé en §Migration) : chaque étape
livre un repli = comportement actuel — à tout instant, une école BF
non migrée fonctionne exactement comme avant.

---

## Matrice pays / devise / langue / référentiel / réglementation

> Contenu réglementaire volontairement vide (à renseigner depuis les
> sources officielles). ✔ = couvert par l'existant, ◐ = pack à écrire,
> ✖ = travail spécifique.

| Pays | Devise | Langue | Référentiel compta | Sécurité sociale | Impôt sal. | Congés | Paiements | Notes |
|---|---|---|---|---|---|---|---|---|
| **BF** Burkina | XOF | fr | SYSCOHADA ✔ | CNSS ◐ | ITS ◐ | ◐ | PayDunya ✔ | Référence actuelle |
| **CI** Côte d'Ivoire | XOF | fr | SYSCOHADA ✔ | CNPS ◐ | ITS ◐ | ◐ | PayDunya/autres ◐ | Mutualise OHADA+XOF |
| **SN** Sénégal | XOF | fr | SYSCOHADA ✔ | CSS/IPRES ◐ | IR ◐ | ◐ | PayDunya ✔ | Mutualise |
| **BJ** Bénin | XOF | fr | SYSCOHADA ✔ | CNSS BJ ◐ | ITS ◐ | ◐ | MoMo local ◐ | Mutualise |
| **TG** Togo | XOF | fr | SYSCOHADA ✔ | CNSS TG ◐ | IRPP ◐ | ◐ | MoMo local ◐ | Mutualise |
| **GH** Ghana | GHS | **en** | **IFRS-style ✖** | SSNIT ✖ | PAYE ✖ | ✖ | MTN MoMo/Paystack/Hubtel ✖ | i18n + nouveau référentiel |
| **NG** Nigeria | NGN | **en** | **IFRS-style ✖** | NHF/PEN ✖ | PAYE ✖ | ✖ | Paystack/Flutterwave ✖ | i18n + nouveau référentiel |
| **FR** France | EUR | fr | **PCG ✖** | URSSAF ✖ | PAS ✖ | ✖ | Stripe/SEPA ✖ | Référentiel européen |

**Lecture** : CI/SN/BJ/TG coûtent ~1 pack PAYROLL+LEAVE chacun (référentiel
et devise partagés). GH/NG exigent i18n EN + référentiel IFRS + providers.
FR valide l'extensibilité complète.

---

## Architecture technique cible

```
┌────────────────────────────────────────────────────────────┐
│                        UI (i18n)                            │
│  /app · /teacher · /parent · /student · /platform           │
│  fmtMoney(currency,locale) · libellés par locale            │
└──────────────────────────┬─────────────────────────────────┘
┌──────────────────────────▼─────────────────────────────────┐
│                 MOTEURS GÉNÉRIQUES                          │
│  fees·payments · accounting(engine) · payroll(engine)      │
│  leaves · academic · grading · comm                         │
│        ▲ clés sémantiques (PAYROLL:*, METHOD:*, STATEMENT:*) │
└─────────┼──────────────────────────────────────────────────┘
┌─────────▼──────────────────────────────────────────────────┐
│              RESOLVER (src/lib/packs/resolve.ts)            │
│  school.country → packs actifs → version applicable(date)   │
│  guards : pays match · status PUBLISHED · 4 yeux            │
└─────────┬──────────────────────────────────────────────────┘
┌─────────▼──────────────────────────────────────────────────┐
│        REGULATORY PACKS (données versionnées)               │
│  FORMAT · ACCOUNTING · PAYROLL · LEAVE · TAX · DECLARATION  │
│  · PEDAGOGY · PAYMENTS — checksum, source officielle        │
└────────────────────────────────────────────────────────────┘
```

**Règles d'airain** : aucun `if (country)` dans les moteurs ; toute
différence = données de pack ; tout calcul historique lit son snapshot ;
toute activation = 4 yeux + audit.

---

## Roadmap par phases — dépendances et priorités

```
P0 Fondations ──▶ P1 Cadre packs ──▶ P2 BF validé ──▶ P3 Nouveaux pays
   │                  │                  │                  │
   │                  │                  │                  ├─ UEMOA (CI/SN/BJ/TG)
   │                  │                  │                  ├─ GH/NG (i18n+IFRS)
   │                  │                  │                  └─ FR (PCG)
   │                  │                  └─ pack BF PUBLISHED + paie réelle
   │                  └─ modèles + guards + UI bibliothèque
   └─ fmtMoney · clés PAYROLL:* · pays onboarding · statementMapping
```

| Phase | Contenu | Dépendances | Durée est. | Livrable |
|---|---|---|---|---|
| **P0** | R1 onboarding pays, R2 fmtMoney, R3 clés sémantiques, R4 statementMapping externe | aucune | **6-8 j** | Aucun changement visible BF ; prérequis techniques en place |
| **P1** | R5 modèles + guards + activation 4 yeux + écran packs ; R7 résolution par date + snapshots | P0 (clés sémantiques, pays) | **8-10 j** | Cadre packs opérationnel en simulation |
| **P2** | Contenu pack-BF (FORMATS, OHADA existant, LEAVE, PAYROLL CNSS/ITS **après barème officiel**) ; R6 gradingMode NUMERIC confirmé | P1 + **validation réglementaire externe** | **3-4 j** (hors attente barème) | Première paie réelle sur pack validé |
| **P3a** | UEMOA : packs CI/SN/BJ/TG | P2 (cadre éprouvé) | **2-3 j/pays** | Commercialisation UEMOA |
| **P3b** | GH/NG : i18n EN, référentiel IFRS, providers, GHS/NGN | P0+P1 + i18n | **8-12 j/pays** | Anglophone supporté |
| **P3c** | FR : PCG, URSSAF, EUR | P3b (extensibilité prouvée) | **6-10 j** | Europe supportée |

**Parallélisable** : i18n (chantier indépendant), recherche
réglementaire par pays (hors code), providers de paiement.

---

## Estimation de charge

| Lot | Charge | Hypothèse |
|---|---|---|
| P0 fondations | 6-8 j | mécanique, testé par non-régression |
| P1 cadre packs | 8-10 j | 3 modèles + guards + UI plateforme |
| P2 premier pack BF | 3-4 j | **hors** attente barème officiel |
| P3a pays UEMOA | 2-3 j/pays × 4 | contenu packs uniquement |
| P3b Ghana/Nigeria | 8-12 j/pays × 2 | i18n + référentiel + providers |
| P3c France | 6-10 j | PCG + URSSAF |
| **Total moteur + cadre** | **~17-22 j** | P0+P1+P2, le socle qui rend tout le reste possible |
| **Total avec pays** | **~50-70 j** | selon nombre de pays et disponibilité des barèmes |

La recherche des barèmes officiels (CNSS, ITS, SSNIT, NHF…) est **hors
charge de développement** — c'est un travail documentaire à mener en
parallèle ; le code n'attend que des données validées.

---

## Stratégie de migration sans interruption

1. **Migration additive** : nouvelles tables/colonnes seulement —
   `expand-migrate-deploy` (déployer le code qui tolère l'ancien et le
   nouveau schéma, migrer, puis activer).
2. **Backfill BF invisible** : clés `PAYROLL:*` upsertées sur les plans
   existants ; `country/currency` déjà valorisés ; aucun champ à
   déduire rétroactivement.
3. **Repli systématique** : si aucun pack comptable n'est actif →
   mapping OHADA actuel ; si pas de `PAYROLL:*` → codes historiques ;
   si `fmtMoney` absent → littéral actuel. **Chaque changement est un
   no-op pour une école BF non migrée.**
4. **Activation progressive** : les packs se déploient `DRAFT` (inertes),
   passent `VALIDATED` puis `PUBLISHED` — la paie réelle n'utilise un
   pack qu'après activation explicite + approbation.
5. **Rollback** : désactiver une activation (`SUSPENDED`) restaure le
   comportement antérieur instantanément — le code ne dépend jamais
   d'une activation pour fonctionner.
6. **Aucun downtime** : migrations additives uniquement, pas de
   renommage ni de suppression de colonnes existantes ; préprod valide
   chaque phase avant prod.

---

## Verdict et prochaine étape

L'architecture cible est **modulaire, évolutive et compatible** : le
moteur commun existe déjà à 90 % — les packs ne font que formaliser ce
que `isRegulatory` et le plan par école ont esquissé. Aucune
réécriture, aucune interruption, aucun taux inventé.

**En attente de votre décision** : validation du modèle
pack/version/activation (§R5), de la règle 4 yeux, et feu vert pour la
**phase P0** (fondations, zéro risque fonctionnel) — le reste dépend de
la disponibilité des barèmes officiels par pays.
