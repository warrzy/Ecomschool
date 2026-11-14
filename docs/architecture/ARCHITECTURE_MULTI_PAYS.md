# Architecture multi-pays — moteur réglementaire international

> Statut : **proposition à valider** — aucun développement engagé.
> Principe directeur : un moteur générique commun, des packs
> réglementaires par pays versionnés et validés, aucun taux inventé.

## 1. Principes

1. **Le moteur ne connaît aucun pays.** Paie, comptabilité, formats :
   les calculs restent déclaratifs ; toute valeur réglementaire vient
   d'un pack activé pour l'école.
2. **Un établissement = un pays.** `School.country` (ISO 3166-1 alpha-2,
   déjà présent) détermine les packs applicables. Un pack d'un autre
   pays est **techniquement impossible à activer**.
3. **Rien n'entre en calcul sans validation.** Chaque version de pack
   porte un statut (`DRAFT → VALIDATED → PUBLISHED`) ; seule une version
   `PUBLISHED` peut produire une paie réelle — extension du verrou
   `isRegulatory` existant.
4. **Versionné dans le temps.** Les règles portent `validFrom/validTo` :
   un bulletin de novembre applique la réglementation de novembre, pas
   celle d'aujourd'hui (cohérent avec `activeFrom/activeTo` existant).
5. **Reproductible.** `formulaSnapshot` (déjà en place) fige la version
   du pack utilisée dans chaque bulletin — un calcul refait retrouve le
   même résultat et sa provenance réglementaire.

## 2. Vue d'ensemble

```
                    ┌────────────────────────────────────┐
                    │          MOTEURS GÉNÉRIQUES        │
                    │  payroll · accounting · formats    │
                    │  leaves · fees · declarations      │
                    └──────────────┬─────────────────────┘
                                   │ lit les paramètres
                    ┌──────────────▼─────────────────────┐
                    │        REGISTRY DES PACKS          │
                    │  résolution pays + date + version  │
                    └──────────────┬─────────────────────┘
            ┌──────────┬───────────┼───────────┬──────────┐
            ▼          ▼           ▼           ▼          ▼
         pack-BF    pack-CI     pack-GH     pack-NG    pack-FR
        (OHADA)    (OHADA)    (IFRS/GAAP) (IFRS/GAAP)  (PCG)
        CNSS/ITS   CNPS/ITS    SSNIT/PAYE  NHF/PAYE   URSSAF
```

Le pack est un **contenu déclaratif** (données + schéma de formules),
jamais du code métier exécuté — le moteur `evalFormula` reste unique.

## 3. Modèle de données proposé

### 3.1 Nouvelles entités (extensions, pas de migration destructive)

```prisma
/** Pack réglementaire — un par pays, indépendant du tenant. */
model RegulatoryPack {
  id          String   @id @default(cuid())
  countryCode String   // ISO alpha-2 : "BF", "CI", "GH", "NG", "FR"…
  domain      PackDomain  // PAYROLL | ACCOUNTING | LEAVE | TAX | FORMAT | DECLARATION
  name        String   // "CNSS_BF", "SYSCOHADA", "PAYE_GH", "URSSAF_FR"…
  versions    RegulatoryPackVersion[]
  @@unique([countryCode, domain, name])
}

/** Version immuable d'un pack : c'est ce qui est validé et publié. */
model RegulatoryPackVersion {
  id          String   @id @default(cuid())
  packId      String
  pack        RegulatoryPack @relation(fields: [packId], references: [id])
  version     String   // sémantique : "2026.1"
  status      PackStatus @default(DRAFT)   // DRAFT|REVIEW|VALIDATED|PUBLISHED|RETIRED
  validFrom   DateTime
  validTo     DateTime?                    // borne de validité légale
  /** Contenu : règles, taux, tranches, mappings — JSON schématisé par domaine. */
  payload     Json
  source      Json?    // {ref, url?, publishedAt} — référence officielle obligatoire
  validatedBy String?  // responsable de la validation métier
  validatedAt DateTime?
  publishedBy String?
  publishedAt DateTime?
  checksum    String   // SHA-256 du payload — intégrité de la version
  notes       String?
  @@unique([packId, version])
}

/** Activation d'une version de pack pour une école. */
model SchoolPackActivation {
  id           String   @id @default(cuid())
  schoolId     String
  packVersionId String
  packVersion  RegulatoryPackVersion @relation(fields:[packVersionId], references:[id])
  status       ActivationStatus @default(PENDING)  // PENDING|ACTIVE|SUSPENDED|ENDED
  effectiveFrom DateTime
  activatedBy  String
  approvedBy   String?  // validation à 4 yeux avant ACTIVE
  approvedAt   DateTime?
  createdAt    DateTime @default(now())
  @@index([schoolId])
}
```

