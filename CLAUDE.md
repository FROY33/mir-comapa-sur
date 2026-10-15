# COMAPA Sur — Sistema MIR

Plataforma de reporte, revisión y validación de los indicadores MIR de COMAPA Sur. Qué es y para quién:
[proyecto.md](proyecto.md); roles: [roles-usuarios.md](roles-usuarios.md).

- **Frontend:** HTML/JS sin framework en la raíz (una página por pantalla y rol). Sin bundler.
- **Backend:** `backend/` — Node 22 + TypeScript, `node:http`, `pg` con SQL a mano, sin ORM. Solo ES modules.
- **Base:** PostgreSQL 14+, migraciones SQL en `backend/db/migrations` ([db/README.md](backend/db/README.md)).
- **Producción:** servidor propio, servicios systemd detrás de Cloudflare Tunnel ([despliegue/README.md](backend/despliegue/README.md)).

## Skills del proyecto — úsalas

| Cuando… | Skill |
|---|---|
| Empiezas o cierras una ficha del RQM (HU-…, TEC-…, R…) | `/ficha` |
| Vas a crear o cambiar una tabla, columna, índice o dato en la base | `/migracion` |
| Vas a actualizar el servidor | `/desplegar` |

## Comandos

```bash
cd backend
npm test             # node:test; borra y recrea la base de .env.test (nombre terminado en _test)
npm run tipos        # tsc --noEmit
db/probar.sh         # restricciones de la base + reversión + actualización sobre datos de S1
```

## Reglas

- **Idioma:** código, commits, docs y evidencia en español, con los nombres del RQM.
- **Pruebas primero.** El runner es `node:test` (`backend/pruebas/*.test.ts`); no se introduce otro.
- **Fuentes que mandan:** el RQM; lo decidido está en `backend/db/DECISIONES.md`. Si la ficha contradice
  algo decidido, o trae un criterio que no le corresponde, se pregunta; no se inventa.
- **Archivos de más de ~300 líneas se parten** en el mismo PR o en uno de `refactor:` inmediato.
- **Nada de datos institucionales ni `.env` en git** (ver `.gitignore`).
- **En el servidor nunca `pkill`/`killall node`:** todos los sitios corren `node`. Se usa `systemctl stop <unidad>`.
- **Commits:** `feat: …`, `fix: …`, `pruebas: …`, `refactor: …`, `docs: …`, o `TEC-04: …` / `HU-R7-01: …`.
  Título en minúsculas que dice qué cambió para el usuario, con la ficha entre paréntesis si aplica:
  `feat: pendientes del periodo para el Enlace (R1-01)`. El cuerpo explica por qué y cuántas pruebas.
- **Trabajo en rama y PR** contra `main`: `tec-04/dataset-origen`, `r7-02/redireccion-por-rol`.
