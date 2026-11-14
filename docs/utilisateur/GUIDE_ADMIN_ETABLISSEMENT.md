# Guide administrateur d'établissement — ECOM-SCHOOL

## Prise en main

Connexion → `/login` avec l'adresse et le mot de passe reçus par
invitation. La page d'accueil `/app` présente le tableau de bord de
l'établissement ; le menu latéral est organisé en quatre blocs :
Pilotage · Établissement · Pédagogie · Finances.

## Configuration initiale (ordre recommandé)

1. **Année scolaire** — `/app/academic-years` : créer l'année, la marquer
   courante, définir les périodes (trimestres/semestres).
2. **Structure** — `/app/levels` puis `/app/classrooms` : niveaux puis
   classes rattachées à l'année.
3. **Personnes** — `/app/teachers`, `/app/students` (création, import
   CSV/Excel avec prévisualisation), `/app/guardians`.
4. **Inscriptions** — `/app/enrollments` : l'inscription génère
   automatiquement les créances obligatoires de la grille tarifaire.
5. **Finances** — `/app/fees/settings` : catégories de frais et
   tarifs (`FeeTariff`) par niveau/classe, obligatoires ou optionnels.
6. **Comptabilité** — `/app/comptabilite` : installer le plan de
   démarrage SYSCOHADA, ouvrir l'exercice, vérifier les mappings
   (méthodes de paiement → comptes, catégories → comptes).
7. **Utilisateurs** — `/app/users` : invitations par lien (token à
   usage unique, expiration), rôles par permissions.

## Cycles courants

### Finances (quotidien)
Encaissements dans `/app/fees` (fiche élève → « Paiement ») : le reçu est
numéroté et le formulaire est idempotent — une double soumission
renvoie le même reçu. `/app/fees/unpaid` liste les impayés ; les relances
créent un enregistrement tracé. `/app/treasury` : suivi et clôture de
caisse par jour.

### Comptabilité (périodique)
« Générer les écritures » transforme les opérations (paiements, dépenses,
remboursements, annulations, créances en mode engagement, paie validée)
en écritures équilibrées — une source en erreur est signalée sans bloquer
les autres. États : balance, grand livre, bilan, compte de résultat,
tiers (balance âgée), immobilisations, rapprochement. La clôture d'un
exercice refuse toute opération non comptabilisée.

### RH & paie (mensuel)
`/app/rh` : employés, contrats, congés (dotations configurées par
l'établissement — aucun droit présumé), présences, départs.
`/app/rh/paie` : campagne → calcul déterministe → validation →
comptabilisation (OD D66/C422) → rectification par contre-passation si
besoin. Avances : octroi, recouvrement plafonné (configurable).
Assiduité : congés sans solde et absences déduits si activés.

> **Note réglementaire** : les retenues CNSS et fiscales ne sont pas
> calculées — elles s'activent après validation officielle du barème
> (voir `docs/reglementaire/PARAMETRES_PAIE_BF.md`).

## Principes à connaître

- **Isolation** : chaque établissement ne voit que ses données.
- **Permissions** : les rôles limitent chaque action ; un refus 403 est
  normal si le rôle n'a pas la permission.
- **Immutabilité comptable** : on ne modifie pas une écriture — on la
  contre-passe (annulation, rectification).
- **Audit** : chaque action sensible est tracée (`/platform/audit`
  côté plateforme, journal côté école).
