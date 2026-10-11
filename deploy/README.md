# Déploiement préproduction — ECOM-SCHOOL

VPS Hostinger KVM 2 · Ubuntu 24.04 · `preprod.ecomschool.fr` → `147.79.118.212`

**Contraintes absolues** : le VPS héberge déjà `tme-machinery.com` et
`wendyam-finance.com` (port 3000, PM2 sous `deploy`). Aucune commande de ce
guide ne touche aux configurations existantes. ECOM-SCHOOL écoute sur
`127.0.0.1:3001` uniquement.

## Prérequis (déjà présents sur le VPS)

Node 24 · npm · git · PostgreSQL 16 (`16/main`) · Nginx · PM2 · UFW (22/80/443)

Certbot doit être installé (`sudo apt install certbot python3-certbot-nginx`
si absent).

## Étape 0 — Vérification des prérequis

```bash
bash deploy/scripts/check-prereqs.sh
```

Vérifie : binaires, services actifs, ports 80/443 ouverts, **port 3001 libre**,
PostgreSQL non exposé, DNS résolu, rôle/base PostgreSQL absents ou existants.

## Étape 1 — Transférer le code sur le serveur

Le dépôt est privé ou public selon la configuration GitHub — prévoir l'accès :

```bash
# Option A — clone HTTPS (dépôt public ou token)
sudo -u deploy git clone https://github.com/warrzy/Ecomschool.git \
  /var/www/ecomschool-preprod

# Option B — clé de déploiement (dépôt privé, recommandé)
# 1) générer une clé dédiée sous l'utilisateur deploy :
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/ecomschool_deploy -N ''
# 2) ajouter la clé publique en Deploy Key (lecture seule) sur GitHub
# 3) cloner :
sudo -u deploy git clone -c core.sshCommand="ssh -i ~/.ssh/ecomschool_deploy" \
  git@github.com:warrzy/Ecomschool.git /var/www/ecomschool-preprod
```

Si le répertoire doit être créé avant le clone : exécuter d'abord
`sudo bash deploy/scripts/setup-app-dir.sh` (depuis une copie temporaire des
scripts, ou recréer manuellement `mkdir -p /var/www/ecomschool-preprod`).

## Étape 2 — Base de données

```bash
sudo bash deploy/scripts/create-database.sh
# → demande le mot de passe du rôle ecomschool_app (privilèges : propriétaire
#   de ecomschool_preprod uniquement, pas de superuser)
```

Noter le mot de passe pour `.env` (`DATABASE_URL`).

## Étape 3 — Configuration applicative

```bash
sudo -u deploy cp .env.preprod.example /var/www/ecomschool-preprod/.env
sudo -u deploy nano /var/www/ecomschool-preprod/.env
chmod 600 /var/www/ecomschool-preprod/.env
```

Générer les secrets :

```bash
openssl rand -hex 32   # AUTH_SECRET / NEXTAUTH_SECRET
openssl rand -hex 32   # CRON_SECRET
```

Renseigner : `DATABASE_URL` (mot de passe de l'étape 2), `NEXTAUTH_URL`/`AUTH_URL`
`https://preprod.ecomschool.fr`, `PREPROD_PLATFORM_ADMIN_*` (compte
propriétaire plateforme du bootstrap), fournisseurs si utilisés.

## Étape 4 — Premier déploiement

```bash
cd /var/www/ecomschool-preprod
sudo -u deploy bash deploy/scripts/deploy.sh phase-10-production-readiness
```

Le script : fetch → `npm ci` → `prisma generate` → **sauvegarde
pré-migration** → `prisma migrate deploy` → `next build` → démarrage PM2
`ecomschool-preprod` (`next start -p 3001 -H 127.0.0.1`).

## Étape 5 — Bootstrap des données de référence (premier déploiement)

La base migrée est vide : permissions, rôles, modules, plans, gabarits et le
compte propriétaire doivent être créés :

```bash
cd /var/www/ecomschool-preprod
sudo -u deploy bash scripts/preprod/bootstrap.sh
```

Ensuite : connexion sur `https://preprod.ecomschool.fr/platform` avec
`PREPROD_PLATFORM_ADMIN_EMAIL` pour créer les établissements.

## Étape 6 — Nginx

```bash
sudo cp deploy/nginx/preprod.ecomschool.fr.conf \
  /etc/nginx/sites-available/preprod.ecomschool.fr.conf
sudo ln -s /etc/nginx/sites-available/preprod.ecomschool.fr.conf \
  /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Ne modifie aucun site existant (nouveau fichier dédié).

## Étape 7 — HTTPS (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx   # si absent
sudo certbot --nginx -d preprod.ecomschool.fr
# Choisir la redirection HTTP → HTTPS. Certbot modifie UNIQUEMENT le
# server block de preprod.ecomschool.fr.
sudo certbot renew --dry-run   # vérifier le renouvellement automatique
```

## Étape 8 — Cron système

```bash
# Remplacer __CRON_SECRET__ par la valeur de CRON_SECRET du .env
sudo cp deploy/cron/ecomschool-preprod.cron /etc/cron.d/ecomschool-preprod
sudo nano /etc/cron.d/ecomschool-preprod
sudo systemctl reload cron   # ou crond selon l'image
```

Deux entrées : `/api/cron` toutes les 10 min (jobs, automatisations,
rétention) et sauvegarde quotidienne 02:30.

## Étape 9 — Vérifications

```bash
bash deploy/scripts/healthcheck.sh
# PM2 présent, écoute 127.0.0.1:3001 uniquement, /api/auth/csrf → 200,
# nginx -t, entrée cron présente.
```

Parcours manuel : connexion `/login` → `/platform`, création d'une école,
connexion admin école → `/app`.

## Exploitation

| Opération | Commande |
|---|---|
| Nouvelle version | `bash deploy/scripts/deploy.sh <ref>` |
| Santé | `bash deploy/scripts/healthcheck.sh` |
| Sauvegarde manuelle | `bash deploy/scripts/backup.sh` |
| Restauration | `bash deploy/scripts/restore.sh <dump>` |
| Retour arrière code | `bash deploy/scripts/rollback.sh [commit]` |
| Logs applicatifs | `pm2 logs ecomschool-preprod` + `/var/log/ecomschool/` |
| Logs jobs/automatisations | page `/platform/automations` + table `TaskRun` |

## Retour arrière — règles

- Code : `rollback.sh` (commit antérieur + rebuild).
- Base : `prisma migrate deploy` n'est jamais rétrogradé automatiquement ;
  restaurer le dump `pre-migrate-*` via `restore.sh` puis rollback du code.
- **Jamais** `prisma migrate reset` ni `db push` sur la préproduction.

## Sécurité appliquée

- App sur `127.0.0.1` uniquement — pas de port applicatif exposé.
- PostgreSQL : `127.0.0.1` uniquement, rôle dédié propriétaire d'une seule base.
- Secrets dans `.env` mode 600, jamais dans le dépôt.
- `/api/cron` : Bearer `CRON_SECRET`, appel local uniquement.
- UFW inchangé (22/80/443) — aucune règle ajoutée.
