# Migration `User.schoolId` → `SchoolMembership` (préparation Phase 3+)

`User.schoolId` est un héritage du modèle mono-école. La source de vérité est
désormais `SchoolMembership`. Le champ reste en place tant que les dépendances
ci-dessous n'ont pas été migrées — **ne pas le supprimer**.

## Inventaire des dépendances (état au 2026-10-11)

| Fichier | Usage | Cible de migration |
|---|---|---|
| `src/lib/auth/options.ts` | `authorize` lit `schoolId`, le met dans le JWT ; refuse les users sans `schoolId` sauf rôle PLATFORM | Dériver le `schoolId` du JWT depuis la membership ACTIVE unique ; sans membership → accès école impossible, plateforme uniquement |
| `src/types/next-auth.d.ts` | `session.user.schoolId`, `token.schoolId` | Conserver le type `string \| null`, alimenté par la membership |
| `src/lib/tenant/context.ts` | `requireSessionUser` retourne `user.schoolId` ; `requireSchoolContext` s'en sert pour trouver la membership | Inverser : trouver la membership ACTIVE d'abord, le `schoolId` en découle |
| `src/app/app/onboarding/page.tsx` | Vérifie `user.schoolId` + membership | Membership seule |
| `src/app/app/(tenant)/**` | Utilisent `tenant.schoolId` (issu de la session) | Inchangé — la valeur viendra de la membership |
| `src/lib/services/users.ts` | `createSchoolUser` écrit `user.schoolId` ; `removeSchoolUser` le met à null | Continuer à écrire le champ (compat) jusqu'à la bascule JWT |
| `src/app/platform/onboarding/actions.ts` | Écrit `schoolId` sur l'admin créé | Idem |
| `prisma/seed.ts` | Écrit `schoolId` | Idem |
| `scripts/phase2/security-test.ts`, `login-test.ts` | Fixtures écrivent `schoolId` | Adapter au moment de la bascule |
| `scripts/phase2/backfill-*`, `report-*`, `counts-before` | Outils historiques Phase 2 | Ne pas réexécuter |

## Plan de bascule (Phase 4, à valider)

1. `authorize` : résoudre la membership ACTIVE ; `schoolId` JWT = `membership.schoolId` (null si aucune).
2. `requireSchoolContext` : même source.
3. Stopper toute écriture de `User.schoolId`.
4. Migration SQL de retrait de la colonne (`migrate dev --create-only`, revue, `migrate deploy`).
5. Cas multi-écoles : un user avec plusieurs memberships ACTIVE → sélecteur d'école à prévoir (non implémenté).