**Règle dure serveur** : à l'activation on vérifie
`packVersion.pack.countryCode === school.country` **et**
`packVersion.status === PUBLISHED` — tout autre cas → `PACK_NOT_USABLE`.

### 3.2 Extensions de l'existant (non destructives)

| Modèle | Ajout proposé | Pourquoi |
|---|---|---|
| `School` | `packProfile` (JSON) ou relation activation | point d'entrée unique des packs |
| `PayrollComponent` | `packVersionId String?` | rattacher un composant réglementaire à sa source ; `isRegulatory` devient dérivé (`pack activé ?`) |
| `Payslip` | `packSnapshots Json` | provenance : quelles versions de packs ont produit le bulletin (complète `formulaSnapshot`) |
| `AccountingAccountMap` | réutilisé tel quel | les clés sémantiques (C2) viennent s'ajouter (`PAYROLL:*`, `SOCIAL:*`, `TAX:*`) |
| `LeaveType` | reste générique | les durées/droits viennent du pack congés, pas du type |
| `Plan`/`Subscription` | `countryScope String[]?` | offre limitée à certains pays si besoin |

## 4. Contenu d'un pack — schémas par domaine

Le `payload` JSON est validé par schéma (zod) selon `domain`.

### 4.1 PAYROLL — cotisations et impôts

```jsonc
{
  "components": [
    { "code": "CNSS_SAL", "label": "Cotisation CNSS salariale",
      "kind": "DEDUCTION", "order": 30, "isRegulatory": true,
      "formula": { "type": "percent", "rate": 0.0, "base": "brut_plafonne_CNSS" },
      "cap": { "type": "base_cap", "amount": 0 } },
    { "code": "ITS", "kind": "DEDUCTION", "isRegulatory": true,
      "formula": { "type": "table", "base": "assiette_its",
                   "brackets": [{ "upTo": 0, "rate": 0 }] } }
  ],
  "bases": { "brut_plafonne_CNSS": "min(gross, cnssCeiling)",
             "assiette_its": "gross - cnss_sal - abattements" },
  "constants": { "cnssCeiling": 0, "employerRate": 0 }
}
```

La **grammaire de formules déjà implémentée** (`fixed`, `percent`,
`rate_x_qty`, `table` + bases nommées) couvre ces besoins ; seule
l'extension « base dérivée » (`min`, soustraction de composants) est à
ajouter — **une fonction, pas un langage**.

### 4.2 ACCOUNTING — référentiel et mappings

```jsonc
{
  "chartName": "SYSCOHADA",          // ou "GHANA_IFRS", "PCG_FR"…
  "starterPlan": { "accounts": [...], "journals": [...] },
  "semanticMaps": {                   // clés consommées par le moteur (C2)
    "PAYROLL:EXPENSE": "66",  "PAYROLL:PAYABLE": "422",
    "PAYROLL:SOCIAL":  "431", "PAYROLL:ADVANCES": "421",
    "METHOD:CASH": "571",     "METHOD:BANK_TRANSFER": "521",
    "FALLBACK:RECEIVABLE": "411", "FALLBACK:CAT": "706"
  },
  "statementMapping": {               // C3 — rubriques d'états
    "balance.actif.immobilise": ["class:2"], "resultat.charges": ["class:6"]
  }
}
```

**Décision C3** : les états lisent `statementMapping` du pack actif ;
`classNumber` reste une clé de regroupement libre — un plan GH/NG
définirait ses propres rubriques sans classes 1-7.

### 4.3 LEAVE — congés légaux

```jsonc
{ "entitlements": [
  { "type": "ANNUAL", "daysPerYear": 0, "accrual": "per_contract_activation",
    "legalRef": "à définir par pays", "requiresValidation": true },
  { "type": "SICK",   "daysPerYear": 0 },
  { "type": "MATERNITY", "days": 0 }
], "workdaysPerMonth": 30, "note": "valeurs proposées = exemples non légaux tant que non validées" }
```

