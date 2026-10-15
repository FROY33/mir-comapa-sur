# Reporte de conciliación — Catálogo MIR institucional

> Fuente: `2026.09.14-MIR-COMAPA_UNIFICADA.csv` (sha256 1ff29b403d3dcf3b…)

## Resumen

| Concepto | Valor |
|---|---|
| Indicadores MIR en CSV | **123** |
| Indicadores gerenciales (conservados) | 32 |
| Total en indicadores.csv | 155 |
| Esperados según proyecto.md | 132 MIR |
| **Diferencia** | **-9** (faltan 9) |

## Distribución por gerencia

| Gerencia | MIR CSV | proyecto.md |
|---|---|---|
| GEN | 2 | 0 (no documentada) |
| PLA | 14 | 15 |
| COM | 24 | 29 |
| ADM | 43 | 46 |
| TEC | 40 | 41 |
| **Total** | **123** | **132** |

## Distribución por nivel

| Nivel | MIR CSV | proyecto.md |
|---|---|---|
| Fin | 1 | 4 |
| Propósito | 1 | 4 |
| Componente | 4 | 30 |
| Actividad | 117 | 94 |
| **Total** | **123** | **132** |

## Distribución por frecuencia

| Frecuencia | Cantidad |
|---|---|
| anual | 10 |
| bimestral | 1 |
| cuatrimestral | 2 |
| mensual | 47 |
| semestral | 6 |
| trimestral | 57 |

## Distribución por tipo de indicador

| Tipo | Cantidad |
|---|---|
| estrategico | 5 |
| gestion | 118 |

## Jerarquía

| Concepto | Cantidad |
|---|---|
| Con parent_codigo asignado | 117 |
| Sin parent_codigo | 6 |

## Carga sobre la base del sprint 1

`npm run bd:importar-catalogo` solo genera los CSV. Cargarlos sobre una base del sprint 1 lo hace
`db/sembrar.sh --catalogo`: renombra cada MIR del prototipo a su código institucional (mismo `id`, así
que sus reportes se conservan), hace upsert por código, desactiva sin borrar los que no tienen
equivalente y registra `catalogo_importado` en la bitácora (conteos y sha256 de `indicadores.csv`).
Una vez registrado no se repite: solo `--catalogo --forzar`, que no sobrescribe lo que el Administrador
editó desde la pantalla y lo lista al terminar. `Meta` y `Linea base` del CSV no se cargan (tabla METAS).

| Concepto | Cantidad |
|---|---|
| MIR del prototipo | 123 |
| Renombrados al código institucional | 121 |
| Sin equivalente (se desactivan, no se borran) | 2 |
| MIR institucionales sin MIR del prototipo (se insertan) | 2 |

- Sin equivalente: `ADM-PROP-124` (ADM, proposito) «Porcentaje de ejecución del presupuesto administrativo autorizado»
- Sin equivalente: `COM-ACT-125` (COM, actividad) «Porcentaje de metas ejecutadas»

## Pantallas que aún usan arreglos hardcodeados (CA-4b)

La pantalla del catálogo (`estructura-indicadores.html`) ya lee de la base (CA-4a). Las demás siguen con
`mir-actividades-data.js` o `planeacion-data.js`; cada una se resuelve en el ticket que la reemplaza:

| Pantallas | Arreglo | Ticket dueño |
|---|---|---|
| `planeacion-metas-admin`, `planeacion-metas-enlace`, `planeacion-metas-revisor`, `planeacion-enlace`, `mis-actividades`, `reportes`, `reportes-revisor` | `planeacion-data.js` (y `mir-actividades-data.js`) | 10 |
| `dashboard-admin`, `dashboard-enlace`, `dashboard-revisor`, `detalle-actividad`, `detalle-gerencia`, `detalle-indicador-gerencial`, `bandeja-revision`, `historial-revisor`, `mis-observaciones`, `revision-actividad`, `validacion-admin-dashboard`, `validacion-gerencia-detalle`, `planeacion-mir`, `login` | `mir-actividades-data.js` | 5 |

La lista de metas pendientes del Enlace es el ticket 9 (`issues/011`).

## Códigos generados

Formato: `{GERENCIA}-{NUMERO_INDICADOR}` (e.g. `PLA-1.1.1`, `GEN-FIN`)

Los códigos se derivan del campo "Número indicador" del CSV institucional,
reemplazando los códigos del prototipo (`ADM-ACT-42`, etc.) que tenían
inconsistencias documentadas (INCONSISTENCIAS.md §4).

## Fixtures de reporte

Las fixtures (`datos/fixtures_reportes.csv`) se reasignan a los códigos nuevos conservando
gerencia y estado del flujo; también frecuencia y periodo, salvo en las sustituidas que se listan.
`indicador_codigo_prototipo` guarda el código original.

| Concepto | Cantidad |
|---|---|
| Por número de indicador | 121 |
| Por nombre (misma gerencia y frecuencia) | 0 |
| Sustituidas por otro indicador de la misma gerencia | 2 |
| Descartadas | 0 |
| **Total cargadas** | **123** |

- Sustituida: ADM-PROP-124 → GER-ADM-001 (pendiente_carga): «Porcentaje de ejecución del presupuesto administrativo autorizado» anual → «Saldo en bancos» mensual
- Sustituida: COM-ACT-125 → GER-COM-003 (borrador): «Porcentaje de metas ejecutadas» trimestral → «Eficiencia de micromedición» mensual

## Correcciones autorizadas (2)

Valores vacíos o inválidos en el CSV resueltos por Froy el 14/10/2026 (ver `DECISIONES.md`).

| Id | Campo | Valor en el CSV | Corrección |
|---|---|---|---|
| 26 | Tipo indicador | (vacío) | «Porcentaje de cambios de tarifa» → gestion |
| 36 | Tipo indicador | Porcentaje | «Atención a la Industria y el Comercio» → gestion |

## Campos sin datos en el CSV fuente

Los siguientes campos están vacíos en **todos** los registros del CSV:

- **Linea base** — pendiente para tabla METAS (fuera de S1)
- **Meta** — pendiente para tabla METAS (fuera de S1)
- **Metas mensuales** (Enero–Diciembre) — pendiente para tabla METAS
- **Observaciones** — ningún registro tiene observaciones

## Decisiones sobre el catálogo

Registradas en `DECISIONES.md` (Froy, 14/10/2026):

1. **Total:** el catálogo oficial es el del CSV (123 MIR) por ahora; diferencia autorizada frente a los 132 de proyecto.md.
2. **Niveles:** el CSV es la fuente de verdad por ahora, frente a la distribución de proyecto.md.

---
*Archivo generado por importar-csv-unificada.ts — no editar manualmente.*
