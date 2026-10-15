---
name: desplegar
description: Actualizar COMAPA MIR en el servidor propio (systemd + Cloudflare Tunnel) — revisión previa, desplegar.sh con respaldo antes de migrar, verificación y cómo volver atrás. Usar cuando alguien dice "despliega", "sube a producción", "actualiza el servidor", "rollback" o pregunta por los servicios comapa-api / comapa-sitio.
---

# Desplegar

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
