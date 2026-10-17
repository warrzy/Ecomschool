# Croisement profil × abonnement — droits effectifs

> Règle effective : **accès = membership ACTIVE + RolePermission(key) + couverture abonnement**
> (`requireSchoolPermission`, `src/lib/permissions/guard.ts`).
> Couverture = module mappé dans `PERMISSION_MODULE` présent dans le plan (± overrides) ;
> statut actif requis (`TRIALING`/`ACTIVE`/`PAST_DUE`/`GRACE`) — sinon lecture seule.
> **Permission non mappée → jamais restreinte** par l'abonnement.

## 1. Règle de décision (serveur)

```
action école
 ├─ membership ACTIVE + permission dans le rôle ?  → non → /app/forbidden
 └─ permission couverte par l'abonnement ?
     ├─ pas d'abonnement → OUI (fail-open)
     ├─ statut inactif (SUSPENDED/CANCELLED/EXPIRED) → seulement *.read/*.print/portails
     ├─ permission non mappée → OUI
     └─ module mappé ∈ plan (± overrides, + dependsOn) → OUI / sinon /app/forbidden
```

## 2. Exemple demandé : TEACHER peut-il créer une évaluation ?

Permission requise : `assessments.create` (`grades/actions.ts`) → module `GRADES`.

| Formule | TEACHER possède `assessments.create` | Module GRADES dans le plan | **Résultat** |
|---|:-:|:-:|:-:|
| Essentiel | ✓ | ✗ | **Non** — `/app/forbidden` |
| Professionnel | ✓ | ✓ | **Oui** |
| Premium | ✓ | ✓ | **Oui** |
| Abonnement SUSPENDED | ✓ | — | **Non** — écriture bloquée (lectures conservées) |

## 3. Matrice des actions principales (légende : ✓ possible · ✗ bloqué abonnement · — pas le droit RBAC)

### ADMIN_SCHOOL

| Action | Permission | Module | Essentiel | Pro | Premium |
|---|---|---|:-:|:-:|:-:|
| Gérer élèves/parents/inscriptions (CRUD, import, export) | `student.*`, `guardian.*`, `enrollment.*` | *non mappé* | ✓ | ✓ | ✓ |
| Gérer enseignants | `teacher.*` | *non mappé* | ✓ | ✓ | ✓ |
| Gérer classes/matières | `classroom.*`, `subject.*` | *non mappé* | ✓ | ✓ | ✓ |
| Gérer salles | `rooms.*` | CLASSES_SUBJECTS | ✓ | ✓ | ✓ |
| Gérer utilisateurs | `user.*` | ADMINISTRATION | ✓ | ✓ | ✓ |
| Gérer années scolaires | `academic.manage` | ADMINISTRATION | ✓ | ✓ | ✓ |
| Consulter années/fiche école | `academic.read`, `school.read` | *non mappé* | ✓ | ✓ | ✓ |
| Gérer EDT et sessions | `schedules.manage`, `sessions.manage` | SCHEDULES | ✗ | ✓ | ✓ |
| Consulter EDT | `schedules.read` | SCHEDULES | ✗ | ✓ | ✓ |
| Exporter EDT (PDF/CSV) | `schedules.print`, `schedules.read` | *print non mappé* | **✓ (anomalie)** | ✓ | ✓ |
| Appel journalier / saisir absences | `attendance.manage` | ATTENDANCE | ✗ | ✓ | ✓ |
| Justifier une absence | `attendance.justify` | *non mappé* | **✓ (anomalie)** | ✓ | ✓ |
| Créer évaluation | `assessments.create` | GRADES | ✗ | ✓ | ✓ |
| Saisir/valider notes | `grades.enter/validate` | GRADES | ✗ | ✓ | ✓ |
| Calculer moyennes, valider/publier résultats | `grades.calculate`, `results.*` | GRADES / REPORT_CARDS | ✗ | ✓ | ✓ |
| Générer/publier bulletins, PDF | `reportcards.*` | REPORT_CARDS | ✗ | ✓ | ✓ |
| Règles de notation | `gradingpolicy.manage` | REPORT_CARDS | ✗ | ✓ | ✓ |
| Finances (toutes opérations) | `finance.*` | FINANCE | ✗ | ✗ | ✓ |
| Publier annonces | `announcements.manage` | COMMUNICATION | ✗ | ✗ | ✓ |
| Envoyer messages | `messages.manage` | COMMUNICATION | ✗ | ✗ | ✓ |
| Inviter compte parent/élève | `portal.manage` | ADMINISTRATION | **✓*** | **✓*** | ✓ |
| Voir/contre son abonnement | `school.read` / `school.manage` | */ADMINISTRATION | ✓ | ✓ | ✓ |

