#!/usr/bin/env bash
# ECOM-SCHOOL — tests des scripts de continuité (backup/restore/monitor/
# healthcheck) sur un environnement ENTIÈREMENT simulé : stubs de commandes
# sur PATH, arborescence jetable, aucune donnée réelle, aucun réseau.
#
#   bash deploy/tests/run.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(mktemp -d)
STUBS="$ROOT/bin"
mkdir -p "$STUBS" "$ROOT/app/shared" "$ROOT/log" "$ROOT/backups" "$ROOT/remote"
export ECOMSCHOOL_ROOT="$ROOT"
export PATH="$STUBS:$PATH"

# Faux .env — aucun secret réel ; sert aussi à vérifier l'absence de fuite.
echo 'DATABASE_URL="postgresql://u:S3CR3T-TEST@127.0.0.1:5432/ecomschool_preprod?schema=public"' > "$ROOT/app/shared/.env"

PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 — attendu [$3], obtenu [$2]"; fi }
okf() { # okf nom chemin [négatif]
  if [ "${3:-}" = "!" ]; then
    [ ! -e "$2" ] && { PASS=$((PASS+1)); echo "PASS  $1"; } || { FAIL=$((FAIL+1)); echo "FAIL  $1 — $2 existe"; }
  else
    [ -e "$2" ] && { PASS=$((PASS+1)); echo "PASS  $1"; } || { FAIL=$((FAIL+1)); echo "FAIL  $1 — $2 absent"; }
  fi
}

# ---------- Stubs ----------

# pg_dump : écrit un dump factice lisible dans -f <fichier>.
cat > "$STUBS/pg_dump" <<'EOF'
#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do [ "$1" = "-f" ] && { out=$2; shift 2; continue; }; shift; done
[ -n "$out" ] || exit 1
[ "${PGDUMP_FAIL:-0}" = 1 ] && exit 2
echo "FAKE-DUMP $(date +%s)" > "$out"
EOF

# pg_restore : -l liste factice (échoue si le dump contient CORRUPT) ;
# -d restaure (simulé).
cat > "$STUBS/pg_restore" <<'EOF'
#!/usr/bin/env bash
file=""; mode=""
while [ $# -gt 0 ]; do
  case "$1" in
    -l) mode=list; file=$2; shift 2;;
    -d) mode=restore; shift 2;;
    *) shift;;
  esac
done
[ "$mode" = list ] && { grep -q CORRUPT "$file" 2>/dev/null && exit 3; printf '1; 0 0 TABLE public School u\n2; 0 0 TABLE public Student u\n3; 0 0 TABLE public Payment u\n'; exit 0; }
[ "$mode" = restore ] && exit 0
exit 0
EOF

# psql : répond aux sondes du monitor/restore-verify ; journalise les requêtes.
cat > "$STUBS/psql" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "${ECOMSCHOOL_ROOT}/psql.log"
case "$*" in
  *"SELECT 1"*) [ "${PSQL_SELECT1_FAIL:-0}" = 1 ] && exit 1; echo 1; exit 0;;
  *"BASE TABLE"*) echo "${VERIFY_TABLES:-12}"; exit 0;; # nb tables restaurées
  *"_prisma_migrations"*) echo "20261001_init"; exit 0;;
  *"DROP SCHEMA"*) exit 0;;
  *"status='DEAD'"*) echo "${DEAD_COUNT:-0}"; exit "${PSQL_FAIL:-0}";;
  *"pg_terminate_backend"*) exit 0;;
  *"count(*)"*) echo 5; exit 0;;
esac
exit "${PSQL_FAIL:-0}"
EOF

# createdb/dropdb : simulent la création/suppression de la base témoin.
cat > "$STUBS/createdb" <<'EOF'
#!/usr/bin/env bash
echo "createdb $*" >> "${ECOMSCHOOL_ROOT}/pgadmin.log"
exit "${CREATEDB_FAIL:-0}"
EOF
cat > "$STUBS/dropdb" <<'EOF'
#!/usr/bin/env bash
echo "dropdb $*" >> "${ECOMSCHOOL_ROOT}/pgadmin.log"
exit 0
EOF

