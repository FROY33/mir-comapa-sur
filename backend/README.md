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
| `SEMILLA_PASSWORD` | para sembrar | — | Contraseña inicial de las cuentas que crea la carga, 12 caracteres o más. Sin valor por defecto (ver `db/semilla/`) |
| `SEMILLA_ADMIN_EMAIL`, `SEMILLA_ADMIN_NOMBRE` | para sembrar producción | — | La cuenta de Administrador de la carga inicial. `SEMILLA_ADMIN_GERENCIA` (opcional, `PLA`) |
| `CONFIAR_PROXY` | no | `false` | `true` detrás de Cloudflare Tunnel o de un proxy propio: la IP de la bitácora y del límite de intentos se toma de `CF-Connecting-IP` (o de la última entrada de `X-Forwarded-For`). Expuesto directo debe quedar en `false`, o cualquiera podría falsear su IP |
| `HOST` | no | `127.0.0.1` | Interfaz donde escucha la API. En producción se deja así: solo el sitio llega a ella |
| `BD_TIMEOUT_CONEXION_MS` | no | `5000` | Cuánto esperar una conexión antes de responder 503 |
| `BD_TIMEOUT_CONSULTA_MS` | no | `15000` | Límite por consulta (`statement_timeout`) |

De dónde salen:

- **Desarrollo:** de `.env`.
- **Pruebas** (`NODE_ENV=test`): de `.env.test`.
- **Producción:** no se lee ningún archivo; las variables las pone la plataforma.

Si una variable ya existe en el entorno, gana sobre el archivo. `.env` y `.env.test` están en `.gitignore`.

## Probar el prototipo contra el backend

La cookie de sesión es `SameSite=Strict` (HU-R7-01 CA-3), así que el navegador solo la manda si
el sitio y la API comparten origen. `src/sitio.ts` sirve el prototipo de la raíz del repo y
reenvía `/api/*` al backend para conseguirlo en local. En producción lo resuelve la plataforma
(Netlify redirigiendo `/api/*`, o nginx).

```bash
npm run dev          # backend en :3000
npm run dev:sitio    # en otra terminal: prototipo en http://127.0.0.1:4321/login.html
```

Variables: `PUERTO_SITIO` (4321), `BACKEND_URL` (`http://127.0.0.1:3000`).

Solo sirve el prototipo: `backend/`, `node_modules/`, `.git/` y cualquier archivo que empiece
con punto quedan fuera, para que `.env` no viaje por HTTP. Si el backend no está arriba,
`/api/*` responde 502 diciéndolo.
Solo se versionan los `.example`, que no tienen claves. Si falta `DATABASE_URL`, el backend no arranca y
el log lo explica sin mostrar valores.

## Producción

Guía completa para servidor propio con Cloudflare Tunnel y systemd: [`despliegue/README.md`](despliegue/README.md)
(servicios, túnel, variables, respaldos, actualización y checklist de seguridad).

```bash
npm ci && npm run build
NODE_ENV=production DATABASE_URL=... PORT=... npm start        # API, en 127.0.0.1 (HOST)
NODE_ENV=production npm run start:sitio                            # sitio: páginas + proxy a la API
```

**El usuario de base de la app no debe ser dueño de las tablas:** el dueño puede desactivar triggers, vaciar
o borrar tablas, incluida la bitácora. Las migraciones y la carga inicial corren con el dueño. La app usa otro
rol, con los permisos de `db/permisos.sql` (exactamente lo que el código usa, tabla por tabla):

```bash
# con el usuario dueño, después de migrar; el rol comapa_app lo crea antes el DBA, con LOGIN y contraseña
psql "$DATABASE_URL_DUEÑO" -v app=comapa_app -f db/permisos.sql
```

`pruebas/permisos.test.ts` levanta la app con ese rol y recorre login, consultas, gestión de usuarios, ventanas
y ciclos. También comprueba que el rol no puede borrar ni vaciar la bitácora, desactivar triggers ni crear tablas.
En PostgreSQL 14 cualquier rol podía crear tablas en `public`; el script lo cierra. Una HU que necesite un permiso
nuevo lo agrega ahí, con su prueba.

### Cabeceras de seguridad del sitio

El servidor web que entrega las páginas, scripts y estilos (nginx o la plataforma) debe mandar
en cada respuesta las mismas cabeceras que `src/sitio.ts` (`CABECERAS_SEGURIDAD`):

