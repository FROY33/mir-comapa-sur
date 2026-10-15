// Reporte CONCILIACION.md del catálogo institucional (TEC-04, S2-TEC-02). Lo genera
// importar-csv-unificada.ts; aquí vive el texto y los tipos de lo que se concilia.

import path from 'node:path'

export interface Discrepancia {
  id: string
  campo: string
  valor: string
  detalle: string
}

export interface Reasignacion {
  fixtures: Record<string, string>[]
  porNumero: number
  porNombre: number
  sustituidas: string[]
  descartadas: string[]
}

export interface Equivalencia {
  codigo_prototipo: string
  codigo: string
  gerencia_clave: string
  nivel: string
  nombre: string
  estado: 'renombrado' | 'sin_equivalente'
}

// ── Reporte de conciliación ─────────────────────────────────────────────────

export function generarConciliacion(
  csvPath: string,
  mir: Record<string, unknown>[],
  gerenciales: Record<string, unknown>[],
  discrepancias: Discrepancia[],
  correcciones: Discrepancia[],
  advertencias: string[],
  reasignacion: Reasignacion,
  equivalencias: Equivalencia[],
  fuenteSha: string,
): string {
  const total = mir.length + gerenciales.length
  const porGerencia: Record<string, number> = {}
  const porNivel: Record<string, number> = {}
  const porFrecuencia: Record<string, number> = {}
  const porTipo: Record<string, number> = {}

  for (const i of mir) {
    const g = i.gerencia_clave as string
    const n = i.nivel as string
    const f = i.frecuencia as string
    const t = i.tipo_indicador as string || '(vacío)'
    porGerencia[g] = (porGerencia[g] ?? 0) + 1
    porNivel[n] = (porNivel[n] ?? 0) + 1
    porFrecuencia[f] = (porFrecuencia[f] ?? 0) + 1
    porTipo[t] = (porTipo[t] ?? 0) + 1
  }

  const conParent = mir.filter(i => i.parent_codigo).length
  const sinEquivalente = equivalencias.filter(e => !e.codigo)
  const ligados = new Set(equivalencias.map(e => e.codigo))
  const nuevos = mir.filter(i => !ligados.has(i.codigo as string)).length
  const sinTipoInd = mir.filter(i => !i.tipo_indicador).length

  const lineas: string[] = [
    `# Reporte de conciliación — Catálogo MIR institucional`,
    ``,
    `> Fuente: \`${path.basename(csvPath)}\` (sha256 ${fuenteSha.slice(0, 16)}…)`,
    ``,
    `## Resumen`,
    ``,
    `| Concepto | Valor |`,
    `|---|---|`,
    `| Indicadores MIR en CSV | **${mir.length}** |`,
    `| Indicadores gerenciales (conservados) | ${gerenciales.length} |`,
    `| Total en indicadores.csv | ${total} |`,
    `| Esperados según proyecto.md | 132 MIR |`,
    `| **Diferencia** | **${mir.length - 132}** (${mir.length < 132 ? 'faltan ' + (132 - mir.length) : 'sobran ' + (mir.length - 132)}) |`,
    ``,
    `## Distribución por gerencia`,
    ``,
    `| Gerencia | MIR CSV | proyecto.md |`,
    `|---|---|---|`,
    `| GEN | ${porGerencia['GEN'] ?? 0} | 0 (no documentada) |`,
    `| PLA | ${porGerencia['PLA'] ?? 0} | 15 |`,
    `| COM | ${porGerencia['COM'] ?? 0} | 29 |`,
    `| ADM | ${porGerencia['ADM'] ?? 0} | 46 |`,
    `| TEC | ${porGerencia['TEC'] ?? 0} | 41 |`,
    `| **Total** | **${mir.length}** | **132** |`,
    ``,
    `## Distribución por nivel`,
    ``,
    `| Nivel | MIR CSV | proyecto.md |`,
    `|---|---|---|`,
    `| Fin | ${porNivel['fin'] ?? 0} | 4 |`,
    `| Propósito | ${porNivel['proposito'] ?? 0} | 4 |`,
    `| Componente | ${porNivel['componente'] ?? 0} | 30 |`,
    `| Actividad | ${porNivel['actividad'] ?? 0} | 94 |`,
    `| **Total** | **${mir.length}** | **132** |`,
    ``,
    `## Distribución por frecuencia`,
    ``,
    `| Frecuencia | Cantidad |`,
    `|---|---|`,
    ...Object.entries(porFrecuencia).sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `| ${f} | ${n} |`),
    ``,
    `## Distribución por tipo de indicador`,
    ``,
    `| Tipo | Cantidad |`,
    `|---|---|`,
    ...Object.entries(porTipo).sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `| ${t} | ${n} |`),
    ``,
    `## Jerarquía`,
    ``,
    `| Concepto | Cantidad |`,
    `|---|---|`,
    `| Con parent_codigo asignado | ${conParent} |`,
    `| Sin parent_codigo | ${mir.length - conParent} |`,
    ``,
    `## Carga sobre la base del sprint 1`,
    ``,
    `\`npm run bd:importar-catalogo\` solo genera los CSV. Cargarlos sobre una base del sprint 1 lo hace`,
    `\`db/sembrar.sh --catalogo\`: renombra cada MIR del prototipo a su código institucional (mismo \`id\`, así`,
    `que sus reportes se conservan), hace upsert por código, desactiva sin borrar los que no tienen`,
    `equivalente y registra \`catalogo_importado\` en la bitácora (conteos y sha256 de \`indicadores.csv\`).`,
    `Una vez registrado no se repite: solo \`--catalogo --forzar\`, que no sobrescribe lo que el Administrador`,
    `editó desde la pantalla y lo lista al terminar. \`Meta\` y \`Linea base\` del CSV no se cargan (tabla METAS).`,
    ``,
    `| Concepto | Cantidad |`,
    `|---|---|`,
    `| MIR del prototipo | ${equivalencias.length} |`,
    `| Renombrados al código institucional | ${equivalencias.filter(e => e.codigo).length} |`,
    `| Sin equivalente (se desactivan, no se borran) | ${sinEquivalente.length} |`,
    `| MIR institucionales sin MIR del prototipo (se insertan) | ${nuevos} |`,
    ``,
    ...sinEquivalente.map(e => `- Sin equivalente: \`${e.codigo_prototipo}\` (${e.gerencia_clave}, ${e.nivel}) «${e.nombre}»`),
    ...(sinEquivalente.length > 0 ? [``] : []),
    `## Pantallas que aún usan arreglos hardcodeados (CA-4b)`,
    ``,
    `La pantalla del catálogo (\`estructura-indicadores.html\`) ya lee de la base (CA-4a). Las demás siguen con`,
    `\`mir-actividades-data.js\` o \`planeacion-data.js\`; cada una se resuelve en el ticket que la reemplaza:`,
    ``,
    `| Pantallas | Arreglo | Ticket dueño |`,
    `|---|---|---|`,
    `| \`planeacion-metas-admin\`, \`planeacion-metas-enlace\`, \`planeacion-metas-revisor\`, \`planeacion-enlace\`, \`mis-actividades\`, \`reportes\`, \`reportes-revisor\` | \`planeacion-data.js\` (y \`mir-actividades-data.js\`) | 10 |`,
    `| \`dashboard-admin\`, \`dashboard-enlace\`, \`dashboard-revisor\`, \`detalle-actividad\`, \`detalle-gerencia\`, \`detalle-indicador-gerencial\`, \`bandeja-revision\`, \`historial-revisor\`, \`mis-observaciones\`, \`revision-actividad\`, \`validacion-admin-dashboard\`, \`validacion-gerencia-detalle\`, \`planeacion-mir\`, \`login\` | \`mir-actividades-data.js\` | 5 |`,
    ``,
    `La lista de metas pendientes del Enlace es el ticket 9 (\`issues/011\`).`,
    ``,
    `## Códigos generados`,
    ``,
    `Formato: \`{GERENCIA}-{NUMERO_INDICADOR}\` (e.g. \`PLA-1.1.1\`, \`GEN-FIN\`)`,
    ``,
    `Los códigos se derivan del campo "Número indicador" del CSV institucional,`,
    `reemplazando los códigos del prototipo (\`ADM-ACT-42\`, etc.) que tenían`,
    `inconsistencias documentadas (INCONSISTENCIAS.md §4).`,
    ``,
    `## Fixtures de reporte`,
    ``,
    `Las fixtures (\`datos/fixtures_reportes.csv\`) se reasignan a los códigos nuevos conservando`,
    `gerencia y estado del flujo; también frecuencia y periodo, salvo en las sustituidas que se listan.`,
    `\`indicador_codigo_prototipo\` guarda el código original.`,
    ``,
    `| Concepto | Cantidad |`,
    `|---|---|`,
    `| Por número de indicador | ${reasignacion.porNumero} |`,
    `| Por nombre (misma gerencia y frecuencia) | ${reasignacion.porNombre} |`,
    `| Sustituidas por otro indicador de la misma gerencia | ${reasignacion.sustituidas.length} |`,
    `| Descartadas | ${reasignacion.descartadas.length} |`,
    `| **Total cargadas** | **${reasignacion.fixtures.length}** |`,
    ``,
    ...reasignacion.sustituidas.map(d => `- Sustituida: ${d}`),
    ...reasignacion.descartadas.map(d => `- Descartada: ${d}`),
    ...(reasignacion.sustituidas.length + reasignacion.descartadas.length > 0 ? [``] : []),
  ]

  if (discrepancias.length > 0) {
    lineas.push(`## Discrepancias (${discrepancias.length})`)
    lineas.push(``)
    lineas.push(`| Id | Campo | Valor | Detalle |`)
    lineas.push(`|---|---|---|---|`)
    for (const d of discrepancias) {
      lineas.push(`| ${d.id} | ${d.campo} | ${d.valor} | ${d.detalle} |`)
    }
    lineas.push(``)
  }

  if (correcciones.length > 0) {
    lineas.push(`## Correcciones autorizadas (${correcciones.length})`)
    lineas.push(``)
    lineas.push(`Valores vacíos o inválidos en el CSV resueltos por Froy el 14/10/2026 (ver \`DECISIONES.md\`).`)
    lineas.push(``)
    lineas.push(`| Id | Campo | Valor en el CSV | Corrección |`)
    lineas.push(`|---|---|---|---|`)
    for (const c of correcciones) {
      lineas.push(`| ${c.id} | ${c.campo} | ${c.valor} | ${c.detalle} |`)
    }
    lineas.push(``)
  }

  if (advertencias.length > 0) {
    lineas.push(`## Advertencias (${advertencias.length})`)
    lineas.push(``)
    for (const a of advertencias) {
      lineas.push(`- ${a}`)
    }
    lineas.push(``)
  }

  lineas.push(`## Campos sin datos en el CSV fuente`)
  lineas.push(``)
  lineas.push(`Los siguientes campos están vacíos en **todos** los registros del CSV:`)
  lineas.push(``)
  lineas.push(`- **Linea base** — pendiente para tabla METAS (fuera de S1)`)
  lineas.push(`- **Meta** — pendiente para tabla METAS (fuera de S1)`)
  lineas.push(`- **Metas mensuales** (Enero–Diciembre) — pendiente para tabla METAS`)
  lineas.push(`- **Observaciones** — ningún registro tiene observaciones`)
  lineas.push(``)
  lineas.push(`## Decisiones sobre el catálogo`)
  lineas.push(``)
  lineas.push(`Registradas en \`DECISIONES.md\` (Froy, 14/10/2026):`)
  lineas.push(``)
  lineas.push(`1. **Total:** el catálogo oficial es el del CSV (${mir.length} MIR) por ahora; diferencia autorizada frente a los 132 de proyecto.md.`)
  lineas.push(`2. **Niveles:** el CSV es la fuente de verdad por ahora, frente a la distribución de proyecto.md.`)
  lineas.push(``)
  if (sinTipoInd > 0) {
    lineas.push(`**Pendiente:** ${sinTipoInd} indicador(es) sin tipo (Gestión/Estratégico). Ver tabla de discrepancias.`)
    lineas.push(``)
  }
  lineas.push(`---`)
  lineas.push(`*Archivo generado por importar-csv-unificada.ts — no editar manualmente.*`)
  lineas.push(``)

  return lineas.join('\n')
}
