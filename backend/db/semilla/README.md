# Semilla — carga inicial de datos y cuentas (TEC-04)

Dataset de origen para la carga inicial, extraído de los archivos del prototipo y **mapeado al
esquema de TEC-02**. Las migraciones crean las tablas vacías; esto es lo que va dentro.

Catálogos fijos como `frecuencias` ya vienen con sus filas en su propia migración. Aquí van los
datos **institucionales**: los que cambian, los que necesitan confirmación de Planeación
Estratégica y los que deben poder recargarse sin duplicar.

## Usar

```sh
cd backend
./db/migrar.sh up                  # el esquema primero: sin tablas no hay dónde cargar
./db/sembrar.sh                    # definición: gerencias, unidades, usuarios, indicadores, periodos
./db/sembrar.sh --con-fixtures     # agrega los 123 reportes de prueba (CA-4; solo base local o _test)
./db/sembrar.sh --verificar        # no escribe; reporta qué hay en la base
npm run bd:sembrar                 # equivalente a ./db/sembrar.sh
```

Antes de la primera carga define `SEMILLA_PASSWORD` (12 caracteres o más) en `.env` o en el
entorno. No hay valor por defecto. Una opción mal escrita es un error, no se ignora.

### Qué se carga, según el destino (`plan.ts`)

| Destino | Modo | Qué carga |
|---|---|---|
| Base local o `_test`, fuera de producción | demostración | Catálogo, los 35 usuarios del prototipo, los 5 de prueba y, con `--con-fixtures`, los 123 reportes |
| Producción, o cualquier base remota | inicial | Catálogo y **una** cuenta de Administrador: `SEMILLA_ADMIN_EMAIL`, `SEMILLA_ADMIN_NOMBRE` y opcional `SEMILLA_ADMIN_GERENCIA` (`PLA` por defecto). Ninguna persona del prototipo |

En modo inicial, si la base ya tiene usuarios la carga no hace nada: no se repite, así una
segunda corrida no revierte lo que se haya cambiado desde la aplicación. Las fixtures se rechazan
fuera de una base local o `_test`, aunque falte `NODE_ENV`: el destino se imprime antes de cargar.

## Regenerar el dataset desde el prototipo

```sh
npx tsx db/semilla/extraer.ts
```

Determinista: misma entrada, mismos bytes. Las filas se ordenan por clave natural y
`manifest.json` guarda `sha256` por archivo, así que dos corridas se comparan byte a byte
(soporte de CA-3).

```sh
cd backend
shasum -a 256 db/semilla/datos/*.csv > /tmp/h1 && npx tsx db/semilla/extraer.ts >/dev/null \
  && shasum -a 256 db/semilla/datos/*.csv | diff /tmp/h1 - && echo determinista
```

## Archivos

| Archivo | Qué es |
|---|---|
| `extraer.ts` | Extractor. Lee los `.js` del prototipo en la raíz del repo y escribe `datos/` |
| `origen/usuarios-prototipo.js` | Los usuarios del prototipo, congelados sin contraseñas: HU-R7-01 los quitó de `session.js` |
| `mapeos.ts` | Único lugar con la traducción prototipo → catálogos del esquema |
| `cargar.ts` | Cargador idempotente. Lee los CSV e inserta en orden de dependencias |
| `plan.ts` | Qué se carga según el destino, y las variables obligatorias. Funciones puras, con pruebas |
| `csv.ts` | Lector de CSV, sin dependencias |
| `datos/*.csv` | El dataset. Formato de revisión: `gerencias.csv` y `unidades.csv` están hechos para imprimirse y que Planeación confirme renglón por renglón (CA-1) |
| `manifest.json` | Conteos, `sha256`, verificaciones de integridad y lista de pendientes |
| `INCONSISTENCIAS.md` | Hallazgos, con el criterio de aceptación que bloquea cada uno y quién decide |

## Entidades y claves naturales

