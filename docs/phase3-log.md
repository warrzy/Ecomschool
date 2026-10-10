# Phase 3 log

## 2026-10-11 — Étape 0 : sécurisation complémentaire

- Inventaire `User.schoolId` : `docs/user-schoolid-migration.md` (champ conservé, bascule planifiée Phase 4)
- Modèle `AuditLog` + service `src/lib/services/audit.ts` (`logAudit`, `listAuditLogs`) — l'audit ne bloque jamais une opération métier
- `School` : champs `type`, `schoolSystem`, `logoUrl`, `settings` ajoutés
- `requireSchoolContext` : exige `School.status = ACTIVE` (établissement suspendu → `/app/onboarding?reason=suspended`)
- `updateSchoolUser` : interdit de changer son propre rôle (`CANNOT_TARGET_SELF`) et de se désactiver
- Protection dernier admin actif : `LAST_ACTIVE_ADMIN` sur update (désactivation/rétrogradation) et remove si le compte est le seul membre actif détenant `user.manage`
- Audit émis sur `user.create` / `user.update` / `user.remove`
- Migration `20261010235244_phase3_audit_school_fields` : backup préalable `backups/`, `migrate dev --create-only`, revue SQL (aucun DROP INDEX sur les index partiels Role), `migrate deploy`, `generate`
- Vérifié : migrations `2026*phase2*` intactes, sauvegardes présentes dans `backups/`
- Les changements de rôle prennent effet immédiatement : permissions résolues en base à chaque requête via `userHasSchoolPermission` (aucune permission n'est figée dans le JWT)
