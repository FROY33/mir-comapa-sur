#!/usr/bin/env bash
# Prueba de punta a punta sobre una base vacía y desechable:
#   1. crea la base   2. aplica todas las migraciones   3. corre pruebas/restricciones.sql
#   4. revierte todas las migraciones   5. borra la base
#
#   ./probar.sh            (usa la base comapa_mir_prueba en el servidor local)

set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
BASE="comapa_mir_prueba"
export DATABASE_URL="postgres:///$BASE"

paso() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }

limpiar() { dropdb --if-exists "$BASE" >/dev/null 2>&1 || true; }
trap limpiar EXIT

paso "1. Base vacía"
limpiar
createdb "$BASE"
ok "$BASE creada"

paso "2. Migraciones"
"$AQUI/migrar.sh" up

paso "3. Restricciones (TEC-02)"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$AQUI/pruebas/restricciones.sql"

paso "4. Reversión completa"
total=$(ls "$AQUI"/migrations/*.sql | wc -l | tr -d ' ')
for _ in $(seq "$total"); do "$AQUI/migrar.sh" down; done
restantes=$(psql "$DATABASE_URL" -X -At -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'")
[ "$restantes" -eq 0 ] && ok "La base quedó vacía: todas las migraciones se pueden revertir" \
  || { echo "  ✗ Quedaron $restantes tablas después de revertir" >&2; exit 1; }

paso "Todo en orden."
