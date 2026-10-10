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
./db/sembrar.sh --con-fixtures     # agrega los 123 reportes de prueba (CA-4)
./db/sembrar.sh --verificar        # no escribe; reporta qué hay en la base
npm run bd:sembrar                 # equivalente a ./db/sembrar.sh
```

## Regenerar el dataset desde el prototipo

```sh
npx tsx db/semilla/extraer.ts
```

Determinista: misma entrada, mismos bytes. Las filas se ordenan por clave natural y
`manifest.json` guarda `sha256` por archivo, así que dos corridas se comparan byte a byte
(soporte de CA-3).

```sh
cd backend/db/semilla
shasum -a 256 datos/*.csv > /tmp/h1 && node extraer.ts >/dev/null \
  && shasum -a 256 datos/*.csv | diff /tmp/h1 - && echo determinista
```

## Archivos

| Archivo | Qué es |
|---|---|
| `extraer.ts` | Extractor. Lee los `.js` del prototipo en la raíz del repo y escribe `datos/` |
| `mapeos.ts` | Único lugar con la traducción prototipo → catálogos del esquema |
| `cargar.ts` | Cargador idempotente. Lee los CSV e inserta en orden de dependencias |
| `datos/*.csv` | El dataset. Formato de revisión: `gerencias.csv` y `unidades.csv` están hechos para imprimirse y que Planeación confirme renglón por renglón (CA-1) |
| `semilla.json` | El dataset generado como un solo JSON. Artefacto de conveniencia: `cargar.ts` lee los CSV, no este archivo, porque los CSV son lo que Planeación revisa |
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

La contraseña inicial es común y no es un secreto: se cambia al primer acceso. Para no usar el
valor por omisión, define `SEMILLA_PASSWORD` en el entorno antes de sembrar.

En una segunda carga el hash **no se regenera**: bcrypt daría uno distinto cada vez y la carga no
sería comparable (CA-3).

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

Ya hecho: `cargar.ts`, `db/sembrar.sh`, `npm run bd:sembrar`, las 10 pruebas de
`backend/pruebas/semilla.test.ts` y `backend/evidencia/TEC-04.md`.
