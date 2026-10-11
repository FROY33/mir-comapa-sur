// HU-R7-03: rutas y datos protegidos por rol y gerencia, verificado en el backend (CA_4).
// Dos gerencias: A con Admin, Revisor y Enlace; B con un Revisor. Las sesiones se crean
// directo con crear(), sin pasar por el login (ya probado en login.test.ts).

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { COOKIE_SESION, crear, revocar } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>

type Rol = 'admin' | 'revisor' | 'enlace'
const g = { A: '', B: '' }
const ind = { A1: '', A2: '', B1: '' }
const cookie: Record<string, string> = {}
const usuario: Record<string, string> = {}

async function crearGerencia(org: string, clave: string) {
  const [ger] = await bd.consultar<{ id: string }>(
    'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org, clave, `Gerencia ${clave}`])
  const [uni] = await bd.consultar<{ id: string }>(
    'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [ger!.id, `Coordinación ${clave}`])
  return { gerencia: ger!.id, unidad: uni!.id }
}

async function crearUsuario(nombre: string, rol: Rol, ger: { gerencia: string; unidad: string }) {
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`,
    [ger.gerencia, ger.unidad, nombre, `${nombre}-${randomUUID()}@comapasur.gob.mx`, rol])
  usuario[nombre] = u!.id
  cookie[nombre] = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
}

async function crearIndicador(gerencia: string, codigo: string) {
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ($1, $2, 'actividad', $3, 'Porcentaje', 'mensual') RETURNING id`, [gerencia, codigo, `Indicador ${codigo}`])
  return i!.id
}

/** Petición con la cookie de quien se indique (o sin cookie). */
async function pedir(ruta: string, quien?: string, cuerpo?: unknown) {
  const r = await fetch(app.url + ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { ...(quien ? { cookie: cookie[quien]! } : {}), 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  return { status: r.status, cuerpo: await r.json() as any }
}

const codigos = (lista: { codigo: string }[]) => lista.map((i) => i.codigo).sort()

before(async () => {
  app = await levantar()
  const s = randomUUID().slice(0, 8)
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R7-03 ${s}`])
  const A = await crearGerencia(org!.id, 'A')
  const B = await crearGerencia(org!.id, 'B')
  g.A = A.gerencia
  g.B = B.gerencia
  await crearUsuario('admin', 'admin', A)
  await crearUsuario('revisorA', 'revisor', A)
  await crearUsuario('enlaceA', 'enlace', A)
  await crearUsuario('revisorB', 'revisor', B)
  ind.A1 = await crearIndicador(g.A, `A1-${s}`)
  ind.A2 = await crearIndicador(g.A, `A2-${s}`)
  ind.B1 = await crearIndicador(g.B, `B1-${s}`)
})
after(async () => { await app.cerrar(); await bd.cerrar() })

/** Solo los indicadores de esta prueba: la base de pruebas tiene también los de la semilla. */
const deEstaPrueba = (lista: { id: string; codigo: string }[]) =>
  lista.filter((i) => Object.values(ind).includes(i.id))

describe('CA_2: sin sesión, toda ruta protegida responde 401', () => {
  for (const ruta of ['/api/indicadores', '/api/admin/configuracion', '/api/auth/acceso?pagina=dashboard-enlace.html']) {
    test(ruta, async () => {
      const r = await pedir(ruta)
      assert.equal(r.status, 401)
      assert.equal(r.cuerpo.error, 'no_autenticado')
    })
  }

  test('una sesión revocada o vencida tampoco pasa', async () => {
    await crearUsuario('temporal', 'enlace', { gerencia: g.A, unidad: (await bd.consultar<{ id: string }>(
      'SELECT id FROM unidades WHERE gerencia_id = $1', [g.A]))[0]!.id })
    assert.equal((await pedir('/api/indicadores', 'temporal')).status, 200)
    await revocar(bd, cookie.temporal!.split('=')[1])
    assert.equal((await pedir('/api/indicadores', 'temporal')).status, 401)

    await crearUsuario('vencida', 'enlace', { gerencia: g.A, unidad: (await bd.consultar<{ id: string }>(
      'SELECT id FROM unidades WHERE gerencia_id = $1', [g.A]))[0]!.id })
    await bd.consultar(`UPDATE sesiones SET expira_at = now() - interval '1 second' WHERE usuario_id = $1`, [usuario.vencida])
    assert.equal((await pedir('/api/indicadores', 'vencida')).status, 401)
  })
})

describe('CA_1 y CA_6: páginas por rol', () => {
  const casos: [string, string, number][] = [
    ['enlaceA', 'dashboard-revisor.html', 403],
    ['enlaceA', 'dashboard-admin.html', 403],
    ['enlaceA', 'configuracion.html', 403],
    ['revisorA', 'configuracion.html', 403],
    ['revisorA', 'dashboard-admin.html', 403],
    ['admin', 'configuracion.html', 200],
    ['enlaceA', 'dashboard-enlace.html', 200],
    ['revisorA', 'dashboard-revisor.html', 200],
  ]
  for (const [quien, pagina, esperado] of casos) {
    test(`${quien} → ${pagina}: ${esperado}`, async () => {
      assert.equal((await pedir(`/api/auth/acceso?pagina=${pagina}`, quien)).status, esperado)
    })
  }

  test('el 403 dice a qué dashboard redirigir: el del Enlace, para un Enlace', async () => {
    const r = await pedir('/api/auth/acceso?pagina=dashboard-admin.html', 'enlaceA')
    assert.equal(r.cuerpo.redirigirA, 'dashboard-enlace.html')
  })

  test('una página que no está en la tabla de acceso se niega (lista blanca)', async () => {
    assert.equal((await pedir('/api/auth/acceso?pagina=no-existe.html', 'admin')).status, 403)
    assert.equal((await pedir('/api/auth/acceso?pagina=../backend/.env', 'admin')).status, 403)
  })
})

describe('CA_3 y CA_6: /api/admin/* es solo del Administrador', () => {
  for (const ruta of ['/api/admin/configuracion']) {
    test(`${ruta}: 403 a Enlace y Revisor con sesión válida, 200 al Admin`, async () => {
      assert.equal((await pedir(ruta, 'enlaceA')).status, 403)
      assert.equal((await pedir(ruta, 'revisorA')).status, 403)
      assert.equal((await pedir(ruta, 'admin')).status, 200)
    })
  }
})

describe('CA_5 y RN_2: la gerencia sale de la sesión, no de la petición', () => {
  test('el Revisor de A solo ve los indicadores de A', async () => {
    const r = await pedir('/api/indicadores', 'revisorA')
    assert.deepEqual(deEstaPrueba(r.cuerpo).map((i) => i.id).sort(), [ind.A1, ind.A2].sort())
    assert.ok(r.cuerpo.every((i: { gerencia: { clave: string } }) => i.gerencia.clave === 'A'))
  })

  test('cambiar gerencia_id en la URL no cambia nada', async () => {
    const r = await pedir(`/api/indicadores?gerencia_id=${g.B}`, 'revisorA')
    assert.deepEqual(deEstaPrueba(r.cuerpo).map((i) => i.id).sort(), [ind.A1, ind.A2].sort())
  })

  test('cambiar gerencia_id en el cuerpo no cambia nada', async () => {
    const r = await pedir('/api/indicadores/buscar', 'revisorA', { gerencia_id: g.B })
    assert.deepEqual(deEstaPrueba(r.cuerpo).map((i) => i.id).sort(), [ind.A1, ind.A2].sort())
  })

  test('pedir por id un indicador de otra gerencia responde 404, igual que uno que no existe', async () => {
    const ajeno = await pedir(`/api/indicadores/${ind.B1}`, 'revisorA')
    const inexistente = await pedir(`/api/indicadores/${randomUUID()}`, 'revisorA')
    assert.equal(ajeno.status, 404)
    assert.deepEqual(ajeno.cuerpo, inexistente.cuerpo)
    assert.equal((await pedir(`/api/indicadores/${ind.B1}`, 'revisorB')).status, 200)
  })

  test('un id que no es uuid es 404, no un error de la base', async () => {
    assert.equal((await pedir("/api/indicadores/1%20OR%201=1", 'revisorA')).status, 404)
  })

  test('el Enlace ve toda su gerencia: la unidad es informativa', async () => {
    const r = await pedir('/api/indicadores', 'enlaceA')
    assert.equal(deEstaPrueba(r.cuerpo).length, 2)
  })

  test('el Administrador conserva el acceso global y puede elegir gerencia', async () => {
    const todos = await pedir('/api/indicadores', 'admin')
    assert.equal(deEstaPrueba(todos.cuerpo).length, 3)
    const soloB = await pedir(`/api/indicadores?gerencia_id=${g.B}`, 'admin')
    assert.deepEqual(codigos(deEstaPrueba(soloB.cuerpo)), codigos(deEstaPrueba(todos.cuerpo)).filter((c) => c.startsWith('B1')))
    assert.equal((await pedir(`/api/indicadores/${ind.B1}`, 'admin')).status, 200)
  })

  test('si al usuario le cambian la gerencia, la siguiente petición ya usa la nueva', async () => {
    const [uniB] = await bd.consultar<{ id: string }>('SELECT id FROM unidades WHERE gerencia_id = $1', [g.B])
    await bd.consultar('UPDATE usuarios SET gerencia_id = $2, unidad_id = $3 WHERE id = $1', [usuario.enlaceA, g.B, uniB!.id])
    try {
      const r = await pedir('/api/indicadores', 'enlaceA')
      assert.deepEqual(deEstaPrueba(r.cuerpo).map((i) => i.id), [ind.B1])
    } finally {
      const [uniA] = await bd.consultar<{ id: string }>('SELECT id FROM unidades WHERE gerencia_id = $1', [g.A])
      await bd.consultar('UPDATE usuarios SET gerencia_id = $2, unidad_id = $3 WHERE id = $1', [usuario.enlaceA, g.A, uniA!.id])
    }
  })
})

describe('RN_3: un solo rol, y su cambio aplica de inmediato', () => {
  test('al pasar de Revisor a Administrador, /api/admin/* se abre en la siguiente petición', async () => {
    assert.equal((await pedir('/api/admin/configuracion', 'revisorB')).status, 403)
    await bd.consultar(`UPDATE usuarios SET rol = 'admin' WHERE id = $1`, [usuario.revisorB])
    try {
      assert.equal((await pedir('/api/admin/configuracion', 'revisorB')).status, 200)
    } finally {
      await bd.consultar(`UPDATE usuarios SET rol = 'revisor' WHERE id = $1`, [usuario.revisorB])
    }
  })

  test('un usuario desactivado pierde el acceso aunque su cookie siga vigente', async () => {
    await bd.consultar('UPDATE usuarios SET activo = false WHERE id = $1', [usuario.revisorB])
    try {
      assert.equal((await pedir('/api/indicadores', 'revisorB')).status, 401)
    } finally {
      await bd.consultar('UPDATE usuarios SET activo = true WHERE id = $1', [usuario.revisorB])
    }
  })
})
