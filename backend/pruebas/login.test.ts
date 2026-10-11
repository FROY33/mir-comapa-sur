// HU-R7-01: login con credenciales reales. Cubre los CA del RQM que viven en el
// backend y las reglas RN_1, RN_2 y RN_4. Lo del formulario (CA-1, CA-6) se prueba
// aparte; aquí se verifica que el backend no confíe en él.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { COOKIE_SESION, revocar } from '../src/datos/sesiones.js'
import { PASSWORD, prepararLogin, tokenDe } from './apoyo-login.js'

const { bd, crearUsuario, entrar, url } = prepararLogin()

describe('credenciales', () => {
  test('con credenciales correctas entra y recibe su sesión', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: PASSWORD })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.usuario.email, u.email)
    assert.equal(r.cuerpo.usuario.rol, 'enlace')
    assert.equal(r.cuerpo.usuario.gerencia.clave, 'TEC')
    assert.equal(r.cuerpo.usuario.unidad, 'Coordinación General Técnica')
  })

  test('el correo se compara sin distinguir mayúsculas ni espacios', async () => {
    const u = await crearUsuario('revisor')
    const r = await entrar({ email: `  ${u.email.toUpperCase()}  `, password: PASSWORD })
    assert.equal(r.status, 200)
  })

  test('con la contraseña mal responde 401', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: 'otra-cosa' })
    assert.equal(r.status, 401)
    assert.equal(r.cuerpo.error, 'credenciales')
  })

  test('RN_4: el mensaje es el mismo exista o no el correo, y no dice cuál es el caso', async () => {
    const u = await crearUsuario('enlace')
    const existe = await entrar({ email: u.email, password: 'mala' })
    const noExiste = await entrar({ email: `fantasma-${randomUUID()}@comapasur.gob.mx`, password: 'mala' })

    assert.equal(existe.status, noExiste.status)
    assert.deepEqual(existe.cuerpo, noExiste.cuerpo, 'las respuestas deben ser indistinguibles')
    assert.ok(!/existe|encontr|registrad|desconocid/i.test(JSON.stringify(noExiste.cuerpo)),
      'el mensaje insinúa si la cuenta existe')
  })

  test('una cuenta inactiva se rechaza con el mismo error genérico', async () => {
    const u = await crearUsuario('enlace', false)
    const r = await entrar({ email: u.email, password: PASSWORD })
    assert.equal(r.status, 401)
    assert.equal(r.cuerpo.error, 'credenciales')
  })

  test('CA-1: el backend no confía en la validación del formulario', async () => {
    for (const cuerpo of [{}, { email: '' }, { email: 'a@b.c' }, { email: 'a@b.c', password: '' }, { password: 'x' }]) {
      const r = await entrar(cuerpo)
      assert.equal(r.status, 400, `debería rechazar ${JSON.stringify(cuerpo)}`)
      assert.equal(r.cuerpo.error, 'campos_requeridos')
    }
  })

  test('un cuerpo que no es JSON se rechaza con 400, no con 500', async () => {
    const r = await entrar('esto no es json')
    assert.equal(r.status, 400)
    assert.equal(r.cuerpo.error, 'solicitud_invalida')
  })
})

describe('CA-2 y CA-3: la contraseña y el token', () => {
  test('la contraseña no viaja de vuelta ni aparece en la respuesta', async () => {
    const u = await crearUsuario('admin')
    const r = await entrar({ email: u.email, password: PASSWORD })
    const texto = JSON.stringify(r.cuerpo)
    assert.ok(!texto.includes(PASSWORD), 'la contraseña salió en la respuesta')
    assert.ok(!/password_hash|\$2[aby]\$/.test(texto), 'el hash salió en la respuesta')
  })

  test('en la base solo hay hash bcrypt de 12 rondas o más (RN_1)', async () => {
    const u = await crearUsuario('enlace')
    const [fila] = await bd.consultar<{ password_hash: string }>(
      'SELECT password_hash FROM usuarios WHERE id = $1', [u.id])
    assert.ok(/^\$2[aby]\$(1[2-9]|[2-9][0-9])\$/.test(fila!.password_hash))
    assert.ok(!fila!.password_hash.includes(PASSWORD))
  })

  test('CA-3: la cookie es HttpOnly y SameSite=Strict', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: PASSWORD })
    const linea = r.setCookie.find((c) => c.startsWith(`${COOKIE_SESION}=`))
    assert.ok(linea, 'no se envió la cookie de sesión')
    assert.match(linea, /HttpOnly/)
    assert.match(linea, /SameSite=Strict/)
    assert.match(linea, /Path=\//)
  })

  test('fuera de producción la cookie no es Secure, o no se guardaría sobre HTTP', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: PASSWORD })
    const linea = r.setCookie.find((c) => c.startsWith(`${COOKIE_SESION}=`))!
    assert.ok(!/Secure/.test(linea))
  })

  test('el token de la cookie no se guarda en claro en la base', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: PASSWORD })
    const token = tokenDe(r.setCookie)!
    const [fila] = await bd.consultar<{ n: string }>(
      'SELECT count(*)::text AS n FROM sesiones WHERE token_hash = $1', [token])
    assert.equal(fila!.n, '0', 'el token está guardado tal cual; debería guardarse su sha256')
  })
})

describe('CA-4 y CA-5: rol y sesión existente', () => {
  const dashboards = { admin: 'dashboard-admin.html', revisor: 'dashboard-revisor.html', enlace: 'dashboard-enlace.html' }

  for (const rol of ['admin', 'revisor', 'enlace'] as const) {
    test(`CA-4: un ${rol} recibe el dashboard de su rol`, async () => {
      const u = await crearUsuario(rol)
      const r = await entrar({ email: u.email, password: PASSWORD })
      assert.equal(r.cuerpo.redirigirA, dashboards[rol])
    })
  }

  test('CA-4: el rol lo decide el backend; lo que mande el cliente se ignora', async () => {
    const u = await crearUsuario('enlace')
    const r = await entrar({ email: u.email, password: PASSWORD, rol: 'admin', redirigirA: dashboards.admin })
    assert.equal(r.cuerpo.usuario.rol, 'enlace')
    assert.equal(r.cuerpo.redirigirA, dashboards.enlace)
  })

  test('CA-5: con la cookie de sesión, /api/auth/sesion devuelve a quién pertenece', async () => {
    const u = await crearUsuario('revisor')
    const entrada = await entrar({ email: u.email, password: PASSWORD })
    const token = tokenDe(entrada.setCookie)!

    const r = await fetch(`${url()}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 200)
    const cuerpo = await r.json() as Record<string, any>
    assert.equal(cuerpo.usuario.email, u.email)
    assert.equal(cuerpo.redirigirA, dashboards.revisor)
  })

  test('sin cookie, /api/auth/sesion responde 401', async () => {
    const r = await fetch(`${url()}/api/auth/sesion`)
    assert.equal(r.status, 401)
    assert.equal((await r.json() as Record<string, any>).error, 'sin_sesion')
  })

  test('una cookie inventada no abre sesión', async () => {
    const r = await fetch(`${url()}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=inventado` } })
    assert.equal(r.status, 401)
  })

  test('una sesión revocada deja de servir', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    assert.ok(await revocar(bd, token))
    const r = await fetch(`${url()}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 401)
  })

  test('si la cuenta se desactiva, su sesión abierta deja de servir', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    await bd.consultar('UPDATE usuarios SET activo = false WHERE id = $1', [u.id])
    const r = await fetch(`${url()}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 401)
  })
})
