# Decisiones del modelo de datos — COMAPA MIR

Registro de lo decidido para TEC-01 y TEC-02 y de lo que sigue abierto. Cuando una pregunta se resuelve,
pasa a la primera tabla con su fuente y su fecha.

**Fuentes:** RQM v1.1 (02/10/2026), Figma, prototipo (`mir-comapa-sur`), documento «Flujos de datos y
arquitectura de base de datos» (08/10/2026) y respuestas del equipo.

## Decididas

| Tema | Decisión | Fuente | Efecto en la base |
|---|---|---|---|
| Motor y stack | **PostgreSQL 14+**; backend **Node.js + TypeScript**; migraciones en SQL puro (formato dbmate) | Equipo con el arquitecto, 08/10/2026 | Descartados: MySQL (sin DDL transaccional, índices parciales ni variables de sesión), SQLite (el ticket y el RQM piden PG o MySQL; escalado horizontal; ALTER TABLE limitado) y Rust (RNF de mantenibilidad del RQM) |
| Asignación de indicadores | A la **gerencia**; cualquier Enlace de la gerencia reporta; la unidad es informativa | RQM v1.1 HU-R1-01 RN_1, HU-R4-11 RN_1, HU-R7-07 RN_1; equipo 08/10/2026 | `usuarios` con una gerencia y una unidad; sin USUARIO_GERENCIAS |
| Cierre | El Admin valida por **gerencia y corte mensual**, con documento firmado por el Revisor | Prototipo; confirmado por diseño 08/10/2026 | VALIDACIONES_PERIODO con llave (gerencia_id, corte); `periodos_reporte.fin_periodo` define el corte |
| Lo no aprobado al validar | Se cierra como **incumplido** | Diseño (Fran), 08/10/2026 | Estado final `incumplido` |
| El Revisor envía con indicadores sin aprobar | Sí, con aviso | Diseño (Fran), 08/10/2026 | Sin restricción en la base |
| Captura fuera de plazo | Se puede enviar; el reporte queda marcado **vencido** (extemporáneo) | RQM HU-R1-08; diseño (Fran), 08/10/2026 — *por confirmar con Adolf* | `vencido` + `vencido_at` como marca, no como estado; se corrige el texto de Configuración |
| El Admin regresa indicadores | Sí, con observación | Diseño (Fran), 08/10/2026 | Estado `regresado_correccion` |
| Estado vive en el reporte | El estado está en REPORTES, nunca en INDICADORES | RQM, TEC-02 CA-4 | `reportes.estado` |
| Reporte lógico único | Un reporte por indicador y periodo; los intentos van aparte | TEC-01 CA-3 (manda sobre «última fila» del RQM) | UNIQUE (indicador_id, periodo_id); REPORTE_VERSIONES después |
| Configuración histórica | Foto del indicador al crear el reporte; congelado de meta, cumplimiento y semáforo al cerrar | RQM HU-R4-11 CA_4, HU-R3-03 CA_4, HU-R4-12 CA_4 | Columnas de foto y de cierre en `reportes`; sin REPORTES_PERIODO |
| Bloqueo de cerrados | Un reporte cerrado o incumplido solo cambia por override o reapertura autorizados | RQM HU-R3-03 RN_3, HU-R3-04 | Trigger + `SET LOCAL app.reapertura = 'on'` |
| Catálogos de valores | `text` + `CHECK`, no enums nativos | Revisión del modelo | Cambiar un valor es una migración de una línea |
| Capa HTTP | `node:http` sin framework; el framework se decide en el ticket de autenticación si hace falta | Equipo, 08/10/2026 (TEC-03) | Ninguno; la capa de datos (`src/bd.ts`) no depende de la capa HTTP |
| Frecuencias | Seis: mensual, bimestral, trimestral, cuatrimestral, semestral, anual | RQM glosario; datos reales | Catálogo `frecuencias` |
| Bloqueo por intentos (R7-06) | Se cuenta por correo, exista o no; durante el bloqueo los fallos no suman ni lo alargan; al vencer, la cuenta empieza de 1; el Admin desbloquea y queda en la bitácora | RQM HU-R7-06; implementación 09/10/2026 | `login_intentos` sin FK; eventos `cuenta_bloqueada` y `cuenta_desbloqueada` con `entidad = 'acceso'` |
| Versiones del indicador (CA-3) | Tabla `indicador_versiones` a la que apunta cada reporte (`definicion` jsonb con la fila completa + gerencia y unidad en columnas). Una versión se congela cuando un reporte la usa; antes, editar la actualiza en su lugar. La foto de S1 en `reportes` se queda | Propuesta de arquitectura aprobada por el equipo, 14/10/2026 | `indicador_versiones`; `reportes.indicador_version_id` NOT NULL, fija |
| Medio de verificación | **Uno** por indicador, de un catálogo | Equipo, 14/10/2026 | `medios_verificacion`; `indicadores.medio_verificacion_id`; el texto se queda en transición |
| Apertura de ciclos (R3-01) — supuesto | Abrir el periodo siguiente no cierra el anterior; sigue abierto hasta que el Admin lo cierre (R3-05). Solo se abre el periodo más reciente por frecuencia y solo si su ventana sigue corriendo. Días hábiles de lunes a viernes, sin festivos | RQM HU-R3-01 RN_2 se contradice («un ciclo abierto por frecuencia» y «el siguiente se abre aunque el anterior siga abierto»): **confirmar con el Product Owner**; pregunta 8 | Job en `src/datos/ciclos.ts`; `periodos_reporte.fecha_limite` se fija al abrir |
| Vigencia futura de cambios al indicador (HU-R4-11 CA_4) | **Tabla aparte `indicador_cambios_programados`**, no `vigente_desde_periodo` en INDICADORES (RQM). Una columna solo dice *cuándo* aplica el cambio, no *qué* valores nuevos lleva; la tabla guarda los valores pendientes, conserva la historia y permite cancelar un cambio programado | Froy (Arquitectura), 14/10/2026; PRD0_0 pregunta 6 | Tabla nueva; `indicadores` no cambia. Los cambios se aplican en la transacción que abre el siguiente periodo de la frecuencia o un ciclo de planeación. Desviación anotada en `EXTENSION.md` |
| Catálogo administrable sobre el modelo de S2-TEC-01 (HU-R4-11) | Convive con `indicador_versiones`: las versiones conservan la definición que usó cada reporte o meta (ticket 1 CA-3); `indicador_cambios_programados` decide **cuándo** llega al indicador un cambio de gerencia, frecuencia, cálculo o acumulable (ticket 3 CA_4). Al aplicarse, el trigger crea la versión nueva. Cada meta apunta a su versión, como cada reporte, y una versión usada por una meta también queda congelada. Los triggers que versionan y alinean el medio corren como dueño (`SECURITY DEFINER`), así la app edita indicadores sin escribir esas tablas | Froy, 15/10/2026, al integrar los tickets 2 y 3 sobre el modelo de grzlz | Migración `20261015000001_catalogo_sobre_versiones.sql`; `metas_planeacion.indicador_version_id` |
| Catálogo oficial: 123 o 132 indicadores (T2 CA-1) | **123 MIR por ahora** (el CSV institucional del 14/09/2026). **Diferencia autorizada por la PO** frente a los 132 de `proyecto.md` y el RQM (PLA 14/15, COM 24/29, ADM 43/46, TEC 40/41, GEN 2/0). Provisional: se revisa si aparecen los 9 restantes | PO, 14/10/2026; fuente: `2026.09.14-MIR-COMAPA_UNIFICADA.csv` | Se carga lo que trae el CSV (123 MIR + 32 gerenciales); `CONCILIACION.md` lo registra |
| Niveles MIR (1 Fin, 1 Propósito, 4 Componente, 117 Actividad) | **El CSV es la fuente de verdad por ahora**, no la distribución de `proyecto.md` (4/4/30/94). Ver también la pregunta 24a | Froy, 14/10/2026; issue 002 | `indicadores.nivel` se carga del CSV sin ajustes |
| `Tipo indicador` de los ids 26 y 36 del CSV | **Gestión** en ambos. El 26 viene vacío; el 36 dice «Porcentaje» (su unidad de medida) | Froy, 14/10/2026; issue 002 | `importar-csv-unificada.ts` aplica `gestion` solo mientras el CSV no traiga un valor válido; `CONCILIACION.md` lo lista como corrección autorizada, no como discrepancia |
| Medio de verificación de los 32 gerenciales (HU-R4-11 CA_2) | **(a) Obligatorio solo para los MIR.** Los gerenciales pueden quedar sin medio. Sustituye la opción (b) elegida antes el mismo día | Froy, 14/10/2026 | `indicadores.medio_verificacion_id` nula en gerenciales sin medio, sin pendiente; la API lo exige solo si `tipo = 'mir'` |
| «Reactivar indicador» (fuera del RQM) | **Se mantiene** | Froy, 14/10/2026; issue 002 | Sin cambios: API, pantalla y bitácora ya existen (ticket 3) |
| S2-TEC-02 CA-4 (datos desde la base, sin arrays) | **Se cierra con CA-4a** (pantalla del catálogo). CA-4b (las demás pantallas que leen `mir-actividades-data.js`) se cumple en los tickets 5 y 10 | Froy, 14/10/2026; issue 002 | El ticket 2 no espera a los tickets 5 y 10 |
| Carga del catálogo y recargas (S2-TEC-02, HU-R4-11 RN_4) | `sembrar.sh --catalogo` se corre **una sola vez**: registra `catalogo_importado` y con ese evento se niega. `--forzar` repite la carga sin sobrescribir lo que el Administrador editó (desde la primera carga) y lo lista. El sembrado normal deja de escribir indicadores una vez importado el catálogo. Los MIR del prototipo sin equivalente se desactivan, no se borran | Implementación 15/10/2026; issue 009 | `datos/equivalencias_prototipo.csv` (121 renombrados, 2 sin equivalente); evento `catalogo_importado` en la bitácora |
| Mantenimiento del catálogo de medios de verificación (S2-TEC-03, ticket 4) | **Se amplía el modelo de permisos de 20261015000001:** ya no solo el trigger-dueño escribe `medios_verificacion`; la app gana `INSERT, UPDATE` (nunca `DELETE`) porque el Administrador tiene su propia pantalla de alta/renombre/desactivación, con bitácora (`entidad = 'medio_verificacion'`). Un trigger nuevo (`medios_verificacion_propagar`) lleva el renombre al texto heredado (`indicadores.medio_verificacion`) de quien ya usa ese medio. La normalización (`medio_normalizado`) se endurece para ignorar también la puntuación final, no solo mayúsculas y espacios: el CSV institucional trae un casi-duplicado real que solo difiere en un punto («…firmados» / «…firmados.») | Equipo, 15/10/2026, al confirmar el alcance del ticket 4 | `20261015000003_medios_verificacion_mantenimiento.sql`; `permisos.test.ts` ya no exige que el INSERT directo falle |