| Archivo | Filas | Tabla destino | Clave natural |
|---|---|---|---|
| `gerencias.csv` | 5 | `gerencias` | `clave` (`PLA`, `COM`, `ADM`, `TEC`, `GEN`) |
| `unidades.csv` | 34 | `unidades` | `gerencia_clave` + `nombre` |
| `usuarios.csv` | 35 | `usuarios` | `email` |
| `indicadores.csv` | 155 | `indicadores` | `codigo` |
| `periodos.csv` | 28 | `periodos_reporte` | `frecuencia` + `ejercicio` + `numero` |
| `fixtures_reportes.csv` | 123 | `reportes` | `indicador_codigo` + `periodo_frecuencia` + `periodo_numero` |
| `usuarios_prueba.csv` | 5 | `usuarios` | `email` (cuentas de prueba: los responsables que las fixtures citan y no existen en el prototipo) |
| `catalogo_mir_193.csv` | 193 | — | `codigo` (catálogo de abril; espacio de IDs disjunto, no se carga) |

Las claves son las mismas que hace cumplir el esquema: `UNIQUE (organizacion_id, clave)` en
gerencias, `UNIQUE (gerencia_id, nombre)` en unidades, `email citext UNIQUE` en usuarios,
`codigo UNIQUE` en indicadores, `UNIQUE (frecuencia, ejercicio, numero)` en periodos y
`UNIQUE (indicador_id, periodo_id)` en reportes. Elegirlas mal es lo que rompe CA-3.

Los CSV traen además columnas que **no** van a ninguna tabla, marcadas como «de revisión» en
`extraer.ts`: conteos de indicadores por gerencia y unidad, `confirmacion_institucional`,
`gerencia_texto_origen`, `periodo_prototipo`, `iso_codigo` y `*_prototipo`. Sirven para auditar
el mapeo y para que Planeación revise; el cargador las ignora.

## Separación definición / fixtures (CA-4)

Todo lo anterior es definición, salvo `fixtures_reportes.csv`, que es lo único con estado de
flujo simulado. Coincide con la decisión de TEC-02 de que el estado vive en `reportes` y nunca
en `indicadores`: un cargador que respete CA-4 carga las cinco primeras tablas y excluye las
fixtures salvo petición explícita.

## Contraseñas (CA-2)

`usuarios.csv` **no tiene contraseñas**. El dataset define identidad, rol y adscripción; el hash
bcrypt de 12 rondas lo genera `cargar.ts` con `bcryptjs`, uno por usuario con su propia sal.
Todos salen con `debe_cambiar_password = true`.

La contraseña inicial sale de `SEMILLA_PASSWORD` y no hay valor por defecto: una contraseña escrita
en el repositorio la conocería cualquiera que lo lea, incluida la del Administrador.

En una segunda carga el hash de una cuenta existente **no se regenera**: conserva su contraseña,
y la carga sigue siendo comparable (CA-3).

## Antes de cargar

`gerencias.csv` y `unidades.csv` traen `confirmacion_institucional` en `PENDIENTE` en todos sus
renglones. **CA-1 no se cumple mientras siga así**: exige datos institucionales confirmados o
identificados como pruebas. Esa confirmación la da Planeación Estratégica, no el extractor.

Ver `INCONSISTENCIAS.md`. Varios hallazgos coinciden con preguntas que `../DECISIONES.md` ya tiene
abiertas (5, 24a, 24g y la regla general 2).

## Lo que falta para cerrar TEC-04

| Pendiente | Depende de |
|---|---|
| Confirmar gerencias y unidades (quitar `PENDIENTE`) | Planeación Estratégica |
| Resolver si Gerencia General existe | `DECISIONES.md` pregunta 5 |
| Alta de un Revisor por gerencia (hoy faltan en PLA, COM y ADM) | Propio |
| Cuentas de los 4 responsables citados en fixtures que no existen | Propio |
| Unos reportes en estado `borrador` para CA-5 | Propio; ver hallazgo 19 |
| Confirmar la gerencia del Revisor Carlos Mendoza | Dueño funcional; ver hallazgo 18 |

Ya hecho: `cargar.ts`, `db/sembrar.sh`, `npm run bd:sembrar`, las pruebas de
`backend/pruebas/semilla.test.ts` y `semilla-inicial.test.ts`, y `backend/evidencia/TEC-04.md`.
