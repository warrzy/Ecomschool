# Déploiement préproduction — ECOM-SCHOOL

VPS Hostinger KVM 2 · Ubuntu 24.04 · `preprod.ecomschool.fr` → `147.79.118.212`

**Contraintes absolues** : le VPS héberge déjà `tme-machinery.com` et
`wendyam-finance.com` (port 3000, PM2 sous `deploy`). Aucune commande de ce
guide ne touche aux configurations existantes. ECOM-SCHOOL écoute sur
`127.0.0.1:3001` uniquement.

## Architecture de déploiement : releases versionnées

```
/var/www/ecomschool-preprod/
  repo/                  clone git persistant (fetch uniquement)
  releases/20261011_1200/   build complet isolé (worktree git)
  releases/20261012_0900/
  shared/.env            secrets (700) — JAMAIS dans le dépôt
  current → releases/<ts>   lien symbolique, bascule atomique
/var/log/ecomschool/     logs applicatifs + cron + backup
/var/backups/ecomschool/ dumps PostgreSQL (rotation 14 j)
```

Chaque déploiement construit une **nouvelle release** puis déplace le lien
`current`. En cas d'échec avant la bascule, la version en cours reste intacte.
Le rollback est un simple déplacement de lien (< 1 s) + redémarrage PM2.

## Prérequis (déjà présents)

Node 24 · npm · git · PostgreSQL 16 · Nginx · PM2 · UFW (22/80/443)
Certbot : `sudo apt install certbot python3-certbot-nginx` si absent.

## Étape 0 — Vérification des prérequis

```bash
bash deploy/scripts/check-prereqs.sh
```

## Étape 1 — Code sur le serveur

```bash
sudo bash deploy/scripts/setup-app-dir.sh   # (depuis une copie locale des scripts)
# Puis, sous l'utilisateur deploy :

# Option A — dépôt public
sudo -u deploy git clone --no-checkout \
  https://github.com/warrzy/Ecomschool.git /var/www/ecomschool-preprod/repo

# Option B — dépôt privé (recommandé) : Deploy Key lecture seule
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/ecomschool_deploy -N ''
# → ajouter la clé publique en Deploy Key sur GitHub
sudo -u deploy git clone --no-checkout \
  -c core.sshCommand="ssh -i ~/.ssh/ecomschool_deploy" \
  git@github.com:warrzy/Ecomschool.git /var/www/ecomschool-preprod/repo
```

`deploy.sh` crée lui-même le clone s'il est absent — la première exécution
peut donc aussi servir de bootstrap du repo (l'option SSH doit alors être
configurée dans `/home/deploy/.ssh/config`).

## Étape 2 — Base de données

```bash
sudo bash deploy/scripts/create-database.sh
# mot de passe du rôle ecomschool_app demandé interactivement
# (propriétaire de ecomschool_preprod uniquement, pas de superuser)
```

## Étape 3 — Configuration

```bash
sudo -u deploy cp /chemin/.env.preprod.example \
  /var/www/ecomschool-preprod/shared/.env
sudo -u deploy nano /var/www/ecomschool-preprod/shared/.env
chmod 600 /var/www/ecomschool-preprod/shared/.env
```

Générer : `openssl rand -hex 32` (×2 : secrets auth + CRON_SECRET).
Renseigner `DATABASE_URL` (mot de passe étape 2), URLs `https://preprod.ecomschool.fr`,
`PREPROD_PLATFORM_ADMIN_*`.

## Étape 4 — Premier déploiement

```bash
cd /var/www/ecomschool-preprod/repo
sudo -u deploy git worktree add ../releases/init phase-10-production-readiness
sudo -u deploy bash ../releases/init/deploy/scripts/deploy.sh \
  phase-10-production-readiness
```

Déroulé : fetch → worktree `releases/<ts>` → `.env` lié → `npm ci` →
`prisma generate` → **dump pré-migration** → `migrate deploy` → build →
bascule `current` → démarrage PM2 → nettoyage (5 releases conservées).
Tout échec avant la bascule laisse la version courante intacte.

## Étape 5 — Bootstrap (premier déploiement uniquement)

```bash
cd /var/www/ecomschool-preprod/current
sudo -u deploy bash scripts/preprod/bootstrap.sh
```

Crée : permissions, rôles, modules, plans, gabarits de messages (données de
référence uniquement — **aucune donnée de test**) + compte plateforme via
`PREPROD_PLATFORM_ADMIN_*`. Connexion ensuite sur `/platform`.

## Étape 6 — Nginx

```bash
sudo cp /var/www/ecomschool-preprod/current/deploy/nginx/preprod.ecomschool.fr.conf \
  /etc/nginx/sites-available/preprod.ecomschool.fr.conf
sudo ln -s /etc/nginx/sites-available/preprod.ecomschool.fr.conf \
  /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Nouveau fichier dédié — aucun vhost existant modifié. `/api/cron` est en outre
limité à 127.0.0.1 au niveau Nginx (défense en profondeur).

## Étape 7 — HTTPS

```bash
sudo certbot --nginx -d preprod.ecomschool.fr
sudo certbot renew --dry-run
```

## Étape 8 — Cron

```bash
sudo cp /var/www/ecomschool-preprod/current/deploy/cron/ecomschool-preprod.cron \
  /etc/cron.d/ecomschool-preprod
sudo nano /etc/cron.d/ecomschool-preprod   # remplacer __CRON_SECRET__
sudo systemctl reload cron
```

`/api/cron` toutes les 10 min sous `flock` (anti-recouvrement) + sauvegarde
quotidienne 02:30.

## Étape 9 — Vérifications

```bash
bash /var/www/ecomschool-preprod/current/deploy/scripts/healthcheck.sh
```

## Exploitation

| Opération | Commande |
|---|---|
| Nouvelle version | `sudo -u deploy bash current/deploy/scripts/deploy.sh <ref>` |
| Santé | `bash current/deploy/scripts/healthcheck.sh` |
| Rollback applicatif | `bash current/deploy/scripts/rollback.sh [release]` |
| Restauration base | `bash current/deploy/scripts/restore.sh <dump>` |
| Exercice de restauration | `bash current/deploy/scripts/restore-verify.sh <dump>` (base témoin, sans risque) |
| Sauvegarde manuelle | `bash current/deploy/scripts/backup.sh` |
| Supervision | `bash current/deploy/scripts/monitor.sh [--dry-run]` |
| Tests scripts | `bash deploy/tests/run.sh` (stubs, sans VPS ni base) |
| Logs | `pm2 logs ecomschool-preprod`, `/var/log/ecomschool/` |

## Retour arrière — règles

- **Code** : `rollback.sh` (bascule de lien + restart, < 5 s d'interruption).
- **Base** : jamais de rétrogradation automatique — `restore.sh` avec le dump
  `pre-migrate-*`, puis rollback applicatif.
- **Jamais** `prisma migrate reset` ni `db push` en préproduction.

## Sécurité appliquée

- App `127.0.0.1:3001` ; PostgreSQL `127.0.0.1` ; `/api/cron` limité localhost.
- Secrets : `shared/.env` mode 600, hors dépôt, non copié dans les releases
  (lien symbolique uniquement).
- Rôle PostgreSQL dédié, propriétaire d'une seule base, sans superuser.
- PM2 : seul `ecomschool-preprod` créé/supprimé ; les autres applications sont
  ignorées (`--only`).
- UFW inchangé.
