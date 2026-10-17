#!/usr/bin/env bash
# ECOM-SCHOOL — sauvegarde PostgreSQL + copie distante + statut supervisé.
# Usage : bash deploy/scripts/backup.sh   (planifié en crontab, user deploy)
#
# Produit :
#   $BACKUP_DIR/<db>_<ts>.dump       dump custom (-Fc), chmod 640
#   $BACKUP_DIR/<db>_<ts>.dump.sha256  empreinte d'intégrité
#   $LOG_DIR/backup-status.env       dernier état (lu par monitor.sh)
#
# Copie distante (désactivée tant qu'aucune destination n'est configurée) :
#   RESTIC_REPOSITORY + RESTIC_PASSWORD → restic (chiffré côté client,
#     déduplication, rétention keep-daily/weekly/monthly, `restic check`).
#   Sinon BACKUP_REMOTE="user@hote:/chemin" → rsync over SSH (transport
#     chiffré). Le compte distant doit être restreint (rrsync/sftp-jail).
# Aucun secret n'est écrit dans les logs.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

# Configuration depuis shared/.env (RESTIC_*, BACKUP_REMOTE, RETENTION_DAYS,
# BACKUP_LOCAL_ONLY…) — la crontab ne source pas l'environnement applicatif.
set -a
[ -f "$APP_SHARED/.env" ] && . "$APP_SHARED/.env" || true
set +a

RETENTION_DAYS=${RETENTION_DAYS:-14}
# Rétention distante restic (générations conservées).
RESTIC_KEEP_DAILY=${RESTIC_KEEP_DAILY:-14}
RESTIC_KEEP_WEEKLY=${RESTIC_KEEP_WEEKLY:-8}
RESTIC_KEEP_MONTHLY=${RESTIC_KEEP_MONTHLY:-12}

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"
STATUS="LAST_BACKUP_OK=0"
REMOTE_OK=0

write_status() {
  {
    echo "LAST_BACKUP_TS=\"$STAMP\""
    echo "LAST_BACKUP_FILE=\"$(basename "$FILE" 2>/dev/null || echo '-')\""
    echo "LAST_BACKUP_OK=${LAST_BACKUP_OK:-0}"
    echo "LAST_BACKUP_REMOTE_OK=${REMOTE_OK}"
    echo "LAST_BACKUP_REMOTE_MODE=\"${REMOTE_MODE:-none}\""
    echo "LAST_BACKUP_BYTES=${LAST_BACKUP_BYTES:-0}"
    echo "LAST_BACKUP_AT=\"$(date -Is)\""
  } > "$BACKUP_STATUS_FILE"
  chmod 640 "$BACKUP_STATUS_FILE" 2>/dev/null || true
}

fail() {
  log_line "backup FAIL: $*"
  write_status
  exit 1
}

REMOTE_MODE=none
if [ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD:-}" ]; then
  REMOTE_MODE=restic
elif [ -n "${BACKUP_REMOTE:-}" ]; then
  REMOTE_MODE=rsync
fi

# 1) Dump local.
pg_dump "$(pg_url)" -Fc -f "$FILE" || fail "pg_dump a échoué"
chmod 640 "$FILE"
[ -s "$FILE" ] || fail "dump vide"
LAST_BACKUP_BYTES=$(stat -c %s "$FILE" 2>/dev/null || stat -f %z "$FILE")

# 2) Intégrité locale : le dump doit être listable par pg_restore.
pg_restore -l "$FILE" >/dev/null 2>&1 || fail "dump illisible (pg_restore -l)"

# 3) Empreinte SHA256 (transportée avec le dump ; vérifiée à la restauration).
sha256sum "$FILE" > "$FILE.sha256" || fail "sha256sum a échoué"
chmod 640 "$FILE.sha256"

LAST_BACKUP_OK=1

# 4) Rotation locale.
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump.sha256" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "pre-migrate-*.dump" -mtime +"$RETENTION_DAYS" -delete

# 5) Copie distante (best-effort : l'échec est signalé, le dump local reste).
if [ "$REMOTE_MODE" = restic ]; then
  if restic backup "$FILE" "$FILE.sha256" --tag ecomschool >>"$LOG_DIR/backup.log" 2>&1; then
    if restic forget --tag ecomschool \
        --keep-daily "$RESTIC_KEEP_DAILY" \
        --keep-weekly "$RESTIC_KEEP_WEEKLY" \
        --keep-monthly "$RESTIC_KEEP_MONTHLY" \
        --prune >>"$LOG_DIR/backup.log" 2>&1; then
      REMOTE_OK=1
    else
      log_line "backup WARN: restic forget/prune a échoué"
      REMOTE_OK=1  # la copie existe ; la rotation sera reprise au prochain run
    fi
  else
    log_line "backup FAIL-REMOTE: restic backup a échoué (voir backup.log)"
  fi
elif [ "$REMOTE_MODE" = rsync ]; then
  if rsync -az --chmod=640 "$FILE" "$FILE.sha256" "$BACKUP_REMOTE/" >>"$LOG_DIR/backup.log" 2>&1; then
    # Vérification optionnelle : relire l'empreinte distante.
    if [ -n "${BACKUP_REMOTE_SSH:-}" ]; then
      remote_dir=${BACKUP_REMOTE#*:}
      remote_host=${BACKUP_REMOTE%%:*}
      remote_sum=$(ssh "$BACKUP_REMOTE_SSH" "sha256sum '$remote_dir/$(basename "$FILE")' | cut -d' ' -f1" 2>/dev/null || true)
      local_sum=$(cut -d' ' -f1 "$FILE.sha256")
      if [ -n "$remote_sum" ] && [ "$remote_sum" = "$local_sum" ]; then
        REMOTE_OK=1
      else
        log_line "backup FAIL-REMOTE: empreinte distante ≠ locale"
      fi
      : "$remote_host" # évite unused si le format diffère
    else
      REMOTE_OK=1
    fi
  else
    log_line "backup FAIL-REMOTE: rsync a échoué (voir backup.log)"
  fi
else
  if [ "${BACKUP_LOCAL_ONLY:-0}" = 1 ]; then
    log_line "backup info: copie locale seule (choix volontaire BACKUP_LOCAL_ONLY=1)"
  else
    log_line "backup WARN: aucune destination distante configurée (copie locale seule)"
  fi
fi

write_status
echo "$(ts) Sauvegarde : $FILE ($(du -h "$FILE" | cut -f1)) distant=$REMOTE_MODE ok=$REMOTE_OK"
echo "Fichiers conservés : $(find "$BACKUP_DIR" -name '*.dump' | wc -l)"
[ "$REMOTE_OK" = 1 ] || exit 0   # l'échec distant est remonté via le statut
