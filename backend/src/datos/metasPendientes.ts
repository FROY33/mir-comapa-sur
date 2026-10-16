// Metas pendientes del Enlace (PRD0_1, ticket 9; HU-R4-02): las metas vigentes del ciclo vigente que
// aún piden acción de la gerencia (`meta_pendiente` y `borrador_meta`). La gerencia sale de la versión
// del indicador a la que apunta la meta, no de `indicadores.gerencia_id`, para que una reasignación
// posterior no la mueva antes de tiempo. Orden por defecto: vencidas primero, luego por código.

import type { Ejecutor } from '../bd.js'

export const ESTADOS_META_PENDIENTE = ['meta_pendiente', 'borrador_meta'] as const
export const NIVELES_MIR = ['fin', 'proposito', 'componente', 'actividad'] as const

export interface MetaPendiente {
  meta_id: string
  indicador_id: string
  codigo: string
  nombre: string
  tipo: 'mir' | 'gerencial'
  nivel: string | null
  estado: 'meta_pendiente' | 'borrador_meta'
  vencida: boolean
}

export interface FiltrosMetas { estado?: string; nivel?: string }

export interface ResumenMetas { total: number; pendientes: number; borradores: number; vencidas: number }

export function listarMetasPendientes(bd: Ejecutor, cicloId: string, gerenciaId: string, f: FiltrosMetas = {}): Promise<MetaPendiente[]> {
  return bd.consultar<MetaPendiente>(
    `SELECT m.id AS meta_id, i.id AS indicador_id, i.codigo, i.nombre, i.tipo, i.nivel, m.estado, m.vencida
       FROM metas_planeacion m
       JOIN indicador_versiones v ON v.id = m.indicador_version_id
       JOIN indicadores i ON i.id = m.indicador_id
      WHERE m.ciclo_id = $1 AND m.vigente
        AND v.gerencia_id = $2
        AND m.estado = ANY($3::text[])
        AND ($4::text IS NULL OR m.estado = $4)
        AND ($5::text IS NULL OR i.nivel = $5)
      ORDER BY m.vencida DESC, i.codigo`,
    [cicloId, gerenciaId, ESTADOS_META_PENDIENTE, f.estado ?? null, f.nivel ?? null])
}

export function resumirMetas(metas: readonly MetaPendiente[]): ResumenMetas {
  return {
    total: metas.length,
    pendientes: metas.filter((m) => m.estado === 'meta_pendiente').length,
    borradores: metas.filter((m) => m.estado === 'borrador_meta').length,
    vencidas: metas.filter((m) => m.vencida).length,
  }
}
