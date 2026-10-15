// Consulta del cumplimiento de un reporte (HU-R4-11 RN_3): arma las entradas de
// `calcularCumplimiento` con la foto del reporte y la meta validada del ejercicio (con su versión del indicador).
//
// Esta consulta solo lee. Guardar el resultado en `reportes.cumplimiento` al cerrar es de HU-R3-03;
// mostrarlo, de Consulta MIR (ticket 5) y la ficha técnica (ticket 7).

import type { Ejecutor } from '../bd.js'
import { calcularCumplimiento, type AvancePeriodo, type MetaPeriodo, type ResultadoCumplimiento, type TipoCalculo } from '../cumplimiento.js'

interface FilaReporte {
  indicador_id: string
  ejercicio: number
  numero: number
  frecuencia: string
  acumulable: boolean
  sentido_meta: 'ascendente' | 'descendente'
}

interface FilaAvance {
  numero: number
  tipo_calculo: TipoCalculo
  avance: string | null
  numerador: string | null
  denominador: string | null
}

const num = (v: string | null) => (v === null ? null : Number(v))

/**
 * Cumplimiento del reporte, o `undefined` si el reporte no existe. Usa la foto del reporte
 * (tipo de cálculo, acumulable, sentido, frecuencia) y la de la meta (frecuencia); la meta del
 * periodo sale de `metas_periodo` de la meta vigente en `meta_validada` del ejercicio del periodo.
 */
export async function cumplimientoDeReporte(bd: Ejecutor, reporteId: string): Promise<ResultadoCumplimiento | undefined> {
  const [r] = await bd.consultar<FilaReporte>(
    `SELECT r.indicador_id, p.ejercicio, p.numero, r.frecuencia, r.acumulable, r.sentido_meta
       FROM reportes r JOIN periodos_reporte p ON p.id = r.periodo_id
      WHERE r.id = $1`, [reporteId])
  if (!r) return undefined

  const avances = await bd.consultar<FilaAvance>(
    `SELECT p.numero, r.tipo_calculo, r.avance::text, r.numerador::text, r.denominador::text
       FROM reportes r JOIN periodos_reporte p ON p.id = r.periodo_id
      WHERE r.indicador_id = $1 AND p.ejercicio = $2 AND p.frecuencia = $3 AND p.numero <= $4
      ORDER BY p.numero`, [r.indicador_id, r.ejercicio, r.frecuencia, r.numero])
  const periodos: AvancePeriodo[] = avances.map((a) => ({
    numero: a.numero, tipoCalculo: a.tipo_calculo,
    avance: num(a.avance), numerador: num(a.numerador), denominador: num(a.denominador),
  }))

  const [meta] = await bd.consultar<{ id: string; frecuencia: string }>(
    `SELECT m.id, v.definicion->>'frecuencia' AS frecuencia
       FROM metas_planeacion m
       JOIN indicador_versiones v ON v.id = m.indicador_version_id   -- la frecuencia con que se planeó
       JOIN ciclos_planeacion c ON c.id = m.ciclo_id
      WHERE m.indicador_id = $1 AND c.ejercicio = $2 AND m.vigente AND m.estado = 'meta_validada'`,
    [r.indicador_id, r.ejercicio])
  const metas: MetaPeriodo[] | null = meta
    ? (await bd.consultar<{ numero: number; meta_periodo: string | null }>(
        'SELECT numero, meta_periodo::text FROM metas_periodo WHERE meta_id = $1 ORDER BY numero', [meta.id]))
        .map((m) => ({ numero: m.numero, meta_periodo: num(m.meta_periodo) }))
    : null

  return calcularCumplimiento({
    numero: r.numero, acumulable: r.acumulable, frecuencia: r.frecuencia, sentidoMeta: r.sentido_meta,
    periodos, metas, frecuenciaMeta: meta?.frecuencia ?? null,
  })
}
