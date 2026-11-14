<!-- title: Tutoriels métier de bout en bout -->
# Tutoriels métier — parcours complets

Neuf scénarios réels, du déclencheur au résultat final. Chaque tutoriel
précise le profil requis, les prérequis et la vérification finale.

## T1 — Préparer une rentrée scolaire

**Profil :** administrateur · **Durée :** ~20 min

| Étape | Action | Chemin |
|---|---|---|
| 1 | Créer l'année `2027-2028` + périodes | Établissement → Années scolaires |
| 2 | La marquer « courante » | fiche année |
| 3 | Créer les classes rattachées aux niveaux | Établissement → Classes |
| 4 | Affecter matières + coefficients par classe | fiche classe → Matières |
| 5 | Poser les créneaux | Établissement → Emplois du temps |
| 6 | Saisir la grille tarifaire | Finances → Finances → Paramètres |

**Résultat attendu :** tableau de bord sur la nouvelle année ; classes
inscriptibles ; tarifs prêts à générer les créances.

## T2 — Inscrire un élève et encaisser les frais

**Profil :** secrétaire puis caissier (ou admin seul)

| Étape | Action | Vérification |
|---|---|---|
| 1 | Créer l'élève (+ responsable) | Pédagogie → Élèves |
| 2 | L'inscrire à sa classe | Pédagogie → Inscriptions |
| 3 | Vérifier la **créance auto-générée** | Finances → fiche élève |
| 4 | Encaisser un versement | fiche élève → Paiement |
| 5 | Imprimer/remettre le reçu `REC-…` | reçu immuable |

**Résultat :** élève `ENROLLED`, solde réduit, reçu numéroté,
trésorerie et comptabilité prêtes à générer l'écriture.

## T3 — Créer une évaluation et publier les résultats

**Profil :** enseignant (saisie) + admin (publication)

| Étape | Action |
|---|---|
| 1 | Créer l'évaluation (classe, matière, type, barème, coef) | Notes |
| 2 | Saisir les notes élève par élève | fiche évaluation |
| 3 | Soumettre → valider | transitions d'état visibles |
| 4 | **Publier** | statut `PUBLISHED` |

**Résultat :** notes visibles dans le portail parent et élève — avant
publication, elles restent invisibles (testez côté parent).

## T4 — Générer les bulletins

**Profil :** administrateur

1. Vérifier que les évaluations de la période sont publiées.
2. Pédagogie → Moyennes : lancer/vérifier le calcul par période.
3. Pédagogie → Bulletins : générer par classe → publier.

**Résultat :** bulletins téléchargeables côté parent ; une correction
ultérieure passe par rectification, pas par modification.

## T5 — Gérer un impayé

**Profil :** responsable financier

| Étape | Action |
|---|---|
| 1 | Repérer les soldes | Finances → Impayés |
| 2 | Prioriser par ancienneté | Comptabilité → Tiers (balance âgée) |
| 3 | Émettre une relance tracée | Impayés → Relancer |
| 4 | Suivre l'effet | reçus / solde restant du dashboard |

## T6 — Créer un salarié et son contrat

**Profil :** RH

1. Personnel → **Nouvel employé** (matricule, catégorie, embauche).
2. Fiche → **Nouveau contrat** : CDI/CDD, poste, salaire de base.
3. **Activer** → dotations de congés provisionnées automatiquement.

**Vérification :** soldes visibles sur la fiche ; rejouer la
provision → aucun doublon.

## T7 — Approuver un congé

**Profil :** RH

1. File des demandes → demande `PENDING` (type, dates, motif).
2. Vérifier le solde affiché.
3. **Approuver** → solde déduit ; refuser exige un motif.
4. Cas **sans solde** : la demande peut être approuvée `UNPAID` →
   visible côté paie si l'option est activée.

## T8 — Produire une campagne de paie

**Profil :** gestionnaire de paie

| Étape | Action | Garde |
|---|---|---|
| 1 | Créer la campagne (période) | Paie → Campagnes |
| 2 | Calculer | bulletins déterministes |
| 3 | Vérifier un bulletin | brut, retenues, net, snapshot |
| 4 | Valider | statut VALIDATED |
| 5 | Comptabiliser | OD atomique, statut POSTED |

**Résultat :** OD équilibrée D66/C422 ; run verrouillé ; rectification
possible par contre-passation.

## T9 — Produire les états comptables

**Profil :** comptable

1. Comptabilité → **Générer les écritures** (sources → écritures
   équilibrées, erreurs signalées sans blocage).
2. Vérifier la **balance** (Σ débits = Σ crédits).
3. Ouvrir **Bilan** (actif = passif) et **Compte de résultat**.
4. Exporter CSV pour l'expert-comptable.

**Résultat :** états cohérents avec la trésorerie et les bulletins de
paie ; clôture exigeant zéro opération non postée.