### 4.4 FORMAT — devise et conventions

```jsonc
{ "currency": "XOF", "locale": "fr-BF", "timezone": "Africa/Ouagadougou",
  "moneyPattern": "symbol_after_space", "datePattern": "dd/mm/yyyy",
  "phonePrefix": "+226" }
```

### 4.5 DECLARATION — obligations déclaratives

```jsonc
{ "declarations": [
  { "code": "CNSS_MONTHLY", "frequency": "MONTHLY", "produces": "report",
    "fields": ["gross_total","cnss_sal_total","cnss_pat_total"] },
  { "code": "ITS_ANNUAL", "frequency": "ANNUAL", "produces": "export" }
]}
```

### 4.6 PAYMENTS — providers disponibles

```jsonc
{ "providers": ["paydunya","manual_momo"], "methods": ["MOBILE_MONEY","CASH","BANK_TRANSFER"] }
```

## 5. Points d'injection dans le code existant

Réponses directes à l'audit (`AUDIT_INTERNATIONALISATION.md`) :

| # | Audit | Changement proposé |
|---|---|---|
| I1 | C1 FCFA en dur | `lib/format/money.ts` : `fmtMoney(n, {currency, locale})` ; le contexte école alimente la prop — remplacement mécanique des ~60 sites |
| I2 | C2 codes paie | `payrollPosting` lit `accountMap(PAYROLL:*)` via `AccountingAccountMap` — mêmes garde-fous `MISSING_ACCOUNTS` |
| I3 | C3 classes 1-7 | `statements.ts` consomme `statementMapping` du pack comptable actif ; repli = comportement actuel (compat OHADA) |
| I4 | C4 plan unique | `STARTER_PLANS` devient contenu de pack ACCOUNTING ; `installStarterPlan(ctx, packVersionId)` |
| I5 | C5 onboarding | sélecteur de pays → applique `currency/locale/timezone` du pack FORMAT + installe les packs PUBLISHED par défaut |
| I6 | C6 providers | `availableCountries` sur le descripteur ; filtrage UI par `school.country` |
| I7 | C7 cosmétique | libellés UI lus depuis le pack (« États SYSCOHADA » → `chartName`) |

## 6. Contrôles empêchant les mélanges de pays

1. **Clé d'activation** : `countryCode` pack = `school.country` (serveur).
2. **Clé de calcul** : le moteur ne lit que les composants rattachés à
   une activation `ACTIVE` de l'école — un composant d'un pack étranger
   n'existe pas dans son contexte.
3. **Clé de snapshot** : chaque bulletin enregistre les
   `packVersionId` utilisés — la provenance est auditable.
