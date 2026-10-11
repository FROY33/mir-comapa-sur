// HU-R3-01: ventanas de captura y apertura automática de ciclos. El job se prueba en una base
// propia: en la compartida generaría reportes mientras otras pruebas cuentan los suyos.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { crearBD, type BD } from '../src/bd.js'
import { nombreBase } from '../src/config.js'
import { leerCsv } from '../db/semilla/csv.js'
import { abrirCiclos, calcularPeriodo, diaHabil, periodoQueToca, periodosAbiertos } from '../src/datos/ciclos.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const MESES: Record<string, number> = { mensual: 1, bimestral: 2, trimestral: 3, cuatrimestral: 4, semestral: 6, anual: 12 }

describe('cálculo de periodos', () => {
  test('coincide con los 28 periodos de la carga inicial (mismas fechas y etiquetas)', () => {
    const DIAS: Record<string, number> = { mensual: 10, bimestral: 12, trimestral: 15, cuatrimestral: 18, semestral: 20, anual: 30 }
    for (const p of leerCsv('periodos.csv')) {
      const calculado = calcularPeriodo(p.frecuencia!, MESES[p.frecuencia!]!, Number(p.ejercicio), Number(p.numero), DIAS[p.frecuencia!]!)
      assert.deepEqual(
        [calculado.etiqueta, calculado.inicio_periodo, calculado.fin_periodo, calculado.abre_captura, calculado.fecha_limite],
        [p.etiqueta, p.inicio_periodo, p.fin_periodo, p.abre_captura, p.fecha_limite], `${p.frecuencia} ${p.numero}`)
    }
  })

  test('el día hábil salta sábados y domingos', () => {
    // 2026-10-02 es viernes: el 2.º hábil desde ahí es el lunes 5
    assert.equal(diaHabil(new Date('2026-10-02T00:00:00Z'), 2).toISOString().slice(0, 10), '2026-10-05')
  })

  test('el periodo que toca al 11 de octubre de 2026, por frecuencia', () => {
    const toca = (f: string) => periodoQueToca(f, MESES[f]!, 10, '2026-10-11').etiqueta
    assert.deepEqual(Object.keys(MESES).map(toca), ['septiembre-2026', 'B4-2026', 'T3-2026', 'C2-2026', 'S1-2026', '2025'])
  })
})

