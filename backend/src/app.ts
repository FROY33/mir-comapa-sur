// Rutas de la API. Autenticación y pendientes se agregan aquí en sus tickets.

import type { BD } from './bd.js'
import { listarFrecuencias } from './datos/frecuencias.js'
import { crearManejador } from './http.js'
import type { Log } from './log.js'

export function crearApp(bd: BD, log: Log) {
  return crearManejador({
    // 200 si la base responde; 503 si no (lo resuelve el manejo central de errores)
    'GET /api/salud': async () => ({
      status: 200,
      cuerpo: { estado: 'ok', bd: 'ok', esquema: await bd.versionEsquema() },
    }),

    'GET /api/frecuencias': async () => ({ status: 200, cuerpo: await listarFrecuencias(bd) }),
  }, log)
}
