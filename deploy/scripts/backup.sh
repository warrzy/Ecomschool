#!/usr/bin/env bash
# ECOM-SCHOOL — sauvegarde PostgreSQL préproduction + rotation.
# Usage : bash deploy/scripts/backup.sh   (planifié en crontab, user deploy)
#
# Aucun sudo requis : les identifiants sont lus dans shared/.env.
# Résultat : dump format custom (-Fc) restaurable avec pg_restore.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

RETENTION_DAYS=${RETENTION_DAYS:-14}
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"

pg_dump "$(pg_url)" -Fc -f "$FILE"
chmod 640 "$FILE"

# Rotation locale.
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "pre-migrate-*.dump" -mtime +"$RETENTION_DAYS" -delete

# Copie hors VPS — DÉCOMMENTER et adapter la destination :
#   rsync -az "$FILE" backupuser@<hôte-externe>:/backups/ecomschool/
# ou via rclone/object storage. Un dump local seul ne couvre pas la perte du VPS.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -az "$FILE" "$BACKUP_REMOTE" \
    && echo "Copie distante : $BACKUP_REMOTE" \
    || echo "ATTENTION : échec de la copie distante" >&2
fi

echo "Sauvegarde : $FILE ($(du -h "$FILE" | cut -f1))"
echo "Fichiers conservés : $(find "$BACKUP_DIR" -name '*.dump' | wc -l)"