describe('apertura de ciclos (base propia)', () => {
  const url = new URL(configBD.url)
  url.pathname = `/${nombreBase(configBD.url).replace(/_test$/, '')}_ciclos_test`
  let bd: BD
  let gerencia = ''
  const indicadores: Record<string, string> = {}

  const administrar = async (sql: string) => {
    const m = new URL(configBD.url)
    m.pathname = '/postgres'
    const c = new pg.Client({ connectionString: m.toString() })
    await c.connect()
    try { await c.query(sql) } finally { await c.end() }
  }
  const abrir = (hoy: string) => bd.transaccion((tx) => abrirCiclos(tx, hoy))
  const reportesDe = (etiqueta: string) => bd.consultar<{ codigo: string; estado: string }>(
    `SELECT i.codigo, r.estado FROM reportes r JOIN indicadores i ON i.id = r.indicador_id
       JOIN periodos_reporte p ON p.id = r.periodo_id WHERE p.etiqueta = $1 ORDER BY i.codigo`, [etiqueta])

  before(async () => {
    const base = url.pathname.slice(1)
    await administrar(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
    await administrar(`CREATE DATABASE ${base}`)
    execFileSync('db/migrar.sh', ['up'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url.toString() } })
    bd = crearBD({ ...configBD, url: url.toString() }, crearLog(() => {}))
    const [org] = await bd.consultar<{ id: string }>(`INSERT INTO organizaciones (nombre) VALUES ('COMAPA') RETURNING id`)
    const [g] = await bd.consultar<{ id: string }>(`INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'G', 'G') RETURNING id`, [org!.id])
    gerencia = g!.id
    for (const [codigo, frecuencia, activo] of [['M1', 'mensual', true], ['M2', 'mensual', true], ['M-INACTIVO', 'mensual', false], ['T1', 'trimestral', true]] as const) {
      const [i] = await bd.consultar<{ id: string }>(
        `INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia, activo)
         VALUES ($1, $2, 'actividad', $2, 'Porcentaje', $3, $4) RETURNING id`, [gerencia, codigo, frecuencia, activo])
      indicadores[codigo] = i!.id
    }
  })
  after(async () => {
    await bd?.cerrar()
    await administrar(`DROP DATABASE IF EXISTS ${url.pathname.slice(1)} WITH (FORCE)`)
  })

  test('CA_3 y RN_3: un reporte pendiente_carga por indicador activo de la frecuencia', async () => {
    const aperturas = await abrir('2026-10-11')
    assert.deepEqual(await reportesDe('septiembre-2026'), [
      { codigo: 'M1', estado: 'pendiente_carga' }, { codigo: 'M2', estado: 'pendiente_carga' }])
    assert.deepEqual(await reportesDe('T3-2026'), [{ codigo: 'T1', estado: 'pendiente_carga' }])
    assert.equal(aperturas.find((a) => a.frecuencia === 'mensual')!.reportes_creados, 2)
  })

  test('no abre un periodo nuevo cuya ventana ya cerró (al estrenar el sistema a mitad de año)', async () => {
    const etiquetas = (await bd.consultar<{ etiqueta: string }>('SELECT etiqueta FROM periodos_reporte')).map((p) => p.etiqueta).sort()
    // Al 11/10/2026 ya tocaban B4, C2, S1 y el anual 2025, pero su captura cerró antes de hoy
    assert.deepEqual(etiquetas, ['T3-2026', 'septiembre-2026'])
  })

  test('CA_4: ciclos de distintas frecuencias abiertos a la vez', async () => {
    const abiertos = await bd.consultar<{ etiqueta: string }>(`SELECT etiqueta FROM periodos_reporte WHERE estado = 'abierto' ORDER BY etiqueta`)
    assert.ok(abiertos.some((p) => p.etiqueta === 'septiembre-2026') && abiertos.some((p) => p.etiqueta === 'T3-2026'))
  })

  test('idempotente: correrlo otra vez no crea periodos ni reportes', async () => {
    const [antes] = await bd.consultar<{ p: number; r: number }>('SELECT (SELECT count(*)::int FROM periodos_reporte) AS p, (SELECT count(*)::int FROM reportes) AS r')
    const aperturas = await abrir('2026-10-11')
    const [despues] = await bd.consultar<{ p: number; r: number }>('SELECT (SELECT count(*)::int FROM periodos_reporte) AS p, (SELECT count(*)::int FROM reportes) AS r')
    assert.deepEqual(despues, antes)
    assert.ok(aperturas.every((a) => !a.periodo_nuevo && a.reportes_creados === 0))
  })

  test('un indicador activado después recibe su reporte en la siguiente corrida, sin duplicar los demás', async () => {
    await bd.consultar('UPDATE indicadores SET activo = true WHERE id = $1', [indicadores['M-INACTIVO']])
    await abrir('2026-10-11')
    assert.deepEqual((await reportesDe('septiembre-2026')).map((r) => r.codigo), ['M-INACTIVO', 'M1', 'M2'])
    await bd.consultar('UPDATE indicadores SET activo = false WHERE id = $1', [indicadores['M-INACTIVO']])
  })

  test('CA_5: un cambio de ventana aplica a la siguiente apertura; la abierta conserva su fecha límite', async () => {
    const [sep] = await bd.consultar<{ fecha_limite: string }>(`SELECT fecha_limite FROM periodos_reporte WHERE etiqueta = 'septiembre-2026'`)
    await bd.consultar(`UPDATE frecuencias SET dias_habiles = 3 WHERE clave = 'mensual'`)
    await abrir('2026-11-02')
    const fechas = await bd.consultar<{ etiqueta: string; fecha_limite: string; estado: string }>(
      `SELECT etiqueta, fecha_limite, estado FROM periodos_reporte WHERE etiqueta IN ('septiembre-2026', 'octubre-2026') ORDER BY etiqueta DESC`)
    assert.deepEqual(fechas, [
      { etiqueta: 'septiembre-2026', fecha_limite: sep!.fecha_limite, estado: 'abierto' },   // RN_2 (supuesto): el anterior sigue abierto
      { etiqueta: 'octubre-2026', fecha_limite: '2026-11-04', estado: 'abierto' },           // 3 días hábiles desde el lunes 2
    ])
  })

  test('CA_6: para los dashboards, el periodo abierto más reciente por frecuencia y cuántos anteriores siguen abiertos', async () => {
    const mensual = (await periodosAbiertos(bd)).find((p) => p.frecuencia === 'mensual')
    // periodosAbiertos usa la fecha real de la base: solo cuenta periodos cuya captura ya abrió
    assert.ok(mensual)
    const abiertosMensual = await bd.consultar(`SELECT 1 FROM periodos_reporte WHERE frecuencia = 'mensual' AND estado = 'abierto' AND abre_captura <= current_date`)
    assert.equal(mensual!.anteriores_abiertos, abiertosMensual.length - 1)
    assert.equal((await periodosAbiertos(bd)).filter((p) => p.frecuencia === 'mensual').length, 1)
  })

  test('un periodo que el Administrador ya cerró no se reabre ni recibe reportes', async () => {
    await bd.consultar(`UPDATE periodos_reporte SET estado = 'cerrado', cerrado_at = now() WHERE etiqueta = 'T3-2026'`)
    await bd.consultar('UPDATE indicadores SET activo = true WHERE id = $1', [indicadores['M-INACTIVO']])
    await bd.consultar(`UPDATE indicadores SET frecuencia = 'trimestral' WHERE id = $1`, [indicadores['M-INACTIVO']])
    await abrir('2026-11-02')
    assert.deepEqual((await reportesDe('T3-2026')).map((r) => r.codigo), ['T1'])
  })
})

