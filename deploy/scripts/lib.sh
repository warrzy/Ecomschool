# shellcheck shell=bash
# Fonctions partagées — sourcées par les scripts deploy/.
#
# Surcharge pour les tests : poser ECOMSCHOOL_ROOT dans l'environnement
# (ex. un répertoire temporaire) pour détourner tous les chemins.

_ECOMSCHOOL_ROOT=${ECOMSCHOOL_ROOT:-}

# APP_ROOT surchargable par l'environnement (ex. instance de production).
if [ -n "${APP_ROOT:-}" ]; then
  APP_ROOT="$APP_ROOT"
elif [ -n "$_ECOMSCHOOL_ROOT" ]; then
  APP_ROOT="$_ECOMSCHOOL_ROOT/app"
else
  APP_ROOT=/var/www/ecomschool-preprod
fi
APP_REPO="$APP_ROOT/repo"          # clone git persistant (fetch + worktree)
APP_RELEASES="$APP_ROOT/releases"  # builds versionnées
APP_SHARED="$APP_ROOT/shared"      # .env et fichiers partagés
APP_CURRENT="$APP_ROOT/current"    # lien symbolique → release active
DB_NAME=${ECOMSCHOOL_DB_NAME:-ecomschool_preprod}
DB_USER=${ECOMSCHOOL_DB_USER:-ecomschool_app}
if [ -n "$_ECOMSCHOOL_ROOT" ]; then
  LOG_DIR="$_ECOMSCHOOL_ROOT/log"
  BACKUP_DIR="$_ECOMSCHOOL_ROOT/backups"
else
  LOG_DIR=${ECOMSCHOOL_LOG_DIR:-/var/log/ecomschool}
  BACKUP_DIR=${ECOMSCHOOL_BACKUP_DIR:-/var/backups/ecomschool}
fi

# Fichier de statut lu par monitor.sh — écrit par backup.sh.
BACKUP_STATUS_FILE="$LOG_DIR/backup-status.env"
# Répertoire de déduplication des alertes (un fichier par alerte active).
ALERT_STATE_DIR=${ALERT_STATE_DIR:-$LOG_DIR/alerts}

# Horodatage lisible pour les logs.
ts() { date -Is; }

# Log une ligne sur stderr — jamais de secret : les scripts n'affichent que
# des chemins, statuts et compteurs, jamais de valeur d'environnement.
log_line() { echo "$(ts) $*" >&2; }

# Lit DATABASE_URL depuis shared/.env et retire la query string
# (?schema=public est un paramètre Prisma, rejeté par libpq).
pg_url() {
  local raw
  raw=$(sed -n 's/^DATABASE_URL=//p' "$APP_SHARED/.env" | tail -1 | tr -d '"'\')
  [ -n "$raw" ] || { echo "DATABASE_URL absente de $APP_SHARED/.env" >&2; return 1; }
  echo "${raw%%\?*}"
}

# URL de connexion vers une AUTRE base du même cluster (ex. base de
# vérification de restauration). Remplace le dernier segment du chemin.
pg_url_for() {
  local db=$1 base
  base=$(pg_url) || return 1
  base=${base%/*}
  echo "$base/$db"
}

# Envoie une alerte vers ALERT_WEBHOOK_URL au format Discord {"content":..}.
# $1=titre  $2=détail. Sans URL configurée : no-op (alerte loggée par l'appelant).
send_alert_webhook() {
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  local clean_title clean_body host now
  # Caractères JSON sensibles neutralisés (guillemets, antislash, newline).
  clean_title=$(printf '%s' "$1" | tr '"\\n' '   ')
  clean_body=$(printf '%s' "$2" | tr '"\\n' '   ')
  host=$(hostname 2>/dev/null || echo '?')
  now=$(ts)
  curl -fsS -m 10 -X POST "$ALERT_WEBHOOK_URL" \
    -H 'content-type: application/json' \
    -d "{\"content\":\"⚠️ **$clean_title** — $clean_body\n$host · $now\"}" \
    >/dev/null 2>&1
}
