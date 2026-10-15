// Ruta de la Consulta MIR (HU-R8-01), solo para Revisor y Administrador. Solo lectura (RN_1).
// La gerencia sale de la sesión; el Administrador puede pedir una o ninguna (todas), igual que en
// /api/indicadores (CA_6).

import type { BD } from './bd.js'
import type { SolicitudConSesion } from './autorizacion.js'
import { consultarCatalogoMir } from './datos/consultaMir.js'
import type { Respuesta } from './http.js'
import { gerenciaDeConsulta } from './indicadores.js'

/** GET /api/consulta-mir[?gerencia_id=…] */
export const listar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const gerencia = gerenciaDeConsulta(s, s.url.searchParams.get('gerencia_id'))
  return { status: 200, cuerpo: await consultarCatalogoMir(bd, gerencia) }
}