| Cabecera | Valor |
|---|---|
| `Content-Security-Policy` | la de `CSP` en `src/sitio.ts`: todo de `'self'` (scripts, conexiones, imágenes, marcos), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; el único externo es Google Fonts en `style-src` y `font-src` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()` |

**CSP estricta en las páginas de contraseña.** `index.html`, `login.html` y `cambiar-password.html` no tienen
scripts ni manejadores en línea y se sirven con `script-src 'self'`, sin `'unsafe-inline'` (`PAGINAS_CSP_ESTRICTA`
en `src/sitio.ts`). Ahí un XSS no puede ejecutar código aunque lograra inyectar HTML. Una página entra a esa lista
cuando ya no tiene `<script>` en línea ni atributos `on*=`; la prueba lo verifica.

Límite conocido: en las demás páginas la CSP lleva `'unsafe-inline'` en `script-src` porque tienen scripts y
`onclick=` en línea. Por eso no detiene un XSS que logre inyectar HTML; la defensa contra eso es
escapar los datos (`escaparHTML` en `session.js`). Para quitarlo hay que mover los scripts en línea
a archivos y los `onclick=` a `addEventListener`.

**Sin scripts de terceros.** Chart.js 4.4.3 y SheetJS (xlsx) 0.20.3 se sirven desde `vendor/` (la 0.18.5 del
CDN tenía vulnerabilidades conocidas). Se quitó la analítica de maze.co y contentsquare: grababa sesiones con
datos reales, incluida la página de login. Si diseño la necesita para pruebas de usabilidad, que sea en un
entorno de demostración con datos ficticios, nunca en el que usan las personas.

## Pruebas

```bash
cp .env.test.example .env.test
npm test
```

`npm test` borra y recrea la base de `.env.test` (su nombre tiene que terminar en `_test`; si no, se niega a
correr), le aplica las migraciones y corre las pruebas:

| Archivo | Qué demuestra |
|---|---|
| `pruebas/datos.test.ts` | CA-1: lee y escribe; las transacciones confirman o revierten todo; los errores de PostgreSQL se traducen |
| `pruebas/reinicio.test.ts` | CA-2: arranca el servidor real, lo detiene con SIGTERM y lo vuelve a arrancar; lo escrito antes sigue ahí |
| `pruebas/fallo-conexion.test.ts` | CA-3 y CA-4: sin base responde 503 controlado; ni la respuesta ni el log llevan la clave |
| `pruebas/api.test.ts` | Rutas HTTP, 404 y que el proceso sobrevive cuando PostgreSQL corta sus conexiones |
| `pruebas/bloqueo.test.ts` | HU-R7-06: bloqueo tras 5 fallos, 15 minutos, evento en la bitácora, desbloqueo del Admin y reinicio del contador |
| `pruebas/autorizacion.test.ts` | HU-R7-03: 401/403 por rol, `/api/admin/*`, páginas por rol y la gerencia de la sesión contra URL y cuerpo |

Las migraciones tienen sus propias pruebas en `db/probar.sh`. Para revisar tipos: `npm run tipos`.

## Autorización (HU-R7-03)

Toda ruta con datos se registra en `src/app.ts` envuelta en `protegida(roles, manejador)`
(`src/autorizacion.ts`). Sin sesión válida responde 401 y con un rol que no está en la lista,
403 con el dashboard del propio rol en `redirigirA`. El manejador recibe `s.sesion`, cuya
`gerenciaId` sale de `usuarios`: para filtrar por gerencia se usa esa, nunca un parámetro de la
petición. El Administrador conserva el acceso global.

```ts
'GET /api/indicadores': protegida(['admin', 'revisor', 'enlace'], indicadores.listar(bd)),
'GET /api/admin/configuracion': protegida(['admin'], …),   // todo /api/admin/ va con ['admin']
```

`GET /api/auth/acceso?pagina=x.html` dice si la sesión puede abrir una página (tabla de
`src/rutas.ts`, lista blanca). La consultan la guardia de `session.js` y `src/sitio.ts`; en
producción, el servidor web debe hacer lo mismo antes de servir una página protegida.

## Límite por IP y cabeceras de seguridad

- **Logins fallidos por IP:** 30 en 15 minutos; después, `429 demasiados_intentos` con `Retry-After`
  (`src/limitePorIp.ts`). Complementa el bloqueo por cuenta de HU-R7-06: frena a quien prueba una contraseña
  contra muchas cuentas y las ráfagas que saturan la CPU con bcrypt. Los logins correctos no cuentan, para no
  bloquear a una oficina que sale por la misma IP. Está en memoria, por instancia.
- **Toda respuesta de la API** lleva `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer` y
  `Cross-Origin-Resource-Policy: same-origin` (`CABECERAS_SEGURIDAD` en `src/http.ts`).

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
