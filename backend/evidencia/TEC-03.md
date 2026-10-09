# Evidencia — TEC-03: Conectar backend con la base de datos

**Fecha:** 08/10/2026 · **Rama:** `tec-03-backend-bd` · **Entorno:** macOS, Node 22.16.0, PostgreSQL 14.20 (local)

Las salidas de abajo son copia de las corridas. Solo se quitaron duraciones, marcas de tiempo y cabeceras HTTP irrelevantes. Para reproducirlas, ver [`backend/README.md`](../README.md):
`npm test` corre todas las pruebas y la sección 2 da los pasos manuales.

## Resumen

| Criterio | Resultado | Dónde se ve |
|---|---|---|
| CA-1 El backend lee y escribe en la BD elegida | ✅ | §1 `lectura y escritura`, `transacciones`; §2 `curl` |
| CA-2 Los datos sobreviven al reinicio del backend | ✅ | §1 `lo escrito antes del reinicio sigue ahí después`; §3 |
| CA-3 Sin credenciales en código versionado ni en respuestas | ✅ | §4 y §5 |
| CA-4 Errores de conexión registrados sin secretos, respuesta controlada | ✅ | §5 y §6 |

| Tarea del checklist | Entregado |
|---|---|
| Configurar conexión y variables de entorno | `src/config.ts`, `.env.example` |
| Preparar acceso a datos y manejo de errores | `src/bd.ts`, `src/errores.ts`, `src/http.ts` |
| Separar configuración de desarrollo y pruebas | `.env` / `.env.test` / variables reales en producción; la base de pruebas debe terminar en `_test` |
| Documentar arranque y ejemplo de variables sin secretos | `backend/README.md`, `.env.example`, `.env.test.example` |

## 1. Pruebas automáticas — `npm test`

Antes de las pruebas, la base se recrea vacía y se migra:

```
Migrando postgres://localhost/comapa_mir_test
  ✓ 20261008000001_extensiones_y_utilidades
  ✓ 20261008000002_organizaciones_gerencias_unidades
  ✓ 20261008000003_usuarios
  ✓ 20261008000004_frecuencias
  ✓ 20261008000005_indicadores
  ✓ 20261008000006_periodos_reporte
  ✓ 20261008000007_reportes
  ✓ 20261008000008_bitacora
Listo: 8 migración(es) aplicada(s).
```

```
✔ GET /api/salud responde 200 con la versión del esquema
✔ GET /api/frecuencias lee de la base
✔ ruta inexistente → 404 en JSON
✔ si la base corta las conexiones del backend, el proceso sigue y se recupera
▶ lectura y escritura
  ✔ lee el catálogo de frecuencias sembrado por la migración
  ✔ escribe en la bitácora y lo vuelve a leer
  ✔ las fechas DATE llegan como texto AAAA-MM-DD, sin corrimiento de zona horaria
  ✔ la sesión usa la hora de Tamaulipas
▶ transacciones
  ✔ confirma todo junto
  ✔ si algo falla a medio camino, no queda nada
▶ errores de la base traducidos
  ✔ duplicado → conflicto 409, con el nombre de la restricción
  ✔ referencia inexistente → referencia 422
  ✔ regla CHECK → invalido 422
  ✔ uuid mal formado → invalido 422
  ✔ modificar la bitácora → bloqueado 409
  ✔ error de SQL del propio código → interno 500
  ✔ el mensaje del error es genérico; el de PostgreSQL queda solo en la causa
✔ GET /api/salud → 503 con mensaje genérico y número de solicitud
✔ la respuesta no expone la clave, el host ni el error interno
✔ el log registra la causa con el número de solicitud y sin la clave
✔ el backend sigue respondiendo después de varios fallos
✔ el log oculta claves aunque lleguen dentro de un mensaje
✔ sin DATABASE_URL el backend no arranca
✔ en pruebas se niega a usar una base que no termine en _test
✔ lo escrito antes del reinicio sigue ahí después
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

Tipos: `npm run tipos` (`tsc --noEmit`) no da errores.

### Las pruebas detectan fallas reales

Se rompió el código a propósito para confirmar que las pruebas fallan cuando deben. Después se restauró.

| Cambio introducido | Resultado |
|---|---|
| Se quitó el manejador `pool.on('error')` | `not ok 4 - si la base corta las conexiones del backend…`, con `uncaughtException: terminating connection due to administrator command`. Sin el manejador, el proceso se caería. |
| La API devuelve el mensaje interno de PostgreSQL | `not ok 1 - GET /api/salud → 503…` y `not ok 2 - la respuesta no expone la clave, el host ni el error interno` |

## 2. Backend compilado contra la base — CA-1

`npm run build`, luego `NODE_ENV=production PORT=3998 DATABASE_URL=postgres://localhost/comapa_mir_test node dist/servidor.js`:

