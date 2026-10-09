# Phase 2 log

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
