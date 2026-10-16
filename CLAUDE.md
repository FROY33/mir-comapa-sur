# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
| Eliges, agregas o quitas un componente, librería, patrón o proceso | `/arquitectura` |

## Comandos

```bash
cd backend
npm run dev          # API en :3000 (tsx watch)
npm run dev:sitio    # otra terminal: páginas + proxy /api/* en http://127.0.0.1:4321/login.html
npm test             # node:test; borra y recrea la base de .env.test (nombre terminado en _test)
npm run tipos        # tsc --noEmit
db/probar.sh         # restricciones de la base + reversión + actualización sobre datos de S1
npm run bd:migrar    # migraciones (dbmate vía db/migrar.sh); bd:estado, bd:sembrar

# Un solo archivo de pruebas (la base _test ya preparada por un npm test previo,
# o antes: NODE_ENV=test npx tsx pruebas/preparar.ts)
NODE_ENV=test npx tsx --test pruebas/login.test.ts
```

Abre el prototipo siempre por `dev:sitio`, no como archivo ni con otro estático: la cookie de sesión es
`SameSite=Strict` y solo viaja si páginas y API comparten origen.

## Arquitectura: el problema y lo que pide

Esta sección no describe el estado del código ni lista componentes; para eso está el código y `git log`.
Dice qué exige el problema y qué costo se aceptó por ello. Los cambios quedan en
[registro-arquitectura.md](registro-arquitectura.md) (`/arquitectura`); el modelo de datos, en
`backend/db/DECISIONES.md`. Una decisión nueva solo entra si responde a una de estas presiones.

| El problema pide… | Por eso… | Costo aceptado |
|---|---|---|
| **Trazabilidad completa:** quién actuó, cuándo y qué decidió, auditable ante el gobierno | Las reglas (estados, bloqueo de cerrados, bitácora) viven en PostgreSQL con `CHECK` y triggers, no solo en la app; la app corre con un rol que no es dueño de las tablas | SQL a mano y migraciones con pruebas de restricciones; cada permiso nuevo se declara en `db/permisos.sql` |
| **Cada gerencia ve solo lo suyo** (Enlace y Revisor) | La autorización se decide en el backend y la gerencia sale de la sesión, nunca de la petición; la guardia del navegador solo evita mostrar una pantalla vacía | Toda ruta con datos pasa por la verificación de sesión y rol |
| **Cuentas y datos institucionales** expuestos a internet | Cookie de sesión HttpOnly y `SameSite=Strict`, páginas y API en el mismo origen, CSP, sin scripts de terceros (Chart.js y SheetJS servidos desde `vendor/`) | Un proceso extra que sirve las páginas y hace de proxy; las páginas con scripts en línea aún llevan `'unsafe-inline'` |
| **Un reporte por indicador y periodo, con su historia** | El estado vive en el reporte, no en el indicador; al cerrar se congela meta, cumplimiento y semáforo | Columnas de foto en `reportes`; reabrir requiere autorización explícita |
| **Mantenibilidad** (RNF del RQM) | Node + TypeScript sin framework ni ORM, frontend HTML/JS sin bundler, pocas dependencias | Más código propio para enrutar y validar; se agrega framework solo si una ficha lo justifica |
| **Operar en servidor propio** | systemd + Cloudflare Tunnel, respaldo antes de migrar (`/desplegar`) | Sin plataforma administrada: respaldos y actualizaciones son nuestros |

Al elegir un componente o patrón, el argumento es cuál de estas filas atiende y qué cuesta, no
«así está hecho en otro lado del código». El prototipo y sus documentos de diseño (`*-data.js`,
`estructura-datos-flujo.md`, `feature-validacion-administrador.md`) son referencia de pantallas, no del modelo.

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
