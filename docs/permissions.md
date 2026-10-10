# Permissions & accès multi-tenant

## Modèle

- **Plateforme** : `UserRole` → `Role` avec `scope = PLATFORM` (ex. `PLATFORM_OWNER`, réservé ECOM-TOUCH). Pas de `schoolId` requis.
- **École** : `SchoolMembership` (statut `ACTIVE`) → `Role` avec `scope = SCHOOL`, soit système (`schoolId IS NULL`), soit propre à l'école (`role.schoolId = membership.schoolId`).

Un rôle `SCHOOL` ne donne jamais de permission plateforme, et inversement.

## Guards (`src/lib/tenant/context.ts`, `src/lib/permissions/guard.ts`)

| Helper | Vérifie | Redirige si échec |
|---|---|---|
| `requireSessionUser()` | session + `User.status = ACTIVE` | `/login` |
| `requirePlatformContext()` | + rôle `scope=PLATFORM` | `/app` |
| `requirePlatformPermission(key)` | + permission via rôle plateforme | `/platform` |
| `requireSchoolContext()` | + `schoolId` + membership ACTIVE (rôle SCHOOL valide) | `/app/onboarding` (plateforme → `/platform`) |
| `requireSchoolPermission(key)` | + permission via rôle du membership | `/app` |
| `assertSchoolResourceAccess(ctx, schoolId)` | `resourceSchoolId === ctx.schoolId` | retourne `false` |

## Règles

1. Toujours passer par les guards dans les pages/actions — jamais `getSession()` seul.
2. Toute ressource scolaire est filtrée par `ctx.schoolId` (jamais par un `schoolId` client).
3. Un compte détenant un `UserRole` `scope=PLATFORM` est invisible et non modifiable depuis l'espace école (`CANNOT_TARGET_PLATFORM_USER`).
4. Attribution de rôle école : via `getSchoolAssignableRole` (scope SCHOOL + système ou même école).
5. Les relations croisées entre établissements sont refusées (`INVALID_ROLE`, `NOT_FOUND`).

## Tests

`npx tsx scripts/phase2/security-test.ts` — 31 checks (rbac, services, HTTP).
`npx tsx scripts/phase2/login-test.ts` — redirections de connexion.
