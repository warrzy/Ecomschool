#!/usr/bin/env bash
# ECOM-SCHOOL — vérification des prérequis serveur (lecture seule).
# Usage : bash deploy/scripts/check-prereqs.sh
set -uo pipefail

fail=0
check() { # $1=label $2=command
  if eval "$2" >/dev/null 2>&1; then
    echo "OK   $1"
  else
    echo "FAIL $1"; fail=1
  fi
}

echo "== Système =="
. /etc/os-release && echo "OS: $PRETTY_NAME"

check "Node.js >= 20"        "node -e 'process.exit(Number(process.versions.node.split(\".\")[0])>=20?0:1)'"
check "npm présent"          "command -v npm"
check "git présent"          "command -v git"
check "Nginx actif"          "systemctl is-active --quiet nginx"
check "PostgreSQL actif"     "systemctl is-active --quiet postgresql"
check "PM2 installé"         "command -v pm2"
check "certbot installé"     "command -v certbot"
check "UFW actif"            "ufw status | grep -q 'Status: active'"
check "80/tcp ouvert (UFW)"  "ufw status | grep -qE '^80/tcp|^Nginx'"
check "443/tcp ouvert (UFW)" "ufw status | grep -qE '^443/tcp|^Nginx'"

echo "== Conflits et isolation =="
if ss -tlnp 2>/dev/null | grep -q ':3001 '; then
  echo "FAIL port 3001 déjà utilisé :"; ss -tlnp | grep ':3001 '; fail=1
else
  echo "OK   port 3001 libre"
fi
check "port 5432 local uniquement" \
  "! ss -tln | grep -E ':5432' | grep -vE '127\.0\.0\.1|\[::1\]|::1'"
[ -d /var/www/ecomschool-preprod ] \
  && echo "INFO /var/www/ecomschool-preprod existe déjà" \
  || echo "OK   répertoire cible disponible"

echo "== PostgreSQL =="
if sudo -n -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "OK   accès postgres via sudo -u postgres"
  sudo -n -u postgres psql -tAc \
    "SELECT 'role  ecomschool_app : '||CASE WHEN COUNT(*)=1 THEN 'existe' ELSE 'absent' END FROM pg_roles WHERE rolname='ecomschool_app'"
  sudo -n -u postgres psql -tAc \
    "SELECT 'base  ecomschool_preprod : '||CASE WHEN COUNT(*)=1 THEN 'existe' ELSE 'absente' END FROM pg_database WHERE datname='ecomschool_preprod'"
else
  echo "FAIL sudo -u postgres psql inaccessible"; fail=1
fi

echo "== DNS =="
host_ip=$(command -v dig >/dev/null \
  && dig +short preprod.ecomschool.fr A | tail -1 \
  || getent hosts preprod.ecomschool.fr | awk '{print $1; exit}')
echo "preprod.ecomschool.fr → ${host_ip:-non résolu} (attendu : 147.79.118.212)"

[ "$fail" -eq 0 ] && echo -e "\nPrérequis OK" || { echo -e "\nDes prérequis manquent"; exit 1; }
