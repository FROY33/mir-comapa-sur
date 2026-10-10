# TEC-04 — Inconsistencias del dataset de origen

> Actualizado el 2026-10-10 contra el esquema de TEC-02 (`main` en `c8c3a37`).
> Las cifras salen de `manifest.json`, que se regenera con `node backend/db/semilla/extraer.ts`.

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
| 12 | 6 usuarios sin unidad, pero `unidad_id` es NOT NULL | CA-5 | TEC-04 (propio) |
| 13 | `es_iso` boolean pierde el código ISO de 40 indicadores | — | TEC-02 |
| 14 | Las fixtures asignan T3-2026 a indicadores de otras frecuencias | CA-5 | TEC-04 (propio) |
| 15 | La jerarquía `parent_id` no se deriva por prefijo | CA-1 | Dueño funcional |
| 16 | Frecuencia «Semanal» fuera del catálogo de seis | CA-1 | TEC-02 + dueño funcional |
| 18 | La gerencia del único Revisor contradice a las fixtures | CA-5 | Dueño funcional |
| 19 | No hay ningún reporte en estado `borrador` | CA-5 | TEC-04 (propio) |

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

# Hallazgos al mapear contra el esquema de TEC-02

Los nueve anteriores salieron de comparar las fuentes del prototipo entre sí. Estos salieron de
contrastarlas con las migraciones.

## 12. Seis usuarios no tienen unidad, pero el esquema la exige

`usuarios.unidad_id` es `NOT NULL` y además lleva FK compuesta
`(unidad_id, gerencia_id) REFERENCES unidades(id, gerencia_id)`: todo usuario necesita una unidad
**de su propia gerencia**. Seis cuentas del prototipo no traen unidad, incluida la del
Administrador y la del único Revisor:

`admin@comapa.mx`, `revisor@comapa.mx`, `enlace@comapa.mx`, `enlace.admin@comapa.mx`,
`enlace.planeacion@comapa.mx`, `enlace.tecnica@comapa.mx`

El extractor les asigna la **Coordinación General** de su gerencia y lo marca en la columna
`unidad_por_defecto`, para que la asignación sea auditable y no se confunda con un dato de origen.
Es una decisión reversible, no una confirmación.

Caso aparte: `enlace.general@comapa.mx` tiene unidad `Gerencia General`, que ningún indicador
referencia. El extractor la registra como unidad porque un usuario la cita, y la marca con
`solo_citada_por_usuarios`. Si Gerencia General se da de baja (hallazgo 1), esa cuenta queda sin
gerencia válida.

**Pregunta a resolver:** la pregunta 5 de `../DECISIONES.md` ya está abierta exactamente sobre
esto — «¿El Administrador tiene gerencia y unidad?». La respuesta decide si esto es un arreglo de
datos o un cambio al esquema.

## 13. El esquema no guarda el código ISO

`indicadores.es_iso` es `boolean`. El prototipo trae el **código** ISO en 40 indicadores, no solo
si aplica o no. El extractor conserva el código en la columna de revisión `iso_codigo` para que no
se pierda, pero no hay columna destino.

**Pregunta a resolver (TEC-02):** ¿el código ISO importa para los reportes de transparencia? Si
sí, hace falta una columna; si no, `es_iso` basta y `iso_codigo` queda como insumo histórico.

## 14. Las fixtures asignan un periodo trimestral a indicadores de otras frecuencias

`reportes` lleva FK compuesta `(periodo_id, frecuencia) REFERENCES periodos_reporte(id, frecuencia)`:
**un reporte solo cabe en un periodo de la misma frecuencia que su indicador.** El prototipo
asigna `T3-2026` a los 123 indicadores sin distinguir frecuencia, así que 65 de ellos violarían
esa restricción.

El extractor genera los **28 periodos de 2026** (uno por cada periodo de las seis frecuencias,
con `fecha_limite` contada en días hábiles de lunes a viernes como hace el backend) y reasigna
cada fixture al último periodo de su propia frecuencia que haya concluido al corte `2026-09-30`:

| Reasignación | Indicadores |
|---|---|
| `T3-2026` → `septiembre-2026` (mensual) | 47 |
| `T3-2026` → `2026` (anual) | 9 |
| `T3-2026` → `S1-2026` (semestral) | 6 |
| `T3-2026` → `C2-2026` (cuatrimestral) | 2 |
| `T3-2026` → `B4-2026` (bimestral) | 1 |
| se queda en `T3-2026` (trimestral) | 58 |

Se conserva `periodo_prototipo` en el CSV para auditar el remapeo.

**Pendiente, no resuelto:** los 9 indicadores anuales quedan en el periodo `2026`, que **no ha
concluido** al corte y cuya captura abre el 1 de enero de 2027. Nueve de ellos vienen con estado
`cerrado` en el prototipo, lo cual no es coherente con un periodo en curso. Para probar el flujo
hace falta decidir si los anuales se prueban contra el ejercicio 2025 o si se dejan en
`pendiente_carga`.

## 15. La jerarquía de indicadores no se deriva quitando el último segmento

El esquema modela `indicadores.parent_id`, y la numeración del prototipo parece jerárquica
(`1.2.4`), pero no lo es por prefijo: el nivel intermedio no existe como indicador.

```
Propósito    numero = 1
Componente   numero = 1.2.1     ← no existe un '1.2'
Actividad    numero = 1.2.2     ← hermana del componente, no su hija por prefijo
Actividad    numero = 1.2.3
```

La regla real, inferida de la estructura observada en las cuatro gerencias:

- actividad `a.b.c` → componente `a.b.1`
- componente `a.b.1` → propósito `a`

