#!/usr/bin/env bash
# Carga inicial de datos y cuentas (TEC-04). Envoltura de db/semilla/cargar.ts.
#
#   ./sembrar.sh                  solo definición: gerencias, unidades, usuarios, indicadores, periodos
#   ./sembrar.sh --con-fixtures   agrega los reportes de prueba (CA-4: nunca en producción)
#   ./sembrar.sh --verificar      no escribe; solo reporta qué hay en la base
#
# Base destino: igual que migrar.sh — DATABASE_URL; si no está, la de backend/.env;
# si tampoco, postgres:///comapa_mir

set -euo pipefail

BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${DATABASE_URL:-}" ] && [ -f "$BACKEND/.env" ]; then
  # Solo se lee esa línea; el archivo no se ejecuta
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$BACKEND/.env" | tail -n 1 | tr -d "\"'")"
fi
export DATABASE_URL="${DATABASE_URL:-postgres:///comapa_mir}"

# La base tiene que estar migrada: sin tablas no hay dónde cargar
if ! psql "$DATABASE_URL" -X -qt -c "SELECT 1 FROM schema_migrations LIMIT 1" >/dev/null 2>&1; then
  printf '  \033[31m✗\033[0m La base no está migrada. Corre primero: ./migrar.sh up\n' >&2
  exit 1
fi

cd "$BACKEND"
exec npx tsx db/semilla/cargar.ts "$@"
