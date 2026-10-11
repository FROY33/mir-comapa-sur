// HU-R7-07: gestión de usuarios del Administrador. Dos gerencias propias (A con un
// indicador activo, B), un Administrador con sesión y el backend real.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { MAX_INTENTOS } from '../src/datos/loginIntentos.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>
const A = { gerencia: '', unidad: '' }
const B = { gerencia: '', unidad: '' }
let adminId = ''
let cookieAdmin = ''
let cookieEnlace = ''
const sufijo = randomUUID().slice(0, 8)
const correo = (nombre: string) => `${nombre}-${sufijo}@comapasur.gob.mx`

async function pedir(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown) {
  const r = await fetch(app.url + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: cuerpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(cuerpo),
  })
  return { status: r.status, cuerpo: await r.json() as any, setCookie: r.headers.getSetCookie() }
}

async function entrar(email: string, password: string) {
  const r = await pedir('POST', '/api/auth/login', undefined, { email, password })
  const linea = r.setCookie.find((c) => c.startsWith(`${COOKIE_SESION}=`))
  return { ...r, cookie: linea?.split(';')[0] }
}

const alta = (datos: Record<string, unknown>) => pedir('POST', '/api/admin/usuarios', cookieAdmin, datos)
const datosEnlace = (nombre: string) => ({ nombre: `Persona ${nombre}`, email: correo(nombre), gerencia_id: A.gerencia, unidad_id: A.unidad, rol: 'enlace' })

