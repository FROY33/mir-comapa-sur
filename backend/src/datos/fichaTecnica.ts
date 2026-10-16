// Ficha técnica del indicador (HU-R8-03): definición, meta del ejercicio, periodo activo e historial.
// Quien llama pasa la gerencia de la SESIÓN, o null solo para el Administrador (CA_5).
//
// Contrato del historial (CA_2): los últimos 3 reportes del indicador cuyo periodo está cerrado, del más
// reciente al más viejo. El % es el congelado al cierre (`reportes.cumplimiento`, HU-R3-03); si el cierre
// no lo guardó, se calcula con las reglas de HU-R4-11 RN_3. No hay tabla REPORTES_PERIODO (DECISIONES.md).
// El avance de un reporte sin enviar (pendiente o borrador) no se muestra, igual que en la Consulta MIR.

import type { Ejecutor } from '../bd.js'
import { avanceDelPeriodo, type TipoCalculo } from '../cumplimiento.js'
import { cumplimientoDeReporte, ESTADOS_SIN_ENVIAR } from './cumplimiento.js'

export interface PeriodoFicha { periodo: string; estado: string; avance: number | null; cumplimiento: number | null }

export interface FichaTecnica {
  indicador: Record<string, unknown> & { gerencia: { clave: string; nombre: string } }
  meta: { ejercicio: number; meta_anual: number | null; linea_base: number | null } | null
  actual: PeriodoFicha | null
  historial: PeriodoFicha[]
}

interface FilaReporte {
  id: string; etiqueta: string; ejercicio: number; estado: string; tipo_calculo: TipoCalculo
  avance: string | null; numerador: string | null; denominador: string | null; congelado: string | null
}

const num = (v: string | null) => (v === null ? null : Number(v))

async function periodoFicha(bd: Ejecutor, r: FilaReporte): Promise<PeriodoFicha> {
  const enviado = !ESTADOS_SIN_ENVIAR.includes(r.estado)
  const a = enviado
    ? avanceDelPeriodo({ numero: 0, tipoCalculo: r.tipo_calculo, avance: num(r.avance), numerador: num(r.numerador), denominador: num(r.denominador) })
    : undefined
  let cumplimiento = num(r.congelado)
  if (cumplimiento === null && enviado) {
    const c = await cumplimientoDeReporte(bd, r.id)
    cumplimiento = c?.calculable ? c.cumplimiento : null
  }
  return { periodo: r.etiqueta, estado: r.estado, avance: a?.ok ? a.valor : null, cumplimiento }
}

const REPORTES = `
  SELECT r.id, p.etiqueta, p.ejercicio, r.estado, r.tipo_calculo, r.avance::text, r.numerador::text,
         r.denominador::text, r.cumplimiento::text AS congelado
    FROM reportes r JOIN periodos_reporte p ON p.id = r.periodo_id
   WHERE r.indicador_id = $1 AND p.estado = $2
   ORDER BY p.fin_periodo DESC`

/** La ficha, o undefined si el indicador no existe o es de otra gerencia (no se distingue). */
export async function fichaTecnica(bd: Ejecutor, id: string, gerenciaId: string | null): Promise<FichaTecnica | undefined> {
  const [i] = await bd.consultar<Record<string, unknown> & { gerencia_clave: string; gerencia_nombre: string }>(
    `SELECT i.id, i.codigo, i.nombre, i.tipo, i.nivel, i.numero, i.resumen_narrativo, i.formula, i.numerador_desc,
            i.denominador_desc, i.frecuencia, i.unidad_medida, i.tipo_calculo, i.acumulable, i.sentido_meta,
            coalesce(mv.nombre, i.medio_verificacion) AS medio_verificacion, i.origen_mv, i.supuestos,
            i.observaciones_mir, i.es_iso, i.activo, u.nombre AS unidad,
            g.clave AS gerencia_clave, g.nombre AS gerencia_nombre
       FROM indicadores i
       JOIN gerencias g ON g.id = i.gerencia_id
       LEFT JOIN unidades u ON u.id = i.unidad_id
       LEFT JOIN medios_verificacion mv ON mv.id = i.medio_verificacion_id
      WHERE i.id = $1 AND ($2::uuid IS NULL OR i.gerencia_id = $2)`, [id, gerenciaId])
  if (!i) return undefined
  const { gerencia_clave, gerencia_nombre, ...definicion } = i

  const [abierto] = await bd.consultar<FilaReporte>(`${REPORTES} LIMIT 1`, [id, 'abierto'])
  const cerrados = await bd.consultar<FilaReporte>(`${REPORTES} LIMIT 3`, [id, 'cerrado'])

  // Meta del ejercicio del periodo activo; sin periodo activo, la del año en curso
  const [meta] = await bd.consultar<{ ejercicio: number; meta_anual: string | null; linea_base: string | null }>(
    `SELECT c.ejercicio, m.meta_anual::text, m.linea_base::text
       FROM metas_planeacion m JOIN ciclos_planeacion c ON c.id = m.ciclo_id
      WHERE m.indicador_id = $1 AND m.vigente AND m.estado = 'meta_validada'
        AND c.ejercicio = coalesce($2::int, extract(year FROM current_date)::int)`, [id, abierto?.ejercicio ?? null])

  return {
    indicador: { ...definicion, gerencia: { clave: gerencia_clave, nombre: gerencia_nombre } },
    meta: meta ? { ejercicio: meta.ejercicio, meta_anual: num(meta.meta_anual), linea_base: num(meta.linea_base) } : null,
    actual: abierto ? await periodoFicha(bd, abierto) : null,
    historial: await Promise.all(cerrados.map((r) => periodoFicha(bd, r))),
  }
}