```
$ curl -i localhost:3998/api/salud
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store
x-request-id: 4113e709-aefa-4976-a4d0-1dee78a91862

{"estado":"ok","bd":"ok","esquema":"20261008000008"}

$ curl localhost:3998/api/frecuencias
[{"clave":"mensual","nombre":"Mensual","meses":1,"dias_habiles":10},{"clave":"bimestral","nombre":"Bimestral","meses":2,"dias_habiles":12},{"clave":"trimestral","nombre":"Trimestral","meses":3,"dias_habiles":15},{"clave":"cuatrimestral","nombre":"Cuatrimestral","meses":4,"dias_habiles":18},{"clave":"semestral","nombre":"Semestral","meses":6,"dias_habiles":20},{"clave":"anual","nombre":"Anual","meses":12,"dias_habiles":30}]

$ curl -i localhost:3998/api/no-existe
HTTP/1.1 404 Not Found
x-request-id: 8672fd25-69e7-4bb2-b1da-5456e1f290fe

{"error":"no_encontrado","mensaje":"Ruta no encontrada"}
```

## 3. Reinicio — CA-2

Primer arranque, consultas, SIGTERM:

```
{"nivel":"info","mensaje":"Backend escuchando","puerto":3998,"entorno":"production"}
{"nivel":"info","mensaje":"Conectado a la BD","esquema":"20261008000008","evento":"7"}
{"nivel":"info","mensaje":"Apagando","senal":"SIGTERM"}
código de salida: 0
```

Segundo arranque:

```
{"nivel":"info","mensaje":"Backend escuchando","puerto":3998,"entorno":"production"}
{"nivel":"info","mensaje":"Conectado a la BD","esquema":"20261008000008","evento":"9"}
```

En la bitácora siguen el inicio y el apagado que escribió el primer proceso (pid 11804), y debajo está lo
que escribió el segundo (pid 11829):

```
 id | accion  |  pid  |  senal  |          created_at
----+---------+-------+---------+-------------------------------
  9 | inicio  | 11829 |         | 2026-10-08 23:05:09.756738-06
  8 | apagado | 11804 | SIGTERM | 2026-10-08 23:05:09.684996-06
  7 | inicio  | 11804 |         | 2026-10-08 23:05:08.616465-06
```

## 4. Credenciales fuera del código versionado — CA-3

```
$ git check-ignore -v .env .env.test
.gitignore:15:.env	.env
.gitignore:16:.env.*	.env.test

$ git ls-files --others --exclude-standard | grep .env
backend/.env.example
backend/.env.test.example
```

Solo se versionan los `.example`, que no tienen claves. En el código no hay cadenas de conexión: todas
vienen de `DATABASE_URL`.

## 5. Base caída, con clave en la URL — CA-3 y CA-4

`DATABASE_URL='postgres://comapa:Clave-Secreta-123@127.0.0.1:1/comapa_mir'`. Nadie escucha en ese
puerto, así que la conexión se rechaza.

Respuesta al navegador:

```
$ curl -i localhost:3998/api/salud
HTTP/1.1 503 Service Unavailable
content-type: application/json; charset=utf-8
cache-control: no-store
x-request-id: 12210352-142d-45b1-bb50-69956e2f158c

{"error":"no_disponible","mensaje":"La base de datos no está disponible; intenta de nuevo en unos minutos","solicitud":"12210352-142d-45b1-bb50-69956e2f158c"}
```

Log del servidor. La causa queda registrada con el mismo número de solicitud y el proceso no se cae:

```
{"nivel":"info","mensaje":"Backend escuchando","puerto":3998,"entorno":"production"}
{"nivel":"error","mensaje":"Sin conexión a la BD al arrancar; se responde 503 hasta que vuelva","tipo":"no_disponible","codigo":"ECONNREFUSED","causa":"connect ECONNREFUSED 127.0.0.1:1"}
{"nivel":"error","mensaje":"Solicitud fallida","solicitud":"12210352-142d-45b1-bb50-69956e2f158c","ruta":"GET /api/salud","status":503,"tipo":"no_disponible","codigo":"ECONNREFUSED","causa":"connect ECONNREFUSED 127.0.0.1:1"}
{"nivel":"info","mensaje":"Apagando","senal":"SIGTERM"}
{"nivel":"aviso","mensaje":"No se pudo registrar el apagado en la bitácora","tipo":"no_disponible","codigo":"ECONNREFUSED","causa":"connect ECONNREFUSED 127.0.0.1:1"}
```

Búsqueda de la clave:

```
clave en log: 0 · clave en respuesta: 0
```

## 6. Configuración incompleta — CA-4

```
$ NODE_ENV=production node dist/servidor.js        # sin DATABASE_URL
{"nivel":"error","mensaje":"Configuración inválida; el backend no arranca","causa":"Falta DATABASE_URL (ver .env.example)"}
código de salida: 1
```

## Límites de esta evidencia

- **No se detuvo PostgreSQL de verdad.** La caída se simuló de dos formas:
  - Una base inaccesible (§5).
  - PostgreSQL cortando las conexiones del backend con `pg_terminate_backend` (§1, prueba de `api.test.ts`).

  Para verlo con un paro real: `brew services stop postgresql@14` → `curl` → 503;
  `brew services start postgresql@14` → `curl` → 200.
- **«Clave en log: 0» se cumple en parte por cómo es PostgreSQL**, que no incluye la clave en sus mensajes
  de error. El ocultamiento del log (`ocultarSecretos`) es una protección extra y tiene su propia prueba.
