// Cabeceras de seguridad del servidor de desarrollo (dev/servir.ts): cada página, script o
// error que entrega lleva nosniff, la CSP, la protección contra iframes y el resto. Se arranca
// el servidor real como proceso aparte, con un backend inalcanzable: no hace falta para servir.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { RAIZ } from './apoyo-frontend.js'

/** Un puerto libre: se abre en 0, se anota y se cierra. */
const puertoLibre = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number }
    s.close(() => ok(port))
  })
})

let base = ''
let detener = () => {}

before(async () => {
  const puerto = await puertoLibre()
  const proceso = spawn(process.execPath, ['--import', 'tsx', 'dev/servir.ts'], {
    env: { ...process.env, PUERTO_SITIO: String(puerto), BACKEND_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  detener = () => { proceso.kill('SIGTERM') }
  await new Promise<void>((ok, falla) => {
    proceso.stdout.on('data', (t: Buffer) => { if (String(t).includes('Prototipo en')) ok() })
    proceso.once('exit', (c) => falla(new Error(`dev/servir.ts terminó antes de tiempo (código ${c})`)))
  })
  base = `http://127.0.0.1:${puerto}`
})
after(() => detener())

describe('dev/servir.ts: cabeceras de seguridad', () => {
  for (const ruta of ['/login.html', '/session.js', '/shared.css', '/dashboard-admin.html', '/no-existe.html']) {
    test(`${ruta} las lleva`, async () => {
      const r = await fetch(base + ruta, { redirect: 'manual' })
      await r.arrayBuffer()
      const h = r.headers
      assert.equal(h.get('x-content-type-options'), 'nosniff')
      assert.equal(h.get('x-frame-options'), 'DENY')
      assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin')
      assert.match(h.get('permissions-policy') ?? '', /camera=\(\).*microphone=\(\).*geolocation=\(\)/)
      const csp = h.get('content-security-policy') ?? ''
      for (const directiva of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
        assert.ok(csp.includes(directiva), `falta ${directiva} en la CSP: ${csp}`)
      }
    })
  }

  test('la CSP no deja cargar scripts de cualquier dominio ni usar eval', async () => {
    const csp = (await fetch(`${base}/login.html`)).headers.get('content-security-policy') ?? ''
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? ''
    assert.ok(!/\s(\*|https:|http:)(\s|$)/.test(scriptSrc), `script-src demasiado abierto: ${scriptSrc}`)
    assert.ok(!scriptSrc.includes("'unsafe-eval'"))
    assert.equal(scriptSrc, "script-src 'self' 'unsafe-inline'", 'script-src no debe permitir ningún dominio externo')
  })
})

describe('sin terceros ni identidad en el navegador (auditoría 11/10/2026)', () => {
  const paginas = readdirSync(RAIZ).filter((f) => f.endsWith('.html') || f.endsWith('.js'))

  test('ninguna página carga scripts de otro dominio ni analítica de terceros', () => {
    const externos = paginas.filter((f) => /<script[^>]+src=["']https?:\/\//i.test(readFileSync(path.join(RAIZ, f), 'utf8')))
    const analitica = paginas.filter((f) => /maze\.co|contentsquare/i.test(readFileSync(path.join(RAIZ, f), 'utf8')))
    assert.deepEqual([externos, analitica], [[], []])
  })

  test('ninguna vista decide gerencia, unidad o rol con localStorage (el usuario puede cambiarlo)', () => {
    const lectores = paginas
      .filter((f) => !f.startsWith('demo-'))      // las páginas demo solo escriben, nadie lo lee
      .filter((f) => /localStorage\.getItem\(\s*['"](userGerencia|userUnidad|comapa_mir_session)['"]/.test(readFileSync(path.join(RAIZ, f), 'utf8')))
    assert.deepEqual(lectores, [])
  })

  test('dev-toolbar no se activa fuera de un equipo local, aunque la URL traiga ?dev=1', () => {
    const codigo = readFileSync(path.join(RAIZ, 'dev-toolbar.js'), 'utf8')
    // Si se activara, tocaría el documento o la ventana (ahora o en un listener): basta con que no los toque
    const tocados: string[] = []
    const espia = (nombre: string) => new Proxy({}, { get: (_, prop) => { tocados.push(`${nombre}.${String(prop)}`); return () => ({}) } })
    new Function('location', 'sessionStorage', 'document', 'window', codigo)(
      { hostname: 'mir.comapasur.gob.mx', search: '?dev=1' }, { getItem: () => '1', setItem() {} }, espia('document'), espia('window'))
    assert.deepEqual(tocados, [])
  })
})