## Supuestos de S1 (confirmar)

Tomados para poder migrar; cambiarlos es barato.

| Supuesto | Dónde | Pregunta |
|---|---|---|
| Roles: admin, revisor, enlace | `usuarios.rol` | 3 |
| Semáforo configurable por indicador, 95/80 por defecto | `indicadores.rango_*` | 20 |
| `sentido_meta`: ascendente o descendente | `indicadores.sentido_meta` | 24e |
| El Admin también tiene gerencia y unidad | `usuarios` | 5 |
| Zona horaria de la sesión: `America/Monterrey` (Tamaulipas, sin horario de verano) | `backend/src/bd.ts` | — |
| Consulta MIR (HU-R8-01 CA_2): cada indicador muestra el reporte de su periodo abierto más reciente; si no tiene ninguno abierto, el del último cerrado. Con varias frecuencias abiertas, cada uno va con la suya | `src/datos/consultaMir.ts` | Ficha R8-01: «cómo elegir periodo con varias frecuencias abiertas» |
| Consulta MIR (CA_4): un reporte en `pendiente_carga` o `borrador` no cuenta como «reporte en el periodo»: N/A y su avance no se muestra. El % usa las reglas de HU-R4-11 RN_3 (acumulable, fracción), que extienden la fórmula simple de CA_4 | `src/datos/consultaMir.ts` | ¿El Revisor ve el avance de un borrador? (Recomendación: no, como las metas, HU-R4-03 RN_1) |
| Consulta MIR solo lista MIR (`tipo = 'mir'`); los gerenciales no entran (el RQM no los menciona y el prototipo no los tenía ahí). Los desactivados sí, marcados (HU-R4-11 CA_5) | `src/datos/consultaMir.ts` | **PO:** el Revisor no tiene hoy ninguna pantalla donde ver los gerenciales de su gerencia; ¿dónde deben verse? |
| Meta anual de la Consulta MIR: la de la meta `meta_validada` vigente del ejercicio del periodo mostrado; sin meta validada, «—» | `src/datos/consultaMir.ts` | — |

