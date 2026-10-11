// HU-R7-04, lo que faltaba tras la auditoría del 10/10/2026:
//   CA_4  el login muestra «Sesión cerrada correctamente» después de cerrar sesión
//   CA_5  al volver con Atrás a una página protegida, se manda al login
// y la cookie del token sin Max-Age: con 8 h fijas desde el login, el navegador la borraba
// aunque el usuario siguiera activo (HU-R7-01 RN_2).
//
// Como en login-formulario.test.ts, se ejecuta el código real de login.js y de los scripts de sesión
// contra un DOM mínimo simulado.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { crearBD } from '../src/bd.js'
import { COOKIE_PERFIL, COOKIE_SESION } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'
import { codigoSesion } from './apoyo-frontend.js'

const RAIZ = path.resolve(import.meta.dirname, '../..')
const esperar = () => new Promise((ok) => setImmediate(ok))

/** login.js con lo mínimo de DOM que usa el aviso. */
function cargarLogin(search: string) {
  const script = readFileSync(path.join(RAIZ, 'login.js'), 'utf8')

  const elementos: Record<string, { textContent: string; value: string; clases: Set<string>; [k: string]: unknown }> = {}
  const elemento = () => {
    const clases = new Set(['hidden'])
    return {
      textContent: '', value: '', clases,
      classList: { add: (c: string) => clases.add(c), remove: (c: string) => clases.delete(c), toggle: () => {} },
      addEventListener: () => {}, focus: () => {},
    }
  }
  const documento = {
    getElementById: (id: string) => (elementos[id] ??= elemento()),
    querySelectorAll: () => [] as unknown[],
  }
  const urls: string[] = []
  const location = { search, pathname: '/login.html', replace: () => {}, href: '' }
  const history = { replaceState: (_: unknown, __: string, url: string) => { urls.push(url) } }
  const Session = { cargar: () => Promise.resolve(null), login: () => Promise.resolve({ ok: false }) }

  new Function('document', 'window', 'Session', 'setInterval', 'setTimeout', 'history', script)(
    documento, { location, Session }, Session, () => 0, () => 0, history)
  return { aviso: elementos.avisoBox, urls }
}

/** session.js con window, document.cookie y fetch simulados. */
function cargarSession(opciones: { cookie: string; sesionEnServidor: boolean }) {
  const codigo = codigoSesion()
  const cookies = { valor: opciones.cookie }
  const oyentes: Record<string, ((e: unknown) => void)[]> = {}
  const navegaciones: string[] = []
  const peticiones: string[] = []
  const ventana = {
    location: { href: '', pathname: '/dashboard-admin.html', replace: (u: string) => { navegaciones.push(u) } },
    addEventListener: (ev: string, fn: (e: unknown) => void) => { (oyentes[ev] ??= []).push(fn) },
  }
  const documento = {
    get cookie() { return cookies.valor },
    set cookie(v: string) { if (/Max-Age=0/.test(v)) cookies.valor = '' },
  }
  const fetchFalso = (ruta: string, o?: { method?: string }) => {
    peticiones.push(`${o?.method ?? 'GET'} ${ruta}`)
    const ok = ruta.endsWith('/logout') || opciones.sesionEnServidor
    return Promise.resolve({ ok, status: ok ? 200 : 401, json: () => Promise.resolve(ok ? {
      usuario: { id: '1', nombre: 'Ana Torres', email: 'a@b.mx', rol: 'enlace', gerencia: { clave: 'COM', nombre: 'Comercial' }, unidad: 'X' },
      redirigirA: 'dashboard-enlace.html',
    } : { error: 'sin_sesion' }) })
  }
  const api = new Function('window', 'document', 'fetch', `${codigo}\n; return { Session, cerrarSesion }`)(
    ventana, documento, fetchFalso) as { Session: { requireAuth: () => unknown }; cerrarSesion: () => void }
  const volverConAtras = (persisted: boolean) => { for (const fn of oyentes.pageshow ?? []) fn({ persisted }) }
  return { ...api, navegaciones, peticiones, cookies, volverConAtras }
}

const PERFIL = `${COOKIE_PERFIL}=${encodeURIComponent(JSON.stringify({
  nombre: 'Ana Torres', email: 'a@b.mx', rol: 'enlace', gerencia: 'Comercial', gerenciaClave: 'COM',
  unidad: 'X', redirigirA: 'dashboard-enlace.html',
}))}`

