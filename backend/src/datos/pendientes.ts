// Reportes del periodo abierto para la gerencia de la sesión (HU-R1-01). Un reporte existe
// solo en los periodos de la frecuencia de su indicador (RN_3: lo garantiza la FK compuesta
// periodo + frecuencia), así que basta con listar los reportes de periodos abiertos.

import type { Ejecutor } from '../bd.js'

/** Estados que piden acción del Enlace. Los demás no aparecen como pendientes (RN_2). */
export const ESTADOS_PENDIENTES = ['pendiente_carga', 'borrador', 'observado', 'regresado_correccion'] as const

/** CA_2: urgente si vence en los próximos 3 días o ya venció. */
export const DIAS_URGENCIA = 3

export interface ReporteDelPeriodo {
  reporte_id: string
  indicador_id: string
  codigo: string
  nombre: string
  tipo: 'mir' | 'gerencial'
  nivel: string | null
  frecuencia: string
  unidad: string | null
  medio_verificacion: string | null
  es_iso: boolean
  periodo: string
  fecha_limite: string
  estado: string
  pendiente: boolean
  vencido: boolean           // marca de R1-08, o fecha límite ya pasada: sigue pendiente (RN_4)
  urgente: boolean
  actualizado_at: Date
}

export interface Filtros { estado?: string; nivel?: string; hasta?: string; soloPendientes?: boolean }

/**
 * Orden por defecto (CA_4): primero los vencidos, luego por fecha límite ascendente.
 * `gerenciaId` null solo para el Administrador.
 */
export function listarDelPeriodo(bd: Ejecutor, gerenciaId: string | null, f: Filtros = {}): Promise<ReporteDelPeriodo[]> {
  return bd.consultar<ReporteDelPeriodo>(
    `WITH base AS (
       SELECT r.id AS reporte_id, i.id AS indicador_id, i.codigo, i.nombre, i.tipo, i.nivel, i.frecuencia,
              u.nombre AS unidad, i.medio_verificacion, i.es_iso, p.etiqueta AS periodo,
              p.fecha_limite, r.estado, r.updated_at AS actualizado_at,
              r.estado = ANY($2::text[]) AS pendiente,
              r.estado = ANY($2::text[]) AND (r.vencido OR p.fecha_limite < current_date) AS vencido
         FROM reportes r
         JOIN indicadores i ON i.id = r.indicador_id
         JOIN periodos_reporte p ON p.id = r.periodo_id
         LEFT JOIN unidades u ON u.id = i.unidad_id
        WHERE p.estado = 'abierto'
          AND ($1::uuid IS NULL OR r.gerencia_id = $1))
     SELECT *, pendiente AND fecha_limite <= current_date + $3::int AS urgente
       FROM base
      WHERE ($4::text IS NULL OR estado = $4)
        AND ($5::text IS NULL OR nivel = $5)
        AND ($6::date IS NULL OR fecha_limite <= $6)
        AND (NOT $7 OR pendiente)
      ORDER BY vencido DESC, fecha_limite, codigo`,
    [gerenciaId, ESTADOS_PENDIENTES, DIAS_URGENCIA, f.estado ?? null, f.nivel ?? null, f.hasta ?? null, f.soloPendientes ?? false],
  )
}
