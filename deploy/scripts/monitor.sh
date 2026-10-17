#!/usr/bin/env bash
# ECOM-SCHOOL — supervision : sauvegardes, cron, jobs DEAD, dispo, disque.
# Usage : bash deploy/scripts/monitor.sh [--dry-run]
#         (planifié en crontab, user deploy — ex. toutes les 15 min)
#
# Contrôles :
#   - dernière sauvegarde OK et récente (backup-status.env de backup.sh)
#   - copie distante présente et fraîche (statut ; si restic : dernier snapshot)
#   - nouvelles lignes dans cron-errors.log (échecs /api/cron)
#   - jobs applicatifs DEAD récents
#   - application joignable (local + HTTPS public)
#   - espace disque
#
# Alertes : une par condition, dédupliquées ALERT_DEDUP_HOURS (défaut 24 h) ;
# un message "rétabli" est émis quand la condition disparaît.
# Canal : ALERT_WEBHOOK_URL (POST JSON) sinon EMAIL_PROVIDER_URL (même
# contrat que les fournisseurs de messages). Aucun secret n'est transmis.
# --dry-run : affiche les alertes sans rien envoyer (tests).
set -uo pipefail
source "$(dirname "$0")/lib.sh"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

BACKUP_MAX_AGE_HOURS=${BACKUP_MAX_AGE_HOURS:-26}
DISK_ALERT_PCT=${DISK_ALERT_PCT:-90}
ALERT_DEDUP_HOURS=${ALERT_DEDUP_HOURS:-24}
CRON_ERRORS=${CRON_ERRORS_FILE:-$LOG_DIR/cron-errors.log}

mkdir -p "$ALERT_STATE_DIR"
ISSUES=0

# Émet une alerte dédupliquée. $1=clé  $2=titre  $3=détail
alert() {
  local key=$1 title=$2 body=$3 stamp="$ALERT_STATE_DIR/$1.stamp"
  local now=$(date +%s) last=0
  [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt $((ALERT_DEDUP_HOURS * 3600)) ]; then
    return 0  # déjà signalée récemment
  fi
  ISSUES=$((ISSUES + 1))
  # En dry-run on ne consomme pas la déduplication : un test ne doit pas
  # masquer une alerte réelle pendant ALERT_DEDUP_HOURS.
  [ "$DRY_RUN" = 0 ] && echo "$now" > "$stamp"
  local payload
  payload=$(printf '{"key":"%s","title":"%s","body":"%s","host":"%s","at":"%s"}' \
    "$key" "$title" "$body" "$(hostname 2>/dev/null || echo '?')" "$(ts)")
  if [ "$DRY_RUN" = 1 ]; then
    echo "ALERTE[dry-run] $key — $title — $body"
    return 0
  fi
  echo "ALERTE $key — $title — $body" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -X POST "$ALERT_WEBHOOK_URL" \
      -H 'content-type: application/json' -d "$payload" >/dev/null 2>&1 \
      || log_line "monitor: envoi webhook en échec ($key)"
  elif [ -n "${EMAIL_PROVIDER_URL:-}" ]; then
    curl -fsS -m 10 -X POST "$EMAIL_PROVIDER_URL" \
      -H 'content-type: application/json' \
      ${EMAIL_PROVIDER_TOKEN:+-H "authorization: Bearer $EMAIL_PROVIDER_TOKEN"} \
      -d "{\"to\":\"${ALERT_EMAIL_TO:-ops@ecom-touch.local}\",\"subject\":\"[ECOM-SCHOOL] $title\",\"text\":\"$body\"}" \
      >/dev/null 2>&1 || log_line "monitor: envoi email en échec ($key)"
  else
    log_line "monitor: aucun canal d'alerte configuré (ALERT_WEBHOOK_URL)"
  fi
}

