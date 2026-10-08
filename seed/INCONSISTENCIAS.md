# TEC-04 — Inconsistencias del dataset de origen

> Generado el 2026-10-08 a partir de los archivos del prototipo en el commit `ddf552d`.
> Las cifras de este documento salen de `seed/manifest.json`, que se regenera con `node seed/extract.js`.

Este documento registra las contradicciones encontradas al extraer el dataset de origen.
Ninguna se resolvió por criterio propio: resolverlas requiere decisión del dueño funcional
(Gerencia de Planeación Estratégica) o del responsable del modelo de datos (TEC-02).

**Resumen de impacto sobre los criterios de aceptación de TEC-04:**

| # | Hallazgo | Bloquea | Decide |
|---|----------|---------|--------|
| 1 | ¿4 o 5 gerencias? | CA-1 | Dueño funcional |
| 2 | Tres totales de indicadores: 123 / 132 / 193 | CA-1 | Dueño funcional |
| 3 | Dos catálogos con espacios de ID disjuntos | CA-1, CA-3 | Dueño funcional + TEC-02 |
| 4 | El prefijo del ID contradice el nivel en 33 de 123 registros | CA-3 | TEC-02 |
| 5 | Nivel Fin ausente de los datos operativos | CA-5 | Dueño funcional |
| 6 | Las unidades responsables no existen como catálogo | CA-1 | Dueño funcional |
| 7 | El nombre de gerencia se escribe de tres formas | CA-3 | TEC-02 |
| 8 | 4 de 5 gerencias sin Revisor en el padrón | CA-5 | TEC-04 (propio) |
| 9 | Responsables citados sin cuenta de usuario | CA-5 | TEC-04 (propio) |
| 10 | Indicadores gerenciales con esquema y formato de fecha propios | CA-3 | TEC-02 |
| 11 | Contraseñas en claro en el repositorio | CA-2 | TEC-03 |

---

## 1. ¿Son cuatro gerencias o cinco?

`mir-gerencias-data.js` define **cinco** gerencias e incluye `Gerencia General`, descrita como
contenedora de «indicadores institucionales de Fin y Propósito del MIR». Pero:

- `Gerencia General` tiene **0 indicadores** en las tres fuentes de indicadores.
- En el catálogo de 193 registros, los 4 Fin y 4 Propósito están repartidos **uno de cada
  uno en cada una de las otras cuatro gerencias**, no en Gerencia General.
- `proyecto.md` declara cuatro gerencias (Planeación Estratégica, Comercial, Administrativa, Técnica).
- El commit `8a497ff` (2026-09-24) eliminó explícitamente los registros Fin/Propósito de Gerencia General.

Lectura probable: Gerencia General quedó como contenedor vacío tras ese commit, y la
plataforma opera con cuatro gerencias. **No se asumió.** El dataset exporta las cinco con
`confirmacion_institucional=PENDIENTE` y `general` con sus conteos en cero, para que la
decisión sea explícita y no un efecto secundario de la extracción.

**Pregunta a resolver:** ¿Gerencia General se da de baja del catálogo, o se conserva como
gerencia sin indicadores propios (p. ej. para alojar los Fin institucionales más adelante)?

## 2. Tres totales de indicadores distintos

| Fuente | Total | Fin | Propósito | Componente | Actividad |
|---|---|---|---|---|---|
| `mir-actividades-data.js` (operativo, Q3 2026) | **123** | 0 | 5 | 29 | 89 |
| `data/mir-comapa-sur.js` (catálogo) | **193** | 4 | 4 | 30 | 155 |
| `proyecto.md` y `estructura-datos-flujo.md` | **132** | 4 | 4 | 30 | 94 |

Las tres cifras provienen de extracciones distintas del Excel oficial: el catálogo de 193 es
de abril (`MIR FINAL COMAPA SUR.xlsx`), el operativo de 123 es de septiembre
(`2026.09.23 MIR COMAPA SUR_CONSOLIDADA.xlsx`). El 132 de la documentación no corresponde
a ninguna de las dos.

Además, el encabezado de `mir-actividades-data.js:1-3` declara «121 indicadores · 5 gerencias»
cuando el archivo contiene 123 indicadores en 4 gerencias.

**Pregunta a resolver:** ¿cuál es el universo oficial de indicadores que debe cargarse, y
contra qué archivo Excel se valida?

## 3. Dos catálogos de indicadores con espacios de ID disjuntos

Los dos catálogos usan convenciones de ID incompatibles y **no comparten ni un solo ID**
(verificado: `ids_compartidos_operativos_vs_catalogo_mir: 0`):