4. **Verrou d'état** : `PUBLISHED` requis pour la paie réelle ; un pack
   `DRAFT`/`REVIEW` n'est accessible qu'en **mode simulation** (cohérent
   avec l'existant SIMULATION vs REAL).
5. **Journal d'audit** : activation, suspension et publication de pack
   sont auditées (acteur, date, version).

## 7. Matrice pays / réglementations — état à construire

> Taux volontairement vides : à renseigner depuis les sources officielles
> au moment de la création de chaque pack. Ce tableau est le cadre, pas
> le contenu.

| Pays | Devise | Référentiel | Sécurité sociale | Impôt sal. | Providers paiement | Statut |
|---|---|---|---|---|---|---|
| **BF** Burkina Faso | XOF | SYSCOHADA | CNSS (taux+plafond à valider) | ITS (barème à valider) | PayDunya (OM, Moov) | **pack à créer** — paramètres listés dans `PARAMETRES_PAIE_BF.md` |
| **CI** Côte d'Ivoire | XOF | SYSCOHADA | CNPS | ITS | PayDunya + autres | à documenter |
| **SN** Sénégal | XOF | SYSCOHADA | CSS/IPRES | IR | PayDunya | à documenter |
| **BJ** Bénin | XOF | SYSCOHADA | CNSS BJ | ITS | Mobile Money local | à documenter |
| **TG** Togo | XOF | SYSCOHADA | CNSS TG | IRPP | Mobile Money local | à documenter |
| **GH** Ghana | GHS | IFRS-style (pas OHADA) | SSNIT | PAYE (barème) | MTN MoMo, Paystack, Hubtel | à documenter |
| **NG** Nigeria | NGN | IFRS-style | NSITF/NHF/PEN | PAYE états | Paystack, Flutterwave | à documenter |
| **FR** France | EUR | PCG | URSSAF | PAS | Stripe, SEPA | à documenter |

**Réutilisation** : les pays OHADA/XOF partagent le pack ACCOUNTING
SYSCOHADA (un seul contenu, activé par pays) ; seuls PAYROLL/LEAVE/
DECLARATION diffèrent. Ghana/Nigeria/France exigent un pack ACCOUNTING
distinct (C3 — mapping d'états) et des providers propres (C6).

## 8. Gestion du cycle de vie réglementaire

```
DRAFT ──revue──▶ REVIEW ──validation métier──▶ VALIDATED ──▶ PUBLISHED
   ▲                                              │
   └─────────── RETIRED ◀── nouvelle loi ─────────┘
```

- **Changement de barème** : nouvelle `RegulatoryPackVersion`
  (`validFrom` = date d'effet) — l'ancienne passe `RETIRED` après
  `validTo` ; les bulletins passés gardent leur snapshot.
- **Recalcul historique** : la période détermine la version applicable
  (`validFrom/validTo`) — un bulletin de 2026 n'applique jamais le
  barème de 2027.
- **Tests par pays** : suite de cas de référence (cas nominaux + cas
  limites + cas frontière de tranche) par version — bloquant avant
  `PUBLISHED`.
- **Revue à 4 yeux** : `validatedBy` ≠ `publishedBy` ; activation école
  exige `activatedBy` ≠ `approvedBy`.

## 9. Plan de développement progressif

### Phase 0 — Fondations (sans pack, sans pays)
1. `fmtMoney` centralisé + propagation `currency/locale` (C1) — **aucun
   changement fonctionnel**, prépare tout le reste.
2. Clés sémantiques `PAYROLL:*` dans `AccountingAccountMap` +
   `payrollPosting` les consomme (C2) — SYSCOHADA devient une valeur
   par défaut du plan, plus un code attendu.
3. Onboarding : sélecteur pays/devise/timezone (C5).
4. `statementMapping` externe (C3) avec repli sur le mapping actuel.

### Phase 1 — Cadre des packs
5. Modèles `RegulatoryPack`/`PackVersion`/`SchoolPackActivation` +
   guards pays + statuts + audit.
6. `Payslip.packSnapshots` + rattachement `PayrollComponent.packVersionId`.
7. Interface plateforme : bibliothèque de packs, cycle DRAFT→PUBLISHED.
8. Suite de tests par pays (harnais de cas de référence).

### Phase 2 — Premier pack validé : BF
9. Contenu pack-BF : FORMAT (XOF/fr-BF), ACCOUNTING (SYSCOHADA déjà
   présent comme starter), LEAVE (valeurs établissement), PAYROLL
   CNSS/ITS **une fois le barème officiel validé**.
10. Recette : paie réelle BF sur pack PUBLISHED → bulletin conforme.

### Phase 3 — Nouveaux pays
11. CI/SN/BJ/TG : réutilisent SYSCOHADA + XOF ; seuls les packs PAYROLL/
    LEAVE/DECLARATION sont à documenter.
12. GH/NG : nouveau pack ACCOUNTING (mapping d'états), providers
    locaux (C6), devise GHS/NGN.
13. FR : PCG + URSSAF + EUR — valide l'extensibilité complète.

### Jalons de validation (4 yeux)
| Jalon | Validation requise |
|---|---|
| Pack PUBLISHED | `validatedBy` + `publishedBy` distincts |
| Activation école | `activatedBy` + `approvedBy` distincts |
| Paie réelle activée | pack PUBLISHED + simulation concluante |

## 10. Ce que cette architecture garantit

- **Ajouter un pays** = écrire un pack (données) + éventuellement un
  adaptateur provider — **zéro modification des moteurs**.
- **Une école d'un pays** ne peut jamais calculer avec les règles d'un
  autre : clé pays + activation + snapshot.
- **Aucun taux inventé** : le statut `PUBLISHED` est l'unique chemin
  vers la paie réelle ; tout pack non validé reste en simulation.
- **La production actuelle n'est pas impactée** : tout est additif,
  les repliements préservent le comportement BF existant.
