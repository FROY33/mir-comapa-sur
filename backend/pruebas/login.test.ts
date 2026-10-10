// HU-R7-01: login con credenciales reales. Cubre los CA del RQM que viven en el
// backend y las reglas RN_1, RN_2 y RN_4. Lo del formulario (CA-1, CA-6) se prueba
// aparte; aquí se verifica que el backend no confíe en él.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { crearBD } from '../src/bd.js'
import { ENTIDAD } from '../src/datos/acceso.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { MAX_INTENTOS } from '../src/datos/loginIntentos.js'
import { COOKIE_SESION, HORAS_INACTIVIDAD, revocar } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { levantar } from './apoyo.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

const PASSWORD = 'Contrasena-Valida-2026'
let app: Awaited<ReturnType<typeof levantar>>
let gerenciaId: string
let unidadId: string

/** Crea un usuario con contraseña real. bcrypt a 12 rondas, como manda RN_1. */
async function crearUsuario(rol: 'admin' | 'revisor' | 'enlace', activo = true) {
  const email = `login-${randomUUID()}@comapasur.gob.mx`
  const hash = await bcrypt.hash(PASSWORD, 12)
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, activo)
     VALUES ($1, $2, 'Quien inicia sesión', $3, $4, $5, $6) RETURNING id`,
    [gerenciaId, unidadId, email, hash, rol, activo])
  return { id: u!.id, email }
}

/** POST /api/auth/login contra el backend real. Devuelve status, cuerpo y cookies. */
async function entrar(cuerpo: unknown, cookie?: string) {
  const r = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  })
  return { status: r.status, cuerpo: await r.json() as Record<string, any>, setCookie: r.headers.getSetCookie() }
}

/** Extrae el valor de la cookie de sesión de un Set-Cookie. */
const tokenDe = (setCookie: string[]) => {
  const linea = setCookie.find((c) => c.startsWith(`${COOKIE_SESION}=`))
  return linea?.slice(COOKIE_SESION.length + 1).split(';')[0]
}

before(async () => {
  app = await levantar()
  const sufijo = randomUUID()
  const [org] = await bd.consultar<{ id: string }>(
    'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org login ${sufijo}`])
  const [g] = await bd.consultar<{ id: string }>(
    `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'TEC', 'Gerencia Técnica') RETURNING id`, [org!.id])
  const [n] = await bd.consultar<{ id: string }>(
    `INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, 'Coordinación General Técnica', true) RETURNING id`, [g!.id])
  gerenciaId = g!.id
  unidadId = n!.id
})
after(() => app.cerrar())

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
  const dashboards = { admin: 'dashboard-inicio.html', revisor: 'dashboard-revisor.html', enlace: 'dashboard-enlace.html' }

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

    const r = await fetch(`${app.url}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 200)
    const cuerpo = await r.json() as Record<string, any>
    assert.equal(cuerpo.usuario.email, u.email)
    assert.equal(cuerpo.redirigirA, dashboards.revisor)
  })

  test('sin cookie, /api/auth/sesion responde 401', async () => {
    const r = await fetch(`${app.url}/api/auth/sesion`)
    assert.equal(r.status, 401)
    assert.equal((await r.json() as Record<string, any>).error, 'sin_sesion')
  })

  test('una cookie inventada no abre sesión', async () => {
    const r = await fetch(`${app.url}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=inventado` } })
    assert.equal(r.status, 401)
  })

  test('una sesión revocada deja de servir', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    assert.ok(await revocar(bd, token))
    const r = await fetch(`${app.url}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 401)
  })

  test('si la cuenta se desactiva, su sesión abierta deja de servir', async () => {
    const u = await crearUsuario('enlace')
    const token = tokenDe((await entrar({ email: u.email, password: PASSWORD })).setCookie)!
    await bd.consultar('UPDATE usuarios SET activo = false WHERE id = $1', [u.id])
    const r = await fetch(`${app.url}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
    assert.equal(r.status, 401)
  })
})

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
    const r = await fetch(`${app.url}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
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
    const r = await fetch(`${app.url}/api/auth/sesion`, { headers: { cookie: `${COOKIE_SESION}=${token}` } })
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
