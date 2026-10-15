#!/usr/bin/env bash
# Actualiza COMAPA MIR en icarus, en el orden de la casa: código → parar → respaldo → dependencias y
# build → migraciones y permisos → arrancar → verificar. Se corre como developer, sin contraseña.
#
#   ~/comapa-mir/backend/despliegue/icarus/desplegar.sh
#
# Si algo falla después de parar, los servicios quedan parados y el mensaje dice cómo volver.
set -euo pipefail
cd /home/developer/comapa-mir
CONFIG=/home/developer/comapa-mir-config
export RESPALDO_DESTINO=/home/developer/backups/comapa-mir
export PATH="/usr/local/lib/nodejs/node-v22.21.1-linux-x64/bin:$PATH"

paso() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }

[ -z "$(git status --porcelain)" ] || { echo "✗ Hay cambios sin commitear en $(pwd)" >&2; exit 1; }
paso "Código"
antes="$(git rev-parse --short HEAD)"
git pull --ff-only
echo "$antes → $(git rev-parse --short HEAD)"

paso "Parando comapa-sitio y comapa-api (aquí empieza la caída)"
sudo -n systemctl stop comapa-sitio comapa-api
trap 'echo "✗ Falló con los servicios parados. Código anterior: git checkout '"$antes"'; base: el respaldo de arriba (pg_restore --clean --if-exists)." >&2' ERR

cd backend
set -a; source "$CONFIG/dueno.env"; set +a

paso "Respaldo"
despliegue/respaldar.sh

paso "Dependencias y build"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

paso "Migraciones y permisos"
db/migrar.sh up
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v app=comapa_app -f db/permisos.sql

paso "Arrancando"
sudo -n systemctl start comapa-api comapa-sitio
trap - ERR

paso "Verificación"
for i in $(seq 1 30); do
  curl -fs -o /dev/null --max-time 2 http://127.0.0.1:3087/api/salud && break
  [ "$i" -eq 30 ] && { journalctl -u comapa-api -n 30 --no-pager >&2; exit 1; }
  sleep 1
done
curl -fsS http://127.0.0.1:3087/api/salud; echo
curl -fsS -o /dev/null -w "sitio: %{http_code}\n" http://127.0.0.1:3088/login.html
