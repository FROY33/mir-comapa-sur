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
// La raíz sirve index.html, que decide a dónde va cada quien según su sesión
// (HU-R7-02 CA_2). En producción el host hace lo mismo con su documento por defecto.
const INICIO = '/index.html'

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

/**
 * Cabeceras de seguridad para todo lo que sirve este servidor (no para /api, que pone las
 * suyas). Producción debe enviar las mismas: ver «Cabeceras de seguridad» en backend/README.md.
 *
 * La CSP lleva 'unsafe-inline' en script-src porque las páginas tienen scripts y manejadores
 * en línea (onclick=...): sin él no funcionaría ninguna. Eso significa que la CSP NO frena un
 * XSS que logre inyectar HTML; esa defensa es escapar los datos (escaparHTML en session.js).
 * Lo que sí hace: impide cargar scripts de cualquier otro dominio (todo lo que corre sale de
 * este sitio; Chart.js y xlsx viven en vendor/), enviar datos fuera, incrustar la página en un
 * iframe ajeno (clickjacking) y usar <base> u <object>. Solo se permite Google Fonts para
 * estilos y fuentes. Sin analítica de terceros: grababa sesiones con datos reales, incluida la
 * página donde se teclea la contraseña (auditoría del 11/10/2026).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Páginas sin ningún script ni manejador en línea, con una CSP sin 'unsafe-inline': ahí un XSS
 * no puede ejecutar código aunque lograra inyectar HTML. Son las que reciben contraseñas. Una
 * página entra a esta lista cuando ya no tiene <script> sin src ni atributos on*= (lo verifica
 * pruebas/cabeceras-sitio.test.ts).
 */
export const PAGINAS_CSP_ESTRICTA = new Set(['index.html', 'login.html', 'cambiar-password.html'])
const CSP_ESTRICTA = CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")

const CABECERAS_SEGURIDAD: Record<string, string> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
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

/** Páginas que se sirven sin sesión. Las mismas que PAGINAS_PUBLICAS de guardia.js. */
const PUBLICAS = new Set(['index.html', 'login.html', 'demo-enlace.html', 'demo-revisor.html', 'design-system.html'])

type Veredicto = { status: 200 } | { status: 401 } | { status: 403; redirigirA: string }

/**
 * HU-R7-03 CA_1 y CA_2 a nivel HTTP: antes de servir una página protegida se le pregunta al
 * backend si la sesión de la cookie puede abrirla. En producción, el servidor web (nginx con
 * auth_request, o similar) debe hacer esta misma consulta a GET /api/auth/acceso.
 */
function verificarAcceso(pagina: string, cookie: string | undefined): Promise<Veredicto> {
  return new Promise((resolver) => {
    const consulta = pedirAlBackend({
      protocol: BACKEND.protocol, hostname: BACKEND.hostname, port: BACKEND.port,
      path: `/api/auth/acceso?pagina=${encodeURIComponent(pagina)}`, method: 'GET',
      headers: cookie ? { cookie } : {},
    }, (r) => {
      let texto = ''
      r.on('data', (t) => { texto += t })
      r.on('end', () => {
        if (r.statusCode === 401) return resolver({ status: 401 })
        if (r.statusCode === 403) {
          let redirigirA = 'login.html'
          try { redirigirA = JSON.parse(texto).redirigirA ?? redirigirA } catch {}
          return resolver({ status: 403, redirigirA })
        }
        resolver({ status: 200 })          // 200, o un backend con problemas: los datos los protege él
      })
    })
    consulta.on('error', () => resolver({ status: 200 }))
    consulta.end()
  })
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PUERTO}`)

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    reenviar(req, res)
    return
  }

  // Todo lo estático (páginas, scripts, 404, 302 y 403) sale con las cabeceras de seguridad
  for (const [nombre, valor] of Object.entries(CABECERAS_SEGURIDAD)) res.setHeader(nombre, valor)

  void archivoDe(url.pathname).then(async (archivo) => {
    if (archivo === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`No existe ${url.pathname}`)
      return
    }
    const pagina = archivo.slice(RAIZ.length + 1)
    if (PAGINAS_CSP_ESTRICTA.has(pagina)) res.setHeader('content-security-policy', CSP_ESTRICTA)
    if (pagina.endsWith('.html') && !PUBLICAS.has(pagina)) {
      const veredicto = await verificarAcceso(pagina, req.headers.cookie)
      if (veredicto.status === 401) {
        // Si traía cookie de sesión, la sesión expiró: el login lo dice (HU-R7-05 CA_1) y la
        // página se recuerda para volver a ella tras iniciar sesión (CA_3), igual que hace
        // guardia.js cuando el 401 llega a una página ya abierta.
        const expirada = /(?:^|;\s*)comapa_sesion=/.test(req.headers.cookie ?? '')
        res.writeHead(302, {
          location: expirada ? '/login.html?sesion=expirada' : '/login.html',
          'cache-control': 'no-store',
          'set-cookie': `comapa_destino=${encodeURIComponent(pagina)}; Path=/; Max-Age=600; SameSite=Strict`,
        })
        res.end()
        return
      }
      if (veredicto.status === 403) {
        // CA_1: 403 y, en el mismo cuerpo, la redirección al dashboard del propio rol
        const destino = encodeURI(veredicto.redirigirA)
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/${destino}">` +
          `<title>Sin acceso</title><p>No tienes permiso para esta sección. <a href="/${destino}">Ir a tu inicio</a></p>`)
        return
      }
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
    `Prototipo en http://127.0.0.1:${PUERTO}/\n` +
    `  estático  ${RAIZ}\n` +
    `  /api/*  →  ${BACKEND.origin}\n`,
  )
})

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => { servidor.close(() => process.exit(0)) })
}
