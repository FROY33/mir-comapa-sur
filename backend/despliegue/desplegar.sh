#!/usr/bin/env bash
# Actualiza COMAPA MIR en el servidor: código, dependencias, compilación, migraciones, permisos y
# reinicio, con verificación al final. Se corre como root desde /opt/comapa-mir.
#
#   sudo /opt/comapa-mir/backend/despliegue/desplegar.sh
#
# Si algo falla se detiene antes de reiniciar: los servicios siguen con la versión anterior.
set -euo pipefail
cd /opt/comapa-mir

echo "→ Código"
sudo -u comapa git pull --ff-only

echo "→ Dependencias y compilación"
cd backend
sudo -u comapa npm ci
sudo -u comapa npm run build
sudo -u comapa npm prune --omit=dev   # en ejecución solo queda pg y bcryptjs

echo "→ Migraciones y permisos (con el dueño de las tablas)"
set -a; source /etc/comapa-mir/dueno.env; set +a
db/migrar.sh up
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v app=comapa_app -f db/permisos.sql

echo "→ Reinicio"
systemctl restart comapa-api comapa-sitio
sleep 3

echo "→ Verificación"
curl -fsS http://127.0.0.1:3000/api/salud
echo
curl -fsS -o /dev/null -w "sitio: %{http_code}\n" http://127.0.0.1:4321/login.html
