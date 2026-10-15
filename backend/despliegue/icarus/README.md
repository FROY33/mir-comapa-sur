# COMAPA MIR en icarus (comapa.icarus.mx)

Variante de `../` para el servidor propio `icarus`, con sus convenciones: servicios como `developer`,
PostgreSQL en Docker y el túnel compartido `icarus-server`. Lo de `../README.md` (checklist de seguridad,
roles de base) sigue valiendo.

| Pieza | Dónde |
|---|---|
| Código (checkout de despliegue, no el de trabajo) | `/home/developer/comapa-mir` |
| Variables (`api.env`, `sitio.env`, `dueno.env`, `postgres.env`; 600, fuera de git) | `/home/developer/comapa-mir-config/` |
| PostgreSQL 16 (contenedor `comapa-postgres`, volumen `comapa-mir_pgdata`) | `127.0.0.1:5433` |
| API (`comapa-api`) | `127.0.0.1:3087` |
| Sitio (`comapa-sitio`), destino del túnel | `127.0.0.1:3088` |
| Respaldos (`comapa-respaldo.timer`, 02:30, 14 días; y antes de cada despliegue) | `/home/developer/backups/comapa-mir/` |

## Actualizar

```bash
~/comapa-mir/backend/despliegue/icarus/desplegar.sh
```

Código → parar → respaldo → `npm ci` y build → migraciones y permisos → arrancar → verificar `/api/salud`
y `/login.html`. Sin contraseña: usa los `sudo -n systemctl` permitidos a `developer`.

## Instalación (una vez, 2026-10-14)

1. `sudo -n apt install postgresql-client-16` (para `migrar.sh`, `permisos.sql` y `respaldar.sh`).
2. `git clone` en `~/comapa-mir`; variables en `~/comapa-mir-config/`.
3. `docker compose -f backend/despliegue/icarus/compose.yml --env-file ~/comapa-mir-config/postgres.env up -d`,
   luego roles `comapa_dueno` y `comapa_app` y la base `comapa_mir` (dueña: `comapa_dueno`).
4. `npm ci`, build, `db/migrar.sh up`, `permisos.sql` y la carga inicial
   (`NODE_ENV=production db/sembrar.sh`: catálogo y una cuenta de Administrador).
5. `sudo -n systemctl link` de las tres unidades y el timer de esta carpeta; `enable --now`.
6. `~/.claude/skills/icarus/scripts/ruta-tunel.sh comapa.icarus.mx 3088 --aplicar`.