describe('CA_4: aviso en el login', () => {
  test('después de cerrar sesión dice «Sesión cerrada correctamente» y limpia la URL', () => {
    const { aviso, urls } = cargarLogin('?sesion=cerrada')
    assert.equal(aviso!.textContent, 'Sesión cerrada correctamente')
    assert.equal(aviso!.clases.has('hidden'), false)
    assert.deepEqual(urls, ['/login.html'])
  })

  test('con la sesión expirada dice el mensaje de HU-R7-05', () => {
    assert.equal(cargarLogin('?sesion=expirada').aviso!.textContent, 'Tu sesión expiró. Inicia sesión nuevamente.')
  })

  test('sin motivo, o con uno inventado, no muestra nada', () => {
    for (const search of ['', '?sesion=<script>']) {
      const { aviso } = cargarLogin(search)
      assert.ok(aviso === undefined || aviso.clases.has('hidden'), `aviso visible con ${search}`)
    }
  })

  test('cerrarSesion() revoca en el servidor y luego va al login con el aviso, sin dejar la página en el historial', async () => {
    const s = cargarSession({ cookie: PERFIL, sesionEnServidor: true })
    s.cerrarSesion()
    await esperar()
    assert.deepEqual(s.peticiones, ['POST /api/auth/logout'])
    assert.deepEqual(s.navegaciones, ['login.html?sesion=cerrada'])
  })
})

describe('CA_5: botón Atrás después de cerrar sesión', () => {
  test('una página protegida restaurada desde la caché del navegador sin perfil va al login', () => {
    const s = cargarSession({ cookie: PERFIL, sesionEnServidor: true })
    s.Session.requireAuth()
    s.cookies.valor = ''                     // el logout borró la cookie de perfil
    s.volverConAtras(true)
    assert.deepEqual(s.navegaciones, ['login.html'])
  })

  test('con perfil pero la sesión ya no vale en el servidor, también va al login', async () => {
    const s = cargarSession({ cookie: PERFIL, sesionEnServidor: false })
    s.Session.requireAuth()
    s.volverConAtras(true)
    await esperar()
    assert.deepEqual(s.peticiones, ['GET /api/auth/sesion'])
    assert.deepEqual(s.navegaciones, ['login.html'])
  })

  test('con la sesión vigente se queda en la página', async () => {
    const s = cargarSession({ cookie: PERFIL, sesionEnServidor: true })
    s.Session.requireAuth()
    s.volverConAtras(true)
    await esperar()
    assert.deepEqual(s.navegaciones, [])
  })

  test('una carga normal (no restaurada) o una página no protegida no se revisan aquí', () => {
    const normal = cargarSession({ cookie: '', sesionEnServidor: false })
    normal.volverConAtras(true)              // sin requireAuth: no es página protegida
    const s = cargarSession({ cookie: PERFIL, sesionEnServidor: false })
    s.Session.requireAuth()
    s.volverConAtras(false)                  // carga normal: requireAuth ya decidió
    assert.deepEqual([...normal.navegaciones, ...s.navegaciones], [])
  })
})

describe('cookie del token (HU-R7-01 RN_2)', () => {
  const bd = crearBD(configBD, crearLog(() => {}))
  let app: Awaited<ReturnType<typeof levantar>>
  let email: string
  before(async () => {
    app = await levantar()
    const sufijo = randomUUID()
    const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org ${sufijo}`])
    const [g] = await bd.consultar<{ id: string }>(
      `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'COM', 'Comercial') RETURNING id`, [org!.id])
    const [n] = await bd.consultar<{ id: string }>(
      `INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, 'Coordinación', true) RETURNING id`, [g!.id])
    email = `cookie-${sufijo}@comapasur.gob.mx`
    await bd.consultar(
      `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password) VALUES ($1, $2, 'Ana', $3, $4, 'enlace', false)`,
      [g!.id, n!.id, email, await bcrypt.hash('Contrasena-Valida-2026', 12)])
  })
  after(async () => { await app.cerrar(); await bd.cerrar() })

  test('sin Max-Age: dura hasta cerrar el navegador y la inactividad la decide el servidor', async () => {
    const r = await fetch(`${app.url}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Contrasena-Valida-2026' }),
    })
    assert.equal(r.status, 200)
    const token = r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_SESION}=`))!
    assert.doesNotMatch(token, /Max-Age|Expires/)
    assert.match(token, /HttpOnly/)
    assert.match(token, /SameSite=Strict/)
  })
})
