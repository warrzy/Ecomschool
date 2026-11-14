# Guide de recette utilisateur — ECOM-SCHOOL

**Environnement** : https://preprod.ecomschool.fr — école **ÉCOLE DÉMO VALIDATION**.
Toutes les données sont fictives (élèves D-E001→D-E012, employés D-P001→D-P005).

| Compte | Rôle | Mot de passe |
|---|---|---|
| `demo-admin@demo.ecomschool.test` | Admin d'établissement (24 permissions) | communiqué séparément (`SEED_DEMO_PASSWORD`) |
| `demo-compta@demo.ecomschool.test` | Comptabilité + trésorerie + dépenses | idem |
| `demo-rh@demo.ecomschool.test` | RH (employés/congés) — **sans** paie | idem |
| `demo-paie@demo.ecomschool.test` | Paie — **sans** gestion RH | idem |
| `demo-enseignant@demo.ecomschool.test` | Enseignant — portail `/teacher` | idem |
| `demo-parent@demo.ecomschool.test` | Parent — portail `/parent`, 2 enfants rattachés | idem |

> Le cloisonnement fait partie de la recette : certains refus attendus sont
> volontaires et prouvent la confidentialité des salaires.

## A. Administrateur d'établissement (`demo-admin`)

1. `/app/students` — 13 élèves, filtres année/classe/statut, export CSV.
2. `/app/enrollments` — créer une inscription → la créance est générée
   automatiquement (visible dans `/app/fees` → fiche élève).
3. `/app/fees/payments` — encaisser un paiement partiel sur un élève
   existant → reçu `REC-…` édité, solde mis à jour. Rejouer la même
   soumission → **même reçu** (idempotence).
4. `/app/fees/unpaid` — liste des impayés + relance.
5. `/app/announcements` — publier une annonce → visible portail parent.
6. `/app/notifications` — centre de notifications.

## B. Comptable (`demo-compta`)

1. `/app/comptabilite` — plan de comptes, journaux, mappings.
2. `/app/comptabilite/etats` — **bilan** (actif = passif) et **compte de
   résultat** après « Générer les écritures ».
3. `/app/comptabilite/tiers` — balance âgée des élèves.
4. `/app/comptabilite/immobilisations` — créer une immobilisation →
   écriture d'acquisition + dotations mensuelles.
5. `/app/expenses` — saisir une dépense → « payer » → OD de décaissement.
6. `/app/treasury` — journée de caisse, clôture.
7. **Refus attendus** : bulletin de paie → 403 (pas `payroll.read`) ;
   écriture déséquilibrée manuelle → refusée.

## C. Responsable RH (`demo-rh`)

1. `/app/rh` — 5 employés, contrats CDI actifs, organigramme.
2. Carte « Dotations de congés » — règles ANNUAL 30 j / SICK 10 j ;
   « Provisionner » (aucun droit légal présumé, valeurs de l'école).
3. Une **demande de congé en attente** (Prosper Some) → approuver.
4. Créer un employé + contrat activé → soldes provisionnés automatiquement.
5. **Refus attendus** : `/app/rh/paie` → 403 ; bulletin → 403.

## D. Gestionnaire de paie (`demo-paie`)

1. `/app/rh/paie` — campagnes existantes (POSTED, RECTIFIED), composants.
2. Créer une campagne → Calculer → vérifier un bulletin `?slip=` :
   brut, retenues, recouvrement d'avance (plafond configurable 0–100 %
   du net — **indicatif, non réglementaire**).
3. Valider → **clôture refusée tant que l'OD n'est pas postée** →
   « Comptabiliser » → POSTED.
4. Rectifier → contre-passation + run correctif DRAFT.
5. Encart « Assiduité » : base mensuelle, congés sans solde, absences.
6. **Refus attendus** : `/app/rh` création employé → 403.

## E. Enseignant (`demo-enseignant`)

1. Connexion → `/teacher` — espace enseignant (séances du jour, appels à
   faire, évaluations à saisir). La fiche enseignant « Harmonie Kientega »
   est rattachée au compte.
2. « Mon emploi du temps » — vue hebdomadaire.
3. **Refus attendus** : `/app/rh`, `/app/rh/paie`, `/app/comptabilite`,
   `/app/students` → 403 (un enseignant n'a pas accès aux données RH,
   financières ni à la liste complète des élèves).

## F. Parent (`demo-parent`)

1. Connexion → **redirection automatique vers `/parent`** (le rôle
   PARENT n'accède pas à `/app`).
2. Deux enfants rattachés : **Awa Ouédraogo** (6e, mère) et
   **Mariam Compaoré** (tutrice) — onglets de suivi par enfant.
3. Onglet « Aperçu » : classe, inscription, encadrés.
4. Onglets finances : créances et paiements de l'enfant, reçus PDF.
5. Annonces publiées visibles ; notifications (« tout marquer lu »).
6. **Refus attendus** : toute URL `/app/...` redirige vers `/parent` —
   un parent ne voit jamais les données des autres élèves.

## Critères de succès

- Aucune erreur 500 ; les refus sont des **403 explicites**.
- Montants identiques entre bulletin, OD comptable et trésorerie.
- Rejouer une action ne crée jamais de doublon (idempotence).
