// Ventanas de captura y apertura de ciclos (HU-R3-01).
//   GET  /api/periodos/abiertos   los tres roles: periodo abierto y fecha límite (CA_6)
//   GET  /api/admin/ventanas      solo Admin (CA_1)
//   PUT  /api/admin/ventanas      { dias: { mensual: 10, … } }, validado (CA_2)
//   POST /api/admin/ciclos/abrir  corre la apertura ya, sin esperar al job
// El job corre solo desde servidor.ts (al arrancar y cada hora). Ver datos/ciclos.ts.

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD, Ejecutor } from './bd.js'
import { registrarEvento } from './datos/bitacora.js'
import { abrirCiclos, periodosAbiertos, type Apertura } from './datos/ciclos.js'
import type { Respuesta } from './http.js'

/** Hoy en la hora de la base (America/Monterrey), no la del servidor. */
async function hoy(bd: Ejecutor): Promise<string> {
  const [f] = await bd.consultar<{ hoy: string }>('SELECT current_date::text AS hoy')
  return f!.hoy
}

/** Abre lo que toque y deja en la bitácora cada periodo nuevo o reporte generado. */
export async function correrApertura(bd: BD, autor?: { usuarioId: string }): Promise<Apertura[]> {
  return bd.transaccion(async (tx) => {
    const aperturas = await abrirCiclos(tx, await hoy(tx))
    for (const a of aperturas.filter((x) => x.periodo_nuevo || x.reportes_creados > 0)) {
      await registrarEvento(tx, {
        ...(autor ? { usuarioId: autor.usuarioId, rol: 'admin' as const } : {}),
        accion: 'ciclo_abierto', entidad: 'periodo', entidadId: `${a.frecuencia}:${a.etiqueta}`, detalle: a,
      })
    }
    return aperturas
  })
}

export const abiertos = (bd: BD) => async (): Promise<Respuesta> =>
  ({ status: 200, cuerpo: await periodosAbiertos(bd) })

export const ventanas = (bd: BD) => async (): Promise<Respuesta> => ({
  status: 200,
  cuerpo: await bd.consultar(
    `SELECT clave, nombre, meses, dias_habiles, meses * 23 AS maximo FROM frecuencias ORDER BY meses`),
})

/** CA_2: entero mayor que 0 y no más largo que el periodo (el CHECK de la tabla usa 23 días hábiles por mes). */
export const guardarVentanas = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const cuerpo = await s.json()
  const dias = (cuerpo.dias ?? {}) as Record<string, unknown>
  const actuales = await bd.consultar<{ clave: string; meses: number; dias_habiles: number }>(
    'SELECT clave, meses, dias_habiles FROM frecuencias')
  const errores: string[] = []
  const cambios: { clave: string; antes: number; despues: number }[] = []
  for (const [clave, valor] of Object.entries(dias)) {
    const f = actuales.find((x) => x.clave === clave)
    if (!f) { errores.push(`frecuencia desconocida: ${clave}`); continue }
    if (!Number.isInteger(valor) || (valor as number) < 1) { errores.push(`${clave}: los días hábiles deben ser un entero mayor que 0`); continue }
    if ((valor as number) > f.meses * 23) { errores.push(`${clave}: la ventana no puede ser más larga que el periodo (máximo ${f.meses * 23})`); continue }
    if (valor !== f.dias_habiles) cambios.push({ clave, antes: f.dias_habiles, despues: valor as number })
  }
  if (errores.length > 0) return { status: 422, cuerpo: { error: 'ventana_invalida', mensaje: errores.join('; ') } }

  await bd.transaccion(async (tx) => {
    for (const c of cambios) {
      await tx.consultar('UPDATE frecuencias SET dias_habiles = $2, updated_por = $3 WHERE clave = $1', [c.clave, c.despues, s.sesion.usuarioId])
      await registrarEvento(tx, {
        usuarioId: s.sesion.usuarioId, rol: 'admin', accion: 'ventana_actualizada', entidad: 'frecuencia',
        entidadId: c.clave, ip: s.ip, detalle: { antes: c.antes, despues: c.despues },
      })
    }
  })
  return { status: 200, cuerpo: { cambios, nota: 'Aplica a los periodos que se abran después; los abiertos conservan su fecha límite' } }
}

export const abrirAhora = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> =>
  ({ status: 200, cuerpo: { aperturas: await correrApertura(bd, { usuarioId: s.sesion.usuarioId }) } })
