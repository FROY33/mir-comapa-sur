// PRD0_1, base compartida: fase del ciclo de planeación (función pura) y GET /api/planeacion/ciclo-vigente.
// El ciclo vigente es global, así que la API se prueba en una base propia.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { faseCiclo, type CicloPlaneacion } from '../src/datos/cicloPlaneacion.js'
import { levantar } from './apoyo.js'
import { crearCiclo, crearGerencia, crearMeta, entrar, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'

const ciclo = (c: Partial<CicloPlaneacion> = {}): CicloPlaneacion => ({
  inicio_captura: '2026-11-01', fin_captura: '2026-11-15', inicio_revision: '2026-11-20', cerrado_manual: false, ...c,
})

describe('fase del ciclo (PRD0_1, «Fase del ciclo»)', () => {
  test('programado antes de la captura', () => {
    assert.equal(faseCiclo(ciclo(), '2026-10-31'), 'programado')
  })
  test('captura el primer y el último día', () => {
    assert.equal(faseCiclo(ciclo(), '2026-11-01'), 'captura')
    assert.equal(faseCiclo(ciclo(), '2026-11-15'), 'captura')
  })
  test('fuera de plazo solo con hueco entre las fases', () => {
    assert.equal(faseCiclo(ciclo(), '2026-11-16'), 'fuera_de_plazo')
    assert.equal(faseCiclo(ciclo(), '2026-11-19'), 'fuera_de_plazo')
  })
  test('sin hueco (inicio_revision = fin_captura) no hay fuera de plazo', () => {
    const c = ciclo({ inicio_revision: '2026-11-15' })
    assert.equal(faseCiclo(c, '2026-11-15'), 'captura')   // el último día de captura sigue siendo captura
    assert.equal(faseCiclo(c, '2026-11-16'), 'revision')
  })
  test('revisión desde su inicio', () => {
    assert.equal(faseCiclo(ciclo(), '2026-11-20'), 'revision')
    assert.equal(faseCiclo(ciclo(), '2027-03-01'), 'revision')
  })
  test('cerrado manualmente es cerrado con cualquier fecha', () => {
    const c = ciclo({ cerrado_manual: true })
    for (const hoy of ['2026-10-01', '2026-11-05', '2026-11-17', '2026-12-01']) assert.equal(faseCiclo(c, hoy), 'cerrado')
  })
})

describe('GET /api/planeacion/ciclo-vigente', () => {
  let base: BasePlaneacion
  let app: Awaited<ReturnType<typeof levantar>>
  let g: Gerencia
  const cookie: Record<string, string> = {}
  const pedir = async (quien?: string) => {
    const r = await fetch(app.url + '/api/planeacion/ciclo-vigente', { headers: quien ? { cookie: cookie[quien]! } : {} })
    return { status: r.status, cuerpo: await r.json() as any }
  }
  const hoyEnBase = async () => (await base.bd.consultar<{ hoy: string }>('SELECT current_date::text AS hoy'))[0]!.hoy

  before(async () => {
    base = await prepararBase('ciclo_vigente')
    app = await levantar({ url: base.url })
    g = await crearGerencia(base.bd, 'CV')
    for (const rol of ['admin', 'revisor', 'enlace'] as const) cookie[rol] = await entrar(base.bd, g, rol, rol)
  })
  after(async () => { await app.cerrar(); await base.soltar() })

  test('sin sesión, 401', async () => {
    assert.equal((await pedir()).status, 401)
  })

  test('sin ciclo: { ciclo: null, hoy } para los tres roles', async () => {
    const hoy = await hoyEnBase()
    for (const rol of ['admin', 'revisor', 'enlace']) {
      const r = await pedir(rol)
      assert.equal(r.status, 200)
      assert.deepEqual(r.cuerpo, { ciclo: null, hoy })
    }
  })

  test('con un ciclo cerrado: { ciclo: null, hoy }', async () => {
    await crearCiclo(base.bd, { ejercicio: 2040, inicioCaptura: -30, finCaptura: -20, cerrado: true })
    assert.equal((await pedir('enlace')).cuerpo.ciclo, null)
  })

  test('con ciclo en captura: el ciclo con su fase y sus fechas, y ninguna meta ni id interno', async () => {
    await crearCiclo(base.bd, { ejercicio: 2041, inicioCaptura: -2, finCaptura: 5, inicioRevision: 8 })
    const r = await pedir('revisor')
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.hoy, await hoyEnBase())
    assert.deepEqual(Object.keys(r.cuerpo.ciclo).sort(), ['ejercicio', 'fase', 'fin_captura', 'inicio_captura', 'inicio_revision'])
    assert.equal(r.cuerpo.ciclo.ejercicio, 2041)
    assert.equal(r.cuerpo.ciclo.fase, 'captura')
  })

  test('devuelve el ciclo no cerrado más reciente, en su fase', async () => {
    await crearCiclo(base.bd, { ejercicio: 2042, inicioCaptura: 10, finCaptura: 20 })
    const r = await pedir('admin')
    assert.equal(r.cuerpo.ciclo.ejercicio, 2042)
    assert.equal(r.cuerpo.ciclo.fase, 'programado')
  })

  test('la ayuda de pruebas crea metas con identificadores reconocibles', async () => {
    const cicloId = await crearCiclo(base.bd, { ejercicio: 2043, inicioCaptura: -1, finCaptura: 3 })
    await crearMeta(base.bd, { cicloId, gerencia: g, codigo: 'CV-1' })
    await crearMeta(base.bd, { cicloId, gerencia: g, codigo: 'CV-2', estado: 'borrador_meta', vencida: true })
    const filas = await base.bd.consultar<{ estado: string; vencida: boolean }>(
      'SELECT estado, vencida FROM metas_planeacion WHERE ciclo_id = $1 ORDER BY estado', [cicloId])
    assert.deepEqual(filas, [{ estado: 'borrador_meta', vencida: true }, { estado: 'meta_pendiente', vencida: false }])
  })
})
