#!/usr/bin/env bash
# ECOM-SCHOOL — déploiement préproduction (idempotent).
# Usage : bash deploy/scripts/deploy.sh [ref-git]
#   ref-git : branche/tag/commit à déployer (défaut : phase-10-production-readiness)
#
# À exécuter sous l'utilisateur `deploy`, depuis /var/www/ecomschool-preprod.
set -euo pipefail

APP_DIR=/var/www/ecomschool-preprod
APP_REF="${1:-phase-10-production-readiness}"
BACKUP_DIR=/var/backups/ecomschool
export PATH="$HOME/.pm2/bin:/usr/local/bin:/usr/bin:$PATH"

cd "$APP_DIR"
[ -f .env ] || { echo "ERREUR : .env absent (voir .env.preprod.example)"; exit 1; }

echo "== 1/7 Récupération du code ($APP_REF) =="
git fetch --all --tags --prune
git checkout "$APP_REF"
git pull --ff-only origin "$APP_REF" 2>/dev/null || git reset --hard "$APP_REF"

echo "== 2/7 Dépendances =="
npm ci

echo "== 3/7 Prisma generate =="
npx prisma generate

echo "== 4/7 Sauvegarde pré-migration =="
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d'"' -f2)
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_DIR/pre-migrate-${STAMP}.dump" \
  && echo "Sauvegarde : $BACKUP_DIR/pre-migrate-${STAMP}.dump"

echo "== 5/7 Migrations =="
npx prisma migrate deploy

echo "== 6/7 Build =="
npm run build

echo "== 7/7 Redémarrage PM2 =="
if pm2 describe ecomschool-preprod >/dev/null 2>&1; then
  pm2 reload ecomschool-preprod --update-env
else
  pm2 start deploy/pm2/ecosystem.config.cjs --only ecomschool-preprod
fi
pm2 save

echo ""
echo "Déploiement terminé. Vérification : bash deploy/scripts/healthcheck.sh"