Con esa regla se resuelven **116 de 155** indicadores (los 39 restantes son los 5 propósitos, los
32 gerenciales sin nivel y 2 fuera de patrón), sin un solo huérfano.

**Advertencia:** la regla está inferida de los datos, **no confirmada por el RQM**. Si el Excel
oficial numera distinto, la jerarquía cargada queda mal. Vale confirmarla junto con la pregunta
24f de `../DECISIONES.md` («¿cuál es el 3.1 correcto en Técnica?»), que apunta al mismo problema
de numeración.

## 16. Una frecuencia fuera del catálogo de seis

`COM-ACT-012`, en el catálogo de 193, tiene `frecuenciaMedicion: 'Semanal'`. El catálogo
`frecuencias` del esquema admite seis valores y «semanal» no es uno
(`CHECK (clave IN ('mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual'))`).

No bloquea hoy porque ese indicador no está entre los 123 operativos. **Sí bloquea si el catálogo
de 193 resulta ser el universo oficial** (hallazgo 2): cargarlo exigiría una migración que agregue
`semanal` al catálogo y a `frecuencias.meses`, donde no encaja — el CHECK de `meses` admite
`(1, 2, 3, 4, 6, 12)` y una semana no es un número de meses.

## 17. Dos indicadores con `tipo_indicador` mal capturado

- `COM-ACT-36` trae `tipo_indicador: 'Porcentaje'` — la unidad de medida en el campo equivocado.
  Violaría `CHECK (tipo_indicador IN ('estrategico', 'gestion'))`.
- `COM-ACT-26` lo trae vacío.

La columna acepta `NULL`, así que el extractor deja ambos vacíos y los reporta en
`manifest.json` → `pendientes.tipo_indicador_vacio`. Son dos correcciones de captura en el Excel,
no un problema de modelo.

## 18. La gerencia del único Revisor contradice a las fixtures

`session.js` registra a Carlos Mendoza (`revisor@comapa.mx`) en **Gerencia Técnica**. Pero las
fixtures lo ponen revisando los **14 indicadores de Planeación Estratégica**, y a Técnica le
asignan a Miguel Ángel Pérez. El reparto que implican las fixtures es uno por gerencia:

| Gerencia | Revisor según las fixtures | Indicadores | ¿Tenía cuenta? |
|---|---|---|---|
| PLA | Carlos Mendoza | 14 | sí, pero registrada en TEC |
| COM | Rosario Díaz | 24 | no |
| ADM | Laura Vega | 43 | no |
| TEC | Miguel Ángel Pérez | 40 | no |

Cargado tal cual, **PLA queda sin Revisor y TEC con dos**, y CA-5 no se puede cumplir: no hay con
quién probar el aislamiento de Planeación.

Las fixtures son internamente consistentes (un revisor por gerencia, sin traslapes) y `session.js`
no, así que el extractor trata a `session.js` como el dato viejo: `usuarios_prueba.csv` corrige la
gerencia de `revisor@comapa.mx` a PLA, con el motivo escrito en la propia fila. Es un override
explícito y auditable, no una confirmación.

**Pregunta a resolver:** ¿Carlos Mendoza revisa Planeación o Técnica? Si es Técnica, entonces
faltan cuatro revisores y no tres, y las fixtures están mal asignadas.

## 19. No hay ningún reporte en estado `borrador`

CA-5 pide datos suficientes para probar los estados «pendiente, borrador y observado». Los 123
reportes del prototipo cubren cuatro estados y **`borrador` no es uno**:

| Estado | Reportes |
|---|---|
| `cerrado` | 93 |
| `pendiente_carga` | 15 |
| `enviado_revision` | 11 |
| `observado` | 4 |
| `borrador` | **0** |

`estructura-datos-flujo.md:62` explica por qué: `pendiente_carga` se *presenta* como «borrador» en
la interfaz, y `borrador` real significa que el Enlace ya registró el avance del periodo sin
enviarlo. Ningún registro del prototipo está en ese punto intermedio.

No se inventó: las fixtures reproducen lo que trae el prototipo. Para cerrar CA-5 al pie de la
letra hacen falta unos pocos reportes en `borrador`, y por ser fixtures de prueba («preparar
fixtures de ciclos/reportes solo para pruebas») agregarlos está dentro del alcance del ticket.
Es una línea en `fixtures_reportes.csv`, pero cambia datos que hoy salen del prototipo, así que
queda a decisión de quién cierra el ticket.


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
- **Los cuatro estados del prototipo son válidos** contra el CHECK de `reportes.estado`, que
  admite nueve.
- **Las seis frecuencias de los 123 operativos están todas en el catálogo** del esquema: el
  mapeo a minúsculas es limpio y no hay ninguna fuera (la excepción «Semanal» es del catálogo
  de 193, hallazgo 16).
- **Ni una colisión de `codigo`** entre los 123 MIR y los 32 gerenciales, que comparten la
  restricción `UNIQUE` global.
- **Integridad referencial completa** tras el mapeo: toda `gerencia_clave`, toda unidad, todo
  `parent_codigo` y todo `indicador_codigo` de las fixtures resuelven contra su tabla. Verificado
  en cada corrida (`manifest.json` → `integridad`).
- **Cada gerencia activa tiene exactamente una Coordinación General**, que es lo que exige el
  índice único parcial `unidades_una_coord_general`.
- **La carga pasa contra el esquema real**: las 9 migraciones aplicadas, 155 indicadores, 39
  usuarios, 28 periodos y 123 reportes entran sin violar una sola restricción, y correrla dos
  veces deja los mismos conteos y los mismos hashes (CA-3 verificado en
  `backend/pruebas/semilla.test.ts`).
