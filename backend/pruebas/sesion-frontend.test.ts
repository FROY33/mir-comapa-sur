// HU-R7-01, parte frontend: el adaptador de session.js. Se prueba sin navegador
// cargando el archivo en un scope con un `document.cookie` simulado.
//
// Aquí vive la traducción entre lo que devuelve la API ('admin') y lo que comparan
// las vistas del prototipo ('Administrador'), más las iniciales, que la tabla
// usuarios no guarda. Si algo de eso se desalinea, 13 páginas dejan de reconocer al
// usuario sin que ninguna prueba del backend se queje.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

const RAIZ = path.resolve(import.meta.dirname, '../..')

interface Llamada { ruta: string; metodo: string | undefined }

/**
 * Carga session.js con un document.cookie dado. Devuelve su Session, las utilidades
 * y el registro de peticiones que hizo, para verificar contra qué ruta llama.
 */
function cargarSession(cookie: string, respuesta: () => Promise<unknown> = () => Promise.resolve({ ok: true })) {
  const codigo = readFileSync(path.join(RAIZ, 'session.js'), 'utf8')
  const llamadas: Llamada[] = []
  const cookies = { valor: cookie }
  const documento = {
    get cookie() { return cookies.valor },
    set cookie(v: string) {
      // Un Max-Age=0 borra; cualquier otra cosa se ignora en esta simulación
      if (/Max-Age=0/.test(v)) cookies.valor = ''
    },
  }
  const fetchFalso = (ruta: string, opciones?: { method?: string }) => {
    llamadas.push({ ruta, metodo: opciones?.method })
    return Promise.resolve({ ok: true, json: () => respuesta() })
  }
  const fn = new Function('window', 'document', 'fetch',
    `${codigo}\n; return { Session, inicialesDe }`)
  const api = fn({ location: { href: '' } }, documento, fetchFalso) as {
    Session: {
      getUser: () => Record<string, unknown> | null
      requireAuth: () => unknown
      clear: () => void
      logout: () => Promise<void>
    }
    inicialesDe: (n: string) => string
  }
  return { ...api, llamadas, cookies }
}

const perfil = (datos: Record<string, unknown>) =>
  `comapa_perfil=${encodeURIComponent(JSON.stringify(datos))}`

const BASE = {
  nombre: 'Leticia Solís', email: 'admin@comapa.mx', rol: 'admin',
  gerencia: 'Gerencia de Planeación Estratégica', gerenciaClave: 'PLA',
  unidad: 'Coordinación General de Planeación Estratégica', redirigirA: 'dashboard-admin.html',
}

