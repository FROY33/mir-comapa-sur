// Cambios con vigencia futura desde la edición del catálogo (HU-R4-11 CA_4).
// Un indicador con reportes o metas no cambia de gerencia, frecuencia, tipo de cálculo ni acumulable
// al editarlo: el cambio se programa para la apertura del siguiente periodo (datos/cambiosProgramados.ts).

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD, Ejecutor } from './bd.js'
import { registrarEvento } from './datos/bitacora.js'
import {
  cambioPendiente, camposConValores, cancelarCambio, fotoDeCampos, hoyEnBase, mesesDeFrecuencia, obtenerCambio, programarCambio,
  siguienteApertura, tieneMetas, type CambioProgramado, type ValoresProgramados,
} from './datos/cambiosProgramados.js'
import { CAMPOS_VIGENCIA_FUTURA, tieneReportes, type DatosIndicador, type IndicadorCompleto } from './datos/indicadoresAdmin.js'
import type { Respuesta } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNA = { gerenciaId: 'gerencia_id', frecuencia: 'frecuencia', tipoCalculo: 'tipo_calculo', acumulable: 'acumulable' } as const

/** Lo que cambia entre el indicador y lo pedido en los cuatro campos con vigencia futura. */
function diferencias(antes: IndicadorCompleto, d: DatosIndicador): ValoresProgramados {
  const actual = { gerenciaId: antes.gerencia.id, frecuencia: antes.frecuencia, tipoCalculo: antes.tipo_calculo, acumulable: antes.acumulable }
  const cambios: ValoresProgramados = {}
  for (const campo of CAMPOS_VIGENCIA_FUTURA) if (d[campo] !== actual[campo]) cambios[COLUMNA[campo]] = d[campo]
  // La unidad pertenece a la gerencia pedida: viaja con el cambio de gerencia
  if (cambios.gerencia_id !== undefined) cambios.unidad_id = d.unidadId
  return cambios
}

/**
 * Separa lo que cambia de inmediato de lo que se programa. Devuelve los datos que sí se escriben ahora
 * (con los valores actuales en los campos programados) y el cambio programado, si lo hubo.
 * Sin reportes ni metas todo se aplica de inmediato.
 */
export async function programarSensibles(
  tx: Ejecutor, usuarioId: string, ip: string | undefined, antes: IndicadorCompleto, d: DatosIndicador,
): Promise<{ datos: DatosIndicador; programado?: CambioProgramado }> {
  const cambios = diferencias(antes, d)
  if (Object.keys(cambios).length === 0) return { datos: d }
  if (!(await tieneReportes(tx, antes.id)) && !(await tieneMetas(tx, antes.id))) return { datos: d }

  const previo = await cambioPendiente(tx, antes.id)
  if (previo) await cancelarCambio(tx, previo.id, usuarioId)   // lo reemplaza este: uno pendiente por indicador
  const valores = { ...previo?.valores, ...cambios }
  const vigenteDesde = siguienteApertura(await mesesDeFrecuencia(tx, antes.frecuencia), await hoyEnBase(tx))
  const programado = await programarCambio(tx, antes.id, valores, vigenteDesde, usuarioId)
  const { campos } = await fotoDeCampos(tx, antes.id)
  await registrarEvento(tx, {
    usuarioId, rol: 'admin', accion: 'cambio_programado', entidad: 'indicador', entidadId: antes.id, indicadorId: antes.id, ip,
    detalle: { antes: campos, despues: await camposConValores(tx, campos, valores), vigente_desde: vigenteDesde, cambio_id: programado.id,
               ...(previo ? { reemplaza: previo.id } : {}) },
  })
  return {
    programado,
    datos: { ...d, gerenciaId: antes.gerencia.id, frecuencia: antes.frecuencia, tipoCalculo: antes.tipo_calculo, acumulable: antes.acumulable,
             unidadId: cambios.gerencia_id !== undefined ? antes.unidad.id : d.unidadId },
  }
}

/** POST /api/admin/cambios-programados/:id/cancelar — solo si sigue pendiente (aún no abre el periodo). */
export const cancelar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const existente = UUID.test(id) ? await obtenerCambio(bd, id) : undefined
  if (!existente) return { status: 404, cuerpo: { error: 'no_encontrado', mensaje: 'Cambio programado no encontrado' } }
  return bd.transaccion(async (tx) => {
    const cancelado = await cancelarCambio(tx, id, s.sesion.usuarioId)
    if (!cancelado) {
      return { status: 409, cuerpo: { error: 'cambio_no_pendiente', mensaje: 'El cambio ya se aplicó o se canceló y no puede cancelarse' } }
    }
    const { campos } = await fotoDeCampos(tx, cancelado.indicador_id)
    await registrarEvento(tx, {
      usuarioId: s.sesion.usuarioId, rol: 'admin', accion: 'cambio_programado_cancelado', entidad: 'indicador',
      entidadId: cancelado.indicador_id, indicadorId: cancelado.indicador_id, ip: s.ip,
      detalle: { antes: await camposConValores(tx, campos, cancelado.valores), despues: campos, vigente_desde: cancelado.vigente_desde, cambio_id: cancelado.id },
    })
    return { status: 200, cuerpo: { cancelado: true, indicador_id: cancelado.indicador_id } }
  })
}
