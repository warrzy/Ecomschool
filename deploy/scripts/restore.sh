#!/usr/bin/env bash
# ECOM-SCHOOL — restauration d'un dump dans ecomschool_preprod.
# Usage : bash deploy/scripts/restore.sh /var/backups/ecomschool/<fichier>.dump
#
# ATTENTION : écrase le contenu actuel de la base.
# L'application est arrêtée pendant l'opération puis relancée.
#
# Sans sudo : tout est exécuté sous le rôle applicatif (DB_USER), qui peut
# terminer ses propres connexions et supprimer/recréer ses propres objets.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DUMP="${1:?Usage: restore.sh <fichier.dump>}"
[ -f "$DUMP" ] || { echo "Fichier introuvable : $DUMP"; exit 1; }

# 0) Vérification du dump avant toute action.
if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256") \
    || { echo "Empreinte SHA256 invalide — abandon."; exit 1; }
else
  echo "ATTENTION : pas de fichier .sha256 — intégrité non vérifiable."
fi
pg_restore -l "$DUMP" >/dev/null 2>&1 \
  || { echo "Dump illisible (pg_restore -l) — abandon."; exit 1; }

read -rp "Restaurer $DUMP dans ${DB_NAME} (destructif) ? [o/N] " a
[[ "$a" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 1; }

DBURL=$(pg_url)

echo "1) Arrêt de l'application (ecomschool-preprod uniquement)"
pm2 stop ecomschool-preprod || true

echo "2) Sauvegarde de sécurité de l'état actuel"
mkdir -p "$BACKUP_DIR"
pg_dump "$DBURL" -Fc -f "$BACKUP_DIR/pre-restore-$(date +%Y%m%d_%H%M%S).dump" \
  || echo "ATTENTION : sauvegarde pré-restore échouée (poursuite)"

echo "3) Fermeture des connexions résiduelles"
# pg_terminate_backend est permis au rôle sur ses propres connexions —
# toutes les connexions applicatives appartiennent à DB_USER.
psql "$DBURL" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" || true

echo "4) Restauration (--clean, objets sous ${DB_USER})"
# --no-owner : les objets reviennent au rôle de connexion (DB_USER).
pg_restore --clean --if-exists --no-owner -d "$DBURL" "$DUMP"

echo "5) Redémarrage"
pm2 delete ecomschool-preprod >/dev/null 2>&1 || true
pm2 start "$APP_CURRENT/deploy/pm2/ecosystem.config.cjs" \
  --only ecomschool-preprod
pm2 save

echo "6) Vérification"
sleep 3
bash "$(dirname "$0")/healthcheck.sh"
