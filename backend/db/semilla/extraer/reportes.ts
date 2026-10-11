// extraer/reportes.ts — Periodos de reporte y fixtures de reporte (solo pruebas, CA-4).
// Parte del extractor de TEC-04 (../extraer.ts); se ejecuta una vez al importarse.

import { ESTADOS_REPORTE, MESES_POR_FRECUENCIA, DIAS_HABILES_POR_FRECUENCIA } from '../mapeos.js'
import { EJERCICIO, CORTE, src, colar, iso, finDeMes, masDias, diaHabil, etiqueta } from './base.js'
import { filasUsuarios } from './organizacion.js'
import { indicadoresMir, filasIndicadores } from './indicadores.js'

// ── 6. Periodos de reporte (los «ciclos» del checklist de TEC-04) ───────────
// reportes tiene FK compuesta (periodo_id, frecuencia): un reporte solo cabe en un
// periodo de la misma frecuencia que su indicador. Hacen falta los periodos de las
// seis frecuencias, no solo T3-2026. Ver INCONSISTENCIAS.md §14.
export const frecuenciasUsadas = [...new Set(filasIndicadores.map(i => i.frecuencia).filter(Boolean))]

export const filasPeriodos = Object.keys(MESES_POR_FRECUENCIA)
  .filter(f => frecuenciasUsadas.includes(f))
  .flatMap(frecuencia => {
    const meses = MESES_POR_FRECUENCIA[frecuencia] ?? 1
    const dias = DIAS_HABILES_POR_FRECUENCIA[frecuencia] ?? 10
    return Array.from({ length: 12 / meses }, (_, k) => {
      const numero = k + 1
      const inicio = new Date(Date.UTC(EJERCICIO, (numero - 1) * meses, 1))
      const fin = finDeMes(EJERCICIO, numero * meses)
      const abre = masDias(fin, 1)
      return {
        frecuencia,                                       // ← CLAVE NATURAL (compuesta) · FK a frecuencias
        ejercicio: EJERCICIO,                             // ← CLAVE NATURAL (compuesta)
        numero,                                           // ← CLAVE NATURAL (compuesta) · UNIQUE (frecuencia, ejercicio, numero)
        etiqueta: etiqueta(frecuencia, numero, inicio),
        inicio_periodo: iso(inicio),
        fin_periodo: iso(fin),
        abre_captura: iso(abre),
        // fecha_limite: días hábiles de la frecuencia contados de lunes a viernes,
        // sin calendario de festivos (limitación conocida de S1).
        fecha_limite: iso(diaHabil(abre, dias)),
        estado: 'abierto',                                // S1 los crea abiertos; el cierre es acción del Admin
      }
    })
  })
  .sort((a, b) => colar(a.frecuencia, b.frecuencia) || a.numero - b.numero)

/** Último periodo de cada frecuencia que ya concluyó al corte. */
export const periodoDeCorte = new Map<string, typeof filasPeriodos[number]>()
for (const p of filasPeriodos) {
  if (p.fin_periodo > CORTE) continue
  const previo = periodoDeCorte.get(p.frecuencia)
  if (!previo || p.fin_periodo > previo.fin_periodo) periodoDeCorte.set(p.frecuencia, p)
}
// Frecuencias cuyo primer periodo no concluye al corte (anual): se usa el primero.
export const sinPeriodoConcluido: string[] = []
for (const f of frecuenciasUsadas) {
  if (periodoDeCorte.has(f)) continue
  sinPeriodoConcluido.push(f)
  periodoDeCorte.set(f, filasPeriodos.find(p => p.frecuencia === f)!)
}

