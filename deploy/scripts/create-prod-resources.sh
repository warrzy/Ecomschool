#!/usr/bin/env bash
# ECOM-SCHOOL — création des ressources PRODUCTION (à exécuter en root/sudo).
# Usage : sudo bash /var/www/ecomschool-prod/current/deploy/scripts/create-prod-resources.sh
#
# Idempotent : les ressources existantes attendues sont conservées ;
# toute incohérence inattendue arrête le script sans rien modifier.
#
# Actions :
#   1. /var/backups/ecomschool-prod + /var/log/ecomschool-prod (deploy:deploy 750)
#   2. Rôle PostgreSQL ecomschool_prod_app (LOGIN, mot de passe généré —
#      aucun CREATEDB/CREATerole/superuser)
#   3. Base ecomschool_prod OWNER ecomschool_prod_app
#   4. Mot de passe injecté dans shared/.env (jamais affiché)
#
# Refuse de tourner si la base existe avec un autre propriétaire.
set -euo pipefail

APP_ROOT=${APP_ROOT:-/var/www/ecomschool-prod}
ENV_FILE="$APP_ROOT/shared/.env"
ROLE=ecomschool_prod_app
DB=ecomschool_prod

[ "$(id -u)" = 0 ] || { echo "ERREUR : exécuter en root (sudo)."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERREUR : $ENV_FILE absent."; exit 1; }

# -- 1. Répertoires -----------------------------------------------------------
for d in /var/backups/ecomschool-prod /var/log/ecomschool-prod; do
  mkdir -p "$d"
  chown deploy:deploy "$d"
  chmod 750 "$d"
  echo "OK   $d (deploy:deploy 750)"
done

# -- 2. Rôle PostgreSQL --------------------------------------------------------
PW=$(openssl rand -hex 16)
ROLE_EXISTS=$(su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$ROLE'\"")
if [ "$ROLE_EXISTS" = "1" ]; then
  echo "OK   rôle $ROLE déjà présent — mot de passe régénéré et réinjecté"
  su - postgres -c "psql -c \"ALTER ROLE $ROLE WITH LOGIN PASSWORD '$PW'\""
else
  su - postgres -c "psql -c \"CREATE USER $ROLE WITH LOGIN PASSWORD '$PW'\""
  echo "OK   rôle $ROLE créé (LOGIN seul)"
fi

# -- 3. Base -------------------------------------------------------------------
DB_ROW=$(su - postgres -c "psql -tAc \"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='$DB'\"")
if [ -z "$DB_ROW" ]; then
  su - postgres -c "psql -c \"CREATE DATABASE $DB OWNER $ROLE\""
  echo "OK   base $DB créée (owner $ROLE)"
elif [ "$DB_ROW" = "$ROLE" ]; then
  echo "OK   base $DB déjà présente (owner $ROLE) — inchangée"
else
  echo "REFUS : $DB existe avec owner '$DB_ROW' ≠ $ROLE — aucune action."
  exit 1
fi

# -- 4. Injection du mot de passe dans .env ------------------------------------
sed -i "s|ecomschool_prod_app:[^@]*@|ecomschool_prod_app:$PW@|" "$ENV_FILE"
grep -q "ecomschool_prod_app:$PW@" "$ENV_FILE" \
  && echo "OK   mot de passe écrit dans $ENV_FILE (jamais affiché)" \
  || { echo "ERREUR : DATABASE_URL non mise à jour"; exit 1; }
chmod 600 "$ENV_FILE"

echo
echo "Ressources prod prêtes : $DB / $ROLE / backups / logs."
echo "Suite (user deploy) : bash deploy/scripts/deploy.sh avec APP_ROOT=$APP_ROOT PM2_APP=ecomschool-prod"
