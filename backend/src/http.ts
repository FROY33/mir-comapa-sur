// Capa HTTP mínima sobre node:http: una tabla de rutas «MÉTODO /ruta» y un único lugar
// donde los errores se convierten en respuesta. Ningún detalle interno llega al navegador.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { ErrorBD, ErrorSolicitud, detalleError } from './errores.js'
import type { Log } from './log.js'

/** Tope del cuerpo de una petición. Un login son unos cientos de bytes. */
const MAX_CUERPO_BYTES = 64 * 1024

export interface Solicitud {
  id: string
  url: URL
  req: IncomingMessage
  /** IP del cliente, para la bitácora. undefined si no se pudo determinar. */
  ip: string | undefined
  /** Cookies de la petición, ya separadas. */
  cookies: Record<string, string>
  /** Parámetros de la ruta: para «GET /api/indicadores/:id», { id }. */
  params: Record<string, string>
  /** Lee el cuerpo como JSON. Falla con 400 si no es JSON o excede el tope. */
  json: () => Promise<Record<string, unknown>>
}

/** Cookie a escribir en la respuesta. */
export interface CookieSalida {
  nombre: string
  valor: string
  /**
   * Segundos de vida. Sin valor es cookie de sesión del navegador: dura hasta que se cierra,
   * y la expiración real la decide el servidor (8 h de inactividad, HU-R7-01 RN_2). 0 la borra.
   */
  maxEdadSegundos?: number
  /** Solo en producción: una cookie Secure no se guarda sobre HTTP. */
  secure: boolean
  /**
   * false para la cookie de perfil, que el frontend sí necesita leer. El token de
   * sesión siempre va con HttpOnly (CA-3).
   */
  httpOnly?: boolean
}

export interface Respuesta {
  status: number
  cuerpo: unknown
  /** Cookies a poner o borrar (maxEdadSegundos 0 la borra). */
  cookies?: CookieSalida[]
}

export type Manejador = (s: Solicitud) => Promise<Respuesta>

export function crearManejador(
  rutas: Record<string, Manejador>,
  log: Log,
  opciones: { confiarProxy?: boolean } = {},
): RequestListener {
  const buscar = crearBuscador(rutas)
  return async (req, res) => {
    const id = randomUUID()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ruta = `${req.method} ${url.pathname}`
    const encontrada = buscar(req.method ?? '', url.pathname)
    const ip = ipDelCliente(req, opciones.confiarProxy === true)

    try {
      if (!encontrada) return enviar(res, id, 404, { error: 'no_encontrado', mensaje: 'Ruta no encontrada' })
      const { status, cuerpo, cookies } = await encontrada.manejador({
        id, url, req, ip,
        params: encontrada.params,
        cookies: leerCookies(req.headers.cookie),
        json: () => leerJson(req),
      })
      enviar(res, id, status, cuerpo, cookies)
    } catch (err) {
      const e = err instanceof ErrorBD || err instanceof ErrorSolicitud ? err : null
      const status = e?.status ?? 500
      log[status >= 500 ? 'error' : 'aviso']('Solicitud fallida', { solicitud: id, ruta, status, ...detalleError(err) })
      enviar(res, id, status, {
        error: e?.tipo ?? 'interno',
        mensaje: e?.message ?? 'Error interno',
        ...(status < 500 && e instanceof ErrorBD && e.restriccion ? { restriccion: e.restriccion } : {}),
        solicitud: id,   // para buscar el detalle en el log
      })
    }
  }
}

/**
 * Busca la ruta de una petición: primero la exacta y luego las que tienen parámetros
 * («GET /api/indicadores/:id»). Un parámetro es un segmento completo y nunca contiene «/».
 */
function crearBuscador(rutas: Record<string, Manejador>) {
  const conParametros = Object.entries(rutas)
    .filter(([clave]) => clave.includes('/:'))
    .map(([clave, manejador]) => {
      const [metodo, patron] = clave.split(' ') as [string, string]
      const nombres: string[] = []
      const regex = new RegExp('^' + patron.replace(/:([a-zA-Z]+)/g, (_, n: string) => {
        nombres.push(n)
        return '([^/]+)'
      }) + '$')
      return { metodo, regex, nombres, manejador }
    })

  return (metodo: string, ruta: string) => {
    const exacta = rutas[`${metodo} ${ruta}`]
    if (exacta) return { manejador: exacta, params: {} as Record<string, string> }
    for (const r of conParametros) {
      const m = r.metodo === metodo ? r.regex.exec(ruta) : null
      if (!m) continue
      let params: Record<string, string>
      try {
        params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]))
      } catch {
        return null                                  // %XX mal formado: como si no existiera
      }
      return { manejador: r.manejador, params }
    }
    return null
  }
}

