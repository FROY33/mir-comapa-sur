// Marca vencida de las metas (PRD0_1, ticket 9; HU-R4-02 CA_5, RN_2): pasado el fin de captura, las
// metas que siguen en `meta_pendiente` o `borrador_meta` quedan con `vencida = true`. Es una marca, no
// un estado, y nada la quita: ningún código escribe `vencida = false`. Cada meta marcada deja
// `meta_vencida` en la bitácora, y correrla otra vez no duplica nada (solo toca las no marcadas).
// La reutiliza el ticket 10 (borrador vencido). Se aplica en la tarea automática y antes de listar.

import type { Ejecutor } from '../bd.js'
import { registrarEvento } from './bitacora.js'
import { ESTADOS_META_PENDIENTE } from './metasPendientes.js'

/** Marca las metas vigentes pendientes o en borrador del ciclo si su captura ya terminó. Devuelve cuántas marcó. */
export async function marcarVencidas(tx: Ejecutor, cicloId: string): Promise<number> {
  const marcadas = await tx.consultar<{ id: string; indicador_id: string; estado: string }>(
    `UPDATE metas_planeacion m SET vencida = true, vencida_at = now()
       FROM ciclos_planeacion c
      WHERE c.id = m.ciclo_id AND m.ciclo_id = $1 AND NOT c.cerrado_manual AND c.fin_captura < current_date
        AND m.vigente AND NOT m.vencida AND m.estado = ANY($2::text[])
      RETURNING m.id, m.indicador_id, m.estado`,
    [cicloId, ESTADOS_META_PENDIENTE])
  for (const m of marcadas) {
    await registrarEvento(tx, {
      accion: 'meta_vencida', entidad: 'meta', entidadId: m.id, indicadorId: m.indicador_id,
      estadoAnterior: m.estado, estadoNuevo: m.estado, detalle: { ciclo_id: cicloId },
    })
  }
  return marcadas.length
}

/** Lo que corre la tarea automática: todos los ciclos no cerrados cuya captura ya terminó. */
export async function marcarVencidasDeCiclos(tx: Ejecutor): Promise<number> {
  const ciclos = await tx.consultar<{ id: string }>(
    'SELECT id FROM ciclos_planeacion WHERE NOT cerrado_manual AND fin_captura < current_date')
  let total = 0
  for (const c of ciclos) total += await marcarVencidas(tx, c.id)
  return total
}