\* incohérent : le compte créé ne peut pas se connecter (portail non inclus dans le plan).

### FINANCE_MANAGER / CASHIER

| Action | Essentiel | Pro | Premium |
|---|:-:|:-:|:-:|
| Consulter finances (`finance.read`) | ✗ | ✗ | ✓ |
| Encaisser (`finance.payments.create`) | ✗ | ✗ | ✓ |
| Valider/annuler, remises, config, clôture | ✗ | ✗ | ✓ |

→ **Un caissier ne peut travailler que sous Premium** — cohérent avec le tarif (finances = Premium), mais à documenter : un établissement Professionnel peut créer un utilisateur CASHIER sans qu'il puisse rien faire.

### TEACHER

| Action | Essentiel | Pro | Premium |
|---|:-:|:-:|:-:|
| Dashboard `/teacher` | ✓* | ✓ | ✓ |
| Ouvrir sa fiche de session | ✓* | ✓ | ✓ |
| Faire l'appel | ✗ | ✓ | ✓ |
| Contenu pédagogique | ✓* | ✓ | ✓ |
| Créer évaluation / saisir notes | ✗ | ✓ | ✓ |
| Consulter bulletins | ✗ | ✓ | ✓ |
| Export PDF de l'EDT | ✓* | ✓ | ✓ |

\* Lacunes de la couverture : `/teacher` ne demande aucune permission ; `isOwnSession` permet de consulter la session sans module SCHEDULES ; `coursecontent.manage` et `schedules.print` non mappés.

### PARENT / STUDENT

| Action | Essentiel | Pro | Premium |
|---|:-:|:-:|:-:|
| Connexion portail (`portal.parent`/`portal.student`) | ✗ | ✗ | ✓ |
| Lire annonces (`announcements.read`) | ✗ | ✗ | ✓ |

→ Les portails parent/élève sont **strictement réservés à Premium** — conforme à `/tarifs`. En suspension, l'exception `ALWAYS_ALLOWED_IN_SUSPENSION` laisse néanmoins l'accès lecture aux portails.

### PLATFORM_OWNER / PLATFORM_SALES

Insensibles aux abonnements : les permissions `platform.*` ne passent pas par `isPermissionCoveredBySubscription`. SALES garde ses restrictions RBAC quelle que soit l'offre de l'école consultée.

## 4. Statuts d'abonnement — effet uniforme

Pour **tous** les profils école (sauf portails) : `SUSPENDED`/`CANCELLED`/`EXPIRED` = consultation seule. `GRACE`/`PAST_DUE` = fonctionnement complet. Aucun abonnement = tout autorisé (fail-open historique).

## 5. Quotas croisés

| Action | Quota appliqué | Contournement connu |
|---|---|---|
| Inscrire un élève (unitaire ou import) | `maxStudents` | aucun — contrôlé |
| Créer un utilisateur back-office | `maxUsers` | les **invitations portail** (`portal.manage`) créent des comptes parent/élève sans `checkLimit` — le compteur `usageSnapshot` les inclut pourtant |
| Créer un compte plateforme | aucun | n/a — hors école |
