#!/usr/bin/env bash
# ECOM-SCHOOL — restauration d'un dump dans ecomschool_preprod.
# Usage : bash deploy/scripts/restore.sh /var/backups/ecomschool/<fichier>.dump
#
# ATTENTION : écrase le contenu actuel de la base.
# L'application est arrêtée pendant l'opération puis relancée.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DUMP="${1:?Usage: restore.sh <fichier.dump>}"
[ -f "$DUMP" ] || { echo "Fichier introuvable : $DUMP"; exit 1; }

read -rp "Restaurer $DUMP dans ${DB_NAME} (destructif) ? [o/N] " a
[[ "$a" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 1; }

echo "1) Arrêt de l'application (ecomschool-preprod uniquement)"
pm2 stop ecomschool-preprod || true

echo "2) Sauvegarde de sécurité de l'état actuel"
mkdir -p "$BACKUP_DIR"
pg_dump "$(pg_url)" -Fc -f "$BACKUP_DIR/pre-restore-$(date +%Y%m%d_%H%M%S).dump" \
  || echo "ATTENTION : sauvegarde pré-restore échouée (poursuite)"

echo "3) Fermeture des connexions résiduelles"
sudo -u postgres psql -d "$DB_NAME" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" || true

echo "4) Restauration (--clean, objets recréés sous ${DB_USER})"
sudo -u postgres pg_restore --clean --if-exists --no-owner \
  --role="$DB_USER" -d "$DB_NAME" "$DUMP"

echo "5) Redémarrage"
pm2 delete ecomschool-preprod >/dev/null 2>&1 || true
pm2 start "$APP_CURRENT/deploy/pm2/ecosystem.config.cjs" \
  --only ecomschool-preprod
pm2 save

echo "6) Vérification"
sleep 3
bash "$(dirname "$0")/healthcheck.sh"
