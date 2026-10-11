# Despliegue en producción — servidor propio, Cloudflare Tunnel y systemd

```
Navegador ──HTTPS──▶ Cloudflare ──túnel──▶ cloudflared ──▶ 127.0.0.1:4321  comapa-sitio (páginas + proxy)
                                                                  │
                                                                  ▼
                                                 127.0.0.1:3000  comapa-api ──▶ PostgreSQL (127.0.0.1:5432)
```

- **HTTPS lo pone Cloudflare.** El servidor no abre puertos a internet: `cloudflared` sale hacia Cloudflare.
- **Todo escucha en `127.0.0.1`.** Solo el túnel llega al sitio, y solo el sitio llega a la API. Por eso la API
  puede confiar en `CF-Connecting-IP` para la IP de la bitácora y del límite de intentos (`CONFIAR_PROXY=true`).
- **El sitio** (`dist/sitio.js`) es el mismo de desarrollo. Pone las cabeceras de seguridad y HSTS, consulta
  `/api/auth/acceso` antes de servir cada página protegida y solo sirve los tipos de archivo del sitio.
- **Dos usuarios de base:** el dueño de las tablas (migraciones, carga inicial, respaldos) y `comapa_app` con los
  permisos mínimos de `db/permisos.sql` (la app). La app nunca se conecta como dueño.

## Archivos de esta carpeta

| Archivo | Va en | Para qué |
|---|---|---|
| `comapa-api.service`, `comapa-sitio.service` | `/etc/systemd/system/` | Servicios, con usuario sin privilegios y endurecimiento de systemd |
| `comapa-respaldo.service`, `comapa-respaldo.timer` | `/etc/systemd/system/` | Respaldo diario a las 02:30, 14 días de retención |
| `api.env.ejemplo`, `sitio.env.ejemplo`, `dueno.env.ejemplo` | `/etc/comapa-mir/*.env` | Variables. Los reales no se versionan |
| `cloudflared.yml.ejemplo` | `/etc/cloudflared/config.yml` | El túnel expone solo el sitio |
| `desplegar.sh` | — | Actualizar: código, compilación, migraciones, permisos, reinicio y verificación |
| `respaldar.sh` | — | Lo corre el timer |

## Instalación inicial

Requisitos: Node 22+, PostgreSQL 14+, `git`, `cloudflared`.

```bash
# 1. Usuario de sistema y código
sudo useradd --system --home /opt/comapa-mir --shell /usr/sbin/nologin comapa
sudo git clone https://github.com/pacodesign/mir-comapa-sur /opt/comapa-mir
sudo chown -R comapa:comapa /opt/comapa-mir

# 2. Base: escuchar solo en localhost (postgresql.conf: listen_addresses = 'localhost'), dos roles
sudo -u postgres psql <<'SQL'
CREATE ROLE comapa_dueno LOGIN PASSWORD '<contraseña larga del dueño>';
CREATE ROLE comapa_app   LOGIN PASSWORD '<contraseña larga de la app>';
CREATE DATABASE comapa_mir OWNER comapa_dueno;
SQL

# 3. Variables (sin valores reales en el repo)
sudo install -d -m 750 -o root -g comapa /etc/comapa-mir
sudo install -m 640 -o root -g comapa /opt/comapa-mir/backend/despliegue/api.env.ejemplo   /etc/comapa-mir/api.env
sudo install -m 640 -o root -g comapa /opt/comapa-mir/backend/despliegue/sitio.env.ejemplo /etc/comapa-mir/sitio.env
sudo install -m 600 -o root -g root   /opt/comapa-mir/backend/despliegue/dueno.env.ejemplo /etc/comapa-mir/dueno.env
sudoedit /etc/comapa-mir/api.env /etc/comapa-mir/dueno.env      # contraseñas reales

# 4. Compilar, migrar, permisos y carga inicial (solo la primera vez)
cd /opt/comapa-mir/backend
sudo -u comapa npm ci && sudo -u comapa npm run build
set -a; source /etc/comapa-mir/dueno.env; set +a
db/migrar.sh up
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v app=comapa_app -f db/permisos.sql
SEMILLA_PASSWORD='<12+ caracteres>' SEMILLA_ADMIN_EMAIL='admin@…' SEMILLA_ADMIN_NOMBRE='…' \
  NODE_ENV=production db/sembrar.sh          # solo catálogo y la cuenta del Administrador
sudo -u comapa npm prune --omit=dev

# 5. Servicios y respaldos
sudo cp despliegue/comapa-{api,sitio,respaldo}.service despliegue/comapa-respaldo.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now comapa-api comapa-sitio comapa-respaldo.timer

# 6. Túnel
cloudflared tunnel login && cloudflared tunnel create comapa-mir
sudo cp despliegue/cloudflared.yml.ejemplo /etc/cloudflared/config.yml   # ID, hostname
cloudflared tunnel route dns comapa-mir mir.ejemplo.gob.mx
sudo cloudflared service install
```

El Administrador entra con `SEMILLA_PASSWORD` y el sistema le pide cambiarla en el primer acceso.

## Actualizar

```bash
sudo /opt/comapa-mir/backend/despliegue/desplegar.sh
```

Si algo falla (compilación, migración, permisos), se detiene antes de reiniciar.

## Checklist de seguridad

- [ ] `listen_addresses = 'localhost'` en PostgreSQL y autenticación `scram-sha-256` en `pg_hba.conf`.
- [ ] La app usa `comapa_app` (`api.env`), nunca el dueño. `pruebas/permisos.test.ts` prueba que con ese rol todo
      funciona y que no puede borrar la bitácora, desactivar triggers ni crear tablas.
- [ ] `ss -ltnp` solo muestra `127.0.0.1:3000`, `127.0.0.1:4321` y `127.0.0.1:5432`.
- [ ] El firewall no abre puertos entrantes; SSH con llave.
- [ ] En Cloudflare: «Always Use HTTPS», TLS 1.2 mínimo. Opcional: Cloudflare Access o WAF delante del sitio.
- [ ] `/etc/comapa-mir/*.env` con permisos 640/600; nada con contraseñas en el repo.
- [ ] El timer de respaldo corre (`systemctl list-timers comapa-respaldo`) y **se probó restaurar** un respaldo.
- [ ] Los respaldos se copian fuera del servidor (otro disco o almacenamiento), cifrados.
