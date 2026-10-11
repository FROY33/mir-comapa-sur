// HU-R7-04: cierre de sesión. Y con él cierra CA-2 de TEC-05: el cierre deja un
// evento de auditoría.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { crearBD } from '../src/bd.js'
import { ENTIDAD } from '../src/datos/acceso.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { COOKIE_PERFIL, COOKIE_SESION } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

const PASSWORD = 'Contrasena-Valida-2026'
let app: Awaited<ReturnType<typeof levantar>>
let gerenciaId: string
let unidadId: string

before(async () => {
  app = await levantar()
  const sufijo = randomUUID()
  const [org] = await bd.consultar<{ id: string }>(
    'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org logout ${sufijo}`])
  const [g] = await bd.consultar<{ id: string }>(
    `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'COM', 'Gerencia Comercial') RETURNING id`, [org!.id])
  const [n] = await bd.consultar<{ id: string }>(
    `INSERT INTO unidades (gerencia_id, nombre) VALUES ($1, 'Coordinación General Comercial') RETURNING id`, [g!.id])
  gerenciaId = g!.id
  unidadId = n!.id
})
after(() => app.cerrar())

async function usuarioNuevo(rol: 'admin' | 'revisor' | 'enlace' = 'enlace') {
  const email = `logout-${randomUUID()}@comapasur.gob.mx`
  const hash = await bcrypt.hash(PASSWORD, 12)
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, 'Quien cierra sesión', $3, $4, $5, false) RETURNING id`,
    [gerenciaId, unidadId, email, hash, rol])
  return { id: u!.id, email }
}

const tokenDe = (setCookie: string[]) =>
  setCookie.find((c) => c.startsWith(`${COOKIE_SESION}=`))?.slice(COOKIE_SESION.length + 1).split(';')[0]

/** Entra y devuelve la cookie lista para mandar en las siguientes peticiones. */
async function entrar(email: string) {
  const r = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  assert.equal(r.status, 200, 'el login previo debería funcionar')
  const token = tokenDe(r.headers.getSetCookie())!
  return { token, cookie: `${COOKIE_SESION}=${token}` }
}

const salir = (cookie?: string) =>
  fetch(`${app.url}/api/auth/logout`, { method: 'POST', headers: cookie ? { cookie } : {} })

const sesionActiva = (cookie: string) =>
  fetch(`${app.url}/api/auth/sesion`, { headers: { cookie } })

describe('cierre de sesión', () => {
  test('la sesión deja de servir en cuanto se cierra', async () => {
    const u = await usuarioNuevo()
    const { cookie } = await entrar(u.email)
    assert.equal((await sesionActiva(cookie)).status, 200, 'debería estar dentro antes de salir')

    assert.equal((await salir(cookie)).status, 200)
    assert.equal((await sesionActiva(cookie)).status, 401, 'la sesión sobrevivió al cierre')
  })

  test('queda revocada en la base, no borrada: la auditoría tiene que poder leerla', async () => {
    const u = await usuarioNuevo()
    const { token, cookie } = await entrar(u.email)
    await salir(cookie)
    const [fila] = await bd.consultar<{ n: string; revocada: boolean }>(
      `SELECT count(*)::text AS n, bool_and(revocada_at IS NOT NULL) AS revocada
         FROM sesiones WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [token])
    assert.equal(fila!.n, '1', 'la fila de la sesión no debe borrarse')
    assert.equal(fila!.revocada, true)
  })

  test('borra las dos cookies del navegador', async () => {
    const u = await usuarioNuevo()
    const { cookie } = await entrar(u.email)
    const cookies = (await salir(cookie)).headers.getSetCookie()

    for (const nombre of [COOKIE_SESION, COOKIE_PERFIL]) {
      const linea = cookies.find((c) => c.startsWith(`${nombre}=`))
      assert.ok(linea, `no se borró ${nombre}`)
      assert.match(linea, /Max-Age=0/)
      assert.match(linea, /Expires=Thu, 01 Jan 1970/)
    }
    // El token sigue siendo HttpOnly al borrarse; el perfil sigue siendo legible
    assert.match(cookies.find((c) => c.startsWith(`${COOKIE_SESION}=`))!, /HttpOnly/)
    assert.ok(!/HttpOnly/.test(cookies.find((c) => c.startsWith(`${COOKIE_PERFIL}=`))!))
  })

  test('TEC-05 CA-2: el cierre deja un evento de auditoría con usuario, rol e IP', async () => {
    const u = await usuarioNuevo('revisor')
    const { cookie } = await entrar(u.email)
    await salir(cookie)

    const eventos = await listarEventos(bd, ENTIDAD, u.email.toLowerCase())
    const cierres = eventos.filter((e) => e.accion === 'logout')
    assert.equal(cierres.length, 1, 'debería haber exactamente un evento de cierre')
    assert.equal(cierres[0]?.usuario_id, u.id)
    assert.equal(cierres[0]?.rol, 'revisor')

    const [conIp] = await bd.consultar<{ ip: string | null }>(
      'SELECT host(ip) AS ip FROM bitacora WHERE id = $1', [cierres[0]!.id])
    assert.ok(conIp!.ip, 'el cierre debe registrar la IP')
  })

  test('el ciclo completo queda en orden en la bitácora', async () => {
    const u = await usuarioNuevo()
    const { cookie } = await entrar(u.email)
    await salir(cookie)
    const acciones = (await listarEventos(bd, ENTIDAD, u.email.toLowerCase())).map((e) => e.accion)
    assert.deepEqual(acciones, ['login_exitoso', 'logout'])
  })

  test('es idempotente: cerrar dos veces no audita dos cierres', async () => {
    const u = await usuarioNuevo()
    const { cookie } = await entrar(u.email)
    assert.equal((await salir(cookie)).status, 200)
    assert.equal((await salir(cookie)).status, 200, 'el segundo cierre no debe fallar')

    const cierres = (await listarEventos(bd, ENTIDAD, u.email.toLowerCase()))
      .filter((e) => e.accion === 'logout')
    assert.equal(cierres.length, 1, 'se auditó un cierre que no ocurrió')
  })

  test('sin cookie responde 200 y no audita nada', async () => {
    const antes = await bd.consultar<{ id: string }>(
      `SELECT id FROM bitacora WHERE entidad = $1 AND accion = 'logout'`, [ENTIDAD])
    assert.equal((await salir()).status, 200)
    const despues = await bd.consultar<{ id: string }>(
      `SELECT id FROM bitacora WHERE entidad = $1 AND accion = 'logout'`, [ENTIDAD])
    assert.equal(despues.length, antes.length, 'un cierre sin sesión no debe dejar evento')
  })

  test('una cookie inventada responde 200 sin delatar que no servía', async () => {
    const r = await salir(`${COOKIE_SESION}=inventado`)
    assert.equal(r.status, 200)
    const conSesion = await (async () => {
      const u = await usuarioNuevo()
      const { cookie } = await entrar(u.email)
      return salir(cookie)
    })()
    assert.equal(r.status, conSesion.status, 'la respuesta debe ser indistinguible')
  })

  test('cerrar una sesión no toca las demás del mismo usuario', async () => {
    const u = await usuarioNuevo()
    const a = await entrar(u.email)
    const b = await entrar(u.email)
    await salir(a.cookie)
    assert.equal((await sesionActiva(a.cookie)).status, 401, 'la sesión cerrada debe morir')
    assert.equal((await sesionActiva(b.cookie)).status, 200, 'la otra sesión no debía caer')
  })

  test('solo responde a POST: un GET no cierra la sesión', async () => {
    const u = await usuarioNuevo()
    const { cookie } = await entrar(u.email)
    const r = await fetch(`${app.url}/api/auth/logout`, { method: 'GET', headers: { cookie } })
    assert.equal(r.status, 404, 'GET /api/auth/logout no debería existir')
    assert.equal((await sesionActiva(cookie)).status, 200, 'un GET cerró la sesión')
  })

  test('tras cerrar se puede volver a entrar', async () => {
    const u = await usuarioNuevo()
    const primera = await entrar(u.email)
    await salir(primera.cookie)
    const segunda = await entrar(u.email)
    assert.notEqual(segunda.token, primera.token, 'el token nuevo debe ser distinto')
    assert.equal((await sesionActiva(segunda.cookie)).status, 200)
  })
})
