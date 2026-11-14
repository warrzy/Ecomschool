<!-- title: Exercices pratiques et corrigés -->
# Exercices pratiques — par profil

Exercices à réaliser sur l'environnement de démonstration. Les corrigés
suivent chaque série. **N'utilisez jamais un exercice en production.**

## Administrateur / direction

### Exercice A1 — Préparer une année
Créez une année `2027-2028` avec 2 périodes, marquez-la courante,
créez une classe de test rattachée à un niveau.

**Corrigé.** Établissement → Années scolaires → Nouvelle année ;
fiche → Périodes → 2 périodes ; cochez « courante » ; Établissement →
Classes → nouvelle classe (niveau + année). Vérifiez : le tableau de
bord indique la nouvelle année.

### Exercice A2 — Vérifier le cloisonnement
Connectez-vous en `demo-compta` puis tentez `/app/rh` et `/app/rh/paie`.

**Corrigé.** Les deux URLs renvoient **403** — le menu ne montre pas
Personnel/Paie et le serveur refuse l'URL directe. Cloisonnement
vérifié.

## Secrétariat

### Exercice S1 — Cycle complet élève
Créez un élève « TEST, Forma », rattachez un responsable, inscrivez-le
en classe, vérifiez la créance générée.

**Corrigé.** Élèves → Nouvel élève ; Parents → fiche → rattacher ;
Inscriptions → Inscrire. La créance de scolarité apparaît
automatiquement (tarif du niveau) — visible dans Finances côté admin.

### Exercice S2 — Traiter une demande
Passez une demande parent en « en cours », répondez, clôturez.

**Corrigé.** Demandes parents → ouvrir la demande → statuts → réponse.
Le parent voit l'avancement dans son onglet Demandes.

## Comptable

### Exercice C1 — Générer les écritures
Générez les écritures des sources non postées, puis contrôlez la balance.

**Corrigé.** Comptabilité → Générer les écritures → rapport (postées /
erreurs). États → Balance : Σ débits = Σ crédits. Rejouer la
génération → 0 nouvelle écriture (clé unique).

### Exercice C2 — Contre-passation
Annulez une dépense payée et retrouvez sa contre-passation.

**Corrigé.** Dépenses → fiche → Annuler : l'écriture inverse exacte est
créée atomiquement — la dépense conserve son historique.

## Caissier

### Exercice K1 — Encaisser avec reçu
Encaissez un versement sur un élève en solde, remettez le reçu, puis
retrouvez l'opération dans « Mes encaissements ».

**Corrigé.** fiche élève → Paiement → montant/méthode → reçu `REC-…`.
« Mes encaissements » montre l'opération ; rejouer la soumission
renvoie le même reçu (idempotence).

### Exercice K2 — Refus de surpaiement
Tentez un encaissement supérieur au reste dû.

**Corrigé.** Le système **refuse** le montant — c'est une règle
métier de protection, pas une erreur.

## RH

### Exercice R1 — Cycle congé complet
Créez un employé, activez son contrat, vérifiez les dotations,
saisissez puis approuvez un congé.

**Corrigé.** Personnel → Nouvel employé → contrat → activer : dotation
automatique selon les règles. Demande PENDING → Approuver → solde
déduit. Reprovisionner l'année → aucun doublon.

## Paie

### Exercice P1 — Campagne complète
Créez une campagne, calculez, vérifiez un bulletin, validez,
comptabilisez.

**Corrigé.** Paie → Campagnes → créer → Calculer → fiche bulletin
(formules figées visibles) → Valider → Comptabiliser : OD équilibrée
postée atomiquement, run `POSTED` verrouillé.

### Exercice P2 — Avance plafonnée
Accordez une avance, calculez le run suivant, constatez le recouvrement
plafonné.

**Corrigé.** Avances → Accorder. Au run suivant : ligne de retenue
≤ plafond % du net ; reliquat reporté (statut RECOVERING).

## Enseignant

### Exercice E1 — Appel + cahier
Faites l'appel d'une séance passée, complétez le cahier de textes.

**Corrigé.** Dashboard → « Faire l'appel » → présences → valider :
l'absence remonte au parent. « Compléter » → contenu de séance.

## Parent

### Exercice F1 — Explorer le suivi
Parcourez les onglets de votre enfant, téléchargez un reçu, ouvrez une
demande.

**Corrigé.** Sélecteur d'enfant → onglets Finances (reçu `REC-…`
téléchargeable) → Demandes → nouvelle demande. Les écrans d'autres
élèves sont inaccessibles — cloisonnement vérifié.

## Élève

### Exercice L1 — Consulter
Retrouvez votre classe, votre emploi du temps et une note publiée.

**Corrigé.** `/student` : classe et année en haut ; onglets EDT /
Notes — lecture seule, aucune action possible.
