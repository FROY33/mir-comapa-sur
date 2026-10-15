#!/usr/bin/env bash
# Prueba de punta a punta sobre bases desechables:
#   1. crea la base   2. aplica todas las migraciones   3. corre las pruebas SQL de pruebas/
#   4. revierte todas las migraciones
#   5. actualización con datos: recrea la base de S1, la llena con la semilla y las fixtures, aplica
#      las migraciones nuevas y comprueba que ninguna tabla perdió filas (CA-1 de las fichas de modelo)
#   6. borra la base
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

# psql de Windows no conoce /dev/null
case "${OSTYPE:-}" in msys*|cygwin*) NULO=NUL ;; *) NULO=/dev/null ;; esac

paso "3. Pruebas SQL (restricciones de TEC-02, modelo de metas…)"
for f in "$AQUI"/pruebas/*.sql; do
  case "$(basename "$f")" in apoyo.sql|datos-base.sql|resultado.sql|actualizacion.sql) continue ;; esac
  printf '  %s\n' "$(basename "$f")"
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v nulo="$NULO" -f "$f"
done

paso "4. Reversión completa"
total=$(ls "$AQUI"/migrations/*.sql | wc -l | tr -d ' ')
for _ in $(seq "$total"); do "$AQUI/migrar.sh" down; done
restantes=$(psql "$DATABASE_URL" -X -At -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'")
[ "$restantes" -eq 0 ] && ok "La base quedó vacía: todas las migraciones se pueden revertir" \
  || { echo "  ✗ Quedaron $restantes tablas después de revertir" >&2; exit 1; }

paso "5. Actualización sobre la base de S1 con datos"
# Última migración de S1. Al cerrar un sprint, súbela a su última migración.
BASE_S1=20261010000001
limpiar
createdb "$BASE"
MIGRAR_HASTA="$BASE_S1" "$AQUI/migrar.sh" up >/dev/null
ok "Esquema de S1 (hasta $BASE_S1)"
SEMILLA_PASSWORD="${SEMILLA_PASSWORD:-prueba-actualizacion-local}" \
  "$AQUI/sembrar.sh" --con-fixtures >/dev/null
ok "Semilla y fixtures cargadas"

# Filas por tabla
CONTAR="SELECT string_agg(format('%s %s', t, (xpath('/row/n/text()',
          query_to_xml(format('SELECT count(*) AS n FROM %I', t), false, true, '')))[1]::text), E'\n' ORDER BY t)
        FROM unnest(ARRAY(SELECT table_name::text FROM information_schema.tables
                          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                            AND table_name <> 'schema_migrations')) AS t"
antes="$(psql "$DATABASE_URL" -X -At -c "$CONTAR")"

"$AQUI/migrar.sh" up
despues="$(psql "$DATABASE_URL" -X -At -c "$CONTAR")"

perdidas=0
while read -r tabla n; do
  m="$(awk -v t="$tabla" '$1 == t { print $2 }' <<<"$despues")"
  if [ -z "$m" ]; then echo "  ✗ La tabla $tabla desapareció" >&2; perdidas=1
  elif [ "$m" -lt "$n" ]; then echo "  ✗ $tabla: $n filas antes, $m después" >&2; perdidas=1
  fi
done <<<"$antes"
[ "$perdidas" -eq 0 ] || exit 1
# Comprobaciones específicas de las migraciones de datos (qué debe seguir siendo cierto con datos reales)
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v nulo="$NULO" -f "$AQUI/pruebas/actualizacion.sql"
ok "Ninguna tabla de S1 perdió filas ($(wc -l <<<"$antes" | tr -d ' ') tablas, $(awk '{ s += $2 } END { print s }' <<<"$antes") filas)"

paso "Todo en orden."
