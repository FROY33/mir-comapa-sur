// Ticket 9: GET /api/planeacion/pendientes (HU-R4-02). Base propia (el ciclo vigente es global)
// y metas creadas con la ayuda de pruebas, sin depender de la apertura.

import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { levantar } from './apoyo.js'
import { crearCiclo, crearGerencia, crearMeta, entrar, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'

describe('GET /api/planeacion/pendientes (HU-R4-02)', () => {
  let base: BasePlaneacion
  let app: Awaited<ReturnType<typeof levantar>>
  let com: Gerencia, otra: Gerencia
  const cookie: Record<string, string> = {}
  const pedir = async (quien?: string, consulta = '') => {
    const r = await fetch(`${app.url}/api/planeacion/pendientes${consulta}`, { headers: quien ? { cookie: cookie[quien]! } : {} })
    return { status: r.status, cuerpo: await r.json() as any }
  }
  const codigos = (r: { cuerpo: any }) => (r.cuerpo.metas as { codigo: string }[]).map((m) => m.codigo)
  const borrarCiclos = async () => {
    // TRUNCATE: las metas no se borran fila por fila (trigger de protección)
    await base.bd.consultar('TRUNCATE metas_periodo, metas_planeacion, ciclos_planeacion CASCADE')
  }

  before(async () => {
    base = await prepararBase('metas_pendientes')
    app = await levantar({ url: base.url })
    com = await crearGerencia(base.bd, 'COM')
    otra = await crearGerencia(base.bd, 'OTR')
    cookie.admin = await entrar(base.bd, com, 'admin', 'admin')
    cookie.revisor = await entrar(base.bd, com, 'revisor', 'revisor')
    cookie.enlace = await entrar(base.bd, com, 'enlace', 'enlace')
  })
  after(async () => { await app.cerrar(); await base.soltar() })

  test('sin sesión 401; revisor y admin 403', async () => {
    assert.equal((await pedir()).status, 401)
    assert.equal((await pedir('revisor')).status, 403)
    assert.equal((await pedir('admin')).status, 403)
  })

  test('sin ciclo: { ciclo: null, metas: [] } con 200', async () => {
    const r = await pedir('enlace')
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.ciclo, null)
    assert.deepEqual(r.cuerpo.metas, [])
  })

  test('ciclo cerrado o programado: { ciclo: null, metas: [] }', async () => {
    const cerrado = await crearCiclo(base.bd, { ejercicio: 2050, inicioCaptura: -30, finCaptura: -20, cerrado: true })
    await crearMeta(base.bd, { cicloId: cerrado, gerencia: com, codigo: 'X-CERRADO' })
    assert.equal((await pedir('enlace')).cuerpo.ciclo, null)
    await crearCiclo(base.bd, { ejercicio: 2051, inicioCaptura: 5, finCaptura: 15 })
    const r = await pedir('enlace')
    assert.equal(r.cuerpo.ciclo, null)
    assert.deepEqual(r.cuerpo.metas, [])
    await borrarCiclos()
  })

  describe('con un ciclo en captura', () => {
    before(async () => {
      const c = await crearCiclo(base.bd, { ejercicio: 2052, inicioCaptura: -3, finCaptura: 10, inicioRevision: 14 })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-B', nivel: 'componente' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-A', nivel: 'actividad' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-D', nivel: 'actividad', estado: 'borrador_meta' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-V', nivel: 'actividad', vencida: true })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-ENV', estado: 'meta_enviada' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-VAL', estado: 'meta_validada' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-OBS', estado: 'meta_observada' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-COR', estado: 'meta_corregida', vencida: true })
      await crearMeta(base.bd, { cicloId: c, gerencia: otra, codigo: 'OTR-1' })
    })
    after(borrarCiclos)

    test('CA_1: el Enlace de COM solo ve COM, también con ?gerencia_id= de otra gerencia', async () => {
      const r = await pedir('enlace', `?gerencia_id=${otra.id}`)
      assert.equal(r.status, 200)
      assert.ok(codigos(r).length > 0 && codigos(r).every((c) => c.startsWith('COM-')), codigos(r).join())
    })

    test('RN_1: enviadas y validadas no aparecen; borrador y pendiente se distinguen en estado', async () => {
      const r = await pedir('enlace')
      assert.deepEqual(codigos(r).sort(), ['COM-A', 'COM-B', 'COM-D', 'COM-V'])
      const por = Object.fromEntries(r.cuerpo.metas.map((m: any) => [m.codigo, m.estado]))
      assert.equal(por['COM-D'], 'borrador_meta')
      assert.equal(por['COM-A'], 'meta_pendiente')
    })

    test('HU-R4-02 RN_1: meta_observada y meta_corregida nunca se listan ni entran en el resumen', async () => {
      const r = await pedir('enlace')
      assert.ok(!codigos(r).includes('COM-OBS') && !codigos(r).includes('COM-COR'), codigos(r).join())
      assert.deepEqual(r.cuerpo.resumen, { total: 4, pendientes: 3, borradores: 1, vencidas: 1 })   // la corregida vencida no suma
      for (const estado of ['meta_observada', 'meta_corregida']) {
        assert.equal(codigos(await pedir('enlace', `?estado=${estado}`)).length, 4)   // no es un estado listable: se ignora
      }
    })

    test('entrega ciclo con fase y fechas, hoy y los campos de cada meta', async () => {
      const r = await pedir('enlace')
      assert.equal(r.cuerpo.ciclo.fase, 'captura')
      assert.equal(r.cuerpo.ciclo.ejercicio, 2052)
      assert.match(r.cuerpo.ciclo.fin_captura, /^\d{4}-\d{2}-\d{2}$/)
      assert.match(r.cuerpo.hoy, /^\d{4}-\d{2}-\d{2}$/)
      const m = r.cuerpo.metas.find((x: any) => x.codigo === 'COM-A')
      assert.deepEqual(Object.keys(m).sort(),
        ['codigo', 'estado', 'indicador_id', 'meta_anterior', 'meta_id', 'nivel', 'nombre', 'tipo', 'vencida'])
      assert.equal(m.nivel, 'actividad')
      assert.equal(m.tipo, 'mir')
    })

    test('orden: vencidas primero, luego por código', async () => {
      assert.deepEqual(codigos(await pedir('enlace')), ['COM-V', 'COM-A', 'COM-B', 'COM-D'])
    })

    test('resumen coincide con la lista', async () => {
      const r = await pedir('enlace')
      assert.deepEqual(r.cuerpo.resumen, { total: 4, pendientes: 3, borradores: 1, vencidas: 1 })
      const f = await pedir('enlace', '?nivel=componente')
      assert.deepEqual(f.cuerpo.resumen, { total: 1, pendientes: 1, borradores: 0, vencidas: 0 })
    })

    test('filtros por estado y por nivel; un valor desconocido se ignora', async () => {
      assert.deepEqual(codigos(await pedir('enlace', '?estado=borrador_meta')), ['COM-D'])
      assert.deepEqual(codigos(await pedir('enlace', '?nivel=componente')), ['COM-B'])
      assert.equal(codigos(await pedir('enlace', '?estado=inventado&nivel=raro')).length, 4)
      assert.equal(codigos(await pedir('enlace', '?estado=meta_validada')).length, 4)   // no es un estado listable: se ignora
      assert.deepEqual(codigos(await pedir('enlace', '?estado=borrador_meta&nivel=componente')), [])
    })

    test('una reasignación del indicador no mueve la meta de gerencia', async () => {
      const [u] = await base.bd.consultar<{ id: string }>('SELECT id FROM unidades WHERE gerencia_id = $1', [otra.id])
      await base.bd.consultar('UPDATE indicadores SET gerencia_id = $1, unidad_id = $2 WHERE codigo = $3', [otra.id, u!.id, 'COM-B'])
      assert.ok(codigos(await pedir('enlace')).includes('COM-B'))
      await base.bd.consultar('UPDATE indicadores SET gerencia_id = $1, unidad_id = $2 WHERE codigo = $3', [com.id, com.unidadId, 'COM-B'])
    })
  })

  test('CA_5: pasado fin_captura la lista sigue disponible (fuera de plazo y revisión)', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2053, inicioCaptura: -20, finCaptura: -5, inicioRevision: 5 })
    await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-T', vencida: true })
    let r = await pedir('enlace')
    assert.equal(r.cuerpo.ciclo.fase, 'fuera_de_plazo')
    assert.deepEqual(codigos(r), ['COM-T'])
    await borrarCiclos()
    const rev = await crearCiclo(base.bd, { ejercicio: 2055, inicioCaptura: -20, finCaptura: -5, inicioRevision: -1 })
    await crearMeta(base.bd, { cicloId: rev, gerencia: com, codigo: 'COM-T2' })
    r = await pedir('enlace')
    assert.equal(r.cuerpo.ciclo.fase, 'revision')
    assert.deepEqual(codigos(r), ['COM-T2'])
    await borrarCiclos()
  })

  describe('meta_anterior (HU-R4-02 CA_4)', () => {
    const pasado = (ejercicio: number) => crearCiclo(base.bd, { ejercicio, inicioCaptura: -400, finCaptura: -390, cerrado: true })
    const por = (r: { cuerpo: any }) => Object.fromEntries(r.cuerpo.metas.map((m: any) => [m.codigo, m.meta_anterior]))
    afterEach(borrarCiclos)

    test('es la meta_anual validada del mismo indicador en el ejercicio anterior', async () => {
      const ant = await pasado(2059)
      await crearMeta(base.bd, { cicloId: ant, gerencia: com, codigo: 'COM-H', estado: 'meta_validada', metaAnual: 87.5 })
      await crearMeta(base.bd, { cicloId: ant, gerencia: com, codigo: 'COM-CERO', estado: 'meta_validada', metaAnual: 0 })
      const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -3, finCaptura: 10 })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-H', mismoIndicador: true })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-CERO', mismoIndicador: true })
      assert.deepEqual(por(await pedir('enlace')), { 'COM-H': 87.5, 'COM-CERO': 0 })
    })

    test('sin antecedente, o con la anterior enviada, observada o en borrador: null', async () => {
      const ant = await pasado(2059)
      await crearMeta(base.bd, { cicloId: ant, gerencia: com, codigo: 'COM-XE', estado: 'meta_enviada', metaAnual: 50 })
      await crearMeta(base.bd, { cicloId: ant, gerencia: com, codigo: 'COM-XB', estado: 'borrador_meta' })
      await crearMeta(base.bd, { cicloId: ant, gerencia: com, codigo: 'COM-XO', estado: 'meta_observada', metaAnual: 30 })
      const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -3, finCaptura: 10 })
      for (const codigo of ['COM-XE', 'COM-XB', 'COM-XO']) await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo, mismoIndicador: true })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-XN' })
      assert.deepEqual(por(await pedir('enlace')), { 'COM-XE': null, 'COM-XB': null, 'COM-XO': null, 'COM-XN': null })
    })

    test('solo cuenta el ejercicio inmediato anterior, no uno más viejo', async () => {
      const viejo = await pasado(2057)
      await crearMeta(base.bd, { cicloId: viejo, gerencia: com, codigo: 'COM-XV', estado: 'meta_validada', metaAnual: 10 })
      const c = await crearCiclo(base.bd, { ejercicio: 2060, inicioCaptura: -3, finCaptura: 10 })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-XV', mismoIndicador: true })
      assert.deepEqual(por(await pedir('enlace')), { 'COM-XV': null })
    })
  })

  test('sin pendientes: lista vacía con resumen en cero', async () => {
    const c = await crearCiclo(base.bd, { ejercicio: 2054, inicioCaptura: -1, finCaptura: 5 })
    await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-OK', estado: 'meta_enviada' })
    const r = await pedir('enlace')
    assert.deepEqual(r.cuerpo.metas, [])
    assert.deepEqual(r.cuerpo.resumen, { total: 0, pendientes: 0, borradores: 0, vencidas: 0 })
    await borrarCiclos()
  })
})

