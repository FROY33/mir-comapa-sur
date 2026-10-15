---
name: desplegar
description: Actualizar COMAPA MIR en producción (comapa.icarus.mx, servidor icarus; systemd + Cloudflare Tunnel) — revisión previa, desplegar.sh con respaldo antes de migrar, verificación y cómo volver atrás. Usar cuando alguien dice "despliega", "sube a producción", "actualiza el servidor", "rollback" o pregunta por los servicios comapa-api / comapa-sitio.
---

# Desplegar

**Producción: `comapa.icarus.mx`, en el servidor propio `icarus`** (instalada el 2026-10-14). Guía y
piezas: `backend/despliegue/icarus/README.md`.

```bash
~/comapa-mir/backend/despliegue/icarus/desplegar.sh     # como developer, sin contraseña
```

Código → parar → respaldo (`~/backups/comapa-mir/`) → `npm ci` y build → migraciones y permisos →
arrancar → verificar. API `127.0.0.1:3087`, sitio `127.0.0.1:3088`, PostgreSQL 16 en el contenedor
`comapa-postgres` (`127.0.0.1:5433`), variables en `~/comapa-mir-config/` (fuera de git).

Antes de desplegar: `main` con `npm test`, `npm run tipos` y `db/probar.sh` en verde, y revisa las
migraciones nuevas (¿borran o renombran algo que la API usa? → dos despliegues, ver `/migracion`).

Si falla con los servicios parados, el script imprime el commit anterior; la base se restaura con
`pg_restore --clean --if-exists -d "$DATABASE_URL" <respaldo>.dump` usando `~/comapa-mir-config/dueno.env`.

**Nunca `pkill`/`killall node`:** el servidor aloja ~30 apps con `node`. `sudo -n systemctl stop comapa-api`.

---

Lo que sigue describe la variante genérica (`backend/despliegue/`: usuario `comapa`, `/opt`, `/etc`),
para un servidor propio de COMAPA. No aplica a icarus.

# Variante genérica


Guía completa: `backend/despliegue/README.md`. Unidades: `comapa-api` (API, `127.0.0.1:3000`),
`comapa-sitio` (sitio, `127.0.0.1:4321`), `comapa-respaldo.timer` (02:30, 14 días). Código en `/opt/comapa-mir`.

## Antes

- `main` tiene lo que se va a desplegar, con `npm test`, `npm run tipos` y `db/probar.sh` en verde.
- Lee las migraciones nuevas desde el último despliegue (`git log <desplegado>..main -- backend/db/migrations`):
  ¿alguna borra o renombra algo que la API actual usa? Entonces va en dos despliegues (ver `/migracion`).
- ¿Hay permisos nuevos en `db/permisos.sql`? `desplegar.sh` los aplica; confirma que estén.

## Desplegar

```bash
sudo /opt/comapa-mir/backend/despliegue/desplegar.sh
```

Hace, en orden: `git pull --ff-only` → `npm ci` + build → **respaldo** (`respaldar.sh`, en
`/var/backups/comapa-mir`) → migraciones → permisos → `systemctl restart comapa-api comapa-sitio` →
verificación de `/api/salud` y `/login.html`. Si algo falla antes del reinicio, se detiene y los servicios
siguen con la versión anterior. **Anota la ruta del respaldo que imprime.**

## Verificar

```bash
systemctl status comapa-api comapa-sitio --no-pager
journalctl -u comapa-api -n 50 --no-pager
curl -fsS http://127.0.0.1:3000/api/salud      # "esquema" = última migración desplegada
```

## Volver atrás

1. Código: `sudo -u comapa git -C /opt/comapa-mir checkout <commit anterior>`, compilar y
   `systemctl restart comapa-api comapa-sitio`. Antes del siguiente despliegue, `git checkout main`
   (`desplegar.sh` hace `pull --ff-only` y falla en un HEAD separado).
2. Base, solo si la migración dañó datos: `systemctl stop comapa-api`, luego
   `pg_restore --clean --if-exists -d "$DATABASE_URL" <respaldo>.dump` con `dueno.env`, y arrancar.

## Nunca

- `pkill`/`killall node` o `pkill -f "node build"`: el servidor aloja otros sitios con `node`. Se detiene con
  `systemctl stop <unidad>`.
- Correr scripts contra la base del servidor sin un respaldo recién tomado (`despliegue/respaldar.sh`).
- Commitear `/etc/comapa-mir/*.env` o volcados de la base.
