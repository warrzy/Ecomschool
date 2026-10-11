#!/usr/bin/env bash
# ECOM-SCHOOL — vérifications de santé applicative.
# Usage : bash deploy/scripts/healthcheck.sh
set -uo pipefail
source "$(dirname "$0")/lib.sh" 2>/dev/null || true
fail=0

echo "== Processus =="
pm2 describe ecomschool-preprod >/dev/null 2>&1 \
  && echo "OK   PM2 ecomschool-preprod présent" \
  || { echo "FAIL PM2 ecomschool-preprod absent"; fail=1; }
ss -tln | grep -q '127.0.0.1:3001' \
  && echo "OK   écoute 127.0.0.1:3001 (non exposé)" \
  || { echo "FAIL pas d'écoute sur 127.0.0.1:3001"; fail=1; }
ss -tln | grep -E '(0\.0\.0\.0|\[::\]|\*|::):3001' >/dev/null \
  && { echo "FAIL 3001 exposé sur toutes les interfaces"; fail=1; } \
  || echo "OK   3001 non exposé publiquement"

echo "== Release =="
[ -n "${APP_CURRENT:-}" ] && [ -L "$APP_CURRENT" ] \
  && echo "OK   current → $(readlink -f "$APP_CURRENT")" \
  || echo "WARN lien current introuvable"

echo "== Applicatif =="
code=$(curl -sk -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/auth/csrf)
[ "$code" = "200" ] && echo "OK   /api/auth/csrf → 200" \
  || { echo "FAIL /api/auth/csrf → $code"; fail=1; }

echo "== Nginx =="
nginx -t >/dev/null 2>&1 && echo "OK   nginx -t" \
  || { echo "FAIL nginx -t"; fail=1; }
# Après Certbot : HTTPS attendu. HTTP → 301 accepté (redirection vers HTTPS).
code=$(curl -sk -L -o /dev/null -w '%{http_code}' \
  https://preprod.ecomschool.fr/api/auth/csrf)
echo "HTTPS preprod.ecomschool.fr → $code (200 attendu)"

echo "== Cron =="
grep -rqs 'ecomschool\|api/cron' /etc/cron.d/ /var/spool/cron/crontabs/ 2>/dev/null \
  && echo "OK   entrée cron trouvée" \
  || echo "WARN aucune entrée cron /api/cron trouvée"

[ "$fail" -eq 0 ] && echo -e "\nSanté OK" || { echo -e "\nÉchecs détectés"; exit 1; }
