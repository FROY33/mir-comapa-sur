// Rutas de consulta de indicadores, filtradas por la gerencia de la sesión (HU-R7-03).
//
// RN_2: para Revisor y Enlace la gerencia es SIEMPRE la de la sesión. Un `gerencia_id` en la
// URL o en el cuerpo se ignora; un indicador de otra gerencia responde 404, igual que uno que
// no existe, para no confirmar que existe (CA_5). El Administrador conserva el acceso global
// y es el único que puede elegir gerencia.

import type { BD } from './bd.js'
import type { SolicitudConSesion } from './autorizacion.js'
import { listarIndicadores, obtenerIndicador } from './datos/indicadores.js'
import type { Respuesta } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_ENCONTRADO: Respuesta = { status: 404, cuerpo: { error: 'no_encontrado', mensaje: 'Indicador no encontrado' } }

/**
 * La gerencia con la que se consulta: la de la sesión, salvo para el Administrador, que
 * puede pedir una (o ninguna: todas). Lo que mande otro rol no se lee.
 */
export function gerenciaDeConsulta(s: SolicitudConSesion, pedida: unknown): string | null {
  if (s.sesion.rol !== 'admin') return s.sesion.gerenciaId
  return typeof pedida === 'string' && UUID.test(pedida) ? pedida : null
}

/** GET /api/indicadores[?texto=…] — los de la gerencia de la sesión. */
export const listar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const gerencia = gerenciaDeConsulta(s, s.url.searchParams.get('gerencia_id'))
  return { status: 200, cuerpo: await listarIndicadores(bd, gerencia, s.url.searchParams.get('texto') ?? '') }
}

/** POST /api/indicadores/buscar { texto?, gerencia_id? } — la misma consulta con cuerpo. */
export const buscar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const cuerpo = await s.json()
  const gerencia = gerenciaDeConsulta(s, cuerpo.gerencia_id)
  const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto : ''
  return { status: 200, cuerpo: await listarIndicadores(bd, gerencia, texto) }
}

/** GET /api/indicadores/:id — 404 si no existe o es de otra gerencia. */
export const detalle = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  if (!UUID.test(id)) return NO_ENCONTRADO
  const gerencia = s.sesion.rol === 'admin' ? null : s.sesion.gerenciaId
  const indicador = await obtenerIndicador(bd, id, gerencia)
  return indicador ? { status: 200, cuerpo: indicador } : NO_ENCONTRADO
}
