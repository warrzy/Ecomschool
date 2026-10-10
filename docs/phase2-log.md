# Phase 2 log

## 2026-10-11 — Sécurité multi-tenant (étapes 18-19)

- Permissions centralisées : `requireSessionUser`, `requirePlatformContext`, `requireSchoolContext` (`src/lib/tenant/context.ts`), `requirePlatformPermission`, `requireSchoolPermission`, `assertSchoolResourceAccess` (`src/lib/permissions/guard.ts`)
- RBAC scopé (`src/lib/permissions/rbac.ts`) : permissions école via `SchoolMembership` ACTIVE + `Role.scope=SCHOOL` (rôle système ou rôle de l'école) ; permissions plateforme via `UserRole` + `Role.scope=PLATFORM` ; `User.status=ACTIVE` vérifié à chaque requête
- `authorize()` : les comptes plateforme sans `schoolId` peuvent se connecter ; `session.user.schoolId` devant nullable
- Route group `src/app/app/(tenant)/` : layout interne exige membership actif ; layout externe `/app` = session + compte actif + renvoi plateforme ; `/app/onboarding` devient la page "compte en attente"
- Onboarding création d'établissement déplacé sous `/platform/onboarding`, protégé par `platform.schools.manage`, utilise le rôle système `ADMIN_SCHOOL`, périodes créées avec `schoolId`
- Services métier `src/lib/services/users.ts` : liste par membership (exclut les comptes plateforme), création avec membership+rôle validé, update/delete protégés (`NOT_FOUND` cross-tenant, `CANNOT_TARGET_PLATFORM_USER`, `CANNOT_TARGET_SELF`)
- Tests `scripts/phase2/security-test.ts` (31 checks : rbac, services, HTTP) + utilitaires partagés `scripts/phase2/lib/test-utils.ts` ; `login-test.ts` refactoré dessus
- Navigation `/platform` (8 entrées) et `/app` (15 entrées) + pages socles honnêtes ("Module en préparation")
- Checks: `npm run typecheck` OK, `npm run lint` OK, `npm run build` OK, `security-test` 31/31 OK

## 2026-10-09 — M3 (SchoolMembership)

- Migration: `20261009101947_phase2_m3_school_membership` (create enum + table)
- Migration: `20261009102810_phase2_m3_school_membership` (add `roleId` + FK + index)
- Checks: `npm run typecheck` OK, `npm run lint` OK, `npm run build` OK
- Commit: `phase2(M3): school membership with role` (`4190483`)

## 2026-10-09 — Rename platform role

- Data script: `scripts/phase2/rename-platform-owner.ts` (SUPER_ADMIN → PLATFORM_OWNER)
- Checks: `npm run typecheck` OK, `npm run lint` OK, `npm run build` OK

## 2026-10-09 — Backfill school memberships

- Backup: `scripts/phase2/backup.ts` → `backups/backup_20261009_142756.dump`
- Data script: `scripts/phase2/backfill-memberships.ts`
- Result: createdRoles=1, createdMemberships=0, skippedPlatformUsers=1

## 2026-10-09 — AcademicPeriod.schoolId

- Migration: `20261009143735_phase2_m4_academicperiod_schoolid` (add nullable `AcademicPeriod.schoolId` + FK + index)
- Backup: `scripts/phase2/backup.ts` → `backups/backup_20261009_144254.dump`
- Data script: `scripts/phase2/backfill-academicperiod-schoolid.ts` → updatedRows=3, nullSchoolIdCount=0
- Checks: `npm run typecheck` OK, `npm run lint` OK, `npm run build` OK

## 2026-10-09 — Tenant access control (step 18 groundwork)

- Enforced active `SchoolMembership` for non-platform access (`requireTenant()` redirects to `/app/onboarding` if missing)
- Onboarding pages now require session only (no membership required)
- Onboarding school creation now creates an ACTIVE `SchoolMembership` for the admin user
- Login default `callbackUrl` is `/` to rely on root redirect logic (platform vs school)
- Removed hardcoded demo password from login UI

## 2026-10-09 — Bootstrap reference data

- Backup: `scripts/phase2/backup.ts` → `backups/backup_20261009_150902.dump`
- Data script: `scripts/phase2/bootstrap-reference-data.ts` → createdPermissions=5, ensuredRoles=1, createdRolePermissions=13
