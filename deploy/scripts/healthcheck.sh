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
# nginx -t exige des droits de lecture des vhosts/logs — inaccessibles à
# deploy. On vérifie le service (systemctl, sans sudo) puis la syntaxe si
# un sudo non-interactif est disponible.
if systemctl is-active --quiet nginx 2>/dev/null; then
  echo "OK   nginx actif (systemctl)"
  if sudo -n nginx -t >/dev/null 2>&1; then
    echo "OK   nginx -t"
  else
    echo "WARN nginx -t non vérifiable sans sudo (service actif néanmoins)"
  fi
elif pgrep -x nginx >/dev/null 2>&1; then
  echo "OK   processus nginx présent"
else
  echo "FAIL nginx inactif"; fail=1
fi
# Après Certbot : HTTPS attendu. HTTP → 301 accepté (redirection vers HTTPS).
code=$(curl -sk -L -o /dev/null -w '%{http_code}' \
  https://preprod.ecomschool.fr/api/auth/csrf)
echo "HTTPS preprod.ecomschool.fr → $code (200 attendu)"

echo "== Cron =="
# La tâche est dans la crontab de l'utilisateur deploy (pas /etc/cron.d).
if crontab -l 2>/dev/null | grep -q 'api/cron'; then
  echo "OK   entrée cron /api/cron dans la crontab de $(id -un)"
elif grep -rqs 'api/cron' /etc/cron.d/ 2>/dev/null; then
  echo "OK   entrée cron /api/cron dans /etc/cron.d"
else
  echo "WARN aucune entrée cron /api/cron trouvée"
fi

[ "$fail" -eq 0 ] && echo -e "\nSanté OK" || { echo -e "\nÉchecs détectés"; exit 1; }