describe('adaptador de perfil', () => {
  test('traduce el rol de la API al que comparan las vistas', () => {
    const casos = { admin: 'Administrador', revisor: 'Revisor', enlace: 'Enlace' }
    for (const [api, vista] of Object.entries(casos)) {
      const { Session } = cargarSession(perfil({ ...BASE, rol: api }))
      assert.equal(Session.getUser()?.rol, vista, `${api} debería verse como ${vista}`)
      assert.equal(Session.getUser()?.rolClave, api, 'se pierde el rol original de la API')
    }
  })

  test('expone gerencia y unidad con los nombres que esperan las vistas', () => {
    const { Session } = cargarSession(perfil(BASE))
    const u = Session.getUser()!
    assert.equal(u.gerencia, BASE.gerencia)
    assert.equal(u.gerenciaClave, 'PLA')
    assert.equal(u.unidadResponsable, BASE.unidad)
    assert.equal(u.redirect, 'dashboard-admin.html')
  })

  test('deriva las iniciales del nombre, que la tabla usuarios no guarda', () => {
    const { inicialesDe } = cargarSession('')
    assert.equal(inicialesDe('Leticia Solís'), 'LS')
    assert.equal(inicialesDe('Carlos Mendoza'), 'CM')
    assert.equal(inicialesDe('Miguel Ángel Pérez'), 'MP', 'toma el primero y el último')
    assert.equal(inicialesDe('Ana'), 'AN')
    assert.equal(inicialesDe('  '), '??')
    assert.equal(inicialesDe(''), '??')
  })

  test('sin cookie de perfil no hay usuario', () => {
    const { Session } = cargarSession('')
    assert.equal(Session.getUser(), null)
  })

  test('una cookie de perfil corrupta no revienta la página', () => {
    const { Session } = cargarSession('comapa_perfil=%7Bno-es-json')
    assert.equal(Session.getUser(), null)
  })

  test('no confunde la cookie de perfil con otra que empiece igual', () => {
    const { Session } = cargarSession('comapa_perfil_otro=basura; ' + perfil(BASE))
    assert.equal(Session.getUser()?.nombre, 'Leticia Solís')
  })

  test('requireAuth manda a login.html cuando no hay sesión', () => {
    const codigo = readFileSync(path.join(RAIZ, 'session.js'), 'utf8')
    const location = { href: '' }
    const fn = new Function('window', 'document', 'fetch', `${codigo}\n; return Session`)
    const Session = fn({ location }, { cookie: '' }, () => Promise.reject(new Error('sin red'))) as any
    // window.location es el que lee session.js para redirigir
    ;(globalThis as any).window = { location }
    assert.equal(Session.requireAuth(), null)
    assert.equal(location.href, 'login.html')
    delete (globalThis as any).window
  })

  test('logout llama a POST /api/auth/logout y olvida al usuario (HU-R7-04)', async () => {
    const { Session, llamadas, cookies } = cargarSession(perfil(BASE))
    assert.ok(Session.getUser(), 'debería haber usuario antes de cerrar')

    await Session.logout()

    assert.deepEqual(llamadas, [{ ruta: '/api/auth/logout', metodo: 'POST' }])
    assert.equal(Session.getUser(), null, 'el usuario siguió en memoria tras cerrar')
    assert.equal(cookies.valor, '', 'no se borró la cookie de perfil')
  })

  test('si la red falla, logout limpia igual en vez de dejar al usuario atrapado', async () => {
    const codigo = readFileSync(path.join(RAIZ, 'session.js'), 'utf8')
    const cookies = { valor: perfil(BASE) }
    const documento = {
      get cookie() { return cookies.valor },
      set cookie(v: string) { if (/Max-Age=0/.test(v)) cookies.valor = '' },
    }
    const fn = new Function('window', 'document', 'fetch', `${codigo}\n; return Session`)
    const Session = fn({ location: { href: '' } }, documento,
      () => Promise.reject(new Error('sin red'))) as { getUser: () => unknown; logout: () => Promise<void> }

    await Session.logout()
    assert.equal(Session.getUser(), null)
    assert.equal(cookies.valor, '')
  })

  test('todo punto que cierra sesión pasa por cerrarSesion(), no por Session.clear()', () => {
    // Regresión: layout.js tenía su propio manejador que llamaba Session.clear() y
    // redirigía. Eso solo borra la cookie de perfil — la de sesión es HttpOnly y
    // seguía vigente, así que login.html encontraba la sesión abierta y devolvía al
    // usuario al dashboard. El botón de cerrar sesión no cerraba nada.
    const archivos = readdirSync(RAIZ)
      .filter((f) => f.endsWith('.html') || f.endsWith('.js'))
      .filter((f) => f !== 'session.js')     // ahí vive la implementación legítima

    const infractores: string[] = []
    for (const archivo of archivos) {
      const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
      // Session.clear() seguido de una redirección al login, en una ventana de 3 líneas
      const lineas = texto.split('\n')
      lineas.forEach((linea, i) => {
        if (!/Session\.clear\(\)/.test(linea) || /^\s*(\/\/|\*)/.test(linea)) return
        const alrededor = lineas.slice(i, i + 3).join(' ')
        if (/login\.html/.test(alrededor)) infractores.push(`${archivo}:${i + 1}`)
      })
    }
    assert.deepEqual(infractores, [],
      'estos cierran sesión sin revocarla en el servidor; deben llamar cerrarSesion()')
  })

  test('el token de sesión no es accesible desde el perfil', () => {
    const { Session } = cargarSession(perfil(BASE))
    const u = Session.getUser()!

    // debeCambiarPassword es un booleano de UI, no una credencial: es la única clave
    // que puede sonar sensible sin serlo.
    const sospechosas = Object.keys(u)
      .filter((k) => /token|password|hash|secret|clave/i.test(k))
      .filter((k) => k !== 'debeCambiarPassword' && k !== 'gerenciaClave' && k !== 'rolClave')
    assert.deepEqual(sospechosas, [], 'el objeto de sesión expone claves sensibles')

    // Y ningún valor con forma de token o de hash bcrypt
    for (const [clave, valor] of Object.entries(u)) {
      if (typeof valor !== 'string') continue
      assert.ok(!/^\$2[aby]\$/.test(valor), `${clave} contiene un hash bcrypt`)
      assert.ok(!/^[A-Za-z0-9_-]{32,}$/.test(valor), `${clave} tiene forma de token`)
    }
  })
})
