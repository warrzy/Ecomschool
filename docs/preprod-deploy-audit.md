# Audit technique — déploiement préproduction ECOM-SCHOOL

Branche auditée : `phase-10-production-readiness` (`f6b3260`).
Cible : VPS Hostinger `147.79.118.212` · `preprod.ecomschool.fr` · port 3001.

## Compatibilité infrastructure

| Composant | Requis | VPS | Verdict |
|---|---|---|---|
| Node.js | ≥ 20 (Next 16, NextAuth 4) | 24.14.0 | OK — E2E validés sous Node 24 |
| PostgreSQL | ≥ 15 (Prisma 7) | 16.15 | OK |
| Prisma | CLI 7.10 + `prisma-client-js` | — | `prisma migrate deploy` + `generate` au déploiement |
| Mémoire | Next build ~1,5 Go, run ~0,5 Go | 8 Go | OK pour préprod (build parallèle à wendyam à surveiller) |
| Port | 3001 sur 127.0.0.1 | 3000 pris par wendyam | OK — 3001 à confirmer libre par check-prereqs |

## Points vérifiés dans le code

- **`npm start`** : `next start` standard — `-p 3001 -H 127.0.0.1` via PM2
  (`deploy/pm2/ecosystem.config.cjs`). Pas d'output standalone nécessaire.
- **Auth** : NextAuth v4 credentials, JWT 12 h. Cookies sécurisés
  automatiquement avec `NEXTAUTH_URL` https — pas de config custom à porter.
- **`prisma.config.ts`** charge `.env` via `dotenv/config` : le fichier
  d'environnement sur le serveur doit s'appeler `.env` (le nom
  `.env.preprod` n'est PAS lu automatiquement — c'est un modèle à copier).
- **`postinstall`** : `prisma skills sync || exit 0` — tolérant aux erreurs,
  sans impact sur `npm ci` en production.
- **Stockage fichiers** : aucun upload serveur actif. Les logos sont lus
  depuis `public/` (fichiers versionnés). Pas de répertoire inscriptible à
  prévoir hors `.next/` et logs PM2.
- **`/api/cron`** : secret Bearer obligatoire (503 sans `CRON_SECRET`,
  401 mauvais secret, comparaison `timingSafeEqual`). Ordonnancement externe
  requis — couvert par `/etc/cron.d/ecomschool-preprod`.
- **Base vide au premier déploiement** : `prisma migrate deploy` n'amène
  AUCUNE donnée de référence. Le bootstrap est obligatoire :
  `scripts/preprod/bootstrap.sh` enchaîne les bootstraps idempotents des
  phases 2–9 (permissions, rôles, modules, plans, gabarits) + création du
  compte plateforme via `PREPROD_PLATFORM_ADMIN_*`.
- **Providers externes** : email/SMS/WhatsApp tous optionnels — canal
  non configuré = indisponible affiché, jamais de simulation. Préprod peut
  tourner sans aucun.
- **Headers sécurité** : HSTS activé dans `next.config.ts` — déployer
  HTTPS rapidement ; en cas d'accès HTTP prolongé, HSTS force le navigateur
  en HTTPS une fois le certificat émis (comportement souhaité).

## Blocages / décisions avant déploiement

1. **Accès GitHub depuis le VPS** : dépôt `warrzy/Ecomschool` — si privé,
   créer une Deploy Key lecture seule sous l'utilisateur `deploy` (procédure
   dans `deploy/README.md` étape 1). À confirmer.
2. **Branche déployée** : le travail récent est sur
   `phase-10-production-readiness`, non fusionné dans `main`. Décider si la
   préprod suit cette branche (défaut dans `deploy.sh`) ou attend la fusion.
3. **Secrets à générer sur place** : `AUTH_SECRET`/`NEXTAUTH_SECRET`,
   `CRON_SECRET`, mot de passe `ecomschool_app`, mot de passe du compte
   plateforme — jamais dans le dépôt.
4. **`SEED_TEST_PASSWORD` / `SEED_DEMO_PASSWORD`** : ne PAS les renseigner en
   préprod — ils ne servent qu'aux seeds de développement. Le seed dev
   (`prisma/seed.ts`) ne doit PAS être exécuté en préproduction.
5. **Rétention des dumps** : 14 jours par défaut dans
   `/var/backups/ecomschool` — à copier hors VPS pour la production finale.
6. **Ressources partagées** : le `next build` (~1,5 Go) pendant que
   wendyam-finance tourne — planifier les déploiements hors pic ou accepter
   une contention temporaire.

## Fichiers livrés

```
deploy/
  README.md                        guide complet (étapes 0→9, exploitation)
  nginx/preprod.ecomschool.fr.conf vhost dédié 80 → proxy 127.0.0.1:3001
  pm2/ecosystem.config.cjs         processus ecomschool-preprod dédié
  cron/ecomschool-preprod.cron     /api/cron 10 min + backup quotidien
  scripts/
    check-prereqs.sh               audit serveur lecture seule
    setup-app-dir.sh               répertoires app/logs/backups
    create-database.sh             rôle + base (privilèges minimaux, interactif)
    deploy.sh                      pull → ci → generate → dump → migrate → build → reload
    healthcheck.sh                 PM2, port, csrf, nginx, cron
    backup.sh                      pg_dump -Fc + rotation 14 j
    restore.sh                     arrêt → pré-dump → pg_restore --clean → healthcheck
    rollback.sh                    code → commit antérieur + rebuild
.env.preprod.example               gabarit d'environnement sans secrets
scripts/preprod/
  bootstrap.sh                     enchaîne les bootstraps idempotents P2→P9
  create-platform-admin.ts         compte plateforme (env PREPROD_*)
```

## Tests locaux exécutés

- `bash -n` sur les 8 scripts shell : syntaxe OK.
- `npm run typecheck` (inclut `scripts/preprod/`) : OK.
- Aucune connexion au VPS, aucune commande distante exécutée.
