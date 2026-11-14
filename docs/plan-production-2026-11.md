# Plan de bascule production — ecomschool.fr

**Date :** 2026-11-08 · **Branche :** `phase-10-production-readiness` · **Cible :** https://ecomschool.fr (+www)
**Statut :** proposition — aucune opération VPS exécutée (en attente de GO).

---

## 1. Mission A — I1 + I2 : état

| Élément | Constat |
|---|---|
| Commits | `64dbb99` (I1) + `51fe622` (I2) — locaux, non poussés |
| Tests I2 | tsc ✓ eslint ✓ build 16.4.1 ✓ · H12 68 · H6 110 · H5 117 · G2-E 91 · G3-C 71 |
| Vulns résiduelles | uuid@8.3.2 via exceljs (2 moderate, `buf` non utilisé) + dev-deps |
| **Test restauration réel** | **BLOQUÉ** : `restore-verify.sh` → `ecomschool_verify` inexistante et rôle `ecomschool_app` sans `CREATEDB` |
| **Déblocage (admin, une fois)** | `sudo -u postgres psql -c "CREATE DATABASE ecomschool_verify OWNER ecomschool_app;"` — aucun privilège nouveau accordé |
| Cron/alertes | Ligne restore-verify dim 04:10 prête dans `ecomschool-preprod.cron`, **non installée** ; canal `ALERT_WEBHOOK_URL` à renseigner dans shared/.env (absent → alertes loggées seulement) |

## 2. Mission B — Audit VPS (lecture seule, réalisé)

| Élément | Constat |
|---|---|
| Sites Nginx | `preprod.ecomschool.fr`, `wendyam-finance`, `tme-machinery`, `ecom-touch-public`, `preprod.wagesse.fr`, `default` |
| TLS | Certbot/letsencrypt actif — certificats par vhost (`/etc/letsencrypt/live/<domaine>/`) |
| Ports | 80/443 public · 3000 **exposé 0.0.0.0 (à identifier)** · 3001 preprod · 3010 · 3020 · 3306 mysql · 5432 pg |
| PM2 | `ecomschool-preprod` (:3001, 285 MB), `wendyam-finance` — **tme-machinery absent de PM2** (autre service/user — à confirmer avant toute opération) |
| Versions | Node v24.14.0 · PostgreSQL 16.15 · nginx 1.24.0 |
| Ressources | RAM 8 GB (6.6 libre) · disque 96 GB @23% · 2 vCPU — **confortable pour une instance prod supplémentaire (~300 MB)** |
| Privilèges | `deploy` sans sudo — opérations admin (DB create, nginx, certbot) nécessitent l'accès administrateur |
| Backups | dumps + uploads + SHA-256 dans `/var/backups/ecomschool`, rétention ~14j+ |
| Risque | Port 3000 public bound — vérifier que rien n'y écoute en clair avant ouverture prod |

## 3. Mission C — Architecture cible proposée

```
https://ecomschool.fr  ─┐
https://www.ecomschool.fr → 301 → ecomschool.fr
        nginx vhost (certbot) → 127.0.0.1:3002 → PM2 ecomschool-prod
              → PostgreSQL ecomschool_prod (user ecomschool_prod_app)
              → uploads : /var/www/ecomschool-prod/shared/uploads
```

| Composant | Valeur |
|---|---|
| App | `/var/www/ecomschool-prod/{repo,releases,shared}` — même structure que preprod |
| PM2 | `ecomschool-prod`, port interne **3002** (libre), fork, 1 instance |
| DB | `ecomschool_prod` + rôle dédié `ecomschool_prod_app` (mot de passe propre, jamais celui de preprod) |
| Secrets | `.env` propre : `NEXTAUTH_SECRET`, `DATABASE_URL`, `CRON_SECRET`, `APP_ENV=production`, `NEXT_PUBLIC_BASE_URL=https://ecomschool.fr` — aucune réutilisation preprod |
| Premier admin | `create-database.sh` + création via `schools.ts` (platform admin) par script interactif — mot de passe saisi, jamais codé/commité |
| Backups | `/var/backups/ecomschool-prod/` — même scripts paramétrés |
| Monitoring | `monitor.sh` + `restore-verify-run.sh` propres à prod |
| Données | **Aucune copie preprod→prod** — base vierge + migrations seules |
| Paiements | LIVE désactivé (providers sandbox/manuels seuls) |
| Notifications externes | Désactivées tant que providers non configurés |

