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
| Apertura de ciclos (R3-01) — supuesto | Abrir el periodo siguiente no cierra el anterior; sigue abierto hasta que el Admin lo cierre (R3-05). Solo se abre el periodo más reciente por frecuencia y solo si su ventana sigue corriendo. Días hábiles de lunes a viernes, sin festivos | RQM HU-R3-01 RN_2 se contradice («un ciclo abierto por frecuencia» y «el siguiente se abre aunque el anterior siga abierto»): **confirmar con el Product Owner**; pregunta 8 | Job en `src/datos/ciclos.ts`; `periodos_reporte.fecha_limite` se fija al abrir |

## Supuestos de S1 (confirmar)

Tomados para poder migrar; cambiarlos es barato.

| Supuesto | Dónde | Pregunta |
|---|---|---|
| Roles: admin, revisor, enlace | `usuarios.rol` | 3 |
| Semáforo configurable por indicador, 95/80 por defecto | `indicadores.rango_*` | 20 |
| `sentido_meta`: ascendente o descendente | `indicadores.sentido_meta` | 24e |
| El Admin también tiene gerencia y unidad | `usuarios` | 5 |
| Zona horaria de la sesión: `America/Monterrey` (Tamaulipas, sin horario de verano) | `backend/src/bd.ts` | — |

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
