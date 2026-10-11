#!/usr/bin/env bash
# ECOM-SCHOOL — bootstrap des données de référence en préproduction.
# Exécute, dans l'ordre, les bootstraps idempotents des phases 2 à 9
# (permissions, rôles, modules, plans, gabarits de messages) puis crée le
# compte propriétaire plateforme à partir des variables PREPROD_*.
# Usage : bash scripts/preprod/bootstrap.sh   (depuis la racine de l'app)
set -euo pipefail
cd "$(dirname "$0")/../.."

for f in \
  scripts/phase2/bootstrap-reference-data.ts \
  scripts/phase3/bootstrap-permissions.ts \
  scripts/phase4/bootstrap-permissions.ts \
  scripts/phase5/bootstrap-permissions.ts \
  scripts/phase6/bootstrap-permissions.ts \
  scripts/phase7/bootstrap-permissions.ts \
  scripts/phase8/bootstrap.ts \
  scripts/phase9/bootstrap.ts \
  scripts/preprod/create-platform-admin.ts
do
  echo "── $f"
  npx tsx "$f"
done

echo "Bootstrap préproduction terminé."
