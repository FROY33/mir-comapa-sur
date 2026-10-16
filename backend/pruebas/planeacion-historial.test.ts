// Ticket 8 (HU-R4-01 CA_6): historial de ciclos del Administrador.
// GET /api/admin/planeacion/ciclos. El ciclo vigente es global, así que corre en una base propia.

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { levantar } from './apoyo.js'
import { crearCiclo, crearGerencia, crearIndicador, entrar, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'

const RUTA = '/api/admin/planeacion/ciclos'

describe('historial de ciclos de planeación (HU-R4-01 CA_6)', () => {
  let base: BasePlaneacion
  let app: Awaited<ReturnType<typeof levantar>>
  let g: Gerencia
  let anio: number
  const cookie: Record<string, string> = {}

  const get = async (ruta: string, quien?: string) => {
    const r = await fetch(app.url + ruta, { headers: quien ? { cookie: cookie[quien]! } : {} })
    return { status: r.status, cuerpo: await r.json() as any }
  }
  const dia = async (d: number) =>
    (await base.bd.consultar<{ d: string }>('SELECT (current_date + $1::int)::text AS d', [d]))[0]!.d

  before(async () => {
    base = await prepararBase('historial')
    app = await levantar({ url: base.url })
    g = await crearGerencia(base.bd, 'HC')
    for (const rol of ['admin', 'revisor', 'enlace'] as const) cookie[rol] = await entrar(base.bd, g, rol, rol === 'admin' ? 'Ana' : rol)
    anio = Number((await dia(0)).slice(0, 4))
  })
  after(async () => { await app.cerrar(); await base.soltar() })
  beforeEach(async () => { await base.bd.consultar('TRUNCATE ciclos_planeacion CASCADE') })

  test('sin sesión 401; revisor y enlace 403', async () => {
    assert.equal((await get(RUTA)).status, 401)
    assert.equal((await get(RUTA, 'revisor')).status, 403)
    assert.equal((await get(RUTA, 'enlace')).status, 403)
  })

  test('sin ciclos: lista vacía, sin error', async () => {
    const r = await get(RUTA, 'admin')
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo, { ciclos: [], hoy: await dia(0) })
  })

  test('del más reciente al más antiguo, con fase, quién lo abrió y cuándo', async () => {
    await crearCiclo(base.bd, { ejercicio: anio - 1, inicioCaptura: -400, finCaptura: -380, inicioRevision: -370, cerrado: true })
    await crearCiclo(base.bd, { ejercicio: anio, inicioCaptura: -2, finCaptura: 10, inicioRevision: 15 })
    await base.bd.consultar(
      `UPDATE ciclos_planeacion SET abierto_por = (SELECT id FROM usuarios WHERE nombre = 'Ana') WHERE ejercicio = $1`, [anio])
    const r = await get(RUTA, 'admin')
    assert.equal(r.status, 200)
    assert.deepEqual(r.cuerpo.ciclos.map((c: any) => [c.ejercicio, c.fase]), [[anio, 'captura'], [anio - 1, 'cerrado']])
    const [nuevo, viejo] = r.cuerpo.ciclos
    assert.equal(nuevo.abierto_por, 'Ana')
    assert.ok(!Number.isNaN(Date.parse(nuevo.abierto_at)))
    assert.equal(nuevo.inicio_captura, await dia(-2))
    assert.equal(nuevo.fin_captura, await dia(10))
    assert.equal(nuevo.inicio_revision, await dia(15))
    assert.equal(viejo.abierto_por, null)   // abierto por la carga inicial, sin usuario
  })

  test('un ciclo con captura futura aparece programado, con sus metas, y el Enlace aún no lo ve', async () => {
    await crearIndicador(base.bd, { gerencia: g, codigo: 'HC-1' })
    const abrir = await fetch(app.url + RUTA, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie.admin! },
      body: JSON.stringify({ ejercicio: anio, inicio_captura: await dia(5), fin_captura: await dia(20), inicio_revision: await dia(25) }),
    })
    assert.equal(abrir.status, 201)
    const lista = await get(RUTA, 'admin')
    assert.equal(lista.cuerpo.ciclos[0].fase, 'programado')
    assert.equal(lista.cuerpo.ciclos[0].abierto_por, 'Ana')
    const metas = await base.bd.consultar<{ n: string }>('SELECT count(*) AS n FROM metas_planeacion')
    assert.ok(Number(metas[0]!.n) >= 1)
    assert.equal((await get('/api/planeacion/ciclo-vigente', 'admin')).cuerpo.ciclo.fase, 'programado')
    assert.equal((await get('/api/planeacion/pendientes', 'enlace')).cuerpo.ciclo, null)
  })
})
