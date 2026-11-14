<!-- title: Guide administrateur technique -->
# Guide administrateur technique — configuration et exploitation

Référence pour l'équipe ECOM-TOUCH opérant la plateforme. Synthèse
technique ; le détail opérationnel est dans
`docs/exploitation/SECURITE_ET_EXPLOITATION.md`.

## 1. Architecture

- **Stack** : Next.js (App Router) + TypeScript + Prisma/PostgreSQL
- **Multi-tenant** : `schoolId` porté par toutes les tables métier ;
  aucune requête transverse sans filtre tenant
- **RBAC serveur** : `requireSchoolPermission(ctx, perm)` côté serveur,
  menu filtré par `permCoveredByEntitlements` (droits ET abonnement)
- **Portails dédiés** : `/app` (admin), `/teacher`, `/parent`,
  `/student`, `/platform` (ECOM-TOUCH)
- **PM2** : instances par environnement (prod :3002, preprod :3001)
  derrière nginx

## 2. Environnements et migrations

| Élément | Détail |
|---|---|
| Migrations | Prisma ; `prisma migrate deploy` en déploiement, backup **pré-migrate** automatique |
| Variables | `.env` par environnement — jamais de secret en dépôt |
| Sauvegardes | dump quotidien + SHA-256 + uploads hebdo + dump pré-migrate |
| Restore-drill | `restore.sh` vers base témoin `ecomschool_verify` — jamais la base applicative |

## 3. Sécurité opérationnelle

- **Rate limiting** : `deploy/nginx/00-ecomschool-ratelimit.conf`
  (zones `ecom_api` 10 r/s, `ecom_auth` 2 r/s sur `/api/auth/`) —
  contexte `http`, application par sudo + `nginx -t`
- **En-têtes** : `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` dans les confs de site
- **Preprod** : protection basic-auth ou IP allowlist (confs prêtes
  en commentaire) — activer avant toute recette externe
- **Tokens** : invitations/reset hashés à l'enregistrement ; liens à
  usage unique, expirants
- **Audit** : journal plateforme + sessions d'assistance visibles par
  l'école (bandeau) et expirantes

## 4. Exploitation courante

| Tâche | Outil |
|---|---|
| Santé applicative | `deploy/scripts/healthcheck.sh` (paramétré par env) |
| Supervision jobs | `/platform/monitoring` (file, échecs DEAD à rejouer) |
| Surveillance | `deploy/scripts/monitor.sh` (prod→3002, preprod→3001) |
| Rollback | `deploy/scripts/rollback.sh` (pointe sur la release précédente) |
| Logs | PM2 logs + journal d'audit applicatif |

## 5. Paie — verrou réglementaire

Les composants `isRegulatory: true` sont **exclus du calcul** jusqu'à
validation officielle du barème burkinabè (CNSS : taux, plafond,
ventilation ; ITS : tranches, assiette, abattements — liste complète
dans `docs/reglementaire/PARAMETRES_PAIE_BF.md`). Activation = création
des formules officielles + passage à 4 yeux — **aucun taux ne doit
être inventé**.

## 6. Idempotence et intégrité — points clés

- Paiements : clé d'idempotence + **empreinte SHA-256 du payload** —
  clé réutilisée avec payload différent ⇒ `IDEMPOTENCY_CONFLICT`
- Écritures : équilibrées avant insertion ; clé unique source ⇒
  pas de doublon ; annulation = contre-passation
- Campagnes paie : validation → POSTED atomique ; rectification par
  contre-passation
- Clôture d'exercice : refusée tant que des opérations ne sont pas
  postées (`UNPOSTED_OPERATIONS`)

## 7. Démonstration et recette

- Comptes démo : `scripts/preprod/demo-accounts.ts` (garde
  `ALLOW_DEMO_SEED=1`, refuse les URLs prod)
- Données démo : `scripts/preprod/demo-data.ts` (garde
  `ALLOW_RECETTE=1` + garde anti-prod du module partagé)
- Smoke UI : `scripts/preprod/ui-smoke.ts` (9 profils, erreurs JS/API)
- Captures : `scripts/docs/capture-annotated.ts`
- **Ces scripts sont interdits en production** — gardes multiples et
  cloisonnement strict à `demo-validation`.
