# Backend — COMAPA MIR

Node.js 22+ con TypeScript y PostgreSQL 14+. La capa HTTP es `node:http`, sin framework; si hace falta uno,
se decide en el ticket de autenticación. Para la base usa `pg` con SQL a mano, sin ORM. La base, sus
migraciones y su diccionario están en [`db/`](db/README.md).

## Arranque en desarrollo

```bash
cd backend
npm install
cp .env.example .env          # ajusta DATABASE_URL si tu PostgreSQL no es el local
createdb comapa_mir
npm run bd:migrar             # aplica las migraciones de db/migrations
npm run dev                   # http://localhost:3000, se reinicia al guardar
```

Para comprobarlo:

```bash
curl localhost:3000/api/salud
# {"estado":"ok","bd":"ok","esquema":"20261009000001"}
```

## Variables de entorno

| Variable | Obligatoria | Por defecto | Para qué |
|---|---|---|---|
| `DATABASE_URL` | sí | — | `postgres://usuario:clave@host:5432/base` |
| `PORT` | no | `3000` | Puerto HTTP |
| `NODE_ENV` | no | `development` | `development`, `test` o `production` |
| `BD_MAX_CONEXIONES` | no | `10` | Tamaño del pool |
| `CONFIAR_PROXY` | no | `false` | `true` solo si el backend está detrás de un proxy propio: entonces la IP de la bitácora se toma de `X-Forwarded-For`. Expuesto directo debe quedar en `false`, o cualquiera podría falsear su IP |
| `BD_TIMEOUT_CONEXION_MS` | no | `5000` | Cuánto esperar una conexión antes de responder 503 |
| `BD_TIMEOUT_CONSULTA_MS` | no | `15000` | Límite por consulta (`statement_timeout`) |

De dónde salen:

- **Desarrollo:** de `.env`.
- **Pruebas** (`NODE_ENV=test`): de `.env.test`.
- **Producción:** no se lee ningún archivo; las variables las pone la plataforma.

Si una variable ya existe en el entorno, gana sobre el archivo. `.env` y `.env.test` están en `.gitignore`.
Solo se versionan los `.example`, que no tienen claves. Si falta `DATABASE_URL`, el backend no arranca y
el log lo explica sin mostrar valores.

## Producción

```bash
npm ci && npm run build
NODE_ENV=production DATABASE_URL=... PORT=... npm start
```

El usuario de base de la app no debe ser dueño de las tablas. Necesita `SELECT, INSERT, UPDATE` sobre las
tablas de negocio y solo `SELECT, INSERT` sobre `bitacora`. Las migraciones se corren con otro usuario.

## Pruebas

```bash
cp .env.test.example .env.test
npm test
```

`npm test` borra y recrea la base de `.env.test` (su nombre tiene que terminar en `_test`; si no, se niega a
correr), le aplica las migraciones y corre 39 pruebas:

| Archivo | Qué demuestra |
|---|---|
| `pruebas/datos.test.ts` | CA-1: lee y escribe; las transacciones confirman o revierten todo; los errores de PostgreSQL se traducen |
| `pruebas/reinicio.test.ts` | CA-2: arranca el servidor real, lo detiene con SIGTERM y lo vuelve a arrancar; lo escrito antes sigue ahí |
| `pruebas/fallo-conexion.test.ts` | CA-3 y CA-4: sin base responde 503 controlado; ni la respuesta ni el log llevan la clave |
| `pruebas/api.test.ts` | Rutas HTTP, 404 y que el proceso sobrevive cuando PostgreSQL corta sus conexiones |
| `pruebas/bloqueo.test.ts` | HU-R7-06: bloqueo tras 5 fallos, 15 minutos, evento en la bitácora, desbloqueo del Admin y reinicio del contador |

Las migraciones tienen sus propias pruebas en `db/probar.sh`. Para revisar tipos: `npm run tipos`.

## Cómo responde la API a los errores

Toda respuesta es JSON y lleva la cabecera `x-request-id`. Ante un error, el cuerpo es:

```json
{ "error": "no_disponible", "mensaje": "La base de datos no está disponible; intenta de nuevo en unos minutos", "solicitud": "4392a0db-…" }
```

| Error de la base | `error` | HTTP |
|---|---|---|
| Duplicado (23505), conflicto de concurrencia (40001, 40P01) | `conflicto` | 409 |
| Referencia inexistente (23503) | `referencia` | 422 |
| CHECK, NOT NULL, dato mal formado (23xxx, 22xxx) | `invalido` | 422 |
| Trigger de protección: reporte cerrado, bitácora (23001) | `bloqueado` | 409 |
| Sin conexión, autenticación, base inexistente, timeout | `no_disponible` | 503 |
| Cualquier otro | `interno` | 500 |

Para los 4xx también se envía el nombre de la restricción (`restriccion`), que el frontend puede usar para
señalar el campo. Nunca se envían el mensaje de PostgreSQL, la cadena de conexión ni la pila. Eso queda en
el log del servidor, una línea JSON por evento, con el mismo número de `solicitud` para encontrarlo. Antes
de escribir, el log reemplaza cualquier clave dentro de una URL o de `password=` por `***`.

Si la base no está al arrancar, el backend arranca igual. Responde 503 y se recupera solo cuando la base
vuelve. Una conexión que PostgreSQL corta queda en el log y no tumba el proceso.

## Estructura

```
src/
  servidor.ts     arranque, apagado limpio, inicio y apagado en la bitácora
  config.ts       variables de entorno, separación desarrollo / pruebas / producción
  bd.ts           pool, consultar(), transaccion(), versionEsquema()
  errores.ts      ErrorBD y traducción de los códigos de PostgreSQL
  log.ts          log JSON con secretos ocultos
  http.ts         tabla de rutas y manejo central de errores
  app.ts          rutas de la API
  datos/          una función por consulta, agrupadas por tabla
pruebas/          node:test; preparar.ts recrea la base de pruebas
db/               migraciones, diccionario y decisiones del modelo
```

Para agregar una consulta: crea la función en `datos/<tabla>.ts`, que recibe un `Ejecutor` (así sirve
igual con `bd` que dentro de `bd.transaccion(tx => …)`), y llámala desde una ruta en `app.ts`.

## Detalles que conviene saber

- **Fechas:** las columnas `date` llegan como texto `'AAAA-MM-DD'` y no como `Date`, para que la zona
  horaria no mueva el día. `bigint` (el id de bitácora) y `numeric` llegan como texto, para no perder precisión.
- **Zona horaria:** la sesión de base usa `America/Monterrey` (Tamaulipas, sin horario de verano). Así,
  `now()::date` y los vencimientos no dependen de la zona del servidor.
- **Bitácora del sistema:** cada arranque y apagado deja un evento (`entidad = 'sistema'`, `entidad_id = 'backend'`).
- **Override y reapertura:** el patrón con `SET LOCAL app.reapertura = 'on'` se usa dentro de `bd.transaccion`
  (ver [`db/README.md`](db/README.md)).
