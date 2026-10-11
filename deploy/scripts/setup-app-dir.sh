#!/usr/bin/env bash
# ECOM-SCHOOL — préparation des répertoires (structure de releases).
# Usage : sudo bash deploy/scripts/setup-app-dir.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DEPLOY_USER=deploy   # même utilisateur que les PM2 existants (wendyam-finance)

mkdir -p "$APP_RELEASES" "$APP_SHARED" "$LOG_DIR" "$BACKUP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_ROOT"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$LOG_DIR" "$BACKUP_DIR"
chmod 750 "$APP_ROOT" "$BACKUP_DIR" "$LOG_DIR"
chmod 700 "$APP_SHARED"   # contient .env

echo "Arborescence prête :"
ls -la "$APP_ROOT"