# rsync : recopie vers la destination factice ou échoue (REMOTE_FAIL=1).
cat > "$STUBS/rsync" <<'EOF'
#!/usr/bin/env bash
[ "${REMOTE_FAIL:-0}" = 1 ] && exit 5
dest=""
for a in "$@"; do case "$a" in -*|*:*sha256|*:*/dev/null) ;; esac; dest=$a; done
dir="${dest%%/*}/"; dir="${dest%/*}/"
mkdir -p "$dir" 2>/dev/null
for src in "$@"; do [ -f "$src" ] && cp "$src" "$dir" 2>/dev/null; done
exit 0
EOF

# restic : journalise, dernier snapshot horodaté "maintenant".
cat > "$STUBS/restic" <<'EOF'
#!/usr/bin/env bash
echo "restic $*" >> "${ECOMSCHOOL_ROOT}/restic.log"
[ "${RESTIC_FAIL:-0}" = 1 ] && exit 6
case "$*" in
  "snapshots --json --latest 1") echo "[{\"time\":\"$(date -Is)\"}]";;
esac
exit 0
EOF

# curl : code piloté par env (local vs public vs webhook).
cat > "$STUBS/curl" <<'EOF'
#!/usr/bin/env bash
url="${!#}"
case "$url" in
  *127.0.0.1:3001*|*localhost*) printf '%s' "${CURL_LOCAL_CODE:-200}";;
  *preprod.ecomschool.fr*|*ecomschool*) printf '%s' "${CURL_PUB_CODE:-200}";;
  *) [ "${ALERT_WEBHOOK_URL:+x}" ] && echo "$*" >> "${ECOMSCHOOL_ROOT}/webhook.log"; exit 0;;
esac
exit 0
EOF

# Outils système.
for c in pm2 ss; do :; done
cat > "$STUBS/pm2" <<'EOF'
#!/usr/bin/env bash
exit "${PM2_FAIL:-0}"
EOF
cat > "$STUBS/ss" <<'EOF'
#!/usr/bin/env bash
[ "${SS_NO_LISTEN:-0}" = 1 ] && exit 0
echo "tcp LISTEN 0 511 127.0.0.1:3001 0.0.0.0:*"
EOF
cat > "$STUBS/systemctl" <<'EOF'
#!/usr/bin/env bash
[ "$*" = "is-active --quiet nginx" ] && exit "${NGINX_DOWN:-0}"
exit 0
EOF
cat > "$STUBS/crontab" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = "-l" ]; then
  [ "${NO_CRON:-0}" = 1 ] && exit 0
  echo "*/10 * * * * flock -n /tmp/x curl -H x http://127.0.0.1:3001/api/cron"
