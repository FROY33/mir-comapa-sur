#!/usr/bin/env node
// Servidor de desarrollo: sirve el prototipo estático de la raíz del repo y reenvía
// /api/* al backend, de modo que ambos queden en el mismo origen.
//
// Hace falta porque la cookie de sesión es SameSite=Strict (HU-R7-01 CA-3): si el
// estático y la API estuvieran en orígenes distintos, el navegador no mandaría la
// cookie y no se podría iniciar sesión. En producción esto lo resuelve la plataforma
// (Netlify redirigiendo /api/*, o nginx); esto es su equivalente local.
//
//   npm run dev          en una terminal: el backend en :3000
//   npm run dev:sitio    en otra: el prototipo en :4321
//
// Variables: PUERTO_SITIO (4321), BACKEND_URL (http://127.0.0.1:3000)

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request as pedirAlBackend, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(fileURLToPath(import.meta.url), '../../..')   // la raíz del repo
const PUERTO = Number(process.env.PUERTO_SITIO ?? 4321)
const BACKEND = new URL(process.env.BACKEND_URL ?? 'http://127.0.0.1:3000')
const INICIO = '/login.html'

/**
 * Lo que este servidor NO sirve, aunque esté dentro de la raíz del repo. La
 * protección de traversal impide salirse de la raíz, pero dentro de ella hay cosas
 * que no son del prototipo y que no deben viajar por HTTP: .env tiene la cadena de
 * conexión a la base, y .git el historial completo.
 */
const PROHIBIDOS = ['backend', 'node_modules', '.git', 'seed', '.netlify']

/** Un segmento que empieza con punto nunca se sirve (.env, .git, .DS_Store...). */
const esOculto = (segmento: string) => segmento.startsWith('.')

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Reenvía la petición al backend tal cual, con sus cabeceras y su cuerpo. */
function reenviar(req: IncomingMessage, res: ServerResponse): void {
  const destino = pedirAlBackend(
    {
      protocol: BACKEND.protocol,
      hostname: BACKEND.hostname,
      port: BACKEND.port,
      path: req.url,
      method: req.method,
      // Se reescribe host para que el backend no vea el del proxy
      headers: { ...req.headers, host: BACKEND.host },
    },
    (respuesta) => {
      res.writeHead(respuesta.statusCode ?? 502, respuesta.headers)
      respuesta.pipe(res)
    },
  )

  destino.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      error: 'backend_inalcanzable',
      mensaje: `No se pudo hablar con el backend en ${BACKEND.origin}. ¿Está corriendo \`npm run dev\`?`,
      causa: err.message,
    }))
  })

  req.pipe(destino)
}

/**
 * Resuelve una ruta del sitio a un archivo dentro de la raíz del repo.
 * Devuelve null si se sale de la raíz: sin esto, `/../../.ssh/id_rsa` sería servible.
 */
async function archivoDe(ruta: string): Promise<string | null> {
  let decodificada: string
  try { decodificada = decodeURIComponent(ruta) } catch { return null }

  const candidato = resolve(join(RAIZ, decodificada === '/' ? INICIO : decodificada))
  if (candidato !== RAIZ && !candidato.startsWith(RAIZ + sep)) return null

  const segmentos = candidato.slice(RAIZ.length).split(sep).filter(Boolean)
  if (segmentos.some(esOculto)) return null
  if (segmentos.length > 0 && PROHIBIDOS.includes(segmentos[0]!)) return null

  try {
    const info = await stat(candidato)
    if (info.isDirectory()) return archivoDe(join(decodificada, 'index.html'))
    return info.isFile() ? candidato : null
  } catch {
    return null
  }
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PUERTO}`)

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    reenviar(req, res)
    return
  }

  void archivoDe(url.pathname).then((archivo) => {
    if (archivo === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`No existe ${url.pathname}`)
      return
    }
    res.writeHead(200, {
      'content-type': TIPOS[extname(archivo).toLowerCase()] ?? 'application/octet-stream',
      // El prototipo se edita a mano todo el tiempo: que el navegador no lo cachee
      'cache-control': 'no-store',
    })
    createReadStream(archivo).pipe(res)
  })
})

servidor.listen(PUERTO, '127.0.0.1', () => {
  process.stdout.write(
    `Prototipo en http://127.0.0.1:${PUERTO}${INICIO}\n` +
    `  estático  ${RAIZ}\n` +
    `  /api/*  →  ${BACKEND.origin}\n`,
  )
})

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => { servidor.close(() => process.exit(0)) })
}
