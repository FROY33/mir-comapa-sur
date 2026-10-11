// Frontend de HU-R7-03 (guardia de páginas) y HU-R7-05 (sesión expirada), en session.js.
// Se ejecuta el archivo real con un DOM mínimo simulado: qué pide al servidor, a dónde
// navega y qué muestra. La seguridad de los datos se prueba en autorizacion.test.ts.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { codigoSesion, RAIZ } from './apoyo-frontend.js'

const esperar = () => new Promise((ok) => setImmediate(ok))

interface Nodo { tag: string; hijos: Nodo[]; textContent: string; parentNode: Nodo | null; [k: string]: unknown }

function nodo(tag: string): Nodo {
  const n: Nodo = {
    tag, hijos: [], textContent: '', parentNode: null, style: {}, oyentes: {} as Record<string, () => void>,
    setAttribute: () => {},
    appendChild: (h: Nodo) => { h.parentNode = n; n.hijos.push(h); return h },
    removeChild: (h: Nodo) => { n.hijos = n.hijos.filter((x) => x !== h); h.parentNode = null },
    addEventListener: (ev: string, fn: () => void) => { (n.oyentes as Record<string, () => void>)[ev] = fn },
    focus: () => {},
  }
  return n
}

const PERFIL = `comapa_perfil=${encodeURIComponent(JSON.stringify({
  nombre: 'Ana Torres', email: 'a@b.mx', rol: 'enlace', gerencia: 'Comercial', gerenciaClave: 'COM',
  unidad: 'X', redirigirA: 'dashboard-enlace.html',
}))}`

/** Abre `pagina` con session.js. `acceso` es la respuesta de GET /api/auth/acceso. */
function abrir(pagina: string, opciones: { cookie?: string; acceso?: { status: number; cuerpo?: unknown } } = {}) {
  const codigo = codigoSesion()
  const cookies: string[] = [opciones.cookie ?? PERFIL]
  const navegaciones: string[] = []
  const peticiones: string[] = []
  const head = nodo('head')
  const body = nodo('body')
  const oyentesDoc: Record<string, (e: unknown) => void> = {}
  const documento = {
    head, body, documentElement: nodo('html'),
    get cookie() { return cookies.join('; ') },
    set cookie(v: string) { cookies.push(v.split(';')[0]!) },
    createElement: (tag: string) => nodo(tag),
    addEventListener: (ev: string, fn: (e: unknown) => void) => { oyentesDoc[ev] = fn },
  }
  const ventana = {
    location: { pathname: `/${pagina}`, href: '', replace: (u: string) => { navegaciones.push(u) } },
    addEventListener: () => {},
  }
  const respuesta = opciones.acceso ?? { status: 200, cuerpo: { permitido: true } }
  const fetchFalso = (ruta: string) => {
    peticiones.push(ruta)
    const r = ruta.startsWith('/api/auth/acceso') ? respuesta : { status: 401, cuerpo: { error: 'no_autenticado' } }
    return Promise.resolve({ ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.cuerpo ?? {}) })
  }
  const api = new Function('window', 'document', 'fetch', `${codigo}\n; return { Session, pedir }`)(
    ventana, documento, fetchFalso) as { Session: { login: (e: string, p: string) => Promise<unknown> }; pedir: (r: string) => Promise<unknown> }

  const velo = () => head.hijos.find((h) => h.tag === 'style')
  const escribir = () => oyentesDoc.input?.({ target: { tagName: 'INPUT' } })
  const aviso = () => body.hijos.find((h) => h.tag === 'div')
  return { ...api, navegaciones, peticiones, cookies, velo, escribir, aviso }
}

