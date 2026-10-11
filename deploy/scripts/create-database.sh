#!/usr/bin/env bash
# ECOM-SCHOOL — création du rôle et de la base préproduction (privilèges minimaux).
# Usage : sudo bash deploy/scripts/create-database.sh
# Le mot de passe du rôle est demandé interactivement (jamais dans le script).
set -euo pipefail

DB_NAME=ecomschool_preprod
DB_USER=ecomschool_app

read -rsp "Mot de passe pour le rôle PostgreSQL '$DB_USER' : " DB_PASS
echo
[ -n "$DB_PASS" ] || { echo "Mot de passe vide — abandon."; exit 1; }

# Le rôle applicatif possède sa base (prisma migrate deploy a besoin de DDL),
# sans privilèges super-utilisateur ni accès aux autres bases.
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS//\'/\'\'}';
  ELSE
    ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS//\'/\'\'}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb --owner="${DB_USER}" "${DB_NAME}"
  echo "Base ${DB_NAME} créée (propriétaire ${DB_USER})."
else
  echo "Base ${DB_NAME} déjà présente — inchangée."
fi

# Vérifie que le rôle peut se connecter à SA base uniquement.
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" \
  -tAc "SELECT 'connexion applicative OK : '||current_database()"
