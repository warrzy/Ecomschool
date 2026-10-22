# Différenciation stratégique — ECOM-SCHOOL

## Positionnement recommandé

> **« Le logiciel scolaire dont les chiffres sont justes — avec l'expérience mobile que les familles attendent. »**

Ne pas jouer la course au nombre de modules (Galactis : 100+ pays, EduX : 40+ modules — imprenables sur la couverture brute). Jouer sur **la confiance + l'expérience locale** :

1. **Confiance comptable** : aucun concurrent ne documente l'idempotence, les snapshots figés, le refus de surpaiement, les annulations motivées non destructives, les verrous de clôture. Démontrable en démo : « essayez de créer un doublon de reçu ».
2. **Traçabilité académique** : révisions de notes horodatées + versions de bulletins immuables + transitions verrouillées — un argument auprès des directions et des inspecteurs.
3. **Adaptation burkinabè prouvée** : FCFA entier, MENAPLN (trimestres, CEP/BEPC/Bac), français natif, résilience réseau faible, pas de dépendance à un cloud étranger lourd.

## Les 5 paris différenciants

### Pari 1 — Le reçu en main avant de quitter le guichet… ou sur WhatsApp
- Déjà : reçu PDF A5 immuable à l'encaissement.
- À ajouter : **envoi du reçu par WhatsApp/SMS au parent** (plomberie `comm/` prête — il manque la connexion), puis **paiement Mobile Money** avec preuve.
- Différenciation : PERIS annonce le suivi MoMo, Major vend l'OM depuis l'app — personne ne promet « le reçu arrive instantanément sur le téléphone du parent ».

### Pari 2 — La candidature en ligne burkinabè
- Formulaire public sans compte, pièces, suivi par code de dossier, test d'admission optionnel, décision → conversion en inscription réelle.
- Aucun concurrent local ne documente un suivi de candidature *en ligne par le parent* ; PERIS/EduX le gèrent en back-office.
- Réutilise `SchoolSignupRequest` (pattern éprouvé : honeypot, throttle, revue, conversion atomique).

### Pari 3 — Finances opposables
- Nos montants sont réconciliables : trésorerie calculée + notes de limite honnêtes (« pas un solde certifié ») + rapports F3-D cohérents avec le dashboard à l'identique.
- À compléter : export comptable OHADA (pas un plan comptable complet — un **export structuré** des opérations vers la compta = MVP réaliste).

### Pari 4 — Offline-first progressif
- EduSahel vend sa « Box locale » (matériel). Kanda vend le mode hors ligne.
- Notre réponse économique : **PWA + file d'attente locale** pour les appels de présence et les encaissements critiques, plutôt que du matériel. Plus tard seulement si marché.

### Pari 5 — Transparence commerciale
- Tarifs publics et honnêtes (Galactis affiche 5 €/élève/an — repère marché). Notre `/tarifs` doit chiffrer.
- Mise en service rapide (« prêt en X jours ») + support WhatsApp (canal natif du marché) — déjà notre stack.

## Ce qu'on NE fera PAS (arbitrages assumés)

| Refusé | Raison |
|---|---|
| Comptabilité générale complète OHADA | Énorme ; mieux : export vers compta existante |
| Université/LMD dans le même produit | Produit distinct — `PERIS UNIV` a fait ce choix aussi |
| App native iOS/Android | PWA suffit ; natif = coût de maintenance disproportionné |
| Biométrie/badges NFC | Hardware, maintenance terrain — hors modèle SaaS pur |
| E-learning complet | Galactis domine ; notre marché = gestion, pas cours en ligne |

## Arguments de vente vérifiables (démo scriptée)

1. « Double-cliquez sur encaisser — un seul reçu. » (idempotence)
2. « Annulez ce paiement — le reçu reste, le motif est tracé, le total s'ajuste. »
3. « Verrouillez la période — plus aucune note ne bouge, sauf publication. »
4. « Générez 200 bulletins — chaque version est horodatée et consultable par le parent. »
5. « Ce parent voit les notes de SON enfant, jamais un autre. » (isolation testée IDOR)
