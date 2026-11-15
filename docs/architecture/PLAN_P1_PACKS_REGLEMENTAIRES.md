# Plan technique P1 — Packs réglementaires multi-pays

> Statut : **plan de développement — aucune implémentation**.
> Dépend de : P0 fusionné (`feat/i18n-p0`) — `COUNTRY_DEFAULTS`, `statementMappingFor` sécurisé, clés `PAYROLL:*`.
> Objectif : moteur générique + packs versionnés par domaine, publication 4 yeux, immutabilité, provenance sur chaque calcul.

## 1. Modèle de données (Prisma)

```prisma
enum PackDomain { PAYROLL SOCIAL TAX LEAVE DECLARATION ACCOUNTING PEDAGOGY FORMAT PAYMENT }
enum PackStatus { DRAFT REVIEW VALIDATED PUBLISHED RETIRED }

model RegulatoryPack {
  id          String   @id @default(cuid())
  countryCode String   // ISO alpha-2 — égalité avec School.country imposée serveur
  domain      PackDomain
  name        String
  description String?
  versions    PackVersion[]
  @@unique([countryCode, domain, name])
}

model PackVersion {
  id         String     @id @default(cuid())
  packId     String
  pack       RegulatoryPack @relation(fields: [packId], references: [id])
  version    Int        // incrément par pack
  status     PackStatus @default(DRAFT)
  validFrom  DateTime
  validTo    DateTime?  // null = en vigueur
  payload    Json       // règles normalisées par domaine (§2)
  checksum   String     // sha256(payload canonique) — anti-altération
  sources    Json       // [{title, url, officialRef, consultedAt}]
  createdById String
  validatedById String? // 4 yeux : ≠ createdById et ≠ publishedById
  publishedById String?
  validatedAt DateTime?
  publishedAt DateTime?
  activations SchoolPackActivation[]
  @@unique([packId, version])
}

model SchoolPackActivation {
  id            String @id @default(cuid())
  schoolId      String
  packVersionId String
  packVersion   PackVersion @relation(fields: [packVersionId], references: [id])
  activatedById String
  activatedAt   DateTime @default(now())
  deactivatedAt DateTime?
  @@unique([schoolId, packVersionId])
}
```

**Règles d'intégrité (servie par la couche service + testée)**
- `PackVersion.status = PUBLISHED` requis à l'activation ET à l'usage calcul.
- `pack.countryCode === school.country` — vérifié à l'activation (FK logique) et au calcul.
- 4 yeux : `validatedById ≠ createdById`, `publishedById ≠ validatedById`.
- `PUBLISHED` → `payload`/`checksum`/`validFrom` figés (update rejeté ; nouvelle version obligatoire). `RETIRED` seul état de sortie.
- Historique : `payslip.formulaSnapshot` existe déjà ; ajouter `packVersionId` + `packChecksum` sur `Payslip`, `PayrollComponent`, `AccountingExercise` (provenance auditable).

## 2. Payloads par domaine (contrats normalisés)

| Domaine | Contenu du payload |
|---|---|
| `PAYROLL` | composants `{key, formula(fixed/percent/rate_x_qty/table), plafonds, ordre}` — réutilise la grammaire existante |
| `SOCIAL`/`TAX` | taux cotisations salariées/patronales, plafonds d'assiette, tranches ITS, arrondis |
| `LEAVE` | acquisition CP/mois, règles UNPAID, ancienneté, jours fériés |
| `DECLARATION` | formats d'exports officiels (structure, pas les barèmes) |
| `ACCOUNTING` | plan de comptes + `statementMapping` (format P0 déjà validé) + maps `PAYROLL:*` |
| `PEDAGOGY` | périodes (trimestre/semestre), barème maxScore, lettres/GPA, règles de passage |
| `FORMAT` | locale, séparateurs, position symbole, format date |
| `PAYMENT` | providers disponibles, devises acceptées, channels |

## 3. Moteur de résolution

