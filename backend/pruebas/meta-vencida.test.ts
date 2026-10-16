// Ticket 9 (HU-R4-02 CA_5, RN_2): `marcarVencidas` y su uso al listar y en la tarea automática.
// Base propia: el ciclo vigente es global.

import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { levantar } from './apoyo.js'
import { crearCiclo, crearGerencia, crearMeta as crearMetaBase, entrar, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'
import { marcarVencidas, marcarVencidasDeCiclos } from '../src/datos/metaVencida.js'

describe('marca vencida de las metas (HU-R4-02 CA_5, RN_2)', () => {
  // Los indicadores no se truncan entre pruebas: cada meta usa un código propio
  let n = 0
  const crearMeta: typeof crearMetaBase = (b, o) => crearMetaBase(b, { ...o, codigo: `${o.codigo}-${++n}` })
  let base: BasePlaneacion
  let app: Awaited<ReturnType<typeof levantar>>
  let com: Gerencia
  let enlace: string
  const estadoDe = async (id: string) =>
    (await base.bd.consultar<{ estado: string; vencida: boolean }>('SELECT estado, vencida FROM metas_planeacion WHERE id = $1', [id]))[0]!
  const eventos = async (id: string) =>
    base.bd.consultar<{ accion: string; usuario_id: string | null }>(
      `SELECT accion, usuario_id FROM bitacora WHERE entidad = 'meta' AND entidad_id = $1 AND accion = 'meta_vencida'`, [id])
  const limpiar = () => base.bd.consultar('TRUNCATE metas_periodo, metas_planeacion, ciclos_planeacion CASCADE')
  const hoy = async () => (await base.bd.consultar<{ h: string }>('SELECT current_date::text AS h'))[0]!.h

  before(async () => {
    base = await prepararBase('meta_vencida')
    app = await levantar({ url: base.url })
    com = await crearGerencia(base.bd, 'COM')
    enlace = await entrar(base.bd, com, 'enlace', 'enlace')
  })
  after(async () => { await app.cerrar(); await base.soltar() })
  afterEach(limpiar)

  test('marca solo meta_pendiente y borrador_meta, y registra meta_vencida por cada una', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -20, finCaptura: -5, inicioRevision: 5 })
    const p = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'P' })
    const b = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'B', estado: 'borrador_meta' })
    const e = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'E', estado: 'meta_enviada' })
    const v = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'V', estado: 'meta_validada' })
    const n = await base.bd.transaccion((tx) => marcarVencidas(tx, c))
    assert.equal(n, 2)
    assert.equal((await estadoDe(p)).vencida, true)
    assert.equal((await estadoDe(b)).vencida, true)
    assert.equal((await estadoDe(e)).vencida, false)
    assert.equal((await estadoDe(v)).vencida, false)
    assert.equal((await eventos(p)).length, 1)
    assert.equal((await eventos(b)).length, 1)
    assert.equal((await eventos(e)).length, 0)
  })

  test('correrla otra vez no duplica eventos ni cambia nada', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -20, finCaptura: -5, inicioRevision: 5 })
    const p = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'P' })
    await base.bd.transaccion((tx) => marcarVencidas(tx, c))
    assert.equal(await base.bd.transaccion((tx) => marcarVencidas(tx, c)), 0)
    assert.equal((await eventos(p)).length, 1)
  })

  test('nada pone vencida = false: pasar a borrador y volver a correr conserva la marca', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -20, finCaptura: -5, inicioRevision: 5 })
    const p = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'P' })
    await base.bd.transaccion((tx) => marcarVencidas(tx, c))
    await base.bd.consultar(`UPDATE metas_planeacion SET estado = 'borrador_meta' WHERE id = $1`, [p])
    await base.bd.transaccion((tx) => marcarVencidasDeCiclos(tx))
    const f = await estadoDe(p)
    assert.deepEqual(f, { estado: 'borrador_meta', vencida: true })
    assert.equal((await eventos(p)).length, 1)
  })

  test('la tarea (marcarVencidasDeCiclos) marca los ciclos con la captura terminada y no los demás', async () => {
    const pasado = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -20, finCaptura: -5, inicioRevision: 5 })
    const enCaptura = await crearCiclo(base.bd, { ejercicio: 2061, inicioCaptura: -2, finCaptura: 10, inicioRevision: 12 })
    const cerrado = await crearCiclo(base.bd, { ejercicio: 2059, inicioCaptura: -40, finCaptura: -30, cerrado: true })
    const a = await crearMeta(base.bd, { cicloId: pasado, gerencia: com, codigo: 'A' })
    const b = await crearMeta(base.bd, { cicloId: enCaptura, gerencia: com, codigo: 'B' })
    const d = await crearMeta(base.bd, { cicloId: cerrado, gerencia: com, codigo: 'D' })
    assert.equal(await base.bd.transaccion((tx) => marcarVencidasDeCiclos(tx)), 1)
    assert.equal((await estadoDe(a)).vencida, true)
    assert.equal((await estadoDe(b)).vencida, false)
    assert.equal((await estadoDe(d)).vencida, false)
  })

  test('el último día de captura todavía no vence', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -20, finCaptura: 0, inicioRevision: 5 })
    const p = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'P' })
    assert.equal(await base.bd.transaccion((tx) => marcarVencidasDeCiclos(tx)), 0)
    assert.equal((await estadoDe(p)).vencida, false)
    assert.equal(typeof (await hoy()), 'string')
  })

  test('listar la aplica sin que la tarea haya corrido: salen vencidas y primero', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -20, finCaptura: -5, inicioRevision: 5 })
    await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'A-1' })
    await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'A-2', estado: 'borrador_meta' })
    const r = await fetch(`${app.url}/api/planeacion/pendientes`, { headers: { cookie: enlace } })
    const cuerpo = await r.json() as any
    assert.equal(r.status, 200)
    assert.equal(cuerpo.ciclo.fase, 'fuera_de_plazo')
    assert.ok(cuerpo.ciclo.fin_captura)
    assert.ok(cuerpo.hoy)
    assert.deepEqual(cuerpo.metas.map((m: any) => m.vencida), [true, true])
    assert.equal(cuerpo.resumen.vencidas, 2)
  })

  test('en captura listar no marca nada', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -2, finCaptura: 5, inicioRevision: 9 })
    const p = await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'A-1' })
    const r = await fetch(`${app.url}/api/planeacion/pendientes`, { headers: { cookie: enlace } })
    assert.equal(r.status, 200)
    assert.equal((await estadoDe(p)).vencida, false)
  })
})