/**
 * IP del cliente para la bitácora (columna `inet`).
 *
 * Sin confiarProxy se usa la dirección del socket, que no se puede falsear. Con
 * confiarProxy se toma la ÚLTIMA entrada de X-Forwarded-For: la agrega nuestro proxy y
 * es la única confiable; las anteriores las puede inventar el cliente. Lo que no sea una
 * IP válida se ignora y se usa el socket: un valor basura llegaría a la columna `inet`,
 * fallaría el INSERT y con él se desharía el bloqueo por intentos (auditoría 10/10/2026).
 * Las direcciones IPv4 mapeadas en IPv6 (`::ffff:10.0.0.1`) se normalizan a IPv4.
 */
export function ipDelCliente(req: IncomingMessage, confiarProxy: boolean): string | undefined {
  const normalizar = (ip: string | undefined) => {
    const limpia = ip?.trim()
    if (!limpia || isIP(limpia) === 0) return undefined
    return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia)?.[1] ?? limpia
  }
  const socket = normalizar(req.socket.remoteAddress)
  if (!confiarProxy) return socket

  const cabecera = req.headers['x-forwarded-for']
  const lista = Array.isArray(cabecera) ? cabecera.join(',') : cabecera
  return normalizar(lista?.split(',').at(-1)) ?? socket
}

/**
 * Separa el encabezado Cookie. No decodifica más de lo necesario: el valor se
 * devuelve tal cual viene, con percent-decoding, que es como lo escribió el servidor.
 */
export function leerCookies(encabezado: string | undefined): Record<string, string> {
  if (!encabezado) return {}
  const cookies: Record<string, string> = {}
  for (const parte of encabezado.split(';')) {
    const corte = parte.indexOf('=')
    if (corte < 1) continue
    const nombre = parte.slice(0, corte).trim()
    const valor = parte.slice(corte + 1).trim()
    if (nombre === '' || nombre in cookies) continue      // la primera gana
    try { cookies[nombre] = decodeURIComponent(valor) } catch { cookies[nombre] = valor }
  }
  return cookies
}

/**
 * Cuerpo de la petición como JSON. Corta en MAX_CUERPO_BYTES para que un cuerpo
 * enorme no consuma memoria, y falla con 400 si no es un objeto JSON.
 */
export async function leerJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const trozo of req) {
    total += (trozo as Buffer).length
    if (total > MAX_CUERPO_BYTES) throw new ErrorSolicitud('El cuerpo de la petición es demasiado grande', 413)
    trozos.push(trozo as Buffer)
  }
  if (total === 0) throw new ErrorSolicitud('Falta el cuerpo de la petición')
  let valor: unknown
  try {
    valor = JSON.parse(Buffer.concat(trozos).toString('utf8'))
  } catch {
    throw new ErrorSolicitud('El cuerpo no es JSON válido')
  }
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErrorSolicitud('El cuerpo debe ser un objeto JSON')
  }
  return valor as Record<string, unknown>
}

/**
 * Serializa una cookie de sesión. Siempre HttpOnly (CA-3) y SameSite=Strict: el
 * frontend y la API se sirven del mismo origen detrás de un proxy, así que el
 * navegador sí la manda. Secure solo donde hay HTTPS.
 */
function serializarCookie(c: CookieSalida): string {
  const partes = [
    `${c.nombre}=${encodeURIComponent(c.valor)}`,
    'Path=/',
    'SameSite=Strict',
  ]
  if (c.maxEdadSegundos !== undefined) partes.push(`Max-Age=${c.maxEdadSegundos}`)
  if (c.httpOnly !== false) partes.push('HttpOnly')
  if (c.maxEdadSegundos === 0) partes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  if (c.secure) partes.push('Secure')
  return partes.join('; ')
}

function enviar(res: ServerResponse, id: string, status: number, cuerpo: unknown, cookies?: CookieSalida[]): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': id,
    ...(cookies?.length ? { 'set-cookie': cookies.map(serializarCookie) } : {}),
  })
  res.end(JSON.stringify(cuerpo))
}
