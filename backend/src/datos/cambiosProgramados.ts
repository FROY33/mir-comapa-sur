// Cambios del indicador con vigencia futura (HU-R4-11 CA_4; tabla indicador_cambios_programados).
//
// Gerencia, frecuencia, tipo de cálculo y acumulable de un indicador con reportes o metas no se
// escriben al editar: se programan para la apertura del siguiente periodo y se aplican en la
// transacción que lo abre. Los reportes y las metas ya creados apuntan a su versión del indicador (S2-TEC-01), así que
// no cambian. La edición programa y cancela (indicadoresAdmin.ts); la apertura aplica.

import type { Ejecutor } from '../bd.js'
import { registrarEvento } from './bitacora.js'

export type ValoresProgramados = Partial<Record<'gerencia_id' | 'unidad_id' | 'frecuencia' | 'tipo_calculo' | 'acumulable', string | boolean | null>>

export interface CambioProgramado {
  id: string
  indicador_id: string
  valores: ValoresProgramados
  vigente_desde: string
  created_at: string
}

const COLUMNAS_CAMBIO = `id, indicador_id, valores, vigente_desde::text AS vigente_desde, created_at`

/** Un indicador con metas: junto con `tieneReportes`, decide si sus cambios sensibles se programan. */
export async function tieneMetas(bd: Ejecutor, id: string): Promise<boolean> {
  const [fila] = await bd.consultar(`SELECT 1 FROM metas_planeacion WHERE indicador_id = $1 LIMIT 1`, [id])
  return fila !== undefined
}

/** El cambio pendiente del indicador (aún no aplicado ni cancelado), si hay. */
export async function cambioPendiente(bd: Ejecutor, indicadorId: string): Promise<CambioProgramado | undefined> {
  const [fila] = await bd.consultar<CambioProgramado>(
    `SELECT ${COLUMNAS_CAMBIO} FROM indicador_cambios_programados
      WHERE indicador_id = $1 AND aplicado_at IS NULL AND cancelado_at IS NULL`, [indicadorId])
  return fila
}

/** Primer día del siguiente periodo de la frecuencia, cuando abre su captura: desde ahí aplica el cambio. */
export function siguienteApertura(meses: number, hoy: string): string {
  const anio = Number(hoy.slice(0, 4))
  const mes0 = Number(hoy.slice(5, 7)) - 1
  const numero = Math.floor(mes0 / meses) + 1
  return new Date(Date.UTC(anio, numero * meses, 1)).toISOString().slice(0, 10)
}

export async function hoyEnBase(bd: Ejecutor): Promise<string> {
  const [f] = await bd.consultar<{ hoy: string }>('SELECT current_date::text AS hoy')
  return f!.hoy
}

export async function mesesDeFrecuencia(bd: Ejecutor, frecuencia: string): Promise<number> {
  const [f] = await bd.consultar<{ meses: number }>('SELECT meses FROM frecuencias WHERE clave = $1', [frecuencia])
  return f!.meses
}

export async function programarCambio(
  bd: Ejecutor, indicadorId: string, valores: ValoresProgramados, vigenteDesde: string, usuarioId?: string,
): Promise<CambioProgramado> {
  const [fila] = await bd.consultar<CambioProgramado>(
    `INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde, creado_por)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS_CAMBIO}`,
    [indicadorId, JSON.stringify(valores), vigenteDesde, usuarioId ?? null])
  return fila!
}

/** Cancela un cambio pendiente. Devuelve `undefined` si ya no lo está (aplicado, cancelado o inexistente). */
export async function cancelarCambio(bd: Ejecutor, cambioId: string, usuarioId: string): Promise<CambioProgramado | undefined> {
  const [fila] = await bd.consultar<CambioProgramado>(
    `UPDATE indicador_cambios_programados SET cancelado_at = now(), cancelado_por = $2
      WHERE id = $1 AND aplicado_at IS NULL AND cancelado_at IS NULL RETURNING ${COLUMNAS_CAMBIO}`,
    [cambioId, usuarioId])
  return fila
}

export async function obtenerCambio(bd: Ejecutor, cambioId: string) {
  const [fila] = await bd.consultar<CambioProgramado>(
    `SELECT ${COLUMNAS_CAMBIO} FROM indicador_cambios_programados WHERE id = $1`, [cambioId])
  return fila
}

