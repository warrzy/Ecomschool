# Phase 10 — Revue UX/UI

Revue statique + recette navigateur (captures `docs/recette/`).

## Améliorations livrées

- **Accessibilité formulaire de connexion** : labels associés (`htmlFor`/`id`)
  sur email et mot de passe — nécessaire aux lecteurs d'écran et au ciblage.
- **Lien « Mot de passe oublié ? »** fonctionnel (`/reset-password`) ; l'email
  n'est plus pré-rempli dans le formulaire de connexion.
- **Consentement tuteur** : carte SMS/WhatsApp sur la fiche tuteur
  (`/app/guardians/[id]`) — rend les canaux mobiles réellement utilisables.
- **Filtre de statut des bulletins** : la liste admin et le PDF collectif
  acceptent `?status=` (brouillon → publié/rectifié).
- **Messagerie/annonces** : programmation, statuts de livraison réels,
  indicateur « canal indisponible » quand aucun fournisseur n'est configuré
  (pas de fausse simulation).
- **Mobile** : capture 390 px du dashboard (`30-mobile-app.png`) — la mise en
  page responsive fonctionne ; la navigation reste utilisable.

## Captures de recette

| Fichier | Interface |
|---|---|
| `01-login.png` | Connexion |
| `02..05-platform*.png` | Plateforme : dashboard, écoles, abonnements, automatisations |
| `10..16-app-*.png` | École : dashboard, élèves, classes, bulletins, messages, notifications, annonces |
| `20-parent.png` / `21-student.png` / `22-teacher.png` | Portails |
| `30-mobile-app.png` | Dashboard école en mobile 390 px |

## Points restants (non bloquants)

- Pas de système de design unifié (composants Tailwind ad hoc par page) —
  cohérent visuellement mais à consolider si l'équipe grandit.
- Ciblage « un parent » dans la messagerie par identifiant (pas
  d'autocomplétion) — amélioration UX à planifier.
- Messages d'erreur des server actions homogènes mais génériques ;
  enrichissement contextuel possible.
- Accessibilité : focus visible et contrastes corrects sur les pages
  principales ; un audit RGAA formel n'a pas été mené.
