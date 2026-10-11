#!/usr/bin/env bash
# ECOM-SCHOOL — retour arrière applicatif instantané.
# Usage : bash deploy/scripts/rollback.sh [release]
#
# Bascule le lien `current` vers la release précédente (ou celle fournie)
# puis redémarre ecomschool-preprod. Aucun rebuild nécessaire.
#
# ATTENTION : ce script ne rétrograde PAS la base de données. Si le problème
# vient d'une migration, restaurer d'abord le dump pre-migrate correspondant
# via restore.sh, PUIS exécuter ce script.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

cd "$APP_RELEASES"
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  # Release précédent celle actuellement active.
  CUR=$(basename "$(readlink -f "$APP_CURRENT")")
  TARGET=$(ls -1dt */ | grep -v "^${CUR}/$" | head -1 | tr -d '/')
  [ -n "$TARGET" ] || { echo "Aucune autre release disponible."; exit 1; }
  echo "Release active : $CUR — retour proposé : $TARGET"
  read -rp "Confirmer ? [o/N] " a
  [[ "$a" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 1; }
fi

[ -d "$APP_RELEASES/$TARGET" ] \
  || { echo "Release introuvable : $APP_RELEASES/$TARGET"; exit 1; }

echo "Bascule → $TARGET"
ln -sfn "$APP_RELEASES/$TARGET" "$APP_CURRENT.tmp" \
  && mv -T "$APP_CURRENT.tmp" "$APP_CURRENT"

pm2 delete ecomschool-preprod >/dev/null 2>&1 || true
pm2 start "$APP_CURRENT/deploy/pm2/ecosystem.config.cjs" \
  --only ecomschool-preprod
pm2 save

echo "Rollback terminé."
bash "$(dirname "$0")/healthcheck.sh"