| | Catálogo (193) | Operativo (123) |
|---|---|---|
| Formato de ID | `PLA-FIN-001` (3 dígitos) | `PLA-COMP-3` (sin padding) |
| Nombre del indicador | `denominacionIndicador` | `nombreIndicador` |
| Objetivo | `objetivo`, `objetivoResumen` | `resumenNarrativo` |
| Fórmula | `metodoCalculo` + numerador/denominador | numerador/denominador |
| Medio de verificación | `medioVerificacionTipo/Nombre/Fuente` (3 campos) | `medioVerificacion` (1 campo) |
| Nombre de gerencia | `Técnica` | `Gerencia Técnica` |

No hay forma automática de empalmarlos: ni por ID, ni por nombre de indicador. Se exportan
como dos tablas separadas (`indicadores_operativos.csv` y `catalogo_mir_193.csv`).

**Pregunta a resolver:** ¿el catálogo de 193 se descarta, se conserva como histórico, o es
el universo real y el operativo es un subconjunto en curso? Si se conserva, hace falta una
tabla de correspondencia que hoy no existe.

## 4. El prefijo del ID contradice el campo `nivel` en 33 de 123 registros

`estructura-datos-flujo.md:168` documenta el esquema `[GERENCIA]-[NIVEL]-[NUMERO]`, pero en
**33 registros (27%)** el segmento de nivel del ID no coincide con el campo `nivel`:

| ID | Nivel según el ID | Nivel declarado |
|---|---|---|
| `PLA-COMP-3` | Componente | **Propósito** |
| `PLA-ACT-4` | Actividad | **Componente** |
| `COM-COMP-17` | Componente | **Propósito** |
| `COM-ACT-18` | Actividad | **Componente** |

**Consecuencia directa para CA-3:** el ID no puede tratarse como clave natural con significado
semántico. Sirve como identificador opaco (es único y sin duplicados), pero derivar el nivel
de él produciría datos incorrectos en uno de cada cuatro registros. El dataset exporta
`nivel_declarado`, `nivel_segun_prefijo_id` y `nivel_coincide` para que la discrepancia sea
visible por fila.

**Pregunta a resolver (TEC-02):** ¿el ID del prototipo se adopta como clave natural, o se
genera clave propia y el ID queda como referencia externa?

## 5. El nivel Fin no existe en los datos operativos

Los datos operativos tienen 0 indicadores de nivel Fin; la documentación compromete 4.
Probablemente es consecuencia del hallazgo 1 (los Fin vivían en Gerencia General).

**Consecuencia para CA-5:** no hay datos para probar el flujo sobre indicadores de nivel Fin.
También hay 5 Propósito donde la documentación dice 4.

## 6. Las unidades responsables no existen como catálogo

Ninguna fuente tiene un catálogo de unidades. Las **33 unidades** del dataset se derivaron de
los valores de texto libre del campo `unidadResponsable` (operativos) y `area` (gerenciales).

Consecuencias:

- Ninguna unidad tiene confirmación institucional; todas salen marcadas `PENDIENTE`.
- Una unidad (`Coordinación de Política de Ingresos`, Comercial) aparece **solo** en
  indicadores gerenciales, en ninguno operativo.
- No se puede distinguir entre una unidad real y un error de captura en el Excel.
- Hay valores que son el nombre de la gerencia, no de una unidad (p. ej. `unidadResponsable:
  'Gerencia Administrativa'`), lo que sugiere que algunos indicadores no tienen unidad asignada.

**Esto es el bloqueo principal de CA-1.** `unidades.csv` está diseñado para imprimirse y
revisarse: 33 filas con el conteo de indicadores de cada una, para que Planeación Estratégica
confirme, corrija o dé de baja cada renglón.

## 7. El nombre de gerencia se escribe de tres formas

- Catálogo de 193: `Planeación Estratégica`, `Técnica`, `Comercial`, `Administrativa`
- Operativos y gerenciales: `Gerencia de Planeación Estratégica`, `Gerencia Técnica`, …
- Padrón de usuarios: el Administrador trae `Planeación Estratégica` (forma corta) mientras
  los Enlaces de la misma gerencia traen `Gerencia de Planeación Estratégica` (forma larga)

Un cruce por nombre de gerencia falla en silencio. El extractor resuelve las tres formas a una
clave natural (`gerencia_clave`: `planeacion`, `comercial`, `administrativa`, `tecnica`,
`general`) mediante un mapa de alias explícito en `extract.js`, y el manifest reporta en
`nombres_gerencia_sin_alias` cualquier variante nueva que aparezca.

