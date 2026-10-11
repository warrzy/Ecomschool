#!/usr/bin/env bash
# ECOM-SCHOOL — restauration d'un dump dans la base préproduction.
# Usage : bash deploy/scripts/restore.sh /var/backups/ecomschool/<fichier>.dump
#
# ATTENTION : écrase le contenu actuel de ecomschool_preprod.
# L'application est arrêtée pendant l'opération puis relancée.
set -euo pipefail

DUMP="${1:?Usage: restore.sh <fichier.dump>}"
DB_NAME=ecomschool_preprod

[ -f "$DUMP" ] || { echo "Fichier introuvable : $DUMP"; exit 1; }

echo "1) Arrêt de l'application"
pm2 stop ecomschool-preprod || true

echo "2) Sauvegarde de sécurité de l'état actuel"
mkdir -p /var/backups/ecomschool
sudo -u postgres pg_dump -Fc -f \
  "/var/backups/ecomschool/pre-restore-$(date +%Y%m%d_%H%M%S).dump" "$DB_NAME"

echo "3) Restauration (--clean : DROP des objets existants puis recréation)"
sudo -u postgres pg_restore --clean --if-exists --no-owner \
  -d "$DB_NAME" "$DUMP"

echo "4) Redémarrage"
pm2 reload ecomschool-preprod --update-env || \
  pm2 start /var/www/ecomschool-preprod/deploy/pm2/ecosystem.config.cjs \
    --only ecomschool-preprod

echo "5) Vérification"
sleep 3
bash "$(dirname "$0")/healthcheck.sh"
