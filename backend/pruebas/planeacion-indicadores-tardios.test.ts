// Ticket 8 (HU-R4-01 CA_2): un indicador dado de alta o reactivado con un ciclo abierto recibe su
// meta pendiente en la misma transacción. El ciclo vigente es global: base propia, ciclos limpiados entre pruebas.

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { levantar } from './apoyo.js'
import { crearCiclo, crearGerencia, crearIndicador, crearMeta, entrar, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'

describe('indicadores tardíos con ciclo abierto (ticket 8)', () => {
  let base: BasePlaneacion
  let app: Awaited<ReturnType<typeof levantar>>
  let g: Gerencia
  let cookie: string
  let medioId: string
  let n = 0
  let cicloId: string

  const admin = async (metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(app.url + ruta, {
      method: metodo, headers: { 'content-type': 'application/json', cookie },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    const t = await r.text()
    return { status: r.status, cuerpo: (t ? JSON.parse(t) : {}) as any }
  }
  const alta = () => admin('POST', '/api/admin/indicadores', {
    gerencia_id: g.id, codigo: `TAR-${++n}`, tipo: 'mir', nivel: 'actividad', nombre: `Indicador tardío ${n}`,
    unidad_medida: 'Porcentaje', frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false,
    medio_verificacion_id: medioId,
  })
  const metas = (indicadorId: string) =>
    base.bd.consultar<any>(
      `SELECT m.id, m.estado, v.gerencia_id FROM metas_planeacion m
         JOIN indicador_versiones v ON v.id = m.indicador_version_id WHERE m.indicador_id = $1`, [indicadorId])
  const eventos = (indicadorId?: string) =>
    base.bd.consultar<any>(
      `SELECT * FROM bitacora WHERE accion = 'meta_pendiente_creada' ${indicadorId ? 'AND indicador_id = $1' : ''}`,
      indicadorId ? [indicadorId] : [])

  before(async () => {
    base = await prepararBase('tardios')
    app = await levantar({ url: base.url })
    g = await crearGerencia(base.bd, 'TA')
    cookie = await entrar(base.bd, g, 'admin', 'admin')
    const [m] = await base.bd.consultar<{ id: string }>(`INSERT INTO medios_verificacion (nombre) VALUES ('Informe') RETURNING id`)
    medioId = m!.id
  })
  after(async () => { await app.cerrar(); await base.soltar() })
  beforeEach(async () => {
    await base.bd.consultar('DROP TRIGGER IF EXISTS falla_meta ON metas_planeacion')
    await base.bd.consultar('TRUNCATE ciclos_planeacion CASCADE')
    cicloId = await crearCiclo(base.bd, { ejercicio: 2026, inicioCaptura: -2, finCaptura: 10 })
  })

  test('el alta con ciclo abierto crea la meta con la gerencia vigente y el evento', async () => {
    const r = await alta()
    assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
    const id = r.cuerpo.indicador.id
    const m = await metas(id)
    assert.equal(m.length, 1)
    assert.equal(m[0].estado, 'meta_pendiente')
    assert.equal(m[0].gerencia_id, g.id)
    const ev = await eventos(id)
    assert.equal(ev.length, 1)
    assert.equal(ev[0].entidad, 'meta')
    assert.equal(ev[0].entidad_id, m[0].id)
    assert.equal(ev[0].rol, 'admin')
    assert.equal(ev[0].detalle.ciclo_id, cicloId)
  })

  test('con ciclo programado (captura futura) también se crea la meta', async () => {
    await base.bd.consultar('TRUNCATE ciclos_planeacion CASCADE')
    await crearCiclo(base.bd, { ejercicio: 2026, inicioCaptura: 5, finCaptura: 10 })
    const r = await alta()
    assert.equal((await metas(r.cuerpo.indicador.id)).length, 1)
  })

  test('la reactivación crea la meta si no tenía; si ya tenía, no crea otra', async () => {
    const sin = await crearIndicador(base.bd, { gerencia: g, codigo: 'REA-SIN', activo: false })
    assert.equal((await admin('POST', `/api/admin/indicadores/${sin}/reactivar`, {})).status, 200)
    assert.equal((await metas(sin)).length, 1)
    assert.equal((await eventos(sin)).length, 1)

    const con = await crearMeta(base.bd, { cicloId, gerencia: g, codigo: 'REA-CON' })
    const conInd = (await base.bd.consultar<any>('SELECT indicador_id FROM metas_planeacion WHERE id = $1', [con]))[0].indicador_id
    await base.bd.consultar('UPDATE indicadores SET activo = false WHERE id = $1', [conInd])
    assert.equal((await admin('POST', `/api/admin/indicadores/${conInd}/reactivar`, {})).status, 200)
    assert.equal((await metas(conInd)).length, 1)
    assert.equal((await eventos(conInd)).length, 0)
  })

  test('desactivar no modifica ni borra la meta', async () => {
    const id = (await alta()).cuerpo.indicador.id
    const antes = await metas(id)
    assert.equal((await admin('POST', `/api/admin/indicadores/${id}/desactivar`, {})).status, 200)
    assert.deepEqual(await metas(id), antes)
  })

  test('sin ciclo o con el ciclo cerrado no se crea meta', async () => {
    await base.bd.consultar('TRUNCATE ciclos_planeacion CASCADE')
    const sinCiclo = (await alta()).cuerpo.indicador.id
    assert.equal((await metas(sinCiclo)).length, 0)
    await crearCiclo(base.bd, { ejercicio: 2026, inicioCaptura: -5, finCaptura: 10, cerrado: true })
    const cerrado = (await alta()).cuerpo.indicador.id
    assert.equal((await metas(cerrado)).length, 0)
    assert.equal((await eventos(sinCiclo)).length + (await eventos(cerrado)).length, 0)
  })

  test('si falla la creación de la meta, el alta y la reactivación tampoco se guardan', async () => {
    await base.bd.consultar(
      `CREATE OR REPLACE FUNCTION falla_meta() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla simulada'; END $$`)
    await base.bd.consultar(
      'CREATE TRIGGER falla_meta BEFORE INSERT ON metas_planeacion FOR EACH ROW EXECUTE FUNCTION falla_meta()')
    const codigo = `TAR-${n + 1}`
    assert.equal((await alta()).status, 500)
    assert.equal((await base.bd.consultar('SELECT 1 FROM indicadores WHERE codigo = $1', [codigo])).length, 0)

    const apagado = await crearIndicador(base.bd, { gerencia: g, codigo: 'REA-FALLA', activo: false })
    assert.equal((await admin('POST', `/api/admin/indicadores/${apagado}/reactivar`, {})).status, 500)
    assert.equal((await base.bd.consultar<any>('SELECT activo FROM indicadores WHERE id = $1', [apagado]))[0].activo, false)
    assert.equal((await base.bd.consultar(`SELECT 1 FROM bitacora WHERE indicador_id = $1`, [apagado])).length, 0)
  })
})
