// Capa HTTP mínima sobre node:http: una tabla de rutas «MÉTODO /ruta» y un único lugar
// donde los errores se convierten en respuesta. Ningún detalle interno llega al navegador.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { ErrorBD, detalleError } from './errores.js'
import type { Log } from './log.js'

export interface Solicitud {
  id: string
  url: URL
  req: IncomingMessage
  /** IP del cliente, para la bitácora. undefined si no se pudo determinar. */
  ip: string | undefined
}

export interface Respuesta {
  status: number
  cuerpo: unknown
}

export type Manejador = (s: Solicitud) => Promise<Respuesta>

export function crearManejador(
  rutas: Record<string, Manejador>,
  log: Log,
  opciones: { confiarProxy?: boolean } = {},
): RequestListener {
  return async (req, res) => {
    const id = randomUUID()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ruta = `${req.method} ${url.pathname}`
    const manejador = rutas[ruta]
    const ip = ipDelCliente(req, opciones.confiarProxy === true)

    try {
      if (!manejador) return enviar(res, id, 404, { error: 'no_encontrado', mensaje: 'Ruta no encontrada' })
      const { status, cuerpo } = await manejador({ id, url, req, ip })
      enviar(res, id, status, cuerpo)
    } catch (err) {
      const e = err instanceof ErrorBD ? err : null
      const status = e?.status ?? 500
      log[status >= 500 ? 'error' : 'aviso']('Solicitud fallida', { solicitud: id, ruta, status, ...detalleError(err) })
      enviar(res, id, status, {
        error: e?.tipo ?? 'interno',
        mensaje: e?.message ?? 'Error interno',
        ...(status < 500 && e?.restriccion ? { restriccion: e.restriccion } : {}),
        solicitud: id,   // para buscar el detalle en el log
      })
    }
  }
}

/**
 * IP del cliente para la bitácora (columna `inet`).
 *
 * Sin confiarProxy se usa la dirección del socket, que no se puede falsear. Con
 * confiarProxy se toma la primera entrada de X-Forwarded-For, que es el cliente
 * original cuando hay un proxy propio delante. Las direcciones IPv4 mapeadas en
 * IPv6 (`::ffff:10.0.0.1`) se normalizan a su forma IPv4.
 */
export function ipDelCliente(req: IncomingMessage, confiarProxy: boolean): string | undefined {
  let ip = req.socket.remoteAddress

  if (confiarProxy) {
    const cabecera = req.headers['x-forwarded-for']
    const lista = Array.isArray(cabecera) ? cabecera[0] : cabecera
    const primera = lista?.split(',')[0]?.trim()
    if (primera) ip = primera
  }

  if (ip === undefined || ip === '') return undefined
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  return mapeada?.[1] ?? ip
}

function enviar(res: ServerResponse, id: string, status: number, cuerpo: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': id,
  })
  res.end(JSON.stringify(cuerpo))
}