/** Los cuatro campos sensibles con los nombres de la foto de bitácora (la gerencia, por su clave). */
export async function fotoDeCampos(bd: Ejecutor, indicadorId: string) {
  const [f] = await bd.consultar<{ codigo: string; gerencia: string; frecuencia: string; tipo_calculo: string; acumulable: boolean }>(
    `SELECT i.codigo, g.clave AS gerencia, i.frecuencia, i.tipo_calculo, i.acumulable
       FROM indicadores i JOIN gerencias g ON g.id = i.gerencia_id WHERE i.id = $1`, [indicadorId])
  const { codigo, ...campos } = f!
  return { codigo, campos }
}

/** Los campos de la foto con los valores programados encima (la gerencia, por su clave). */
export async function camposConValores(bd: Ejecutor, campos: Record<string, unknown>, valores: ValoresProgramados) {
  const { gerencia_id, unidad_id: _unidad, ...resto } = valores
  const [g] = gerencia_id ? await bd.consultar<{ clave: string }>('SELECT clave FROM gerencias WHERE id = $1', [gerencia_id]) : []
  return { ...campos, ...resto, ...(g ? { gerencia: g.clave } : {}) }
}

export interface CambioAplicado { indicador_id: string; codigo: string; vigente_desde: string; antes: Record<string, unknown>; despues: Record<string, unknown> }

/**
 * Aplica al catálogo los cambios programados cuya vigencia ya llegó (`vigente_desde <= hoy`) y deja
 * cada uno en la bitácora (`cambio_programado_aplicado`, con `antes`, `despues` y `vigente_desde`).
 * Es idempotente: un cambio aplicado ya no está pendiente. Corre dentro de la transacción `tx` de quien
 * abre el periodo, así que o abre y aplica, o ninguna de las dos.
 *
 *   - `frecuencia`: solo los indicadores que HOY tienen esa frecuencia, es decir, los que abre ese
 *     periodo (lo usa abrirCiclos al abrir un periodo de reporte).
 *   - `indicadorId`: solo el de ese indicador.
 *   - Sin filtro: todos los vencidos.
 *
 * Al abrir un ciclo de planeación se debe llamar sin filtro, antes de generar las metas pendientes
 * (DIFERIDO al ticket 8: aún no existe esa apertura).
 */
export async function aplicarCambiosProgramados(tx: Ejecutor, hoy: string, filtro: { frecuencia?: string; indicadorId?: string } = {}): Promise<CambioAplicado[]> {
  const pendientes = await tx.consultar<{ id: string; indicador_id: string; valores: ValoresProgramados; vigente_desde: string }>(
    `SELECT c.id, c.indicador_id, c.valores, c.vigente_desde::text AS vigente_desde
       FROM indicador_cambios_programados c JOIN indicadores i ON i.id = c.indicador_id
      WHERE c.aplicado_at IS NULL AND c.cancelado_at IS NULL AND c.vigente_desde <= $1
        AND ($2::text IS NULL OR i.frecuencia = $2) AND ($3::uuid IS NULL OR c.indicador_id = $3)
      ORDER BY c.vigente_desde, c.created_at
      FOR UPDATE OF c`, [hoy, filtro.frecuencia ?? null, filtro.indicadorId ?? null])
  const aplicados: CambioAplicado[] = []
  for (const c of pendientes) {
    const antes = await fotoDeCampos(tx, c.indicador_id)
    const columnas = Object.keys(c.valores) as (keyof ValoresProgramados)[]
    const asignaciones = columnas.map((col, k) => `${col} = $${k + 2}`).join(', ')
    await tx.consultar(`UPDATE indicadores SET ${asignaciones} WHERE id = $1`, [c.indicador_id, ...columnas.map((col) => c.valores[col])])
    const despues = await fotoDeCampos(tx, c.indicador_id)
    await tx.consultar('UPDATE indicador_cambios_programados SET aplicado_at = now() WHERE id = $1', [c.id])
    await registrarEvento(tx, {
      accion: 'cambio_programado_aplicado', entidad: 'indicador', entidadId: c.indicador_id, indicadorId: c.indicador_id,
      detalle: { antes: antes.campos, despues: despues.campos, vigente_desde: c.vigente_desde, cambio_id: c.id },
    })
    aplicados.push({ indicador_id: c.indicador_id, codigo: antes.codigo, vigente_desde: c.vigente_desde, antes: antes.campos, despues: despues.campos })
  }
  return aplicados
}
