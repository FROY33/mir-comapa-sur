// Ticket 8 (HU-R4-01): el Administrador abre el ciclo de planeación.
// POST /api/admin/planeacion/ciclos. El ciclo vigente es global y el ejercicio solo puede ser el actual
// o el siguiente, así que corre en una base propia y limpia los ciclos entre pruebas.

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { programarCambio } from '../src/datos/cambiosProgramados.js'
import { levantar } from './apoyo.js'
import { crearGerencia, crearIndicador, entrar, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'

const RUTA = '/api/admin/planeacion/ciclos'

describe('apertura del ciclo de planeación (ticket 8)', () => {
  let base: BasePlaneacion
  let app: Awaited<ReturnType<typeof levantar>>
  let ga: Gerencia, gb: Gerencia
  let anio: number
  const cookie: Record<string, string> = {}

  const dia = async (desplazamiento: number) =>
    (await base.bd.consultar<{ d: string }>('SELECT (current_date + $1::int)::text AS d', [desplazamiento]))[0]!.d
  const cuerpo = async (cambios: Record<string, unknown> = {}) => ({
    ejercicio: anio, inicio_captura: await dia(1), fin_captura: await dia(10), inicio_revision: await dia(15), ...cambios,
  })
  const pedir = async (quien: string | undefined, c?: unknown) => {
    const r = await fetch(app.url + RUTA, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(quien ? { cookie: cookie[quien]! } : {}) },
      body: JSON.stringify(c ?? {}),
    })
    const t = await r.text()
    return { status: r.status, cuerpo: (t ? JSON.parse(t) : {}) as any }
  }
  const abrir = async (cambios: Record<string, unknown> = {}) => pedir('admin', await cuerpo(cambios))
  let contador = 0
  const nuevo = (o: Parameters<typeof crearIndicador>[1]) => crearIndicador(base.bd, { ...o, codigo: `${++contador}-${o.codigo}` })
  const cuenta = async (sql: string, p: unknown[] = []) => Number((await base.bd.consultar<{ n: string }>(sql, p))[0]!.n)

  before(async () => {
    base = await prepararBase('apertura')
    app = await levantar({ url: base.url })
    ga = await crearGerencia(base.bd, 'AA')
    gb = await crearGerencia(base.bd, 'AB')
    for (const rol of ['admin', 'revisor', 'enlace'] as const) cookie[rol] = await entrar(base.bd, ga, rol, rol)
    anio = Number((await dia(0)).slice(0, 4))
  })
  after(async () => { await app.cerrar(); await base.soltar() })
  beforeEach(async () => {
    // Como dueño de la base: la app no puede borrar ciclos ni metas, y aquí cada prueba parte de cero
    await base.bd.consultar('TRUNCATE ciclos_planeacion, indicador_cambios_programados CASCADE')
    await base.bd.consultar('UPDATE indicadores SET activo = false')   // los de pruebas anteriores no cuentan
  })

  test('CA_1: admin 201; revisor y enlace 403; sin sesión 401, y los rechazos no crean nada', async () => {
    const c = await cuerpo()
    assert.equal((await pedir(undefined, c)).status, 401)
    assert.equal((await pedir('revisor', c)).status, 403)
    assert.equal((await pedir('enlace', c)).status, 403)
    assert.equal(await cuenta('SELECT count(*) AS n FROM ciclos_planeacion'), 0)
    assert.equal((await pedir('admin', c)).status, 201)
  })

  test('CA_2: una meta pendiente por indicador activo, MIR y gerencial, con la gerencia y la versión vigentes', async () => {
    const mir = await nuevo({ gerencia: ga, codigo: 'A-1' })
    const ger = await nuevo({ gerencia: gb, codigo: 'B-1', tipo: 'gerencial' })
    const r = await abrir()
    assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
    assert.equal(r.cuerpo.ciclo.ejercicio, anio)
    assert.equal(r.cuerpo.ciclo.fase, 'programado')
    assert.equal(r.cuerpo.metas_creadas.total, 2)
    assert.deepEqual(r.cuerpo.metas_creadas.por_gerencia.map((g: any) => g.total), [1, 1])
    const metas = await base.bd.consultar<any>(
      `SELECT m.indicador_id, m.estado, v.gerencia_id FROM metas_planeacion m
         JOIN indicador_versiones v ON v.id = m.indicador_version_id ORDER BY m.indicador_id`)
    assert.equal(metas.length, 2)
    assert.ok(metas.every((m) => m.estado === 'meta_pendiente'))
    assert.equal(metas.find((m) => m.indicador_id === mir).gerencia_id, ga.id)
    assert.equal(metas.find((m) => m.indicador_id === ger).gerencia_id, gb.id)
  })

  test('HU-R4-11 CA_5: un indicador desactivado no recibe meta', async () => {
    await nuevo({ gerencia: ga, codigo: 'A-1' })
    const apagado = await nuevo({ gerencia: ga, codigo: 'A-2', activo: false })
    assert.equal((await abrir()).cuerpo.metas_creadas.total, 1)
    assert.equal(await cuenta('SELECT count(*) AS n FROM metas_planeacion WHERE indicador_id = $1', [apagado]), 0)
  })

  const gerenciaDeLaMeta = async (indicadorId: string) =>
    (await base.bd.consultar<any>(
      `SELECT v.gerencia_id FROM metas_planeacion m JOIN indicador_versiones v ON v.id = m.indicador_version_id
        WHERE m.indicador_id = $1`, [indicadorId]))[0].gerencia_id

  test('HU-R4-11 CA_4: un cambio de gerencia vencido se aplica antes y la meta nace con la gerencia nueva', async () => {
    const id = await nuevo({ gerencia: ga, codigo: 'A-1' })
    await programarCambio(base.bd, id, { gerencia_id: gb.id, unidad_id: gb.unidadId }, await dia(-1))
    const r = await abrir()
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.cambios_aplicados.length, 1)
    assert.ok(r.cuerpo.cambios_aplicados[0].codigo.endsWith('A-1'))
    assert.equal(await gerenciaDeLaMeta(id), gb.id)
  })

  test('HU-R4-11 CA_4: un cambio aún no vencido no se aplica', async () => {
    const id = await nuevo({ gerencia: ga, codigo: 'A-1' })
    await programarCambio(base.bd, id, { gerencia_id: gb.id, unidad_id: gb.unidadId }, await dia(30))
    const r = await abrir()
    assert.deepEqual(r.cuerpo.cambios_aplicados, [])
    assert.equal(await gerenciaDeLaMeta(id), ga.id)
  })

  describe('validación: 422 con campo', () => {
    const casos: [string, () => Promise<Record<string, unknown>>, string][] = [
      ['falta el ejercicio', async () => { const c: any = await cuerpo(); delete c.ejercicio; return c }, 'ejercicio'],
      ['ejercicio no entero', () => cuerpo({ ejercicio: 'dos mil' }), 'ejercicio'],
      ['falta inicio_captura', () => cuerpo({ inicio_captura: undefined }), 'inicio_captura'],
      ['fecha mal formada', () => cuerpo({ fin_captura: '10/11/2026' }), 'fin_captura'],
      ['fecha inexistente', () => cuerpo({ inicio_revision: `${anio}-02-31` }), 'inicio_revision'],
      ['fin_captura igual a inicio_captura (CA_3)', async () => cuerpo({ fin_captura: await dia(1) }), 'fin_captura'],
      ['fin_captura antes de inicio_captura (CA_3)', async () => cuerpo({ fin_captura: await dia(0) }), 'fin_captura'],
      ['inicio_revision antes de fin_captura', async () => cuerpo({ inicio_revision: await dia(9) }), 'inicio_revision'],
      ['ejercicio pasado', async () => cuerpo({ ejercicio: anio - 1 }), 'ejercicio'],
      ['ejercicio dos años adelante', async () => cuerpo({ ejercicio: anio + 2 }), 'ejercicio'],
    ]
    for (const [nombre, armar, campo] of casos) {
      test(nombre, async () => {
        const r = await pedir('admin', await armar())
        assert.equal(r.status, 422, JSON.stringify(r.cuerpo))
        assert.equal(r.cuerpo.campo, campo)
        assert.ok(r.cuerpo.errores[campo])
        assert.equal(await cuenta('SELECT count(*) AS n FROM ciclos_planeacion'), 0)
      })
    }
    test('el ejercicio siguiente se acepta', async () => {
      assert.equal((await abrir({ ejercicio: anio + 1 })).status, 201)
    })
    test('inicio_revision igual a fin_captura se acepta', async () => {
      assert.equal((await abrir({ inicio_revision: await dia(10) })).status, 201)
    })
  })

  test('CA_5 / RN_1: un segundo ciclo del mismo ejercicio responde 409 ciclo_existente y no duplica', async () => {
    await nuevo({ gerencia: ga, codigo: 'A-1' })
    assert.equal((await abrir()).status, 201)
    const r = await abrir()
    assert.equal(r.status, 409)
    assert.equal(r.cuerpo.error, 'ciclo_existente')
    assert.equal(await cuenta('SELECT count(*) AS n FROM ciclos_planeacion'), 1)
    assert.equal(await cuenta('SELECT count(*) AS n FROM metas_planeacion'), 1)
  })

  test('dos solicitudes simultáneas dejan un ciclo y una meta por indicador', async () => {
    await nuevo({ gerencia: ga, codigo: 'A-1' })
    await nuevo({ gerencia: gb, codigo: 'B-1' })
    const c = await cuerpo()
    const rs = await Promise.all([pedir('admin', c), pedir('admin', c)])
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409])
    assert.equal(await cuenta('SELECT count(*) AS n FROM ciclos_planeacion'), 1)
    assert.equal(await cuenta('SELECT count(*) AS n FROM metas_planeacion'), 2)
    assert.equal(await cuenta(`SELECT count(*) AS n FROM bitacora WHERE accion = 'ciclo_planeacion_abierto' AND entidad_id = (SELECT id::text FROM ciclos_planeacion)`), 1)
  })

  test('un fallo a mitad de la apertura no deja ciclo, metas, cambios aplicados ni evento', async () => {
    const id = await nuevo({ gerencia: ga, codigo: 'A-1' })
    await nuevo({ gerencia: ga, codigo: 'A-FALLA' })
    await programarCambio(base.bd, id, { gerencia_id: gb.id, unidad_id: gb.unidadId }, await dia(-1))
    await base.bd.consultar(`
      CREATE FUNCTION falla_en_meta() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT codigo FROM indicadores WHERE id = NEW.indicador_id) LIKE '%A-FALLA' THEN RAISE EXCEPTION 'falla de prueba'; END IF;
        RETURN NEW;
      END $$`)
    await base.bd.consultar('CREATE TRIGGER falla_en_meta BEFORE INSERT ON metas_planeacion FOR EACH ROW EXECUTE FUNCTION falla_en_meta()')
    try {
      const eventos = await cuenta('SELECT count(*) AS n FROM bitacora')
      const r = await abrir()
      assert.ok(r.status >= 400, `status ${r.status}`)
      assert.equal(await cuenta('SELECT count(*) AS n FROM ciclos_planeacion'), 0)
      assert.equal(await cuenta('SELECT count(*) AS n FROM metas_planeacion'), 0)
      assert.equal(await cuenta('SELECT count(*) AS n FROM indicador_cambios_programados WHERE aplicado_at IS NOT NULL'), 0)
      assert.equal(await cuenta('SELECT count(*) AS n FROM bitacora'), eventos)
      const [ind] = await base.bd.consultar<any>('SELECT gerencia_id FROM indicadores WHERE id = $1', [id])
      assert.equal(ind.gerencia_id, ga.id)
    } finally {
      await base.bd.consultar('DROP TRIGGER falla_en_meta ON metas_planeacion')
      await base.bd.consultar('DROP FUNCTION falla_en_meta()')
    }
  })

  test('CA_6: la bitácora registra autor, IP, fechas, metas por gerencia y cambios aplicados', async () => {
    await nuevo({ gerencia: ga, codigo: 'A-1' })
    await nuevo({ gerencia: ga, codigo: 'A-2' })
    await nuevo({ gerencia: gb, codigo: 'B-1' })
    const r = await abrir()
    const [c] = await base.bd.consultar<any>('SELECT id, abierto_por FROM ciclos_planeacion')
    const [e] = await base.bd.consultar<any>(`SELECT * FROM bitacora WHERE accion = 'ciclo_planeacion_abierto' AND entidad_id = $1`, [c.id])
    assert.equal(e.entidad, 'ciclo_planeacion')
    assert.equal(e.entidad_id, c.id)
    assert.equal(e.rol, 'admin')
    assert.ok(e.usuario_id)
    assert.equal(c.abierto_por, e.usuario_id)
    assert.ok(e.ip)
    assert.equal(e.detalle.ejercicio, anio)
    assert.equal(e.detalle.inicio_captura, r.cuerpo.ciclo.inicio_captura)
    assert.equal(e.detalle.fin_captura, r.cuerpo.ciclo.fin_captura)
    assert.equal(e.detalle.inicio_revision, r.cuerpo.ciclo.inicio_revision)
    assert.equal(e.detalle.metas_total, 3)
    assert.deepEqual(e.detalle.metas_por_gerencia.map((g: any) => g.total).sort(), [1, 2])
    assert.deepEqual(e.detalle.cambios_aplicados, [])
  })

  test('RN_2: abrir el ciclo no crea ni cierra periodos de reporte', async () => {
    await nuevo({ gerencia: ga, codigo: 'A-1' })
    const antes = await base.bd.consultar<any>('SELECT id, estado FROM periodos_reporte ORDER BY id')
    const reportes = await cuenta('SELECT count(*) AS n FROM reportes')
    await abrir()
    assert.deepEqual(await base.bd.consultar<any>('SELECT id, estado FROM periodos_reporte ORDER BY id'), antes)
    assert.equal(await cuenta('SELECT count(*) AS n FROM reportes'), reportes)
  })

  test('el ciclo abierto es el vigente: ciclo-vigente lo devuelve', async () => {
    await abrir({ inicio_captura: await dia(-1) })
    const r = await fetch(app.url + '/api/planeacion/ciclo-vigente', { headers: { cookie: cookie.enlace! } })
    const j = await r.json() as any
    assert.equal(j.ciclo.ejercicio, anio)
    assert.equal(j.ciclo.fase, 'captura')
  })

  test('el ciclo y sus metas siguen ahí tras reiniciar el servidor', async () => {
    await nuevo({ gerencia: ga, codigo: 'A-1' })
    await abrir()
    await app.cerrar()
    app = await levantar({ url: base.url })
    const r = await fetch(app.url + '/api/planeacion/ciclo-vigente', { headers: { cookie: cookie.enlace! } })
    assert.equal(((await r.json()) as any).ciclo.ejercicio, anio)
    assert.equal(await cuenta('SELECT count(*) AS n FROM metas_planeacion'), 1)
  })
})
