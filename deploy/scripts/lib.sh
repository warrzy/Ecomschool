# shellcheck shell=bash
# Fonctions partagées — sourcées par les scripts deploy/.

APP_ROOT=/var/www/ecomschool-preprod
APP_REPO="$APP_ROOT/repo"          # clone git persistant (fetch + worktree)
APP_RELEASES="$APP_ROOT/releases"  # builds versionnées
APP_SHARED="$APP_ROOT/shared"      # .env et fichiers partagés
APP_CURRENT="$APP_ROOT/current"    # lien symbolique → release active
DB_NAME=ecomschool_preprod
DB_USER=ecomschool_app
LOG_DIR=/var/log/ecomschool
BACKUP_DIR=/var/backups/ecomschool

# Lit DATABASE_URL depuis shared/.env et retire la query string
# (?schema=public est un paramètre Prisma, rejeté par libpq).
pg_url() {
  local raw
  raw=$(sed -n 's/^DATABASE_URL=//p' "$APP_SHARED/.env" | tail -1 | tr -d '"'\')
  [ -n "$raw" ] || { echo "DATABASE_URL absente de $APP_SHARED/.env" >&2; return 1; }
  echo "${raw%%\?*}"
}
