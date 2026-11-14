<!-- title: Manuel Gestionnaire de paie -->
# Manuel gestionnaire de paie

Votre périmètre : **les campagnes de paie et les avances**. Vous voyez
les employés en lecture (nécessaire au calcul) mais la gestion RH
(contrats, congés) reste au responsable RH — séparation des fonctions.

> [!WARN]
> **Mention réglementaire** : les retenues CNSS et fiscales burkinabè ne
> sont pas calculées. Les composants marqués « réglementaire » sont
> ignorés jusqu'à validation des barèmes officiels. Les bulletins
> produits sont donc **indicatifs** ; les obligations sociales se
> traitent en parallèle.

## 1. Votre espace

**Menu :** Finances → Paie (`/app/rh/paie`)
Permissions : `perm:payroll.read` · `perm:payroll.manage`

![Campagnes de paie](captures/paie-campagnes.png)

La page réunit : composants de salaire, plafond d'avances, assiduité,
campagnes, bulletins et avances.

## 2. Composants de salaire

Chaque composant (prime, indemnité, retenue interne) porte une
**formule déclarative** :

| Type | Principe | Exemple |
|---|---|---|
| `fixed` | Montant fixe | Indemnité de transport 10 000 F |
| `percent` | % d'une base nommée | Prime = 10 % du salaire de base |
| `rate_x_qty` | Taux × quantité (jours, heures) | Vacation horaire |
| `table` | Barème progressif par tranches | Retenue progressive |

- `formulaSnapshot` fige la formule **dans chaque bulletin** : un calcul
  refait plus tard retrouve exactement le même résultat.
- Les composants `isRegulatory` sont visibles mais **ignorés du calcul**
  — verrou de conformité (cf. encadré réglementaire ci-dessus).

## 3. Préparer et calculer une campagne

![Campagne postée](captures/paie-run-posted.png)

1. **Créer une campagne** : période (ex. 2026-11-01 → 2026-11-30).
2. **Calculer** : un bulletin par contrat actif — brut, retenues, net,
   coût patronal.
3. Vérifiez les bulletins (§4) puis **Valider**.
4. **Comptabiliser** : l'OD de paie (D 66 / C 422, + 431 charges et
   421 avances) est postée **atomiquement** avec le statut POSTED —
   pas d'état intermédiaire possible.

> [!NOTE]
> La validation exige la comptabilisation avant toute clôture d'exercice
> comptable — le système vous prévient (`PAYROLL_UNPOSTED`).

## 4. Lire un bulletin

![Bulletin de paie](captures/paie-bulletin.png)

Lignes du bulletin : salaire de base, composants par ordre, **brut**,
retenues (avances, absences si activées), **net à payer**, coût
patronal, jours travaillés éventuels, et le snapshot des formules
utilisées — preuve de calcul.

## 5. Avances sur salaire

Section **Avances** de la page paie :

1. **Accorder** : employé, montant, date, motif — statut `GRANTED`.
2. Le recouvrement se fait automatiquement sur les bulletins suivants,
   dans l'ordre (FIFO), en respectant le **plafond** (§6) — statut
   `RECOVERING` puis `RECOVERED`.
3. **Annuler** une avance non commencée la sort du circuit.

## 6. Plafond de recouvrement

Encart **« Plafond de recouvrement des avances »** : pourcentage du net
à payer (ex. 30 %) au-delà duquel le recouvrement mensuel est reporté.

> [!WARN]
> Cette valeur est **indicative et décidée par l'établissement** — elle
> n'est présentée ni calculée comme une obligation réglementaire.

## 7. Assiduité et paie

Encart **« Assiduité et paie »** — paramètres de l'établissement :

- **Base mensuelle** (ex. 30 jours) : diviseur du prorata ;
- **Congés sans solde (UNPAID) non payés** : si activé, les jours de
  congé approuvés sans solde réduisent le brut — tracés en ligne
  `ABS_NP` et champ `unpaidDays` du bulletin ;
- **Absences pointées déduites** : même logique pour les absences non
  justifiées du pointage RH.

Ces valeurs sont des **réglages internes**, pas des règles légales
présumées.

## 8. Rectifier une campagne

Une campagne `POSTED` erronée se **rectifie** : le système crée la
**contre-passation exacte** de l'OD (ou dans l'exercice ouvert courant
si l'exercice d'origine est clos) et un run correctif `DRAFT` — jamais
de modification de l'historique. La rectification est idempotente :
la rejouer réutilise le run correctif existant.
