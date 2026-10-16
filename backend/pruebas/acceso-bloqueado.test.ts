// S2-TEC-01, último criterio: cada acceso bloqueado (403 por rol, página prohibida, recurso de
// otra gerencia) queda en la bitácora como `acceso_bloqueado`; un 401 no, porque no hay a
// quién atribuirlo. La respuesta al cliente no cambia.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { auditarBloqueo } from '../src/datos/accesoBloqueado.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>
const cookie: Record<string, string> = {}
const usuario: Record<string, string> = {}
const gerencia: Record<string, string> = {}
let indicadorB = ''

async function crearGerencia(org: string, clave: string) {
  const [ger] = await bd.consultar<{ id: string }>(
    'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org, clave, `Gerencia ${clave}`])
  const [uni] = await bd.consultar<{ id: string }>(
    'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [ger!.id, `Coord ${clave}`])
  return { gerencia: ger!.id, unidad: uni!.id }
}

async function crearUsuario(nombre: string, rol: string, g: { gerencia: string; unidad: string }) {
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`,
    [g.gerencia, g.unidad, nombre, `${nombre}-${randomUUID()}@comapasur.gob.mx`, rol])
  usuario[nombre] = u!.id
  cookie[nombre] = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
}

const pedir = (ruta: string, quien?: string) =>
  fetch(app.url + ruta, { headers: quien ? { cookie: cookie[quien]! } : {} })

interface Bloqueo { rol: string; detalle: any; ip: string | null }
const bloqueosDe = (quien: string) => bd.consultar<Bloqueo>(
  `SELECT rol, detalle, ip::text AS ip FROM bitacora
    WHERE accion = 'acceso_bloqueado' AND usuario_id = $1 ORDER BY id`, [usuario[quien]])

before(async () => {
  app = await levantar()
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id',
    [`Org bloqueos ${randomUUID().slice(0, 8)}`])
  const A = await crearGerencia(org!.id, 'A')
  const B = await crearGerencia(org!.id, 'B')
  gerencia.A = A.gerencia
  for (const [n, rol] of [['enlaceA', 'enlace'], ['revisorA', 'revisor'], ['enlaceA2', 'enlace'],
    ['enlaceA3', 'enlace'], ['enlaceA4', 'enlace']] as const) await crearUsuario(n, rol, A)
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ($1, $2, 'actividad', 'Ajeno', 'Porcentaje', 'mensual') RETURNING id`, [B.gerencia, `B-${randomUUID().slice(0, 8)}`])
  indicadorB = i!.id
})
after(async () => { await app.cerrar(); await bd.cerrar() })

describe('acceso_bloqueado en la bitácora', () => {
  test('un Enlace en una ruta de API de Administrador: 403 y un evento con motivo rol', async () => {
    const r = await pedir('/api/admin/indicadores', 'enlaceA')
    assert.equal(r.status, 403)
    assert.equal((await r.json() as any).error, 'prohibido')
    const [e, ...resto] = await bloqueosDe('enlaceA')
    assert.equal(resto.length, 0)
    assert.equal(e!.rol, 'enlace')
    assert.deepEqual(e!.detalle, {
      metodo: 'GET', ruta: '/api/admin/indicadores', motivo: 'rol', gerencia_id: gerencia.A })
    assert.ok(e!.ip, 'debe llevar la IP')
  })

  test('un Revisor en la misma ruta también', async () => {
    assert.equal((await pedir('/api/admin/indicadores', 'revisorA')).status, 403)
    const [e] = await bloqueosDe('revisorA')
    assert.equal(e!.rol, 'revisor')
    assert.equal(e!.detalle.motivo, 'rol')
  })

  test('una página prohibida vía /api/auth/acceso', async () => {
    const r = await pedir('/api/auth/acceso?pagina=configuracion.html', 'enlaceA2')
    assert.equal(r.status, 403)
    const [e] = await bloqueosDe('enlaceA2')
    assert.deepEqual(e!.detalle, {
      metodo: 'GET', ruta: 'configuracion.html', motivo: 'rol', gerencia_id: gerencia.A })
  })

  test('un indicador de otra gerencia: mismo 404 de siempre y un evento otra_gerencia', async () => {
    const r = await pedir(`/api/indicadores/${indicadorB}`, 'enlaceA3')
    assert.equal(r.status, 404)
    assert.equal((await r.json() as any).error, 'no_encontrado')
    assert.equal((await pedir(`/api/indicadores/${indicadorB}/ficha`, 'enlaceA3')).status, 404)
    const eventos = await bloqueosDe('enlaceA3')
    assert.equal(eventos.length, 2)
    assert.equal(eventos[0]!.detalle.motivo, 'otra_gerencia')
    assert.equal(eventos[0]!.detalle.ruta, `/api/indicadores/${indicadorB}`)
  })

  test('un indicador que no existe no es un bloqueo', async () => {
    assert.equal((await pedir(`/api/indicadores/${randomUUID()}`, 'enlaceA4')).status, 404)
    assert.equal((await bloqueosDe('enlaceA4')).length, 0)
  })

  test('el evento no guarda cuerpo, cookies ni query', async () => {
    await fetch(`${app.url}/api/admin/indicadores?texto=secreto`, {
      method: 'POST', headers: { cookie: cookie.enlaceA4!, 'content-type': 'application/json' },
      body: JSON.stringify({ clave: 'valor-privado' }) })
    const eventos = await bloqueosDe('enlaceA4')
    assert.equal(eventos.length, 1)
    const texto = JSON.stringify(eventos)
    assert.ok(!texto.includes('valor-privado') && !texto.includes('secreto') && !texto.includes(COOKIE_SESION))
  })

  test('sin sesión (401) no se registra nada', async () => {
    const cuenta = async () => (await bd.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM bitacora WHERE accion = 'acceso_bloqueado' AND usuario_id = ANY($1)`,
      [Object.values(usuario)]))[0]!.n
    const antes = await cuenta()
    assert.equal((await pedir('/api/admin/indicadores')).status, 401)
    assert.equal((await pedir('/api/auth/acceso?pagina=configuracion.html')).status, 401)
    assert.equal(await cuenta(), antes)
  })

  test('si falla la bitácora, auditarBloqueo no lanza (la petición sigue bloqueada)', async () => {
    const roto = { consultar: async () => { throw new Error('bitácora caída') } } as any
    await auditarBloqueo(roto, { usuarioId: usuario.enlaceA!, rol: 'enlace', gerenciaId: gerencia.A! },
      { metodo: 'GET', ruta: '/x', motivo: 'rol' })
  })

  test('una sesión con más de 8 h de inactividad recibe 401 y no se audita', async () => {
    await bd.consultar(`UPDATE sesiones SET expira_at = now() - interval '1 second' WHERE usuario_id = $1`, [usuario.revisorA])
    assert.equal((await pedir('/api/admin/indicadores', 'revisorA')).status, 401)
    assert.equal((await bloqueosDe('revisorA')).length, 1)
  })
})
