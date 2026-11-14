<!-- title: Manuel Comptable et Responsable financier -->
# Manuel comptable et responsable financier

Votre périmètre : **comptabilité SYSCOHADA**, dépenses, trésorerie.
Vous ne voyez ni les salaires (paie) ni la gestion des élèves —
c'est la séparation des fonctions qui protège la confidentialité.

## 1. Votre espace

![Comptabilité — accueil](captures/compta-dashboard.png)

Menu Finances réduit à l'essentiel : Dépenses, Comptabilité, Tiers,
États financiers, Trésorerie (+ Immobilisations, Rapprochement).

## 2. Le plan de comptes

**Menu :** Finances → Comptabilité (`/app/comptabilite`)
Permission : `perm:accounting.read` · gestion : `perm:accounting.manage`

Le plan de démarrage SYSCOHADA est installé par l'administrateur :
comptes 411 (élèves), 421/422 (personnel), 431 (organismes sociaux),
481-404 (fournisseurs d'immobilisations), 521/571 (trésorerie),
605/62/66/681 (charges), 701/706 (produits), 2xx (immobilisations).

**Points de contrôle :**

- **Journaux** : OD (opérations diverses) et journaux de trésorerie.
- **Mappings** : chaque méthode de paiement pointe vers un compte de
  trésorerie ; chaque catégorie de frais vers un compte de produit —
  c'est ce qui rend la génération automatique possible.
- **Exercice** : dates d'ouverture et de clôture, mode caisse (CASH) ou
  engagement (ACCRUAL).

## 3. Générer les écritures

**Bouton :** « Générer les écritures » (page Comptabilité)

Chaque source non postée devient une écriture équilibrée :

| Source | Écriture produite |
|---|---|
| Paiement élève (caisse) | D 571 / C 411 |
| Créance (engagement) | D 411 / C 706 puis D 571 / C 411 à l'encaissement |
| Dépense payée | D 60x / C 571 |
| Remboursement | Contre-passement proportionnel de l'origine |
| Annulation | Contre-passation exacte de l'écriture d'origine |
| Paie validée | D 66 / C 422 (+ 431 charges, 421 avances) |
| Immobilisation | D 2xx / C 481-404, dotations D 681 / C 28x |

**Garanties du moteur :**

- **Une source = une écriture** (clé unique) : rejouer ne duplique pas.
- Une source en erreur est **signalée** dans le rapport (`errors`) sans
  bloquer les autres — corrigez la source puis regénérez.
- Toute écriture est **équilibrée** avant insertion — un débit ≠ crédit
  est techniquement impossible.

## 4. Écritures manuelles

Saisie libre dans le journal OD avec contrôles stricts :

- débit **ou** crédit par ligne (jamais les deux, jamais aucun) ;
- montants entiers positifs ;
- **somme des débits = somme des crédits** obligatoire ;
- pièce/description recommandées pour la traçabilité.

## 5. États financiers

**Menu :** Finances → États financiers (`/app/comptabilite/etats`)

![États financiers](captures/compta-etats.png)

| État | Usage |
|---|---|
| Balance | Totaux débit/crédit par compte — contrôle d'équilibre |
| Grand livre | Détail mouvement par mouvement |
| Bilan | Actif vs passif — **l'égalité est garantie** |
| Compte de résultat | Produits et charges de l'exercice |
| Export CSV | Reprise dans Excel ou transmission à l'expert-comptable |

## 6. Tiers et balance âgée

**Menu :** Finances → Tiers (`/app/comptabilite/tiers`)

![Tiers](captures/compta-tiers.png)

Position par débiteur : facturé, encaissé, **restant dû ventilé par
ancienneté** (0-30, 30-60, 60-90, +90 jours) — l'outil de priorisation
des relances familles.

## 7. Immobilisations

**Menu :** Finances → Immobilisations (`/app/comptabilite/immobilisations`)

Cycle complet comptabilisé :

1. **Acquisition** : D 2xx / C 481-404 (atomique avec la fiche).
2. **Dotations** : échéancier linéaire, écritures mensuelles
   D 681 / C 28x générées à la volée.
3. **Sortie/cession** : reprise de la VNC en charge, écriture
   équilibrée, statut SOLD.

## 8. Dépenses

**Menu :** Finances → Dépenses (`/app/expenses`)

![Dépenses](captures/compta-depenses.png)

Saisie → paiement → écriture. **Annuler** une dépense déjà postée
produit automatiquement sa contre-passation — l'exercice reste propre.

## 9. Trésorerie et rapprochement

![Trésorerie](captures/compta-tresorerie.png)

- **Trésorerie** (`/app/treasury`) : journées de caisse, clôtures,
  écarts théorique/physique.
- **Rapprochement** (`/app/comptabilite/rapprochement`) : pointage des
  écritures de trésorerie avec les relevés.

## 10. Clôture d'exercice

1. Vérifiez qu'il n'y a **aucune opération non postée** — la clôture
   refuse sinon (`UNPOSTED_OPERATIONS` liste les sources).
2. **Clôturer** : l'exercice devient en lecture seule — plus aucune
   écriture ne peut y être postée (garantie serveur).
3. **Report à nouveau** : les soldes d'à-nouveaux sont générés dans
   l'exercice suivant en une transaction.

> [!WARN]
> Une écriture ne se supprime jamais : on la **contre-passe**. C'est la
> règle SYSCOHADA d'immutabilité — l'audit retrouve toujours l'origine.

## 11. Bascule caisse → engagement

Changement de mode comptable en cours de vie : la bascule crée les
écritures de reprise (créances existantes → D411/C706) **sans
recompter** ce qui était déjà comptabilisé — un cutoff horodaté
garantit l'absence de double produit.
