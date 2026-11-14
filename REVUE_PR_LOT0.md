# REVUE PR — LOT 0

Branches : `lot0/ci-github`, `lot0/nav-permissions` (base `main` = `ec62b59`).

## `lot0/ci-github` — `.github/workflows/ci.yml`

| Point | Constat |
|---|---|
| typecheck/lint/build | ✅ scripts réels (`tsc --noEmit`, `eslint`, `next build`), secrets factices CI sans fuite |
| Job recette PostgreSQL 16 | ✅ service container sain, `migrate deploy` réel |
| **ANOMALIE P1** | `bootstrap.sh` se termine par `create-platform-admin.ts` qui **exige `PREPROD_PLATFORM_ADMIN_EMAIL`+`PASSWORD`** — absentes du workflow → **le job recette échouera**. Correction : fournir les 2 vars de test dans `env:` du job, ou rendre l'étape admin optionnelle dans bootstrap.sh |
| **ANOMALIE P2** | Node 22 en CI vs **Node 24 en prod** — écart moteur | Aligner sur `node-version: 24` |
| H12 recette | ✅ pertinent (verticale complète), mais dépend de `bootstrap-accounting-permissions` **non inclus dans `bootstrap.sh`** — vérifié en recette verify : sans lui `installStarterPlan` échoue | Ajouter `npx tsx scripts/h12/bootstrap-accounting-permissions.ts` après bootstrap |

## `lot0/nav-permissions`

| Changement | Constat |
|---|---|
| Menu « Documents administratifs » | ✅ correct : `administrative-docs.read` = permission réelle de la page (`page.tsx:35`), section Administration cohérente |
| Création `BURSAR` dans bootstrap H12 | ✅ corrige AUD-040 : rôle global (`schoolId:null`, scope SCHOOL) conforme au pattern de création de `phase7/bootstrap-permissions.ts` ; idempotent |
| Limite connue | Le rôle BURSAR global créé n'attribue automatiquement aucune membership — attribution manuelle par l'admin école (acceptable, documenter) |
| Typecheck | ✅ vert après merge local de test |

## Impossibles à contrôler depuis la revue

- Exécution réelle du workflow (pas de run Actions avant merge).
- Effet visuel du nouvel item de menu (non rejoué en UI).

## DÉCISION : **GO SOUS RÉSERVES**

`nav-permissions` : fusionnable tel quel. `ci-github` : corriger les 3 anomalies (vars admin CI, Node 24, bootstrap accounting) avant fusion — sinon la CI naît rouge.
