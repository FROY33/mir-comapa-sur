// Consulta MIR (HU-R8-01): el catálogo de indicadores MIR con su estado actual, meta anual y cumplimiento.
// Quien llama pasa la gerencia de la SESIÓN, o null solo para el Administrador (CA_6).
//
// Estado (CA_2): por indicador, el reporte del periodo abierto más reciente; si no tiene ninguno abierto,
// el del último periodo cerrado. Sin reportes, estado y periodo nulos.
// Cumplimiento (CA_4): solo con reporte en un periodo abierto y ya enviado (un borrador o un pendiente
// no cuentan); se calcula con las reglas de HU-R4-11 RN_3. En otro caso, null («N/A» en la pantalla).
// Meta anual: la de la meta validada del ejercicio del periodo mostrado (o del año en curso).

import type { Ejecutor } from '../bd.js'
import { cumplimientoDeReporte, ESTADOS_SIN_ENVIAR } from './cumplimiento.js'

export interface FilaConsultaMir {
  id: string
  codigo: string
  nombre: string
  nivel: string
  frecuencia: string
  activo: boolean
  resumen_narrativo: string | null
  formula: string | null
  unidad_medida: string
  tipo_calculo: string
  medio_verificacion: string | null
  origen_mv: string | null
  es_iso: boolean
  gerencia: { clave: string; nombre: string }
  unidad: string | null
  estado: string | null
  periodo: { etiqueta: string; estado: 'abierto' | 'cerrado' } | null
  meta_anual: number | null
  cumplimiento: number | null
}

interface Fila {
  id: string; codigo: string; nombre: string; nivel: string; frecuencia: string; activo: boolean
  resumen_narrativo: string | null; formula: string | null; unidad_medida: string; tipo_calculo: string
  medio_verificacion: string | null; origen_mv: string | null; es_iso: boolean
  gerencia_clave: string; gerencia_nombre: string; unidad: string | null
  reporte_id: string | null; estado: string | null; etiqueta: string | null
  periodo_estado: 'abierto' | 'cerrado' | null; meta_anual: string | null
}

export async function consultarCatalogoMir(bd: Ejecutor, gerenciaId: string | null): Promise<FilaConsultaMir[]> {
  const filas = await bd.consultar<Fila>(
    `SELECT i.id, i.codigo, i.nombre, i.nivel, i.frecuencia, i.activo, i.resumen_narrativo, i.formula,
            i.unidad_medida, i.tipo_calculo, coalesce(mv.nombre, i.medio_verificacion) AS medio_verificacion,
            i.origen_mv, i.es_iso,
            g.clave AS gerencia_clave, g.nombre AS gerencia_nombre, u.nombre AS unidad,
            r.id AS reporte_id, r.estado, p.etiqueta, p.estado AS periodo_estado, m.meta_anual::text
       FROM indicadores i
       JOIN gerencias g ON g.id = i.gerencia_id
       LEFT JOIN unidades u ON u.id = i.unidad_id
       LEFT JOIN medios_verificacion mv ON mv.id = i.medio_verificacion_id
       LEFT JOIN LATERAL (
         SELECT r.id, r.estado, r.periodo_id
           FROM reportes r JOIN periodos_reporte p ON p.id = r.periodo_id
          WHERE r.indicador_id = i.id
          ORDER BY (p.estado = 'abierto') DESC, p.fin_periodo DESC
          LIMIT 1) r ON true
       LEFT JOIN periodos_reporte p ON p.id = r.periodo_id
       LEFT JOIN LATERAL (
         SELECT mp.meta_anual
           FROM metas_planeacion mp JOIN ciclos_planeacion c ON c.id = mp.ciclo_id
          WHERE mp.indicador_id = i.id AND mp.vigente AND mp.estado = 'meta_validada'
            AND c.ejercicio = coalesce(p.ejercicio, extract(year FROM current_date)::int)) m ON true
      WHERE i.tipo = 'mir' AND ($1::uuid IS NULL OR i.gerencia_id = $1)
      ORDER BY g.clave, i.codigo`,
    [gerenciaId],
  )

  return Promise.all(filas.map(async (f) => {
    const cuenta = f.reporte_id && f.periodo_estado === 'abierto' && !ESTADOS_SIN_ENVIAR.includes(f.estado!)
    const c = cuenta ? await cumplimientoDeReporte(bd, f.reporte_id!) : undefined
    return {
      id: f.id, codigo: f.codigo, nombre: f.nombre, nivel: f.nivel, frecuencia: f.frecuencia, activo: f.activo,
      resumen_narrativo: f.resumen_narrativo, formula: f.formula, unidad_medida: f.unidad_medida,
      tipo_calculo: f.tipo_calculo, medio_verificacion: f.medio_verificacion, origen_mv: f.origen_mv, es_iso: f.es_iso,
      gerencia: { clave: f.gerencia_clave, nombre: f.gerencia_nombre }, unidad: f.unidad,
      estado: f.estado,
      periodo: f.etiqueta ? { etiqueta: f.etiqueta, estado: f.periodo_estado! } : null,
      meta_anual: f.meta_anual === null ? null : Number(f.meta_anual),
      cumplimiento: c?.calculable ? c.cumplimiento : null,
    }
  }))
}
