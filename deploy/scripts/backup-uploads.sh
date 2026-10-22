#!/usr/bin/env bash
# ECOM-SCHOOL — sauvegarde des documents privés (G2-A).
# Usage : bash deploy/scripts/backup-uploads.sh   (planifié en crontab)
#
# Produit :
#   $BACKUP_DIR/uploads_<ts>.tar.gz          archive tar.gz des uploads
#   $BACKUP_DIR/uploads_<ts>.tar.gz.sha256   empreinte d'intégrité
#   $BACKUP_DIR/uploads_<ts>.manifest.txt    nb fichiers + octets (audit)
#
# Cible : $APP_SHARED/uploads (DOCUMENTS_ROOT) — hors racine web.
# Ne touche ni PostgreSQL (couvert par backup.sh) ni les autres apps.
# Copie distante : suit la même convention que backup.sh
# (RESTIC_* ou BACKUP_REMOTE / BACKUP_LOCAL_ONLY).
set -uo pipefail
source "$(dirname "$0")/lib.sh"

set -a
[ -f "$APP_SHARED/.env" ] && . "$APP_SHARED/.env" || true
set +a

RETENTION_DAYS=${RETENTION_DAYS:-14}
UPLOADS_DIR=${DOCUMENTS_ROOT:-$APP_SHARED/uploads}

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/uploads_${STAMP}.tar.gz"
STATUS_FILE="$LOG_DIR/backup-uploads-status.env"

write_status() {
  {
    echo "LAST_UPLOADS_BACKUP_TS=\"$STAMP\""
    echo "LAST_UPLOADS_BACKUP_FILE=\"$(basename "$FILE" 2>/dev/null || echo '-')\""
    echo "LAST_UPLOADS_BACKUP_OK=${LAST_UPLOADS_BACKUP_OK:-0}"
    echo "LAST_UPLOADS_REMOTE_OK=${REMOTE_OK:-0}"
    echo "LAST_UPLOADS_FILES=${UPLOADS_FILES:-0}"
    echo "LAST_UPLOADS_BYTES=${UPLOADS_BYTES:-0}"
    echo "LAST_UPLOADS_BACKUP_AT=\"$(date -Is)\""
  } > "$STATUS_FILE"
  chmod 640 "$STATUS_FILE" 2>/dev/null || true
}

fail() {
  log_line "backup-uploads FAIL: $*"
  write_status
  exit 1
}

# Rien à sauvegarder : répertoire absent = état sain (module non utilisé).
if [ ! -d "$UPLOADS_DIR" ]; then
  log_line "backup-uploads info: $UPLOADS_DIR absent — rien à faire"
  LAST_UPLOADS_BACKUP_OK=1 UPLOADS_FILES=0 UPLOADS_BYTES=0 REMOTE_OK=0
  write_status
  exit 0
fi

# 1) Archive locale : tar.gz déterministe côté contenu (droits conservés).
tar -C "$(dirname "$UPLOADS_DIR")" -czf "$FILE" "$(basename "$UPLOADS_DIR")" \
  || fail "tar a échoué"
chmod 640 "$FILE"
[ -s "$FILE" ] || fail "archive vide"

# 2) Manifeste : nombre de fichiers + volume (contrôle de cohérence).
UPLOADS_FILES=$(find "$UPLOADS_DIR" -type f ! -name '*.tmp-*' | wc -l)
UPLOADS_BYTES=$(du -sb "$UPLOADS_DIR" 2>/dev/null | cut -f1 || echo 0)
{
  echo "stamp=$STAMP"
  echo "source=$UPLOADS_DIR"
  echo "files=$UPLOADS_FILES"
  echo "bytes=$UPLOADS_BYTES"
  echo "archive_files=$(tar -tzf "$FILE" | grep -v '/$' | wc -l)"
} > "$BACKUP_DIR/uploads_${STAMP}.manifest.txt"
chmod 640 "$BACKUP_DIR/uploads_${STAMP}.manifest.txt"

# 3) Intégrité : l'archive doit être relistable + empreinte SHA256.
tar -tzf "$FILE" >/dev/null 2>&1 || fail "archive illisible (tar -t)"
sha256sum "$FILE" > "$FILE.sha256" || fail "sha256sum a échoué"
chmod 640 "$FILE.sha256"
LAST_UPLOADS_BACKUP_OK=1

# 4) Rotation locale.
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz.sha256" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "uploads_*.manifest.txt" -mtime +"$RETENTION_DAYS" -delete

# 5) Copie distante (même convention que backup.sh, best-effort).
REMOTE_OK=0
if [ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD:-}" ]; then
  if restic backup "$FILE" "$FILE.sha256" \
      "$BACKUP_DIR/uploads_${STAMP}.manifest.txt" \
      --tag ecomschool-uploads >>"$LOG_DIR/backup.log" 2>&1; then
    REMOTE_OK=1
  else
    log_line "backup-uploads FAIL-REMOTE: restic backup a échoué"
  fi
elif [ -n "${BACKUP_REMOTE:-}" ]; then
  if rsync -az --chmod=640 "$FILE" "$FILE.sha256" \
      "$BACKUP_DIR/uploads_${STAMP}.manifest.txt" \
      "$BACKUP_REMOTE/" >>"$LOG_DIR/backup.log" 2>&1; then
    REMOTE_OK=1
  else
    log_line "backup-uploads FAIL-REMOTE: rsync a échoué"
  fi
elif [ "${BACKUP_LOCAL_ONLY:-0}" = 1 ]; then
  log_line "backup-uploads info: copie locale seule (BACKUP_LOCAL_ONLY=1)"
fi

write_status
echo "$(ts) Sauvegarde uploads : $FILE ($(du -h "$FILE" | cut -f1), ${UPLOADS_FILES:-0} fichiers)"
