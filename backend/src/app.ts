// Rutas de la API. Autenticación y pendientes se agregan aquí en sus tickets.

import { login, sesion } from './auth.js'
import type { BD } from './bd.js'
import { listarFrecuencias } from './datos/frecuencias.js'
import { crearManejador } from './http.js'
import type { Log } from './log.js'

export function crearApp(
  bd: BD,
  log: Log,
  opciones: { confiarProxy?: boolean; produccion?: boolean } = {},
) {
  return crearManejador({
    // Autenticación (HU-R7-01). El cierre de sesión entra con HU-R7-04.
    'POST /api/auth/login': login(bd, opciones.produccion === true),
    'GET /api/auth/sesion': sesion(bd, opciones.produccion === true),

    // 200 si la base responde; 503 si no (lo resuelve el manejo central de errores)
    'GET /api/salud': async () => ({
      status: 200,
      cuerpo: { estado: 'ok', bd: 'ok', esquema: await bd.versionEsquema() },
    }),

    'GET /api/frecuencias': async () => ({ status: 200, cuerpo: await listarFrecuencias(bd) }),
  }, log, opciones)
}
