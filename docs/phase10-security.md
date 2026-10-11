# Phase 10 — Sécurité

Audit + corrections de la branche `phase-10-production-readiness`.
Référence : `docs/phase10-audit.md` (inventaire complet des anomalies).

## Contrôles en place (vérifiés par tests E2E)

| Contrôle | Implémentation | Validation |
|---|---|---|
| Isolation multi-tenant | `schoolId` filtré dans tous les services ; `requireSchoolContext()` résout via `SchoolMembership` ACTIVE | E2E : bulletin/reçu d'une autre école → 403/404 |
| Permissions serveur | `requireSchoolPermission` / `requirePlatformPermission` sur chaque page et route | E2E : parent → `/app/users` redirigé, élève → `/app/students` redirigé |
| Anti force-brute | Throttle mémoire (5/30 s/email) + verrou persistant `User.lockedUntil` (8 échecs → 15 min) | E2E : verrou déclenché, bon mot de passe refusé pendant le verrou |
| Oracle temporel login | Comparaison bcrypt factice si utilisateur inconnu | E2E : même erreur générique email inconnu / mauvais mot de passe |
| Secret cron | `timingSafeEqual`, Bearer ou `x-cron-secret`, 503 si non configuré, 401 sinon | E2E : 3 cas testés |
| Reset mot de passe | `AccountInvite` à usage unique, 24 h, école nullable (comptes plateforme), pas d'énumération | Testé : demande publique + admin |
| Sessions | JWT 12 h max ; statut/membership re-vérifiés en base à chaque requête (révocation immédiate) | Revue de code + tests métier |
| En-têtes HTTP | `next.config.ts` : HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy | Build + revue |
| CSRF | Server actions Next + NextAuth (csrfToken obligatoire) | E2E implicite (connexion formulaire) |
| Validation entrées | Zod sur les actions serveur + helpers `validations/form.ts` | Typecheck + tests |
| Consentements | SMS/WhatsApp tuteurs : `GuardianCommConsent` explicite ; WhatsApp opt-in par défaut | Tests métier Phase 9/10 |
| Historique | Annonces archivées (`archivedAt`), jamais de suppression physique des enregistrements métier | Revue de code |

## Décisions d'architecture

- **`User.schoolId`** : n'est plus lu comme source de vérité. `authorize` et
  `requireSchoolContext` dérivent l'école de la première `SchoolMembership`
  ACTIVE. La colonne est conservée (écriture compatible) jusqu'au retrait final
  — voir `docs/user-schoolid-migration.md`. Limite connue : multi-appartenance
  sans sélecteur d'école (première membership active).
- **Sessions d'assistance** : `authorizedById` (membre de l'école) désormais
  obligatoire — un technicien ECOM-TOUCH ne peut ouvrir une session sans accord
  explicite d'un administrateur de l'établissement.
- **Rétention** : `src/lib/services/retention.ts` — purges configurables par
  variables d'environnement, exécutées par `/api/cron` (scope `maintenance` ou
  `all`). Les marqueurs de déduplication sont préservés (idempotence).
- **Notification d'absence** : délai de grâce (`ABSENCE_NOTIFY_DELAY_MIN`,
  défaut 30 min) via job persistant `attendance.absence_notify` qui re-vérifie
  l'état avant envoi.

## Tests de sécurité exécutés

- `e2e/security.spec.ts` — 23 tests PASS : redirections non authentifiées (10),
  cron (3), énumération (2), IDOR admin/parent/élève (6), verrouillage (1),
  export (1).
- Couverture IDOR : bulletins PDF inter-écoles (404), bulletin d'enfant non
  rattaché (403/404), reçu d'un autre élève (403/404), `/platform` pour un
  admin école (redirection), routes de gestion pour parent/élève.

## Risques résiduels (acceptés / à traiter)

| Risque | Gravité | Statut |
|---|---|---|
| Throttle mémoire non mutualisé en multi-instance | MEDIUM | Verrou DB persistant en 2e niveau ; prévoir un store partagé si >1 instance |
| Pas de sélecteur d'école pour multi-membership | LOW | Documenté, à traiter lors du retrait de `User.schoolId` |
| Vulnérabilités npm transitives (deepmerge-ts, mysql2 inaccessibles) | LOW | `audit fix --force` interdit (downgrade Prisma) ; surveiller les correctifs mineurs |
| Cookies non `Secure` en dev | LOW | Normal en HTTP local ; vérifier en HTTPS prod |
| Durées de rétention à fixer contractuellement | MEDIUM | `RETENTION_*` configurables ; décision métier à valider |