## 8. Cuatro de cinco gerencias no tienen Revisor

El padrón tiene **1 Administrador, 1 Revisor y 33 Enlaces**. El único Revisor
(Carlos Mendoza) está asignado a Gerencia Técnica. Sin Revisor en Planeación, Comercial,
Administrativa y General, **CA-5 no se puede cumplir**: no hay forma de probar que un Revisor
de una gerencia no ve los indicadores de otra.

**Acción propia de TEC-04:** dar de alta al menos un Revisor por gerencia en el padrón de
pruebas. No requiere esperar a nadie, pero sí decidir si se inventan nombres de prueba o se
piden los reales.

## 9. Responsables citados sin cuenta de usuario

Los campos `responsableEnlace` y `responsableRevisor` son texto libre con el nombre de la
persona, no una referencia a la cuenta. De los nombres citados en las fixtures:

- **Revisores sin cuenta:** `Laura Vega`, `Rosario Díaz`, `Miguel Ángel Pérez` (3 de 4)
- **Enlaces sin cuenta:** `Pedro Sánchez` (1 de 4)

Cargado tal cual, el dataset produce referencias huérfanas: indicadores asignados a personas
que no pueden iniciar sesión.

Caso aparte: `Ana Torres` tiene **dos cuentas** (`enlace@comapa.mx` en Comercial y
`enlace.general@comapa.mx` en Gerencia General). Al resolver responsables por nombre, es
ambiguo a cuál de las dos corresponde.

**Nota para TEC-02:** conviene que el responsable sea una referencia a la cuenta de usuario,
no un nombre. Si se conserva como texto, la carga no puede garantizar integridad.

## 10. Los indicadores gerenciales usan esquema y formato de fecha propios

`mir-gerencial-data.js` (32 registros) no sigue el esquema de los operativos:

- La unidad se llama `area`, no `unidadResponsable`.
- **No tiene campo `nivel`** en ninguno de los 32 registros.
- Fechas en formato humano: `fechaLimite: '10 Sep 2026'` frente a `'2026-09-30'` en operativos.
- Periodo en formato humano: `periodo: 'Agosto 2026'` frente a `'T3-2026'` en operativos.
- Admite `unidadMedida: 'MXN'`, valor que no está en el catálogo documentado
  (`Porcentaje`, `Número`, `Variación`).

El dataset los exporta en tabla aparte y conserva los formatos originales sin convertirlos,
para no inventar una semántica (`'Agosto 2026'` ¿equivale a `M08-2026`? ¿a parte de `T3-2026`?).

**Pregunta a resolver (TEC-02):** ¿los indicadores gerenciales son la misma entidad que los
MIR con otra presentación, o una entidad distinta con su propio ciclo?

## 11. Contraseñas en claro en el repositorio

`session.js:1-90` contiene contraseñas de demo en texto plano, versionadas en el repositorio
(tres credenciales compartidas, una por rol). No se reproducen aquí por la nota del ticket.

El extractor **no las exporta**: `usuarios.csv` incluye la columna `password_exportada` fija
en `false`. El dataset define identidad y asignación; la credencial inicial la genera el
procedimiento de carga con bcrypt según CA-2.

Esto no es un hallazgo del dataset sino del prototipo, y queda anotado porque el ticket pide
explícitamente no propagar contraseñas a repositorio o reportes. Vale revisar aparte si esas
credenciales deben salir de `session.js` antes de que el prototipo se exponga fuera del equipo.

---

## Lo que sí quedó limpio

Para no dar una impresión más alarmante que la real:

- **Sin IDs duplicados** en ninguna de las tres fuentes de indicadores.
- **Sin emails duplicados** en el padrón de usuarios.
- **Los estados del dataset operativo son válidos**: solo 4 valores, los cuatro del catálogo
  oficial (`cerrado` 93, `pendiente_carga` 15, `enviado_revision` 11, `observado` 4). Los
  valores fuera de catálogo (`enviado`, `validado`, `aprobado`, `lista`, `incompleto`, …)
  viven únicamente en `demo-data.js` y `validacion-data.js`, que son archivos de demo y no
  alimentan este dataset.
- **Ninguna unidad aparece en más de una gerencia**: la relación gerencia→unidad es limpia.
- **El modelo de la entidad Indicador está bien documentado** en `estructura-datos-flujo.md`,
  campo por campo, incluidos los 9 estados del flujo y las estructuras anidadas.
