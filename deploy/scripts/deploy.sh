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
# Pour un nom de branche, origin/<ref> fait foi : une branche locale du clone
# peut être obsolète (cas réel : `main` local figé → release déployée sur un
# ancien commit). Les SHA/tags sans ref distante passent par la résolution directe.
if git -C "$APP_REPO" rev-parse --verify --quiet "origin/$APP_REF" >/dev/null; then
  APP_REF="origin/$APP_REF"
elif ! git -C "$APP_REPO" rev-parse --verify --quiet "$APP_REF" >/dev/null; then
  echo "ERREUR : ref '$APP_REF' introuvable (ni locale ni distante)"; exit 1
fi
RESOLVED_COMMIT=$(git -C "$APP_REPO" rev-parse "$APP_REF")
echo "Ref résolue : $APP_REF → ${RESOLVED_COMMIT:0:10}"

# Garde anti-régression : la ref doit être un descendant (ou l'égal) du commit
# actuellement servi. Retour arrière volontaire : ALLOW_DOWNGRADE=1.
if [ -d "$APP_CURRENT" ] && [ "${ALLOW_DOWNGRADE:-0}" != "1" ]; then
  PREV_COMMIT=$(git -C "$APP_CURRENT" rev-parse HEAD 2>/dev/null || true)
  if [ -n "$PREV_COMMIT" ] && [ "$PREV_COMMIT" != "$RESOLVED_COMMIT" ] \
     && ! git -C "$APP_REPO" merge-base --is-ancestor "$PREV_COMMIT" "$RESOLVED_COMMIT"; then
    echo "ERREUR : ${RESOLVED_COMMIT:0:10} n'est pas un descendant du commit servi ${PREV_COMMIT:0:10}."
    echo "         Bascule refusée (ALLOW_DOWNGRADE=1 pour forcer un retour arrière)."
    exit 1
  fi
fi
# Worktree isolé, HEAD détaché : le répertoire de la version en cours n'est
# jamais touché et plusieurs releases issues de la même branche coexistent.
git -C "$APP_REPO" worktree add --detach "$RELEASE" "$APP_REF"

# Validation précoce : une release sans ces fichiers ne peut pas être servie —
# abandon AVANT npm ci/build/bascule (cas réel : ref obsolète sans deploy/).
for f in package.json prisma/schema.prisma deploy/pm2/ecosystem.config.cjs; do
  [ -f "$RELEASE/$f" ] || {
    echo "ERREUR : $f absent de la release — bascule refusée."
    git -C "$APP_REPO" worktree remove --force "$RELEASE"
    exit 1
  }
done

cd "$RELEASE"
ln -sfn "$APP_SHARED/.env" .env

echo "== 2/8 Dépendances =="
# Le build a besoin des devDependencies (@tailwindcss/turbopack, typescript…).
# Un NODE_ENV=production hérité du shell les omettrait — on le neutralise
# pour cette étape uniquement ; le runtime reste en production via PM2.
env -u NODE_ENV npm ci

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
PREV_RELEASE=$(readlink -f "$APP_CURRENT" 2>/dev/null || true)
ln -sfn "$RELEASE" "$APP_CURRENT.tmp" && mv -T "$APP_CURRENT.tmp" "$APP_CURRENT"

PM2_APP=${PM2_APP:-ecomschool-preprod}
echo "== 8/8 Redémarrage PM2 ($PM2_APP uniquement) =="

# Retour arrière automatique : démarrage raté ou service muet → release précédente.
rollback_release() {
  echo "!! ÉCHEC — restauration de la release précédente : $PREV_RELEASE"
  if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ]; then
    ln -sfn "$PREV_RELEASE" "$APP_CURRENT.tmp" && mv -T "$APP_CURRENT.tmp" "$APP_CURRENT"
    pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
    pm2 start "$PREV_RELEASE/deploy/pm2/ecosystem.config.cjs" --only "$PM2_APP" || true
    pm2 save
  fi
  exit 1
}

# delete+start : en mode fork, reload = restart équivalent, et delete+start
# garantit que le cwd `current` est re-résolu vers la NOUVELLE release
# (un reload peut conserver le chemin résolu précédemment).
# Interruption : ~2 s, identique à un reload fork.
pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
pm2 start "$APP_CURRENT/deploy/pm2/ecosystem.config.cjs" \
  --only "$PM2_APP" || rollback_release
pm2 save

# Vérification post-bascule : le service doit répondre (sinon rollback auto).
APP_PORT=${APP_PORT:-3001}
sleep 4
curl -sf -o /dev/null --max-time 15 "http://127.0.0.1:${APP_PORT}/login" || rollback_release
echo "Service OK sur :$APP_PORT"

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
