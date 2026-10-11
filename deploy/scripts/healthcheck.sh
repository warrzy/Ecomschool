#!/usr/bin/env bash
# ECOM-SCHOOL — vérifications de santé applicative.
# Usage : bash deploy/scripts/healthcheck.sh
set -uo pipefail
fail=0

echo "== Processus =="
pm2 describe ecomschool-preprod >/dev/null 2>&1 \
  && echo "OK   PM2 ecomschool-preprod présent" \
  || { echo "FAIL PM2 ecomschool-preprod absent"; fail=1; }
ss -tln | grep -q '127.0.0.1:3001' \
  && echo "OK   écoute 127.0.0.1:3001 (non exposé)" \
  || { echo "FAIL pas d'écoute sur 127.0.0.1:3001"; fail=1; }
ss -tln | grep -E '(^|\s)0\.0\.0\.0:3001' >/dev/null \
  && { echo "FAIL 3001 exposé sur toutes les interfaces"; fail=1; } \
  || echo "OK   3001 non exposé publiquement"

echo "== Applicatif =="
code=$(curl -sk -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/auth/csrf)
[ "$code" = "200" ] && echo "OK   /api/auth/csrf → 200" \
  || { echo "FAIL /api/auth/csrf → $code"; fail=1; }

echo "== Nginx =="
nginx -t >/dev/null 2>&1 && echo "OK   nginx -t" \
  || { echo "FAIL nginx -t"; fail=1; }
code=$(curl -sk -o /dev/null -w '%{http_code}' http://preprod.ecomschool.fr/api/auth/csrf)
echo "HTTP  préprod.ecomschool.fr → $code (200 attendu)"

echo "== Cron =="
grep -rqs 'ecomschool\|api/cron' /etc/cron.d/ /var/spool/cron/crontabs/ 2>/dev/null \
  && echo "OK   entrée cron trouvée" \
  || echo "WARN aucune entrée cron /api/cron trouvée"

[ "$fail" -eq 0 ] && echo -e "\nSanté OK" || { echo -e "\nÉchecs détectés"; exit 1; }
