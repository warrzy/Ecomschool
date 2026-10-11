#!/usr/bin/env bash
# ECOM-SCHOOL — sauvegarde PostgreSQL préproduction + rotation.
# Usage : bash deploy/scripts/backup.sh   (à planifier en crontab)
set -euo pipefail

BACKUP_DIR=/var/backups/ecomschool
DB_NAME=ecomschool_preprod
RETENTION_DAYS=${RETENTION_DAYS:-14}

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"

# Dump via le rôle postgres (accès lecture garantie) — le rôle applicatif
# suffirait aussi, mais postgres évite tout souci de privilège.
sudo -n -u postgres pg_dump -Fc -f "$FILE" "$DB_NAME" 2>/dev/null \
  || sudo -u postgres pg_dump -Fc -f "$FILE" "$DB_NAME"

chmod 640 "$FILE"
chown deploy:deploy "$FILE" 2>/dev/null || true

# Rotation : suppression des dumps plus vieux que RETENTION_DAYS.
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +"$RETENTION_DAYS" -delete
# Nettoie aussi les sauvegardes pré-migration au-delà de la rétention.
find "$BACKUP_DIR" -name "pre-migrate-*.dump" -mtime +"$RETENTION_DAYS" -delete

echo "Sauvegarde : $FILE ($(du -h "$FILE" | cut -f1))"
echo "Fichiers conservés : $(find "$BACKUP_DIR" -name '*.dump' | wc -l)"
