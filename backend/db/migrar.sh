#!/usr/bin/env bash
# Aplica las migraciones de backend/db/migrations con psql.
# Formato y tabla de control compatibles con dbmate (-- migrate:up / -- migrate:down, schema_migrations).
#
#   ./migrar.sh up       aplica las pendientes, cada una en su propia transacción
#   ./migrar.sh down     revierte la última aplicada
#   ./migrar.sh status   muestra qué está aplicado
#
# MIGRAR_HASTA=<versión> limita `up` a esa versión y las anteriores (lo usa probar.sh para recrear la
# base de un sprint anterior).
#
# Base destino: DATABASE_URL; si no está en el entorno, la de backend/.env; si tampoco, postgres:///comapa_mir

set -euo pipefail

ENV_BACKEND="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_BACKEND" ]; then
  # Solo se lee esa línea; el archivo no se ejecuta
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_BACKEND" | tail -n 1 | tr -d "\"'")"
fi
DB="${DATABASE_URL:-postgres:///comapa_mir}"
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DB" -X -q -v ON_ERROR_STOP=1)

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
info() { printf '  \033[2m·\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

seccion() {  # $1 = up|down, $2 = archivo
  awk -v s="-- migrate:$1" '
    /^-- migrate:(up|down)/ { activo = ($0 == s); next }
    activo { print }' "$2"
}

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(128) PRIMARY KEY)" \
  || fail "No pude conectar a $DB"

aplicadas() { "${PSQL[@]}" -At -c "SELECT version FROM schema_migrations ORDER BY version"; }

case "${1:-status}" in
  up)
    echo "Migrando $(sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$DB")"   # sin la contraseña
    hechas="$(aplicadas)"
    nuevas=0
    for f in "$DIR"/*.sql; do
      nombre="$(basename "$f" .sql)"
      version="${nombre%%_*}"
      if [ -n "${MIGRAR_HASTA:-}" ] && [[ "$version" > "$MIGRAR_HASTA" ]]; then break; fi
      if grep -qx "$version" <<<"$hechas"; then continue; fi
      { seccion up "$f"; echo "INSERT INTO schema_migrations (version) VALUES ('$version');"; } \
        | "${PSQL[@]}" --single-transaction -f - >/dev/null \
        || fail "Falló $nombre — no se aplicó nada de esa migración"
      ok "$nombre"
      nuevas=$((nuevas + 1))
    done
    [ "$nuevas" -eq 0 ] && info "Nada pendiente; la base está al día" || echo "Listo: $nuevas migración(es) aplicada(s)."
    ;;
  down)
    version="$(aplicadas | tail -n 1)"
    [ -z "$version" ] && { info "No hay migraciones aplicadas"; exit 0; }
    f="$(ls "$DIR"/"${version}"_*.sql)"
    { seccion down "$f"; echo "DELETE FROM schema_migrations WHERE version = '$version';"; } \
      | "${PSQL[@]}" --single-transaction -f - >/dev/null \
      || fail "Falló la reversión de $(basename "$f" .sql)"
    ok "Revertida $(basename "$f" .sql)"
    ;;
  status)
    hechas="$(aplicadas)"
    for f in "$DIR"/*.sql; do
      nombre="$(basename "$f" .sql)"
      if grep -qx "${nombre%%_*}" <<<"$hechas"; then ok "$nombre"; else info "$nombre (pendiente)"; fi
    done
    ;;
  *)
    echo "Uso: $0 up|down|status" >&2; exit 2 ;;
esac