before(async () => {
  app = await levantar()
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R7-07 ${sufijo}`])
  for (const [g, clave] of [[A, 'UA'], [B, 'UB']] as const) {
    const [ger] = await bd.consultar<{ id: string }>(
      'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org!.id, clave, `Gerencia ${clave} ${sufijo}`])
    const [uni] = await bd.consultar<{ id: string }>(
      'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [ger!.id, `Coordinación ${clave}`])
    g.gerencia = ger!.id
    g.unidad = uni!.id
  }
  await bd.consultar(`INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
                      VALUES ($1, $2, 'actividad', 'Indicador', 'Porcentaje', 'mensual')`, [A.gerencia, `UA-${sufijo}`])
  const insertar = async (nombre: string, rol: string) => {
    const [u] = await bd.consultar<{ id: string }>(
      `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`, [A.gerencia, A.unidad, nombre, correo(nombre), rol])
    return u!.id
  }
  adminId = await insertar('admin', 'admin')
  cookieAdmin = `${COOKIE_SESION}=${await crear(bd, adminId)}`
  cookieEnlace = `${COOKIE_SESION}=${await crear(bd, await insertar('enlace-sesion', 'enlace'))}`
})
after(async () => { await app.cerrar(); await bd.cerrar() })

describe('CA_1: solo el Administrador', () => {
  const rutas: [string, string][] = [
    ['GET', '/api/admin/usuarios'], ['GET', '/api/admin/catalogo'], ['POST', '/api/admin/usuarios'],
    ['PUT', `/api/admin/usuarios/${randomUUID()}`], ['POST', `/api/admin/usuarios/${randomUUID()}/desactivar`],
    ['POST', `/api/admin/usuarios/${randomUUID()}/restablecer`], ['POST', `/api/admin/usuarios/${randomUUID()}/desbloquear`],
  ]
  for (const [metodo, ruta] of rutas) {
    test(`${metodo} ${ruta.replace(/[0-9a-f-]{36}/, ':id')}: 401 sin sesión y 403 a un Enlace`, async () => {
      assert.equal((await pedir(metodo, ruta, undefined, {})).status, 401)
      assert.equal((await pedir(metodo, ruta, cookieEnlace, {})).status, 403)
    })
  }

  test('configuracion.html (gestión de usuarios) solo la abre el Administrador', async () => {
    assert.equal((await pedir('GET', '/api/auth/acceso?pagina=configuracion.html', cookieEnlace)).status, 403)
    assert.equal((await pedir('GET', '/api/auth/acceso?pagina=configuracion.html', cookieAdmin)).status, 200)
  })
})

describe('CA_2: datos obligatorios, correo único y unidad de la gerencia', () => {
  test('sin nombre, correo, gerencia, unidad o rol: 422 y dice qué falta', async () => {
    const r = await alta({ nombre: '', email: 'no-es-correo', gerencia_id: A.gerencia, unidad_id: A.unidad, rol: 'lectura' })
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.mensaje, /nombre.*correo.*rol/)
  })

  test('un correo repetido, aun con otras mayúsculas, es 409', async () => {
    assert.equal((await alta(datosEnlace('unico'))).status, 201)
    const r = await alta({ ...datosEnlace('otro'), email: correo('unico').toUpperCase() })
    assert.equal(r.status, 409)
    assert.equal(r.cuerpo.error, 'correo_duplicado')
  })

  test('una unidad de otra gerencia es 422', async () => {
    const r = await alta({ ...datosEnlace('cruzado'), unidad_id: B.unidad })
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.error, 'unidad_de_otra_gerencia')
  })

  test('el catálogo trae cada gerencia con sus unidades, para filtrarlas en el formulario', async () => {
    const r = await pedir('GET', '/api/admin/catalogo', cookieAdmin)
    const a = r.cuerpo.gerencias.find((g: { id: string }) => g.id === A.gerencia)
    assert.deepEqual(a.unidades.map((u: { id: string }) => u.id), [A.unidad])
  })
})

describe('CA_3: contraseña temporal y cambio obligatorio', () => {
  test('el alta genera la contraseña; con ella solo se puede cambiarla', async () => {
    const r = await alta(datosEnlace('nuevo'))
    assert.equal(r.status, 201)
    const temporal = r.cuerpo.passwordTemporal as string
    assert.ok(temporal.length >= 12)

    const l = await entrar(correo('nuevo'), temporal)
    assert.equal(l.status, 200)
    assert.equal(l.cuerpo.redirigirA, 'cambiar-password.html')
    const datos = await pedir('GET', '/api/indicadores', l.cookie)
    assert.equal(datos.status, 403)
    assert.equal(datos.cuerpo.error, 'cambio_password_requerido')
    assert.equal((await pedir('GET', '/api/auth/acceso?pagina=dashboard-enlace.html', l.cookie)).cuerpo.redirigirA, 'cambiar-password.html')
    assert.equal((await pedir('GET', '/api/auth/acceso?pagina=cambiar-password.html', l.cookie)).status, 200)

    assert.equal((await pedir('POST', '/api/auth/cambiar-password', l.cookie, { actual: 'mala', nueva: 'Una-Nueva-Larga-2026' })).status, 422)
    assert.equal((await pedir('POST', '/api/auth/cambiar-password', l.cookie, { actual: temporal, nueva: 'corta' })).status, 422)
    const ok = await pedir('POST', '/api/auth/cambiar-password', l.cookie, { actual: temporal, nueva: 'Una-Nueva-Larga-2026' })
    assert.equal(ok.status, 200)
    assert.equal(ok.cuerpo.redirigirA, 'dashboard-enlace.html')

    assert.equal((await pedir('GET', '/api/indicadores', l.cookie)).status, 200, 'la sesión no siguió tras cambiarla')
    assert.equal((await entrar(correo('nuevo'), temporal)).status, 401, 'la temporal sigue sirviendo')
    assert.equal((await entrar(correo('nuevo'), 'Una-Nueva-Larga-2026')).status, 200)
  })

  test('restablecer da otra temporal, cierra sus sesiones y vuelve a exigir el cambio', async () => {
    const { cuerpo } = await alta(datosEnlace('olvido'))
    const l = await entrar(correo('olvido'), cuerpo.passwordTemporal)
    await pedir('POST', '/api/auth/cambiar-password', l.cookie, { actual: cuerpo.passwordTemporal, nueva: 'Primera-Propia-2026' })

    const r = await pedir('POST', `/api/admin/usuarios/${cuerpo.usuario.id}/restablecer`, cookieAdmin)
    assert.equal(r.status, 200)
    assert.equal((await pedir('GET', '/api/indicadores', l.cookie)).status, 401, 'su sesión siguió abierta')
    const otra = await entrar(correo('olvido'), r.cuerpo.passwordTemporal)
    assert.equal(otra.cuerpo.redirigirA, 'cambiar-password.html')
  })
})

describe('CA_4 y RN_3: desactivar, conservar historial y reactivar', () => {
  test('un inactivo no entra, conserva su historial y se puede reactivar', async () => {
    const { cuerpo } = await alta(datosEnlace('baja'))
    const id = cuerpo.usuario.id
    assert.equal((await pedir('POST', `/api/admin/usuarios/${id}/desactivar`, cookieAdmin)).cuerpo.usuario.activo, false)
    assert.equal((await entrar(correo('baja'), cuerpo.passwordTemporal)).status, 401)
    assert.ok((await listarEventos(bd, 'usuario', id)).length >= 2, 'se perdió su historial')
    assert.equal((await pedir('POST', `/api/admin/usuarios/${id}/reactivar`, cookieAdmin)).cuerpo.usuario.activo, true)
    assert.equal((await entrar(correo('baja'), cuerpo.passwordTemporal)).status, 200)
  })

  test('no hay ruta para borrar usuarios', async () => {
    assert.equal((await pedir('DELETE', `/api/admin/usuarios/${adminId}`, cookieAdmin)).status, 404)
  })
})

describe('CA_5: cambiar rol o gerencia cierra su sesión', () => {
  test('cambiar el rol invalida la sesión al instante; cambiar el nombre no', async () => {
    const { cuerpo } = await alta(datosEnlace('cambia'))
    const id = cuerpo.usuario.id
    const l = await entrar(correo('cambia'), cuerpo.passwordTemporal)
    await pedir('POST', '/api/auth/cambiar-password', l.cookie, { actual: cuerpo.passwordTemporal, nueva: 'Propia-De-Cambia-2026' })

    const nombre = await pedir('PUT', `/api/admin/usuarios/${id}`, cookieAdmin, { ...datosEnlace('cambia'), nombre: 'Otro nombre' })
    assert.equal(nombre.cuerpo.sesionesRevocadas, 0)
    assert.equal((await pedir('GET', '/api/indicadores', l.cookie)).status, 200)

    const rol = await pedir('PUT', `/api/admin/usuarios/${id}`, cookieAdmin, { ...datosEnlace('cambia'), rol: 'revisor' })
    assert.equal(rol.cuerpo.sesionesRevocadas, 1)
    assert.equal((await pedir('GET', '/api/indicadores', l.cookie)).status, 401)
  })

  test('cambiar la gerencia también', async () => {
    const { cuerpo } = await alta(datosEnlace('muda'))
    const l = await entrar(correo('muda'), cuerpo.passwordTemporal)
    await pedir('PUT', `/api/admin/usuarios/${cuerpo.usuario.id}`, cookieAdmin,
      { ...datosEnlace('muda'), gerencia_id: B.gerencia, unidad_id: B.unidad })
    assert.equal((await pedir('POST', '/api/auth/cambiar-password', l.cookie, {})).status, 401)
  })
})

describe('CA_6: todo queda en la bitácora, sin contraseñas', () => {
  test('alta, edición, desactivación, reactivación y restablecimiento, con el Administrador como autor', async () => {
    const { cuerpo } = await alta(datosEnlace('auditado'))
    const id = cuerpo.usuario.id
    await pedir('PUT', `/api/admin/usuarios/${id}`, cookieAdmin, { ...datosEnlace('auditado'), nombre: 'Renombrado' })
    await pedir('POST', `/api/admin/usuarios/${id}/desactivar`, cookieAdmin)
    await pedir('POST', `/api/admin/usuarios/${id}/reactivar`, cookieAdmin)
    await pedir('POST', `/api/admin/usuarios/${id}/restablecer`, cookieAdmin)

    const eventos = await listarEventos(bd, 'usuario', id)
    assert.deepEqual(eventos.map((e) => e.accion),
      ['usuario_alta', 'usuario_edicion', 'usuario_desactivado', 'usuario_reactivado', 'password_restablecida'])
    assert.ok(eventos.every((e) => e.usuario_id === adminId))
    const edicion = eventos[1]!.detalle as { antes: { nombre: string }; despues: { nombre: string } }
    assert.deepEqual([edicion.antes.nombre, edicion.despues.nombre], ['Persona auditado', 'Renombrado'])
    const texto = JSON.stringify(eventos)
    assert.ok(!texto.includes(cuerpo.passwordTemporal) && !/\$2[aby]\$/.test(texto), 'hay una contraseña o un hash en la bitácora')
  })
})

describe('RN_4: advertencia de gerencias sin Enlace o sin Revisor activo', () => {
  test('una gerencia con indicadores se advierte mientras le falte Enlace o Revisor activo', async () => {
    const [org] = await bd.consultar<{ organizacion_id: string }>('SELECT organizacion_id FROM gerencias WHERE id = $1', [A.gerencia])
    const [c] = await bd.consultar<{ id: string }>(
      `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'UC', $2) RETURNING id`, [org!.organizacion_id, `Gerencia UC ${sufijo}`])
    const [u] = await bd.consultar<{ id: string }>(
      `INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, 'Coordinación UC', true) RETURNING id`, [c!.id])
    await bd.consultar(`INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
                        VALUES ($1, $2, 'actividad', 'Indicador', 'Porcentaje', 'mensual')`, [c!.id, `UC-${sufijo}`])
    const faltan = async () => (await pedir('GET', '/api/admin/usuarios', cookieAdmin)).cuerpo.advertencias
      .find((g: { nombre: string }) => g.nombre === `Gerencia UC ${sufijo}`)?.faltan
    assert.deepEqual(await faltan(), ['enlace', 'revisor'])

    const r = await alta({ nombre: 'Enlace UC', email: correo('enlace-uc'), gerencia_id: c!.id, unidad_id: u!.id, rol: 'enlace' })
    assert.deepEqual(r.cuerpo.advertencias.find((g: { nombre: string }) => g.nombre === `Gerencia UC ${sufijo}`).faltan, ['revisor'])
    await pedir('POST', `/api/admin/usuarios/${r.cuerpo.usuario.id}/desactivar`, cookieAdmin)
    assert.deepEqual(await faltan(), ['enlace', 'revisor'], 'desactivar al único Enlace no se advirtió')
  })
})

describe('protecciones', () => {
  test('el Administrador no puede desactivarse ni quitarse el rol', async () => {
    assert.equal((await pedir('POST', `/api/admin/usuarios/${adminId}/desactivar`, cookieAdmin)).cuerpo.error, 'propia_cuenta')
    const r = await pedir('PUT', `/api/admin/usuarios/${adminId}`, cookieAdmin,
      { nombre: 'admin', email: correo('admin'), gerencia_id: A.gerencia, unidad_id: A.unidad, rol: 'enlace' })
    assert.equal(r.cuerpo.error, 'propia_cuenta')
  })

  test('R7-06 CA_4: el Administrador desbloquea una cuenta sin esperar los 15 minutos', async () => {
    const { cuerpo } = await alta(datosEnlace('bloqueado'))
    for (let i = 0; i < MAX_INTENTOS; i++) await entrar(correo('bloqueado'), 'mala')
    assert.equal((await entrar(correo('bloqueado'), cuerpo.passwordTemporal)).status, 423)
    const r = await pedir('POST', `/api/admin/usuarios/${cuerpo.usuario.id}/desbloquear`, cookieAdmin)
    assert.equal(r.cuerpo.desbloqueado, true)
    assert.equal((await entrar(correo('bloqueado'), cuerpo.passwordTemporal)).status, 200)
  })

  test('filtros por rol, gerencia y estado', async () => {
    const r = await pedir('GET', `/api/admin/usuarios?rol=admin&gerencia_id=${A.gerencia}&estado=activo`, cookieAdmin)
    assert.deepEqual(r.cuerpo.usuarios.map((u: { id: string }) => u.id), [adminId])
  })
})