// CA-5 pide poder probar los estados «pendiente, borrador y observado», pero el
// prototipo no trae ningún reporte en `borrador`: sus 15 pendiente_carga vienen sin
// avance (ver INCONSISTENCIAS.md §19). Se promueve uno por gerencia activa al
// siguiente paso del flujo, con valores SINTÉTICOS declarados aquí — son fixtures
// de prueba, no datos del prototipo.
//
// Criterio de elección: el primer pendiente_carga de cada gerencia, por código, cuya
// frecuencia tenga un periodo ya concluido al corte (por eso ninguno es anual).
export const BORRADORES_CA5: Record<string, { numerador: string; denominador: string; avance: string }> = {
  'ADM-ACT-45':  { numerador: '7',  denominador: '10', avance: '70' },   // fracción · Metas alcanzadas / programadas
  'COM-ACT-125': { numerador: '4',  denominador: '5',  avance: '80' },   // fracción · Metas alcanzadas / programadas
  'PLA-ACT-9':   { numerador: '1',  denominador: '2',  avance: '50' },   // fracción · Revisiones realizadas / programadas
  'TEC-ACT-117': { numerador: '12', denominador: '',   avance: '12' },   // valor directo · Reposiciones del periodo
}

// ── 7. Fixtures de reporte — SOLO PRUEBAS (CA-4) ────────────────────────────
export const estadosFueraCatalogo = new Set<string>()
export const nombresConCuenta = new Map(filasUsuarios.map(u => [u.nombre, u.email]))

export const borradoresNoAplicados: string[] = []

export const filasFixtures = src.operativos.map(x => {
  const i = indicadoresMir.find(m => m.codigo === String(x.id))!
  const periodo = periodoDeCorte.get(i.frecuencia)
  const original = String(x.estado || 'pendiente_carga')

  // Promoción a borrador: solo si el reporte sigue en pendiente_carga, para no
  // sobrescribir en silencio un estado más avanzado si cambian los datos del prototipo.
  const sintetico = BORRADORES_CA5[String(x.id)]
  const promover = sintetico !== undefined && original === 'pendiente_carga'
  if (sintetico !== undefined && !promover) borradoresNoAplicados.push(`${x.id} (está en ${original})`)

  const estado = promover ? 'borrador' : original
  if (!ESTADOS_REPORTE.has(estado)) estadosFueraCatalogo.add(estado)
  const cerrado = estado === 'cerrado' || estado === 'incumplido'
  const enviado = ['enviado_revision', 'observado', 'corregido', 'aprobado_revisor', 'regresado_correccion'].includes(estado)
  const fecha = x.ultimaActualizacion || CORTE
  return {
    indicador_codigo: String(x.id),                       // ← CLAVE NATURAL (compuesta) · UNIQUE (indicador_id, periodo_id)
    periodo_frecuencia: i.frecuencia,                     // ← CLAVE NATURAL (compuesta), resuelve periodo_id
    periodo_numero: periodo ? periodo.numero : '',
    periodo_etiqueta: periodo ? periodo.etiqueta : '',
    periodo_prototipo: x.periodo || '',                   // lo que decía el prototipo, para auditar el remapeo
    estado,
    // Los CHECK de reportes exigen estas marcas según el estado.
    enviado_at: enviado || cerrado ? `${fecha} 12:00:00-06` : '',
    enviado_por_email: nombresConCuenta.get(x.responsableEnlace) || '',
    cerrado_at: cerrado ? `${fecha} 12:00:00-06` : '',
    cerrado_por_email: '',                                // cierra el Admin; se resuelve en el cargador
    vencido: false,
    vencido_at: '',
    numerador: promover ? sintetico.numerador : x.numeradorVal ?? '',
    denominador: promover ? sintetico.denominador : x.denominadorVal ?? '',
    avance: promover ? sintetico.avance : x.avancePeriodo ?? '',
    estado_prototipo: promover ? original : '',      // queda el rastro de la promoción
    responsable_enlace_prototipo: x.responsableEnlace || '',
    responsable_revisor_prototipo: x.responsableRevisor || '',
    archivos_evidencia: (x.archivosEvidencia || []).length,
    observaciones: (x.observaciones || []).length,
    eventos_historial: (x.historial || []).length,
  }
}).sort((a, b) => colar(a.indicador_codigo, b.indicador_codigo))