# Condition disparue : purge la dédup et signale le rétablissement une fois.
resolved() {
  local key=$1 title=$2 stamp="$ALERT_STATE_DIR/$1.stamp"
  if [ -f "$stamp" ]; then
    rm -f "$stamp"
    echo "RETABLI $key — $title" >&2
    if [ "$DRY_RUN" = 0 ] && [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
      curl -fsS -m 10 -X POST "$ALERT_WEBHOOK_URL" \
        -H 'content-type: application/json' \
        -d "{\"key\":\"$key\",\"title\":\"RÉTABLI : $title\",\"resolved\":true}" \
        >/dev/null 2>&1 || true
    fi
  fi
}

# ---- 1) Sauvegarde locale ----
if [ -f "$BACKUP_STATUS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$BACKUP_STATUS_FILE"
  age=$(( $(date +%s) - $(date -d "${LAST_BACKUP_AT:-1970-01-01}" +%s 2>/dev/null || echo 0) ))
  if [ "${LAST_BACKUP_OK:-0}" != 1 ]; then
    alert backup_failed "Sauvegarde échouée" "Dernier dump ${LAST_BACKUP_FILE:-?} en échec."
  elif [ "$age" -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ]; then
    alert backup_stale "Sauvegarde trop ancienne" "Dernier dump il y a $((age / 3600)) h (max ${BACKUP_MAX_AGE_HOURS} h)."
  else
    resolved backup_failed "Sauvegarde échouée"
    resolved backup_stale "Sauvegarde trop ancienne"
  fi
else
  alert backup_failed "Aucune sauvegarde connue" "$BACKUP_STATUS_FILE absent — backup.sh n'a jamais abouti."
fi

# ---- 2) Copie distante ----
if [ "${LAST_BACKUP_REMOTE_MODE:-none}" = none ]; then
  alert backup_no_remote "Aucune copie distante" "Sauvegarde locale seule — configurer RESTIC_* ou BACKUP_REMOTE."
elif [ "${LAST_BACKUP_REMOTE_OK:-0}" != 1 ]; then
  alert backup_remote "Copie distante en échec" "Mode ${LAST_BACKUP_REMOTE_MODE} KO sur le dernier dump."
else
  resolved backup_remote "Copie distante en échec"
  resolved backup_no_remote "Aucune copie distante"
  # Fraîcheur distante restic : dernier snapshot < seuil.
  if [ "${LAST_BACKUP_REMOTE_MODE}" = restic ] && command -v restic >/dev/null; then
    latest=$(restic snapshots --json --latest 1 2>/dev/null | grep -oE '"time":"[^"]+"' | head -1 | cut -d'"' -f4)
    if [ -n "$latest" ]; then
      rage=$(( $(date +%s) - $(date -d "$latest" +%s 2>/dev/null || echo 0) ))
      [ "$rage" -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ] \
        && alert backup_remote_stale "Snapshot distant ancien" "Dernier snapshot restic il y a $((rage / 3600)) h." \
        || resolved backup_remote_stale "Snapshot distant ancien"
    fi
  fi
fi

# ---- 3) Échecs cron ----
if [ -s "$CRON_ERRORS" ]; then
  n=$(wc -l < "$CRON_ERRORS" | tr -d ' ')
  alert cron_failed "Échecs cron /api/cron" "$n échec(s) consigné(s) dans $(basename "$CRON_ERRORS")."
else
  resolved cron_failed "Échecs cron /api/cron"
fi

# ---- 4) Jobs applicatifs DEAD ----
DEAD=$(psql "$(pg_url)" -tAc \
  "SELECT count(*) FROM \"Job\" WHERE status='DEAD' AND \"finishedAt\" > now() - interval '24 hours'" \
  2>/dev/null || echo -1)
if [ "$DEAD" = "-1" ]; then
  alert jobs_probe "Sonde jobs interrogeable" "psql sur Job a échoué — base injoignable ?"
elif [ "$DEAD" -gt 0 ]; then
  alert jobs_dead "Jobs DEAD" "$DEAD job(s) applicatif(s) DEAD sur 24 h."
else
  resolved jobs_dead "Jobs DEAD"
  resolved jobs_probe "Sonde jobs interrogeable"
fi

# ---- 5) Disponibilité applicative ----
code=$(curl -fsS -o /dev/null -m 10 -w '%{http_code}' \
  http://127.0.0.1:3001/api/auth/csrf 2>/dev/null || echo 000)
[ "$code" = "200" ] && resolved app_down "Application injoignable" \
  || alert app_down "Application injoignable" "127.0.0.1:3001 → HTTP $code."
pub=$(curl -fsS -o /dev/null -m 15 -w '%{http_code}' \
  https://preprod.ecomschool.fr/login 2>/dev/null || echo 000)
[ "$pub" = "200" ] && resolved app_public "HTTPS public injoignable" \
  || alert app_public "HTTPS public injoignable" "preprod.ecomschool.fr → HTTP $pub."

# ---- 6) Espace disque ----
USE=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
[ "${USE:-0}" -ge "$DISK_ALERT_PCT" ] \
  && alert disk_full "Espace disque critique" "/ utilisé à ${USE}% (seuil ${DISK_ALERT_PCT}%)." \
  || resolved disk_full "Espace disque critique"

echo "$(ts) monitor: ${ISSUES} alerte(s) émise(s)"
[ "$ISSUES" -eq 0 ] || exit 1