### Commandes proposées (ordonnées, à exécuter sur GO)

```bash
# 1. Prérequis (admin, une fois)
sudo -u postgres psql -c "CREATE USER ecomschool_prod_app PASSWORD '<secret>';"
sudo -u postgres psql -c "CREATE DATABASE ecomschool_prod OWNER ecomschool_prod_app;"
sudo -u postgres psql -c "CREATE DATABASE ecomschool_verify OWNER ecomschool_app;"   # débloque I1
mkdir -p /var/www/ecomschool-prod/{repo,releases,shared,shared/uploads} /var/backups/ecomschool-prod

# 2. Code + env
cd /var/www/ecomschool-prod && git clone --bare <remote> repo
# éditer shared/.env (secrets propres) — ECOMSCHOOL_PROD_ROOT=/var/www/ecomschool-prod

# 3. Déploiement (variante prod de deploy.sh, APP_ROOT paramétré)
ECOMSCHOOL_ROOT=/var/www/ecomschool-prod bash deploy/scripts/deploy.sh
cd /var/www/ecomschool-prod/current && npx prisma migrate deploy      # 55/55
npx tsx scripts/h5/bootstrap-*.ts scripts/h6/bootstrap-*.ts scripts/h12/bootstrap-accounting-permissions.ts

# 4. PM2 + nginx + TLS
pm2 start deploy/pm2/ecosystem.config.cjs --only ecomschool-prod && pm2 save
# nginx : copier preprod conf → server_name ecomschool.fr www.ecomschool.fr, proxy 3002, www→apex 301
sudo certbot --nginx -d ecomschool.fr -d www.ecomschool.fr

# 5. Cron prod + premier admin platform (script interactif)
```

**Rollback** : retrait du vhost + `pm2 delete ecomschool-prod` (aucune donnée avant onboarding) ; bascule `current` si release défaillante.

## 4. Mission D — Checklist GO/NO-GO lancement

| Contrôle | Critère | État |
|---|---|---|
| Migrations | 55/55 appliquées sur base vierge | ☐ |
| Permissions provisionnées | bootstrap rôle global exécuté | ☐ |
| Auth | admin créé via procédure sécurisée, login vérif | ☐ |
| Onboarding | école test réelle créée e2e | ☐ |
| Abonnements/modules | activation par école OK | ☐ |
| Isolation multi-tenant | 2 écoles → croisement nul | ☐ |
| Documents/stockage | upload + download permissionné | ☐ |
| Comptabilité | plan installé, écriture générée | ☐ |
| Paiements LIVE | désactivés | ✅ par design |
| Notifications externes | désactivées non configurées | ✅ par design |
| Données de test | base vierge, zéro fixture | ☐ |
| HTTPS | certbot ecomschool.fr+www, www→apex 301 | ☐ |
| Sauvegardes | cron prod actif | ☐ |
| Restauration | `ecomschool_verify` créée + cycle réussi | ☐ bloqué (1 cmd admin) |
| Monitoring/alertes | monitor + ALERT_WEBHOOK_URL | ☐ canal à renseigner |
| Rollback | procédure testée | ☐ |

**NO-GO avant** : (1) `CREATE DATABASE ecomschool_verify` + restauration réussie, (2) identification du service sur le port 3000 public, (3) confirmation que tme-machinery n'est pas géré par le PM2 du user deploy, (4) `ALERT_WEBHOOK_URL` configuré.

**En attente du GO explicite pour les opérations VPS.**