describe('GET /api/planeacion/pendientes tras reiniciar (HU-R4-02)', () => {
  test('HU-R4-02 pruebas mínimas: persistencia tras reinicio, la lista del Enlace sale igual', async () => {
    const base = await prepararBase('metas_pend_reinicio')
    let app = await levantar({ url: base.url })
    try {
      const com = await crearGerencia(base.bd, 'COM')
      const cookie = await entrar(base.bd, com, 'enlace', 'enlace')
      const c = await crearCiclo(base.bd, { ejercicio: 2052, inicioCaptura: -3, finCaptura: 10 })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-A' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-D', estado: 'borrador_meta' })
      await crearMeta(base.bd, { cicloId: c, gerencia: com, codigo: 'COM-V', vencida: true })
      const leer = async () => {
        const r = await fetch(`${app.url}/api/planeacion/pendientes`, { headers: { cookie } })
        assert.equal(r.status, 200)
        return await r.json() as any
      }
      const antes = await leer()
      assert.deepEqual(antes.metas.map((m: any) => [m.codigo, m.estado, m.vencida]),
        [['COM-V', 'meta_pendiente', true], ['COM-A', 'meta_pendiente', false], ['COM-D', 'borrador_meta', false]])
      await app.cerrar()
      app = await levantar({ url: base.url })
      const despues = await leer()   // la sesión también vive en la base: la misma cookie sirve
      assert.deepEqual(despues.metas, antes.metas)
      assert.deepEqual(despues.resumen, antes.resumen)
      assert.deepEqual(despues.ciclo, antes.ciclo)
    } finally { await app.cerrar(); await base.soltar() }
  })
})
