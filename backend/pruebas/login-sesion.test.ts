// HU-R7-01, segunda parte: la inactividad de 8 horas (RN_2) y el bloqueo por intentos con
// su auditoría (R7-06, TEC-05). La primera parte está en login.test.ts.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ENTIDAD } from '../src/datos/acceso.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { MAX_INTENTOS } from '../src/datos/loginIntentos.js'
import { COOKIE_SESION, HORAS_INACTIVIDAD } from '../src/datos/sesiones.js'
import { PASSWORD, prepararLogin, tokenDe } from './apoyo-login.js'

const { bd, crearUsuario, entrar, url } = prepararLogin()

describe('RN_2: inactividad de 8 horas renovable', () => {
  test('la sesión nace con 8 horas por delante', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    const [fila] = await bd.consultar<{ horas: string }>(
      `SELECT round(extract(epoch FROM expira_at - now()) / 3600)::text AS horas
         FROM sesiones WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [token])
    assert.equal(fila!.horas, String(HORAS_INACTIVIDAD))
  })

  test('cada petición autenticada corre la expiración hacia adelante', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    const llave = `encode(sha256($1::bytea), 'hex')`
    // Se envejece la sesión a mano: faltándole 1 hora, una petición debe devolverla a 8
    await bd.consultar(`UPDATE sesiones SET expira_at = now() + interval '1 hour' WHERE token_hash = ${llave}`, [token])
    const r = await fetch(`${url()}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 200)
    const [fila] = await bd.consultar<{ horas: string }>(
      `SELECT round(extract(epoch FROM expira_at - now()) / 3600)::text AS horas
         FROM sesiones WHERE token_hash = ${llave}`, [token])
    assert.equal(fila!.horas, String(HORAS_INACTIVIDAD), 'la expiración no se renovó')
  })

  test('una sesión expirada no revive', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    await bd.consultar(
      `UPDATE sesiones SET expira_at = now() - interval '1 second' WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [token])
    const r = await fetch(`${url()}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 401)
  })
})

describe('bloqueo por intentos y auditoría', () => {
  test('tras MAX_INTENTOS fallos el login responde 423 sin revisar la contraseña', async () => {
    const u = await crearUsuario('enlace')
    for (let i = 0; i < MAX_INTENTOS; i++) {
      const r = await entrar({ email: u.email, password: 'mala' })
      assert.ok([401, 423].includes(r.status))
    }
    // Ya bloqueado: incluso con la contraseña correcta
    const r = await entrar({ email: u.email, password: PASSWORD })
    assert.equal(r.status, 423)
    assert.equal(r.cuerpo.error, 'cuenta_bloqueada')
    assert.equal(r.setCookie.length, 0, 'no debe abrir sesión estando bloqueada')
  })

  test('TEC-05 CA-1: el login exitoso y el fallido quedan en la auditoría con su IP', async () => {
    const u = await crearUsuario('enlace')
    await entrar({ email: u.email, password: 'mala' })
    await entrar({ email: u.email, password: PASSWORD })

    const eventos = await listarEventos(bd, ENTIDAD, u.email.toLowerCase())
    const acciones = eventos.map((e) => e.accion)
    assert.ok(acciones.includes('login_fallido'), 'falta el evento de login fallido')
    assert.ok(acciones.includes('login_exitoso'), 'falta el evento de login exitoso')

    const [conIp] = await bd.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM bitacora
        WHERE entidad = $1 AND entidad_id = $2 AND ip IS NOT NULL`, [ENTIDAD, u.email.toLowerCase()])
    assert.equal(conIp!.n, String(eventos.length), 'hay eventos de acceso sin IP')
  })

  test('el login exitoso deja el evento con el usuario y su rol', async () => {
    const u = await crearUsuario('admin')
    await entrar({ email: u.email, password: PASSWORD })
    const [evento] = (await listarEventos(bd, ENTIDAD, u.email.toLowerCase()))
      .filter((e) => e.accion === 'login_exitoso')
    assert.equal(evento?.usuario_id, u.id)
    assert.equal(evento?.rol, 'admin')
  })

  test('CA-2: ni la contraseña ni el token llegan a la auditoría', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: PASSWORD })
    const token = tokenDe(r.setCookie)!
    const [fila] = await bd.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM bitacora
        WHERE entidad = $1 AND (detalle::text LIKE '%' || $2 || '%' OR detalle::text LIKE '%' || $3 || '%')`,
      [ENTIDAD, PASSWORD, token])
    assert.equal(fila!.n, '0')
  })

  test('el login correcto limpia el contador de intentos', async () => {
    const u = await crearUsuario('enlace')
    for (let i = 0; i < MAX_INTENTOS - 1; i++) await entrar({ email: u.email, password: 'mala' })
    assert.equal((await entrar({ email: u.email, password: PASSWORD })).status, 200)
    const [fila] = await bd.consultar<{ n: string }>(
      'SELECT count(*)::text AS n FROM login_intentos WHERE email = $1', [u.email.toLowerCase()])
    assert.equal(fila!.n, '0')
  })
})
