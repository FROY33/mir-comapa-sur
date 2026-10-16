// Indicadores tardíos (PRD0_1, ticket 8; HU-R4-01 CA_2). Con un ciclo de planeación abierto (no cerrado),
// el indicador que se da de alta o se reactiva recibe su meta pendiente en la misma transacción del catálogo.
// Si la creación falla, la transacción de quien llama se revierte completa.

import type { Ejecutor } from '../bd.js'
import { registrarEvento } from './bitacora.js'

export interface AutorTardia { usuarioId: string; ip?: string }

/** Crea la meta pendiente del indicador activo en el ciclo no cerrado más reciente, si aún no tiene una vigente. */
export async function metaPendienteDeIndicador(tx: Ejecutor, indicadorId: string, autor: AutorTardia): Promise<string | null> {
  const [ciclo] = await tx.consultar<{ id: string; ejercicio: number }>(
    'SELECT id, ejercicio FROM ciclos_planeacion WHERE NOT cerrado_manual ORDER BY ejercicio DESC LIMIT 1')
  if (!ciclo) return null
  // La versión del indicador la toma el trigger de la meta; ON CONFLICT cubre al indicador que ya tiene meta
  const [meta] = await tx.consultar<{ id: string }>(
    `INSERT INTO metas_planeacion (indicador_id, ciclo_id)
     SELECT i.id, $2 FROM indicadores i WHERE i.id = $1 AND i.activo
     ON CONFLICT (indicador_id, ciclo_id) WHERE vigente DO NOTHING RETURNING id`, [indicadorId, ciclo.id])
  if (!meta) return null
  await registrarEvento(tx, {
    usuarioId: autor.usuarioId, rol: 'admin', accion: 'meta_pendiente_creada', entidad: 'meta', entidadId: meta.id,
    indicadorId, ip: autor.ip, detalle: { ciclo_id: ciclo.id, ejercicio: ciclo.ejercicio },
  })
  return meta.id
}