describe('rutas', () => {
  const bd = crearBD(configBD, crearLog(() => {}))
  let app: Awaited<ReturnType<typeof levantar>>
  const cookie: Record<string, string> = {}
  before(async () => {
    app = await levantar()
    const s = randomUUID().slice(0, 6)
    const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R3-01 ${s}`])
    const [g] = await bd.consultar<{ id: string }>(`INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'CI', $2) RETURNING id`, [org!.id, `CI ${s}`])
    const [u] = await bd.consultar<{ id: string }>(`INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, 'Coord', true) RETURNING id`, [g!.id])
    for (const rol of ['admin', 'revisor', 'enlace']) {
      const [x] = await bd.consultar<{ id: string }>(
        `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
         VALUES ($1, $2, $3, $4, 'x', $3, false) RETURNING id`, [g!.id, u!.id, rol, `${rol}-${s}@comapasur.gob.mx`])
      cookie[rol] = `${COOKIE_SESION}=${await crear(bd, x!.id)}`
    }
  })
  after(async () => { await app.cerrar(); await bd.cerrar() })

  const pedir = async (metodo: string, ruta: string, quien?: string, cuerpo?: unknown) => {
    const r = await fetch(app.url + ruta, {
      method: metodo, headers: { 'content-type': 'application/json', ...(quien ? { cookie: cookie[quien]! } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    return { status: r.status, cuerpo: await r.json() as any }
  }

  test('CA_1: la ventana solo la ve y la cambia el Administrador; abrir ciclos también', async () => {
    for (const quien of ['revisor', 'enlace']) {
      assert.equal((await pedir('GET', '/api/admin/ventanas', quien)).status, 403)
      assert.equal((await pedir('PUT', '/api/admin/ventanas', quien, { dias: { mensual: 9 } })).status, 403)
      assert.equal((await pedir('POST', '/api/admin/ciclos/abrir', quien)).status, 403)
    }
    assert.equal((await pedir('GET', '/api/admin/ventanas', 'admin')).cuerpo.length, 6)
  })

  test('CA_2: entero mayor que 0 y no más largo que el periodo', async () => {
    for (const dias of [0, -1, 1.5, '10', 24]) {
      const r = await pedir('PUT', '/api/admin/ventanas', 'admin', { dias: { mensual: dias } })
      assert.equal(r.status, 422, `aceptó ${dias}`)
    }
  })

  test('un cambio válido se guarda y queda en la bitácora', async () => {
    const [antes] = await bd.consultar<{ dias_habiles: number }>(`SELECT dias_habiles FROM frecuencias WHERE clave = 'semestral'`)
    try {
      const r = await pedir('PUT', '/api/admin/ventanas', 'admin', { dias: { semestral: antes!.dias_habiles + 1 } })
      assert.equal(r.status, 200)
      const [evento] = await bd.consultar<{ detalle: { despues: number } }>(
        `SELECT detalle FROM bitacora WHERE accion = 'ventana_actualizada' AND entidad_id = 'semestral' ORDER BY id DESC LIMIT 1`)
      assert.equal(evento!.detalle.despues, antes!.dias_habiles + 1)
    } finally {
      await bd.consultar(`UPDATE frecuencias SET dias_habiles = $1 WHERE clave = 'semestral'`, [antes!.dias_habiles])
    }
  })

  test('CA_6: los tres roles consultan los periodos abiertos; sin sesión, 401', async () => {
    assert.equal((await pedir('GET', '/api/periodos/abiertos')).status, 401)
    for (const quien of ['admin', 'revisor', 'enlace']) {
      assert.equal((await pedir('GET', '/api/periodos/abiertos', quien)).status, 200)
    }
  })
})
