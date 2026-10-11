#!/usr/bin/env bash
# Respaldo comprimido de la base en /var/backups/comapa-mir, legible solo por root. Conserva 14 días.
# Restaurar: pg_restore --clean --if-exists -d "$DATABASE_URL" <archivo>.dump
set -euo pipefail
DESTINO=/var/backups/comapa-mir
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"
ARCHIVO="$DESTINO/comapa_mir_$(date +%Y-%m-%d_%H%M).dump"
pg_dump --format=custom --no-owner --file="$ARCHIVO" "$DATABASE_URL"
chmod 600 "$ARCHIVO"
find "$DESTINO" -name 'comapa_mir_*.dump' -mtime +14 -delete
echo "Respaldo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
