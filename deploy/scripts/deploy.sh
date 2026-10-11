#!/usr/bin/env bash
# ECOM-SCHOOL — déploiement préproduction avec releases versionnées.
# Usage : bash deploy/scripts/deploy.sh [ref-git]
#   ref-git : branche/tag/commit (défaut : phase-10-production-readiness)
#
# Stratégie : chaque déploiement construit une release isolée dans
# releases/<horodatage>, puis bascule le lien `current` de façon atomique.
# En cas d'échec AVANT la bascule, la version en cours reste intacte et
# aucun redémarrage n'a lieu.
#
# À exécuter sous l'utilisateur `deploy`.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

APP_REF="${1:-phase-10-production-readiness}"
KEEP_RELEASES=${KEEP_RELEASES:-5}

[ -f "$APP_SHARED/.env" ] \
  || { echo "ERREUR : $APP_SHARED/.env absent (voir .env.preprod.example)"; exit 1; }
command -v node >/dev/null || { echo "ERREUR : node absent"; exit 1; }
command -v pg_dump >/dev/null \
  || export PATH="/usr/lib/postgresql/16/bin:$PATH"

mkdir -p "$APP_REPO" "$APP_RELEASES"
TS=$(date +%Y%m%d_%H%M%S)
RELEASE="$APP_RELEASES/$TS"

echo "== 1/8 Récupération du code ($APP_REF) =="
if [ -d "$APP_REPO/.git" ]; then
  git -C "$APP_REPO" fetch --all --tags --prune
else
  git clone --no-checkout \
    https://github.com/warrzy/Ecomschool.git "$APP_REPO"
  git -C "$APP_REPO" fetch --all --tags --prune
fi
# Une branche non présente localement (clone frais) se résout via origin/.
if ! git -C "$APP_REPO" rev-parse --verify --quiet "$APP_REF" >/dev/null; then
  APP_REF="origin/$APP_REF"
fi
# Worktree isolé, HEAD détaché : le répertoire de la version en cours n'est
# jamais touché et plusieurs releases issues de la même branche coexistent.
git -C "$APP_REPO" worktree add --detach "$RELEASE" "$APP_REF"

cd "$RELEASE"
ln -sfn "$APP_SHARED/.env" .env

echo "== 2/8 Dépendances =="
npm ci

echo "== 3/8 Prisma generate =="
npx prisma generate

echo "== 4/8 Sauvegarde pré-migration =="
mkdir -p "$BACKUP_DIR"
pg_dump "$(pg_url)" -Fc -f "$BACKUP_DIR/pre-migrate-${TS}.dump"
echo "Sauvegarde : $BACKUP_DIR/pre-migrate-${TS}.dump"

echo "== 5/8 Migrations =="
npx prisma migrate deploy

echo "== 6/8 Build =="
npm run build

echo "== 7/8 Bascule atomique =="
ln -sfn "$RELEASE" "$APP_CURRENT.tmp" && mv -T "$APP_CURRENT.tmp" "$APP_CURRENT"

echo "== 8/8 Redémarrage PM2 (ecomschool-preprod uniquement) =="
# delete+start : en mode fork, reload = restart équivalent, et delete+start
# garantit que le cwd `current` est re-résolu vers la NOUVELLE release
# (un reload peut conserver le chemin résolu précédemment).
# Interruption : ~2 s, identique à un reload fork.
pm2 delete ecomschool-preprod >/dev/null 2>&1 || true
pm2 start "$APP_CURRENT/deploy/pm2/ecosystem.config.cjs" \
  --only ecomschool-preprod
pm2 save

# Nettoyage : conserve les KEEP_RELEASES dernières releases.
cd "$APP_RELEASES"
ls -1dt */ | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "$APP_CURRENT" -ef "$APP_RELEASES/$old" ] && continue
  git -C "$APP_REPO" worktree remove --force "$APP_RELEASES/$old" 2>/dev/null \
    || rm -rf "$APP_RELEASES/$old"
done

echo ""
echo "Déploiement $TS terminé → $APP_CURRENT"
echo "Vérification : bash deploy/scripts/healthcheck.sh"
