// HU-R7-02: redirección según rol. Lo que decide el servidor — a qué dashboard va
// cada rol y si un destino guardado se honra o se descarta (RN_1).

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { COOKIE_DESTINO } from '../src/auth.js'
import { crearBD } from '../src/bd.js'
import { crearLog } from '../src/log.js'
import { DASHBOARD, destinoPermitido, destinoTrasLogin, puedeAbrir, type Rol } from '../src/rutas.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

const PASSWORD = 'Contrasena-Valida-2026'
let app: Awaited<ReturnType<typeof levantar>>
const unidadPorGerencia = new Map<string, { gerenciaId: string; unidadId: string }>()

before(async () => {
  app = await levantar()
  const sufijo = randomUUID()
  const [org] = await bd.consultar<{ id: string }>(
    'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org redir ${sufijo}`])
  for (const clave of ['PLA', 'COM', 'ADM']) {
    const [g] = await bd.consultar<{ id: string }>(
      `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id`,
      [org!.id, clave, `Gerencia ${clave}`])
    const [u] = await bd.consultar<{ id: string }>(
      `INSERT INTO unidades (gerencia_id, nombre) VALUES ($1, 'Coordinación General') RETURNING id`, [g!.id])
    unidadPorGerencia.set(clave, { gerenciaId: g!.id, unidadId: u!.id })
  }
})
after(() => app.cerrar())

async function usuario(rol: Rol) {
  const email = `redir-${randomUUID()}@comapasur.gob.mx`
  const { gerenciaId, unidadId } = unidadPorGerencia.get('PLA')!
  await bd.consultar(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, 'Quien navega', $3, $4, $5, false)`,
    [gerenciaId, unidadId, email, await bcrypt.hash(PASSWORD, 12), rol])
  return email
}

/** Inicia sesión, opcionalmente con una cookie de destino guardada. */
async function entrar(email: string, destino?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (destino !== undefined) headers.cookie = `${COOKIE_DESTINO}=${encodeURIComponent(destino)}`
  const r = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return { status: r.status, cuerpo: await r.json() as Record<string, any>, setCookie: r.headers.getSetCookie() }
}

describe('CA_1: cada rol a su dashboard', () => {
  for (const rol of ['admin', 'revisor', 'enlace'] as const) {
    test(`un ${rol} va a ${DASHBOARD[rol]}`, async () => {
      const r = await entrar(await usuario(rol))
      assert.equal(r.status, 200)
      assert.equal(r.cuerpo.redirigirA, DASHBOARD[rol])
    })
  }

  test('el Administrador va a dashboard-admin.html, como nombra el RQM', () => {
    assert.equal(DASHBOARD.admin, 'dashboard-admin.html')
  })
})

describe('CA_3: la respuesta del login llega en menos de un segundo', () => {
  test('tres inicios de sesión seguidos quedan holgadamente por debajo', async () => {
    const email = await usuario('revisor')
    const tiempos: number[] = []
    for (let i = 0; i < 3; i++) {
      const inicio = performance.now()
      const r = await entrar(email)
      tiempos.push(performance.now() - inicio)
      assert.equal(r.status, 200)
    }
    const peor = Math.max(...tiempos)
    assert.ok(peor < 1000, `el peor caso tardó ${peor.toFixed(0)} ms, y CA_3 pide menos de 1000`)
  })
})

describe('CA_4: vuelve al destino que tenía antes del login', () => {
  test('un Revisor que iba a su bandeja vuelve a su bandeja', async () => {
    const r = await entrar(await usuario('revisor'), 'bandeja-revision.html')
    assert.equal(r.cuerpo.redirigirA, 'bandeja-revision.html')
  })

  test('un Enlace que iba a sus actividades vuelve a sus actividades', async () => {
    const r = await entrar(await usuario('enlace'), 'mis-actividades.html')
    assert.equal(r.cuerpo.redirigirA, 'mis-actividades.html')
  })

  test('el destino se acepta aunque venga con / inicial, query o fragmento', async () => {
    for (const destino of ['/bandeja-revision.html', 'bandeja-revision.html?f=1', 'bandeja-revision.html#x']) {
      const r = await entrar(await usuario('revisor'), destino)
      assert.equal(r.cuerpo.redirigirA, 'bandeja-revision.html', `falló con ${destino}`)
    }
  })

  test('la cookie de destino se borra al usarla, para que no se repita', async () => {
    const r = await entrar(await usuario('revisor'), 'bandeja-revision.html')
    const linea = r.setCookie.find((c) => c.startsWith(`${COOKIE_DESTINO}=`))
    assert.ok(linea, 'el login debe borrar la cookie de destino')
    assert.match(linea, /Max-Age=0/)
  })
})

describe('RN_1: un destino que el rol no puede abrir se descarta', () => {
  test('un Enlace que apuntaba al dashboard del Admin va a su propio dashboard', async () => {
    const r = await entrar(await usuario('enlace'), 'dashboard-admin.html')
    assert.equal(r.cuerpo.redirigirA, DASHBOARD.enlace, 'se honró un destino que el rol no puede abrir')
  })

  test('un Revisor que apuntaba a configuración va a su propio dashboard', async () => {
    const r = await entrar(await usuario('revisor'), 'configuracion.html')
    assert.equal(r.cuerpo.redirigirA, DASHBOARD.revisor)
  })

  test('una página que no existe en el mapa se descarta', async () => {
    const r = await entrar(await usuario('admin'), 'pagina-inventada.html')
    assert.equal(r.cuerpo.redirigirA, DASHBOARD.admin)
  })
})

describe('RN_1: destinos que no son del sitio se rechazan', () => {
  const rechazables = [
    ['otro host', 'https://ejemplo.com/robo.html'],
    ['protocol-relative', '//ejemplo.com/robo.html'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<h1>hola</h1>'],
    ['subida de directorio', '../../etc/passwd'],
    ['ruta con carpetas', 'backend/.env'],
    ['separador de Windows', '\\\\ejemplo.com\\robo.html'],
    ['el propio login', 'login.html'],
    ['la raíz', 'index.html'],
    ['vacío', ''],
  ] as const

  for (const [nombre, destino] of rechazables) {
    test(`se rechaza: ${nombre}`, () => {
      assert.equal(destinoPermitido(destino, 'admin'), null, `se aceptó ${JSON.stringify(destino)}`)
    })
  }

  test('ninguno de ellos llega al cliente ni siquiera pasando por el login real', async () => {
    for (const [nombre, destino] of rechazables) {
      if (destino === '') continue                      // una cookie vacía no se manda
      const r = await entrar(await usuario('admin'), destino)
      assert.equal(r.cuerpo.redirigirA, DASHBOARD.admin, `${nombre} se coló`)
    }
  })
})

describe('el mapa de rutas', () => {
  test('cada dashboard solo lo abre su propio rol', () => {
    assert.equal(puedeAbrir('admin', DASHBOARD.admin), true)
    assert.equal(puedeAbrir('revisor', DASHBOARD.admin), false)
    assert.equal(puedeAbrir('enlace', DASHBOARD.admin), false)
    assert.equal(puedeAbrir('revisor', DASHBOARD.revisor), true)
    assert.equal(puedeAbrir('enlace', DASHBOARD.enlace), true)
  })

  test('sin destino guardado, destinoTrasLogin da el dashboard del rol', () => {
    for (const rol of ['admin', 'revisor', 'enlace'] as const) {
      assert.equal(destinoTrasLogin(undefined, rol), DASHBOARD[rol])
    }
  })

  test('el detalle de un indicador lo pueden abrir los tres roles', () => {
    for (const rol of ['admin', 'revisor', 'enlace'] as const) {
      assert.equal(puedeAbrir(rol, 'detalle-indicador.html'), true)
    }
  })
})
