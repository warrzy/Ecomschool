# Manuel utilisateur ECOM-SCHOOL

ECOM-SCHOOL est une application de gestion scolaire en ligne. Elle regroupe dans un même outil la scolarité (élèves, classes, emplois du temps, absences, notes, bulletins), les finances (frais, encaissements, impayés, dépenses) et la communication avec les familles.

Ce manuel est organisé **par profil**. Chaque utilisateur ne voit que les menus et les actions autorisés par son rôle : si une entrée décrite ici n'apparaît pas chez vous, votre rôle ne vous y donne pas accès ou le module n'est pas compris dans l'abonnement de l'établissement.

## Sommaire

| Chapitre | Pour qui |
| --- | --- |
| [1. Prise en main](01-prise-en-main.md) | Tout le monde : connexion, mot de passe, navigation, notifications |
| [2. Direction et administration de l'établissement](02-direction-etablissement.md) | Administrateur d'établissement (direction, secrétariat) |
| [3. Finances et caisse](03-finances-caisse.md) | Responsable financier, caissier |
| [4. Enseignant](04-enseignant.md) | Enseignants |
| [5. Parent](05-parent.md) | Parents et tuteurs |
| [6. Élève](06-eleve.md) | Élèves |
| [7. Plateforme ECOM-TOUCH](07-plateforme.md) | Équipe ECOM-TOUCH : propriétaire de la plateforme, commerciaux |

## Les profils en un coup d'œil

| Profil | Espace après connexion | Ce qu'il fait principalement |
| --- | --- | --- |
| Administrateur d'établissement | `/app` | Paramètre l'établissement, gère élèves, enseignants, notes, bulletins, utilisateurs, abonnement |
| Responsable financier | `/app` | Tarifs, comptes élèves, encaissements, impayés, dépenses, trésorerie, rapports |
| Caissier | `/app` | Guichet d'inscription, encaissements, reçus |
| Enseignant | `/teacher` | Appel, cahier de textes, évaluations et saisie des notes de ses classes |
| Parent | `/parent` | Suivi de ses enfants : notes, bulletins, absences, paiements, demandes |
| Élève | `/student` | Consultation de son emploi du temps, de ses notes, bulletins et absences |
| Propriétaire plateforme | `/platform` | Gère les établissements clients, offres, abonnements, factures, supervision |
| Commercial plateforme | `/platform` | Consulte et suit les offres, abonnements et factures |

## Principes communs

- **Données cloisonnées par établissement** : un utilisateur ne voit que les données de son établissement ; un parent ne voit que ses enfants, un élève que son propre dossier, un enseignant que ses classes.
- **Brouillon → validation → publication** : les notes, résultats, bulletins et délibérations ne sont visibles des familles qu'une fois publiés. Les actions de validation ou de publication demandent une confirmation et certaines sont irréversibles (une correction passe alors par une rectification motivée).
- **Imports en deux temps** : les imports de fichiers (élèves, notes) commencent par une analyse avec aperçu des erreurs ; rien n'est enregistré avant votre confirmation explicite.
- **Notices intégrées** : la plupart des écrans comportent un encadré « Comment fonctionne… ? » ou « Notice » qui rappelle les règles de l'écran.
- **Traçabilité** : les opérations sensibles (encaissement, annulation, publication, rectification) sont journalisées.

Les captures de ce manuel ont été réalisées sur l'établissement de démonstration « Collège Démo ECOM » (données fictives).