`resolvePack(school, domain, date)` :
1. activation active de l'école pour le domaine → version `PUBLISHED` où `validFrom ≤ date < validTo` ;
2. sinon → version `PUBLISHED` du pack par défaut du pays pour le domaine ;
3. sinon → erreur explicite `PACK_UNAVAILABLE` (jamais de calcul implicite) ;
4. vérification `checksum` avant application — altération → `PACK_TAMPERED`.

Le snapshot `{packId, version, checksum, parameters}` est copié dans la sortie (bulletin, écriture, état) — **immunité historique** : une nouvelle version ne retouche jamais un calcul passé.

## 4. Cycle de vie & permissions

`DRAFT → REVIEW → VALIDATED → PUBLISHED` (+ `RETIRED`). Rôle plateforme `REGULATORY_EDITOR` (crée) / `REGULATORY_VALIDATOR` (valide) / `REGULATORY_PUBLISHER` (publie) — séparation stricte. Chaque transition → `PackTransitionEvent` (audit append-only : qui, quand, statut, commentaire, checksum à l'instant t).

## 5. Points d'intégration (fichiers)

| Fichier | Changement |
|---|---|
| `payroll.ts` `computeRun` | composants réglementaires chargés depuis `resolvePack(PAYROLL/SOCIAL/TAX)` au lieu de la seule table `PayrollComponent` ; `isRegulatory` non publié = ignoré (équiv. actuel) |
| `payrollPosting.ts` | maps `PAYROLL:*` déjà sémantiques — surcharge possible par pack `ACCOUNTING` |
| `accounting.ts` `installStarterPlan` | remplacé par `installPack(activation ACCOUNTING)` ; le starter actuel devient le pack `ACCOUNTING_OHADA` seedé |
| `statementMaps.ts` | `statementMappingFor` lit d'abord le pack `ACCOUNTING` actif → `settings` → repli OHADA (règle actuelle conservée) |
| `employees/leaves` | règles `LEAVE` du pack (workdays, UNPAID) au lieu des constantes config |
| `platform/` nouvelles pages | édition packs (DRAFT), revue, validation, publication, activations par école |
| `onboarding` | active les packs `PUBLISHED` par défaut du pays à la création |

## 6. Migration sans interruption

1. Schéma additif (nouvelles tables + colonnes `packVersionId` nullable) — déployable sans downtime.
2. Seed `ACCOUNTING_OHADA` (plan actuel, `PUBLISHED`, `countryCode` ∈ BF/CI/SN/BJ/TG/ML/NE — un pack par pays, contenu mutualisé).
3. Backfill : activation `ACCOUNTING_OHADA` sur chaque école OHADA existante ; `packVersionId` null toléré (repli comportement actuel).
4. Aucun pack PAYROLL/SOCIAL/TAX seedé → comportement paie strictement identique (`isRegulatory` reste inactif).
5. Feature flag `REGULATORY_PACKS=1` pour activer la résolution par environnement.

## 7. Tests prévus

- Intégrité : pays mismatch refusé, non-PUBLISHED inutilisable, 4 yeux violé → refus, payload publié immuable, checksum altéré détecté.
- Calcul : bulletin généré avec pack v1 → inchangé après publication v2 ; `packVersionId` tracé.
- Multi-pays : école GH ne peut activer un pack BF ni inversement.
- Non-régression : les 60 assertions P0 + 44 stabilisation doivent passer avec `REGULATORY_PACKS` on et off.

## 8. Charge estimée

| Lot | Contenu | Charge |
|---|---|---|
| P1-a | Schéma Prisma + migrations + service cycle de vie + 4 yeux + audit | 4-5 j |
| P1-b | Moteur `resolvePack` + provenance snapshots + intégration paie/compta | 4-5 j |
| P1-c | UI plateforme (édition/revue/publication/activations) | 3-4 j |
| P1-d | Seed `ACCOUNTING_OHADA` + backfill + feature flag + tests | 3-4 j |
| **Total P1** | | **~14-18 j** |

Hors périmètre P1 : contenu réglementaire pays (recherche officielle), i18n UI, providers GH/NG — P2/P3.
