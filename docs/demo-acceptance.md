# Matrice de recette — comptes de démonstration

Environnement : local (`ecomschool_dev`), seed `scripts/demo/seed-demo.ts`,
build de production local. Suite E2E : `e2e/demo-roles.spec.ts` (17 tests).
Date : exécution du 15/10/2026.

Légende : ✅ PASS · ❌ FAIL · ➖ NON TESTÉ. « Refusé » = redirection hors de
la page interdite ou 404, selon le garde-fou du module.

## Administrateur d'établissement — `admin@demo.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Connexion + espace | login → `/app` | dashboard école | Dashboard « Collège Démo ECOM », 20 élèves | ✅ |
| Élèves | `/app/students` | liste + DEMO-0xx | 20 fiches fictives | ✅ |
| Classes | `/app/classrooms` | liste des classes | 4 classes démo | ✅ |
| Enseignants | `/app/teachers` | liste | 4 enseignants | ✅ |
| Finances | `/app/fees` | tableau financier | 2 700 000 FCFA facturés, encaissements, impayés | ✅ |
| Bulletins | `/app/report-cards` | bulletins publiés | T1 publiés | ✅ |
| Annonces | `/app/announcements` | liste | 3 annonces démo | ✅ |
| Espace plateforme | `/platform` | refus | redirection hors `/platform` | ✅ |
| Déconnexion | `/app` → Déconnexion → Sign out | retour `/login` | `/login` atteint | ✅ |

## Enseignant — `enseignant@demo.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Connexion + espace | login → `/teacher` | espace enseignant | classes/évaluations affichés | ✅ |
| Élèves (lecture) | `/app/students` | lecture autorisée | liste visible | ✅ |
| Comptes utilisateurs | `/app/users` | refus | redirection | ✅ |
| Finances | `/app/fees` | refus | redirection | ✅ |
| Saisie de notes réelle | création évaluation UI | écriture notes | — | ➖ (couvert par le seed : 54 évaluations, 258 notes via service `saveGrades`) |

## Responsable financier — `finance@demo.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Dashboard financier | `/app/fees` | indicateurs FCFA | totaux, par catégorie, par mode | ✅ |
| Élèves | `/app/students` | refus | redirection | ✅ |
| Utilisateurs | `/app/users` | refus | redirection | ✅ |
| Clôture de caisse | service `closeCashDay` | 1 clôture | clôture 2025-11-28 enregistrée | ✅ |

## Caissier — `caissier@demo.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Caisse / paiements | `/app/fees` | lecture + encaissements | page accessible | ✅ |
| Configuration financière | `/app/fees/settings` | refus (pas `finance.configure`) | redirection | ✅ |

## Parent — `parent@demo.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Portail parent | `/parent` | enfants rattachés | Aminata + Ibrahim visibles | ✅ |
| Bulletin enfant rattaché | `/parent` → notes | bulletin T1 | notes affichées | ✅ |
| Bulletin enfant NON rattaché | GET `/parent/report-cards/{id}/pdf` | 403/404 | 403/404 | ✅ |
| Espace admin | `/app/users` | refus | redirection | ✅ |

## Élève — `eleve@demo.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Portail élève | `/student` | ses données | profil, EDT, résultats | ✅ |
| Gestion élèves | `/app/students` | refus | redirection | ✅ |

## Commercial plateforme — `commercial@ecom-school.local`

| Fonctionnalité | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Espace plateforme | `/platform` | accès | dashboard plateforme | ✅ |
| Formules | `/platform/plans` | liste des plans | 3 formules commerciales | ✅ |
| Abonnements | `/platform/subscriptions` | liste | abonnement DEMO-ECOLE visible | ✅ |
| Écoles | `/platform/schools` | refus (pas `schools.manage`) | redirection `/platform` | ✅ |
| Onboarding | `/platform/onboarding` | refus | redirection | ✅ |
| Demandes d'inscription | `/platform/signup-requests` | refus | redirection | ✅ |
| Administrateurs | `/platform/administrators` | refus | redirection | ✅ |
| Espace école | `/app` | refus | redirection | ✅ |

## Isolation multi-tenant

| Test | Parcours | Attendu | Constaté | Statut |
|---|---|---|---|---|
| Inter-écoles | `demoAdmin` → fiche élève WEND-PANGA | 404 | page « could not be found » | ✅ |
| Inter-écoles inverse | `schoolAdmin` → fiche élève DEMO-ECOLE | 404 | idem | ✅ |
| Intra-école | `parent` → bulletin d'un élève non rattaché | 403/404 | refusé | ✅ |

## Idempotence du seed

| Test | Attendu | Constaté | Statut |
|---|---|---|---|
| 2e exécution | aucun doublon | totaux identiques (20 élèves, 31 paiements…) | ✅ |
| Sans `ALLOW_DEMO_SEED` | refus | `Refusé : ALLOW_DEMO_SEED=1 requis` | ✅ |
| Hôte distant | refus | `hôte distant … n'est autorisé qu'en local` | ✅ |
| Base non listée | refus | `base 'ecomschool_prod' non autorisée` | ✅ |

## Limites connues

- Saisie UI des notes/présences non rejouée en E2E (créée via les services
  métier du seed — chemins identiques aux actions serveur).
- Pas de données T2/T3.
- `PLATFORM_SALES` ne gère pas les demandes d'inscription (périmètre actuel
  des permissions — modification volontairement non faite).