fi
exit 0
EOF
cat > "$STUBS/sudo" <<'EOF'
#!/usr/bin/env bash
exit 1   # pas de sudo non interactif dans le contexte de test
EOF
cat > "$STUBS/df" <<'EOF'
#!/usr/bin/env bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/sda1 100000000 ${DF_USED:-20000000} 90000000 ${DF_PCT:-20}% /"
EOF
cat > "$STUBS/hostname" <<'EOF'
#!/usr/bin/env bash
echo test-host
EOF
chmod +x "$STUBS"/*

S=deploy/scripts

echo "=== backup : succès local + distant rsync ==="
BACKUP_REMOTE="$ROOT/remote" bash $S/backup.sh >"$ROOT/out.log" 2>"$ROOT/err.log"
RC=$?
DUMP=$(ls "$ROOT"/backups/ecomschool_preprod_*.dump 2>/dev/null | head -1)
ok "backup rc" "$RC" "0"
okf "dump créé" "$DUMP"
okf "sha256 créé" "$DUMP.sha256"
okf "copie distante" "$ROOT/remote/$(basename "$DUMP")"
. "$ROOT/log/backup-status.env"
ok "statut OK" "$LAST_BACKUP_OK" "1"
ok "statut remote" "$LAST_BACKUP_REMOTE_OK" "1"
ok "statut mode" "$LAST_BACKUP_REMOTE_MODE" "rsync"
grep -q S3CR3T "$ROOT/err.log" "$ROOT/out.log" 2>/dev/null && L=1 || L=0
ok "aucun secret dans les logs" "$L" "0"

echo "=== backup : dump corrompu ==="
echo "CORRUPT" > "$ROOT/backups/corrupt_test.dump"
PGDUMP_FAIL=1 bash $S/backup.sh >"$ROOT/out.log" 2>"$ROOT/err.log" || true
. "$ROOT/log/backup-status.env"
ok "statut KO après échec pg_dump" "$LAST_BACKUP_OK" "0"

echo "=== backup : destination distante indisponible ==="
REMOTE_FAIL=1 BACKUP_REMOTE="$ROOT/remote" bash $S/backup.sh >"$ROOT/out.log" 2>"$ROOT/err.log" || true
. "$ROOT/log/backup-status.env"
ok "dump local OK malgré remote KO" "$LAST_BACKUP_OK" "1"
ok "remote signalé KO" "$LAST_BACKUP_REMOTE_OK" "0"
grep -q FAIL-REMOTE "$ROOT/err.log" && G=1 || G=0
ok "échec remote journalisé" "$G" "1"

echo "=== backup : mode restic ==="
unset BACKUP_REMOTE
RESTIC_REPOSITORY="/fake/repo" RESTIC_PASSWORD=x bash $S/backup.sh >"$ROOT/out.log" 2>"$ROOT/err.log" || true
. "$ROOT/log/backup-status.env"
ok "statut restic" "$LAST_BACKUP_REMOTE_OK" "1"
ok "mode restic" "$LAST_BACKUP_REMOTE_MODE" "restic"
grep -q "restic backup" "$ROOT/restic.log" && G=1 || G=0
ok "restic backup appelé" "$G" "1"
grep -q "restic forget" "$ROOT/restic.log" && G=1 || G=0
ok "rétention restic (forget/prune)" "$G" "1"

echo "=== restore-verify : refuse la base active ==="
RESTORE_VERIFY_DB=ecomschool_preprod bash $S/restore-verify.sh "$DUMP" >/dev/null 2>&1
ok "refus base applicative" "$?" "1"

echo "=== restore-verify : exercice sur base témoin ==="
# La base témoin n'existe pas encore : psql SELECT 1 échoue → createdb utilisé.
PSQL_SELECT1_FAIL=1 VERIFY_TABLES=9 bash $S/restore-verify.sh "$DUMP" >"$ROOT/rv.log" 2>&1
RC=$?
ok "restore-verify rc" "$RC" "0"
grep -q "RESTAURATION VÉRIFIÉE" "$ROOT/rv.log" && G=1 || G=0
ok "restauration vérifiée" "$G" "1"
grep -q createdb "$ROOT/pgadmin.log" 2>/dev/null && G=1 || G=0
ok "base témoin créée" "$G" "1"
grep -q dropdb "$ROOT/pgadmin.log" 2>/dev/null && G=1 || G=0
ok "base témoin nettoyée" "$G" "1"

echo "=== monitor : tout sain ==="
DEAD_COUNT=0 bash $S/monitor.sh --dry-run >"$ROOT/mon.log" 2>&1
ok "monitor sain rc" "$?" "0"
ok "0 alerte saine" "$(grep -c 'ALERTE' "$ROOT/mon.log")" "0"

echo "=== monitor : échec cron ==="
echo "2026-10-17 ecomschool cron failed" > "$ROOT/log/cron-errors.log"
bash $S/monitor.sh --dry-run >"$ROOT/mon.log" 2>&1 || true
grep -q "ALERTE\[dry-run\] cron_failed" "$ROOT/mon.log" && G=1 || G=0
ok "alerte cron émise" "$G" "1"
rm -f "$ROOT/log/cron-errors.log" "$ROOT/log/alerts/"*.stamp

echo "=== monitor : jobs DEAD ==="
DEAD_COUNT=3 bash $S/monitor.sh --dry-run >"$ROOT/mon.log" 2>&1 || true
grep -q "ALERTE\[dry-run\] jobs_dead" "$ROOT/mon.log" && G=1 || G=0
ok "alerte jobs DEAD" "$G" "1"
rm -f "$ROOT/log/alerts/"*.stamp

echo "=== monitor : app KO + disque plein ==="
CURL_LOCAL_CODE=000 CURL_PUB_CODE=503 DF_PCT=95 bash $S/monitor.sh --dry-run >"$ROOT/mon.log" 2>&1 || true
grep -q "ALERTE\[dry-run\] app_down" "$ROOT/mon.log" && G=1 || G=0
ok "alerte app locale" "$G" "1"
grep -q "ALERTE\[dry-run\] app_public" "$ROOT/mon.log" && G=1 || G=0
ok "alerte HTTPS public" "$G" "1"
grep -q "ALERTE\[dry-run\] disk_full" "$ROOT/mon.log" && G=1 || G=0
ok "alerte disque" "$G" "1"
rm -f "$ROOT/log/alerts/"*.stamp

echo "=== monitor : backup stale + déduplication ==="
. "$ROOT/log/backup-status.env"
sed -i 's/^LAST_BACKUP_AT=.*/LAST_BACKUP_AT="2000-01-01T00:00:00"/' "$ROOT/log/backup-status.env"
# La déduplication s'écrit hors dry-run (aucun canal configuré → log seul).
bash $S/monitor.sh >"$ROOT/mon1.log" 2>&1 || true
bash $S/monitor.sh >"$ROOT/mon2.log" 2>&1 || true
N1=$(grep -c 'ALERTE backup_stale' "$ROOT/mon1.log")
N2=$(grep -c 'ALERTE backup_stale' "$ROOT/mon2.log")
ok "alerte backup_stale émise" "$N1" "1"
ok "dédupliquée au 2e run" "$N2" "0"
# dry-run ne doit pas consommer la déduplication
rm -f "$ROOT/log/alerts/"*.stamp
bash $S/monitor.sh --dry-run >"$ROOT/mon3.log" 2>&1 || true
bash $S/monitor.sh --dry-run >"$ROOT/mon4.log" 2>&1 || true
ok "dry-run répète l'alerte (pas de stamp)" \
  "$(grep -c 'ALERTE\[dry-run\] backup_stale' "$ROOT/mon4.log")" "1"

