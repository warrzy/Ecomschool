#!/usr/bin/env bash
# ECOM-SCHOOL — exercice de restauration NON DESTRUCTIF sur une base témoin.
# Usage : bash deploy/scripts/restore-verify.sh <fichier.dump> [--keep]
#
# Prouve qu'un dump est réellement restaurable : intégrité, schéma, données,
# temps mesuré. N'écrit JAMAIS dans la base applicative (garde explicite).
# Tourne entièrement sous le rôle applicatif — aucun sudo.
#
# Prérequis (une seule fois, par l'admin postgres) si le rôle applicatif
# n'a pas CREATEDB :
#   CREATE DATABASE ecomschool_verify OWNER ecomschool_app;
#
# --keep : conserve la base témoin peuplée (inspection manuelle).
set -uo pipefail
source "$(dirname "$0")/lib.sh"

DUMP="${1:?Usage: restore-verify.sh <fichier.dump> [--keep]}"
KEEP=0
[ "${2:-}" = "--keep" ] && KEEP=1
[ -f "$DUMP" ] || { echo "Fichier introuvable : $DUMP"; exit 1; }

VERIFY_DB=${RESTORE_VERIFY_DB:-ecomschool_verify}

# Garde : jamais sur la base applicative ni sur les bases système.
case "$VERIFY_DB" in
  "$DB_NAME"|postgres|template0|template1)
    echo "REFUS : cible $VERIFY_DB interdite (base applicative ou système)." >&2
    exit 1
    ;;
esac

echo "== Vérification du dump =="
if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256") \
    || { echo "FAIL : empreinte SHA256 invalide."; exit 1; }
  echo "OK   empreinte SHA256"
else
  echo "WARN pas de .sha256 — intégrité non vérifiable"
fi

OBJECTS=$(pg_restore -l "$DUMP" 2>/dev/null | grep -cE '^[0-9]+;') \
  || { echo "FAIL : dump illisible (pg_restore -l)"; exit 1; }
[ "$OBJECTS" -gt 0 ] || { echo "FAIL : dump sans objets"; exit 1; }
echo "OK   $OBJECTS objets catalogués"

VURL=$(pg_url_for "$VERIFY_DB") || exit 1

echo "== Préparation de la base témoin $VERIFY_DB =="
CREATED_BY_US=0
if psql "$VURL" -tc 'SELECT 1' >/dev/null 2>&1; then
  # Base existante : on la vide (schéma public) — elle appartient à DB_USER.
  psql "$VURL" -qc \
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION $DB_USER" \
    || { echo "FAIL : impossible de vider $VERIFY_DB"; exit 1; }
  echo "OK   base témoin existante vidée"
else
  if createdb "$VERIFY_DB" >/dev/null 2>&1; then
    CREATED_BY_US=1
    echo "OK   base témoin créée"
  else
    echo "FAIL : $VERIFY_DB inaccessible et CREATEDB indisponible." >&2
    echo "       Une fois, en admin : CREATE DATABASE $VERIFY_DB OWNER $DB_USER;" >&2
    exit 1
  fi
fi

echo "== Restauration =="
t0=$(date +%s)
if pg_restore --no-owner -d "$VURL" "$DUMP" 2>"$LOG_DIR/restore-verify.err"; then
  echo "OK   pg_restore terminé"
else
  echo "WARN pg_restore avec erreurs — voir $LOG_DIR/restore-verify.err"
fi
RESTORE_S=$(( $(date +%s) - t0 ))
echo "OK   durée : ${RESTORE_S}s"

echo "== Contrôle du schéma et des données =="
TABLES=$(psql "$VURL" -tAc \
  "SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo 0)
echo "OK   tables restaurées : $TABLES"
[ "$TABLES" -gt 0 ] || { echo "FAIL : aucune table restaurée"; exit 1; }

LAST_MIG=$(psql "$VURL" -tAc \
  "SELECT migration_name FROM \"_prisma_migrations\"
   WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1" \
  2>/dev/null || echo "(absente)")
echo "OK   dernière migration : ${LAST_MIG:-aucune}"

for T in '"School"' '"User"' '"Student"' '"Enrollment"' '"Payment"' '"AuditLog"'; do
  N=$(psql "$VURL" -tAc "SELECT count(*) FROM $T" 2>/dev/null || echo '?')
  echo "     $T : $N ligne(s)"
done

echo "== Nettoyage =="
if [ "$KEEP" = 1 ]; then
  echo "OK   base témoin conservée (--keep)"
elif [ "$CREATED_BY_US" = 1 ]; then
  dropdb "$VERIFY_DB" >/dev/null 2>&1 && echo "OK   base témoin supprimée" \
    || echo "WARN dropdb a échoué — supprimer $VERIFY_DB manuellement"
else
  psql "$VURL" -qc \
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION $DB_USER" \
    >/dev/null 2>&1 && echo "OK   base témoin vidée" \
    || echo "WARN vidage incomplet — vérifier $VERIFY_DB"
fi

echo -e "\nRESTAURATION VÉRIFIÉE : $TABLES tables, ${RESTORE_S}s."