describe('HU-R7-03: guardia de páginas', () => {
  test('las páginas públicas no se revisan', () => {
    for (const pagina of ['login.html', 'index.html', '']) {
      const p = abrir(pagina, { cookie: '' })
      assert.deepEqual([p.peticiones, p.navegaciones], [[], []], pagina)
    }
  })

  test('CA_2: sin sesión, una página protegida va al login y recuerda a dónde iba', () => {
    const p = abrir('configuracion.html', { cookie: '' })
    assert.deepEqual(p.navegaciones, ['login.html'])
    assert.ok(p.cookies.includes('comapa_destino=configuracion.html'))
    assert.deepEqual(p.peticiones, [])
  })

  test('la página queda oculta hasta que el servidor responde, y con 200 se muestra', async () => {
    const p = abrir('dashboard-enlace.html')
    assert.ok(p.velo(), 'la página no se ocultó mientras se revisaba')
    assert.deepEqual(p.peticiones, ['/api/auth/acceso?pagina=dashboard-enlace.html'])
    await esperar()
    assert.equal(p.velo(), undefined)
    assert.deepEqual(p.navegaciones, [])
  })

  test('CA_1: un Enlace en dashboard-admin.html recibe 403 y va a su dashboard, sin ver la página', async () => {
    const p = abrir('dashboard-admin.html', { acceso: { status: 403, cuerpo: { redirigirA: 'dashboard-enlace.html' } } })
    await esperar()
    assert.deepEqual(p.navegaciones, ['dashboard-enlace.html'])
    assert.ok(p.velo(), 'la página prohibida se mostró')
  })

  test('si el backend no responde bien (5xx), se muestra: los datos los protege el backend', async () => {
    const p = abrir('dashboard-enlace.html', { acceso: { status: 503 } })
    await esperar()
    assert.equal(p.velo(), undefined)
  })
})

describe('HU-R7-05: sesión expirada', () => {
  test('CA_1: un 401 al abrir la página lleva al login con el aviso y recuerda la página (CA_3)', async () => {
    const p = abrir('mis-actividades.html', { acceso: { status: 401 } })
    await esperar()
    assert.deepEqual(p.navegaciones, ['login.html?sesion=expirada'])
    assert.ok(p.cookies.includes('comapa_destino=mis-actividades.html'))
  })

  test('CA_1: un 401 de cualquier petición posterior también', async () => {
    const p = abrir('mis-actividades.html')
    await esperar()
    await p.pedir('/api/indicadores')
    assert.deepEqual(p.navegaciones, ['login.html?sesion=expirada'])
  })

  test('CA_2: con datos sin guardar, primero avisa en la página y solo redirige al confirmar', async () => {
    const p = abrir('reporte-avance.html')
    await esperar()
    p.escribir()
    await p.pedir('/api/indicadores')
    assert.deepEqual(p.navegaciones, [], 'redirigió sin avisar')
    const aviso = p.aviso()!
    const textos = JSON.stringify(aviso, (k, v) => (k === 'parentNode' ? undefined : v))
    assert.match(textos, /Tu sesión expiró\. Inicia sesión nuevamente\./)
    const boton = aviso.hijos[0]!.hijos.find((h) => h.tag === 'button')!
    ;(boton.oyentes as Record<string, () => void>).click!()
    assert.deepEqual(p.navegaciones, ['login.html?sesion=expirada'])
  })

  test('varios 401 seguidos navegan una sola vez', async () => {
    const p = abrir('mis-actividades.html')
    await esperar()
    await Promise.all([p.pedir('/api/indicadores'), p.pedir('/api/indicadores'), p.pedir('/api/admin/configuracion')])
    assert.equal(p.navegaciones.length, 1)
  })

  test('el 401 de un login con contraseña mala no es una sesión expirada', async () => {
    const p = abrir('login.html', { cookie: '' })
    await p.Session.login('a@b.mx', 'mala')
    assert.deepEqual(p.navegaciones, [])
  })
})

describe('las páginas cargan la guardia', () => {
  test('toda página con session.js carga guardia.js y vistas-mir.js justo después, en el <head>', () => {
    const faltan: string[] = []
    for (const archivo of readdirSync(RAIZ).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(path.join(RAIZ, archivo), 'utf8')
      if (!html.includes('src="session.js"')) continue
      const cabeza = html.slice(0, html.indexOf('</head>'))
      if (!/src="session\.js"><\/script>\s*<script src="guardia\.js"><\/script>\s*<script src="vistas-mir\.js"><\/script>/.test(cabeza)) {
        faltan.push(archivo)
      }
    }
    assert.deepEqual(faltan, [], 'páginas sin la guardia: quedarían visibles para cualquier rol')
  })
})
