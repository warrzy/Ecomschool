#!/usr/bin/env bash
# ECOM-SCHOOL — retour arrière vers le commit précédemment déployé.
# Usage : bash deploy/scripts/rollback.sh [commit]
#
# Stratégie : code → commit antérieur + rebuild + reload.
# La base N'EST PAS rétrogradée automatiquement : si la migration ayant posé
# problème est irréversible, restaurer d'abord le dump pre-migrate le plus
# récent via restore.sh, puis exécuter ce script.
set -euo pipefail

APP_DIR=/var/www/ecomschool-preprod
cd "$APP_DIR"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # Commit déployé juste avant HEAD.
  TARGET=$(git rev-parse HEAD~1)
  echo "Aucun commit fourni — retour à $TARGET"
  git log --oneline -5
  read -rp "Confirmer le retour arrière vers $TARGET ? [o/N] " a
  [[ "$a" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 1; }
fi

git checkout "$TARGET"
npm ci
npx prisma generate
npm run build
pm2 reload ecomschool-preprod --update-env
pm2 save

echo "Rollback terminé vers $TARGET"
bash "$(dirname "$0")/healthcheck.sh"
