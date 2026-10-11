#!/usr/bin/env bash
# ECOM-SCHOOL — préparation des répertoires applicatif et logs.
# Usage : sudo bash deploy/scripts/setup-app-dir.sh
set -euo pipefail

APP_DIR=/var/www/ecomschool-preprod
LOG_DIR=/var/log/ecomschool
BACKUP_DIR=/var/backups/ecomschool
DEPLOY_USER=deploy   # même utilisateur que les PM2 existants (wendyam-finance)

mkdir -p "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$LOG_DIR" "$BACKUP_DIR"
chmod 750 "$APP_DIR" "$BACKUP_DIR"
chmod 750 "$LOG_DIR"

echo "Répertoires prêts :"
ls -ld "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"
