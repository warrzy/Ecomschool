#!/usr/bin/env bash
# ECOM-SCHOOL — vérification RÉCURRENTE des sauvegardes (non destructive).
# Usage : bash deploy/scripts/restore-verify-run.sh [--dry-run] [--force]
#
# À chaque exécution :
#   1. Verrou flock — une seule instance, échec explicite si concurrente.
#   2. Dernier dump + archive uploads détectés ; absence/ancienneté = échec.
#   3. Empreintes SHA-256 vérifiées (dump + uploads).
#   4. Restauration dans la base TÉMOIN isolée via restore-verify.sh
#      (jamais la base applicative — la garde est dans restore-verify.sh).
#   5. Rapport horodaté dans LOG_DIR/restore-verify/ (rétention REPORT_KEEP).
#   6. Alerte dédupliquée via ALERT_WEBHOOK_URL (même canal que monitor.sh).
#
# Config (env) :
#   BACKUP_DIR          défaut /var/backups/ecomschool
#   MAX_AGE_HOURS       défaut 26      âge max toléré d'un dump
#   VERIFY_TIMEOUT_S    défaut 1800    timeout global pg_restore
#   REPORT_KEEP         défaut 30      rapports conservés
#   ALERT_WEBHOOK_URL   canal d'alerte (vide = alerte loggée seulement)
#   RESTORE_VERIFY_DB   base témoin (défaut ecomschool_verify, garde existante)
#
# --dry-run : contrôle les sources sans restaurer (utilisable pour tester
#             les cas d'échec : dump absent, corrompu, trop vieux).
set -uo pipefail
source "$(dirname "$0")/lib.sh"

DRY_RUN=0; FORCE=0
for a in "$@"; do case "$a" in
  --dry-run) DRY_RUN=1 ;; --force) FORCE=1 ;; esac; done

BACKUP_DIR=${BACKUP_DIR:-/var/backups/ecomschool}
MAX_AGE_HOURS=${MAX_AGE_HOURS:-26}
VERIFY_TIMEOUT_S=${VERIFY_TIMEOUT_S:-1800}
REPORT_KEEP=${REPORT_KEEP:-30}
REPORT_DIR="$LOG_DIR/restore-verify"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/verify-$(date +%Y%m%d_%H%M%S).log"

STATUS="OK"; DETAIL=""

fail() { STATUS="FAIL"; DETAIL="$1"; log_line "restore-verify-run FAIL : $1"; finish 1; }

finish() {
  # Alerte dédupliquée (clé stable → pas de spam) ou trace de succès.
  if [ "$STATUS" = "FAIL" ]; then
    if declare -F alert >/dev/null 2>&1; then
      alert "restore_verify" "RESTAURATION-VERIFY ÉCHEC" "$DETAIL"
    else
      log_line "restore-verify-run ALERTE (aucun canal) : $DETAIL"
    fi
  else
    log_line "restore-verify-run OK — rapport $REPORT"
  fi
  exit "${1:-0}"
}

log() { echo "$@" | tee -a "$REPORT"; }

# -- Verrou anti-concurrence --------------------------------------------------
# flock quand disponible (Linux/VPS), sinon mkdir atomique (portable).
LOCKDIR="$LOG_DIR/restore-verify.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCKDIR.flock"
  flock -n 9 || { log_line "restore-verify-run: verrou déjà pris — exécution concurrente refusée"; exit 2; }
else
  mkdir "$LOCKDIR" 2>/dev/null \
    || { log_line "restore-verify-run: verrou déjà pris — exécution concurrente refusée"; exit 2; }
  trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT
fi

{
log "=== restore-verify-run $(ts) ==="
log "sauvegardes : $BACKUP_DIR · âge max ${MAX_AGE_HOURS}h · timeout ${VERIFY_TIMEOUT_S}s"

# -- 1. Présence + fraîcheur du dump ------------------------------------------
DUMP=$(ls -t "$BACKUP_DIR"/*_*.dump 2>/dev/null | head -1)
[ -n "${DUMP:-}" ] || fail "aucun dump PostgreSQL dans $BACKUP_DIR"
log "dump : $DUMP"

AGE_S=$(( $(date +%s) - $(stat -c %Y "$DUMP") ))
if [ "$AGE_S" -gt $((MAX_AGE_HOURS * 3600)) ]; then
  fail "dump trop ancien : $((AGE_S / 3600))h > ${MAX_AGE_HOURS}h"
fi
log "âge  : $((AGE_S / 60))min (OK < ${MAX_AGE_HOURS}h)"

# -- 2. Archive uploads la plus récente ---------------------------------------
UPL=$(ls -t "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | head -1)
if [ -z "${UPL:-}" ]; then
  log "WARN aucun archive uploads_*.tar.gz — contrôle limité au dump"
else
  log "uploads : $UPL"
fi

# -- 3. Empreintes SHA-256 -----------------------------------------------------
if [ -f "$DUMP.sha256" ]; then
  (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$DUMP").sha256" >> "$REPORT" 2>&1) \
    || fail "SHA-256 invalide : $(basename "$DUMP")"
  log "sha256 dump : OK"
else
  # Pas d'empreinte → le dump est non vérifiable = anomalie à signaler.
  fail "empreinte SHA-256 absente pour $(basename "$DUMP") — intégrité non garantie"
fi
if [ -n "${UPL:-}" ] && [ -f "$UPL.sha256" ]; then
  (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$UPL").sha256" >> "$REPORT" 2>&1) \
    || fail "SHA-256 invalide : $(basename "$UPL")"
  log "sha256 uploads : OK"
elif [ -n "${UPL:-}" ]; then
  log "WARN uploads sans .sha256 — signature non vérifiable"
fi

# -- 4. Restauration témoin (sauf --dry-run) -----------------------------------
if [ "$DRY_RUN" = 1 ]; then
  log "DRY-RUN : sources valides — restauration non exécutée."
else
  log "== restauration base témoin =="
  if timeout "$VERIFY_TIMEOUT_S" \
      bash "$(dirname "$0")/restore-verify.sh" "$DUMP" >> "$REPORT" 2>&1; then
    log "restauration : OK"
  else
    rc=$?
    if [ "$rc" = 124 ]; then
      fail "timeout ${VERIFY_TIMEOUT_S}s dépassé pendant la restauration"
    else
      fail "restore-verify.sh a échoué (rc=$rc) — voir $REPORT"
    fi
  fi
fi

log "=== FIN $STATUS ==="
} 2>&1 | tee -a "$REPORT"
RC=${PIPESTATUS[0]}
# Un fail() à l'intérieur du bloc pipé s'est produit dans un subshell :
# il a déjà journalisé + alerté ; on propage son code de sortie ici.
if [ "$RC" -ne 0 ]; then exit "$RC"; fi

# -- Rétention des rapports ----------------------------------------------------
ls -t "$REPORT_DIR"/verify-*.log 2>/dev/null | tail -n +$((REPORT_KEEP + 1)) \
  | xargs -r rm -f

finish 0