## Abiertas

Numeradas como en la lista enviada al equipo. Ninguna bloquea las migraciones de S1.

**Regla general**

2. Cuando el RQM y el prototipo no coinciden, ¿cuál manda? *Recomendación: el RQM, y el prototipo solo en una lista explícita.*

**Usuarios y acceso**

3. ¿Entra el rol «Solo lectura»?
4. ¿El «doble rol» (Revisor que entra como Enlace) existe en producción? *Recomendación: no.*
5. ¿El Administrador tiene gerencia y unidad? ¿«Dirección General» o «Gerencia General»?

**Reporte de avance**

7. ¿La ventana de captura de un mes reporta ese mes o el anterior?
8. ¿Días hábiles con calendario de festivos o solo lunes a viernes?
9. Evidencia: 10 MB y PDF/JPG/PNG obligatoria (RQM), o 20 MB con Excel/Word y opción «sin evidencia» con justificación (Figma). ¿Mínimo de caracteres de la justificación?
10. Campos del paso 3 (análisis). ¿Se queda «Toma de decisiones»?
11. ¿Existe la opción «Sin avance»?

**Revisión**

12. ¿El Revisor puede retirar una observación antes de la respuesta? *Recomendación: sí, anulándola.*
13. ¿Puede «aprobar de todas formas» con observaciones abiertas?
14. ¿Mínimo de caracteres de una observación?

**Cierre**

15. ¿Los indicadores gerenciales entran en el corte de la gerencia?
18. ¿Se puede reabrir un corte validado? ¿Qué pasa con el PDF firmado?
19. Override del Admin: ¿fuerza el estado, el valor o ambos?
20. ¿Semáforo global o por indicador?

**Metas**

21. ¿Un cambio de meta recalcula periodos cerrados? *Recomendación: no (RQM HU-R4-12 CA_4).*
22. ¿El Admin «fija» la meta tras la aprobación del Revisor? ¿Puede editarla o desbloquearla? En un cambio, ¿el Revisor solo da visto bueno?
23. ¿Para enviar una meta se capturan todos los periodos o basta uno?

**Catálogo (para COMAPA; afecta la carga inicial)**

24. a) ¿El Fin repetido en los 4 Excel es uno o cuatro indicadores? b) ¿Los 20 indicadores sin meta anual la tienen? c) ¿Las metas de dos variables se separan? d) ¿Todo en escala de 100? e) ¿Qué indicadores son descendentes o de rango? f) ¿Cuál es el 3.1 correcto en Técnica? g) ¿32 o 49 indicadores gerenciales y de dónde sale el catálogo?