echo "=== monitor : mode local volontaire (pas d'alerte remote) ==="
rm -f "$ROOT/log/alerts/"*.stamp
cat > "$ROOT/log/backup-status.env" <<EOF
LAST_BACKUP_TS="x"
LAST_BACKUP_FILE="x.dump"
LAST_BACKUP_OK=1
LAST_BACKUP_REMOTE_OK=0
LAST_BACKUP_REMOTE_MODE="none"
LAST_BACKUP_BYTES=1
LAST_BACKUP_AT="$(date -Is)"
EOF
BACKUP_LOCAL_ONLY=1 bash $S/monitor.sh --dry-run >"$ROOT/mon.log" 2>&1 || true
grep -q "backup_no_remote" "$ROOT/mon.log" && G=0 || G=1
ok "backup_no_remote neutralisée en local-only" "$G" "1"
# Sans le drapeau, la même condition alerte toujours.
rm -f "$ROOT/log/alerts/"*.stamp
bash $S/monitor.sh --dry-run >"$ROOT/mon.log" 2>&1 || true
grep -q "backup_no_remote" "$ROOT/mon.log" && G=1 || G=0
ok "backup_no_remote active sans le drapeau" "$G" "1"

echo "=== healthcheck : sain ==="
bash $S/healthcheck.sh >"$ROOT/hc.log" 2>&1
ok "healthcheck rc" "$?" "0"
grep -q "FAIL" "$ROOT/hc.log" && G=0 || G=1
ok "aucun FAIL" "$G" "1"
grep -q "OK   nginx actif" "$ROOT/hc.log" && G=1 || G=0
ok "nginx vérifié sans sudo" "$G" "1"
grep -q "OK   entrée cron /api/cron" "$ROOT/hc.log" && G=1 || G=0
ok "crontab deploy lue" "$G" "1"

echo "=== healthcheck : dégradé ==="
SS_NO_LISTEN=1 CURL_LOCAL_CODE=000 bash $S/healthcheck.sh >"$ROOT/hc.log" 2>&1
[ $? -ne 0 ] && G=1 || G=0
ok "rc≠0 en dégradé" "$G" "1"
grep -q "FAIL" "$ROOT/hc.log" && G=1 || G=0
ok "FAIL remonté" "$G" "1"

echo
echo "===== $PASS PASS / $FAIL FAIL ====="
rm -rf "$ROOT"
[ "$FAIL" -eq 0 ]
