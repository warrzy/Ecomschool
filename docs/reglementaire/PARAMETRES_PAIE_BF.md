# Paramètres réglementaires paie — Burkina Faso

> **Statut : À VALIDER.** Aucun taux n'est configuré ni activé. Ce document
> liste précisément les paramètres à faire valider par un expert-comptable
> ou les textes officiels (CNSS, DGI) avant toute activation. Ne jamais
> saisir de valeur « de mémoire » ou issue d'une source non officielle.

## 1. Paramètres à collecter (sources officielles)

### CNSS — cotisations sociales
| Paramètre | Formule moteur | Statut |
|---|---|---|
| Part salariale CNSS (taux, %) | `percent` sur `gross` | ⬜ taux officiel requis |
| Part patronale CNSS (taux, %) | `percent` sur `gross` (kind=EMPLOYER_CHARGE) | ⬜ taux officiel requis |
| Plafond de l'assiette (montant mensuel, FCFA) | borne `upTo` d'une `table` | ⬜ montant officiel requis |
| Autres branches (accidents du travail, prestations familiales) si distinctes | `percent` | ⬜ ventilation officielle requise |

### Impôt sur les traitements et salaires (ITS/IUTS)
| Paramètre | Formule moteur | Statut |
|---|---|---|
| Barème progressif (bornes + taux par tranche) | `table` sur `base_taxable` | ⬜ barème officiel requis |
| Définition de l'assiette (brut ? brut − CNSS ? abattements ?) | nom de la base dans `formula` | ⬜ règle officielle requise |
| Abattements / forfaits éventuels | composant `fixed` ou `percent` déductif | ⬜ règle officielle requise |

### Autres paramètres usuels
| Paramètre | Statut |
|---|---|
| SMIG applicable au secteur privé/éducation | ⬜ montant officiel |
| Indemnités obligatoires (transport, logement, salissure…) | ⬜ statut légal à confirmer — aujourd'hui : composants libres par établissement |
| Durée légale des congés payés | ⬜ référence texte du travail — aujourd'hui : `LeaveRule` libre par école (aucun droit présumé) |
| Plafond légal de retenue sur salaire (avances) | ⬜ texte requis — aujourd'hui : `advanceCapBp` configurable, **valeur indicative non réglementaire** |
| Jours ouvrables de référence pour le prorata | ⬜ usage à confirmer — aujourd'hui : `workdaysPerMonth` configurable |

## 2. Mécanisme d'activation (déjà en place)

Le moteur de paie (`src/lib/services/hr/payroll.ts`) applique les composants
`PayrollComponent` **activés et non réglementaires** uniquement :

```ts
// Composants pris en compte par computeRun :
{ schoolId, enabled: true, isRegulatory: false }
```

- Un composant créé avec `isRegulatory: true` **n'entre jamais dans un
  calcul** : c'est le verrou qui garantit qu'aucune retenue légale n'est
  appliquée sans validation.
- `formulaSnapshot` fige les formules dans chaque bulletin — tout calcul
  reste reproductible et auditable.

### Procédure d'activation après validation officielle

1. Obtenir la source officielle datée (décret, circulaire CNSS/DGI) — la
   joindre au dossier de conformité.
2. Pour chaque paramètre, créer le `PayrollComponent` avec la formule
   validée **en gardant `isRegulatory: true`** puis, après revue à 4 yeux,
   lever le verrou (passage `isRegulatory → false` par un compte
   `payroll.manage` — action auditée).
3. Recalculer un run de test sur données fictives et comparer à une
   feuille de calcul de référence validée par l'expert-comptable.
4. Consigner dans `PROGRESS.md` : source, date, composants activés.

### Modèles de formules (structure uniquement — valeurs à renseigner)

```jsonc
// CNSS part salariale — assiette plafonnée
{ "type": "table", "base": "gross",
  "brackets": [ { "upTo": "<PLAFOND>", "rate": "<TAUX_SALARIAL>" } ] }

// ITS — barème progressif sur la base taxable validée
{ "type": "table", "base": "<BASE_TAXABLE>",
  "brackets": [
    { "upTo": "<BORNE_1>", "rate": "<TAUX_1>" },
    { "upTo": "<BORNE_2>", "rate": "<TAUX_2>" }
    // ... tranches officielles
  ] }
```

## 3. Ce qui est utilisable SANS validation

- Toutes les rubriques **non réglementaires** : primes, indemnités
  internes, retenues diverses, avances (cap configurable), prorata
  d'assiduité (configurable), vacations (`rate_x_qty`).
- La paie peut être calculée et comptabilisée **hors retenues légales** :
  les bulletins produits doivent alors être présentés comme **indicatifs**
  et les obligations sociales/fiscales traitées manuellement en parallèle
  (mode « paie assistée »).
