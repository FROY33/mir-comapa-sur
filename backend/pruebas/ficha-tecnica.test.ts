// HU-R8-03: ficha técnica del indicador. Dos gerencias propias, un indicador con meta validada,
// cuatro periodos cerrados (el historial muestra los últimos 3) y uno abierto con su reporte.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>
const s = randomUUID().slice(0, 6)
let ejercicio = 0
const cookie: Record<string, string> = {}
const G: Record<string, string> = {}
const U: Record<string, string> = {}
const I: Record<string, string> = {}

async function usuario(nombre: string, rol: string, clave: string) {
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`, [G[clave], U[clave], nombre, `${nombre}-${s}@comapasur.gob.mx`, rol])
  cookie[nombre] = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
}

async function indicador(clave: string, codigo: string, c: Record<string, unknown> = {}) {
  const v = { frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false, ...c }
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (gerencia_id, unidad_id, codigo, nivel, nombre, resumen_narrativo, formula, unidad_medida,
                              frecuencia, tipo_calculo, acumulable, medio_verificacion, numerador_desc, denominador_desc)
     VALUES ($1, $2, $3, 'componente', $4, 'Objetivo del indicador', 'X / Y × 100', 'Porcentaje', $5, $6, $7,
             'Informe mensual', 'Casos atendidos', 'Casos recibidos') RETURNING id`,
    [G[clave], U[clave], `${codigo}-${s}`, `Indicador ${codigo}`, v.frecuencia, v.tipo_calculo, v.acumulable])
  I[codigo] = i!.id
  return i!.id
}

async function periodo(numero: number, estado: 'abierto' | 'cerrado') {
  const fin = `${ejercicio}-${String(numero).padStart(2, '0')}-28`
  const [p] = await bd.consultar<{ id: string }>(
    `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite, estado, cerrado_at)
     VALUES ('mensual', $1, $2, $3, $4::date - 20, $4::date, $4::date, $4::date + 10, $5, $6) RETURNING id`,
    [ejercicio, numero, `M${numero}-${s}`, fin, estado, estado === 'cerrado' ? new Date() : null])
  return p!.id
}

async function reporte(indicadorId: string, periodoId: string, estado: string, d: { avance?: number; numerador?: number; denominador?: number; congelado?: number } = {}) {
  const cerrado = ['cerrado', 'incumplido'].includes(estado)
  const enviado = !['pendiente_carga', 'borrador', 'incumplido'].includes(estado)
  await bd.consultar(
    `INSERT INTO reportes (indicador_id, periodo_id, estado, avance, numerador, denominador, enviado_at, cerrado_at, cumplimiento)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [indicadorId, periodoId, estado, d.avance ?? null, d.numerador ?? null, d.denominador ?? null,
      enviado ? new Date() : null, cerrado ? new Date() : null, d.congelado ?? null])
}

async function meta(indicadorId: string, porPeriodo: number[]) {
  const [c] = await bd.consultar<{ id: string }>(
    `INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision, cerrado_manual, cerrado_at)
     VALUES ($1, '2000-01-01', '2000-01-31', '2000-02-15', true, now())
     ON CONFLICT (ejercicio) DO UPDATE SET ejercicio = EXCLUDED.ejercicio RETURNING id`, [ejercicio])
  const [m] = await bd.consultar<{ id: string }>(
    `INSERT INTO metas_planeacion (indicador_id, ciclo_id, estado, meta_anual, linea_base, enviada_at, validada_at)
     VALUES ($1, $2, 'meta_validada', 500, 0, now(), now()) RETURNING id`, [indicadorId, c!.id])
  for (const [i, v] of porPeriodo.entries()) {
    await bd.consultar('INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ($1, $2, $3)', [m!.id, i + 1, v])
  }
}

async function ficha(id: string, quien?: string) {
  const r = await fetch(`${app.url}/api/indicadores/${id}/ficha`, { headers: quien ? { cookie: cookie[quien]! } : {} })
  return { status: r.status, cuerpo: await r.json() as any }
}

before(async () => {
  app = await levantar()
  // Un ejercicio sin periodos ni ciclo: otras pruebas (y corridas previas sobre la misma base) usan los suyos
  const [e] = await bd.consultar<{ y: number }>(
    `SELECT y FROM generate_series(2030, 2099) y
      WHERE NOT EXISTS (SELECT 1 FROM periodos_reporte WHERE ejercicio = y)
        AND NOT EXISTS (SELECT 1 FROM ciclos_planeacion WHERE ejercicio = y)
      ORDER BY random() LIMIT 1`)
  ejercicio = e!.y
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R8-03 ${s}`])
  for (const clave of ['FA', 'FB']) {
    const [g] = await bd.consultar<{ id: string }>('INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id',
      [org!.id, `${clave}${s}`, `Gerencia ${clave} ${s}`])
    G[clave] = g!.id
    const [u] = await bd.consultar<{ id: string }>('INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id',
      [g!.id, `Unidad ${clave} ${s}`])
    U[clave] = u!.id
  }
  await usuario('admin', 'admin', 'FB')
  await usuario('revisorA', 'revisor', 'FA')
  await usuario('enlaceA', 'enlace', 'FA')

  await indicador('FA', 'CON')                                           // con historial completo
  await indicador('FA', 'FRAC', { tipo_calculo: 'fraccion' })
  await indicador('FA', 'NUEVO')                                         // sin reportes ni meta
  await indicador('FB', 'AJENO')

  const cerrados = [1, 2, 3, 4].map((n) => periodo(n, 'cerrado'))
  const [p1, p2, p3, p4] = await Promise.all(cerrados)
  const p5 = await periodo(5, 'abierto')

  await meta(I.CON!, [10, 10, 10, 10, 50])
  await reporte(I.CON!, p1!, 'cerrado', { avance: 1 })
  await reporte(I.CON!, p2!, 'cerrado', { avance: 8 })                   // sin congelar: se calcula 80
  await reporte(I.CON!, p3!, 'cerrado', { avance: 9, congelado: 91.5 })  // congelado al cierre: manda
  await reporte(I.CON!, p4!, 'incumplido')
  await reporte(I.CON!, p5, 'enviado_revision', { avance: 25 })

  await reporte(I.FRAC!, p5, 'borrador', { numerador: 3, denominador: 4 })
  await reporte(I.FRAC!, p4!, 'cerrado', { numerador: 1, denominador: 2 })
  await reporte(I.AJENO!, p5, 'enviado_revision', { avance: 1 })
})

after(async () => {
  await app.cerrar()
  await bd.cerrar()
})

describe('HU-R8-03 acceso', () => {
  test('sin sesión responde 401', async () => {
    assert.equal((await ficha(I.CON!)).status, 401)
  })

  test('CA_5: el Revisor no ve la ficha de otra gerencia: 404, igual que un id que no existe (HU-R7-03)', async () => {
    const ajeno = await ficha(I.AJENO!, 'revisorA')
    const inexistente = await ficha(randomUUID(), 'revisorA')
    assert.equal(ajeno.status, 404)
    assert.deepEqual(ajeno.cuerpo, inexistente.cuerpo, 'la respuesta no debe distinguir «ajeno» de «no existe»')
  })

  test('un id que no es uuid responde 404', async () => {
    assert.equal((await ficha('no-es-uuid', 'admin')).status, 404)
  })

  test('el Revisor ve las de su gerencia y el Administrador las de cualquiera', async () => {
    assert.equal((await ficha(I.CON!, 'revisorA')).status, 200)
    assert.equal((await ficha(I.AJENO!, 'admin')).status, 200)
  })

  test('el Enlace consulta las de su gerencia (HU-R4-11 CA_1), no las de otra', async () => {
    assert.equal((await ficha(I.CON!, 'enlaceA')).status, 200)
    assert.equal((await ficha(I.AJENO!, 'enlaceA')).status, 404)
  })

  test('CA_4: solo lectura; la ruta no acepta escritura', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await fetch(`${app.url}/api/indicadores/${I.CON}/ficha`, { method, headers: { cookie: cookie.admin! } })
      assert.ok([404, 405].includes(r.status), `${method} devolvió ${r.status}`)
    }
  })
})

describe('HU-R8-03 CA_1: campos del indicador', () => {
  test('código, nombre, nivel, objetivo, fórmula, frecuencia, unidad de medida, medio, gerencia, tipo de cálculo y acumulable', async () => {
    const { indicador: i } = (await ficha(I.CON!, 'revisorA')).cuerpo
    assert.equal(i.codigo, `CON-${s}`)
    assert.equal(i.nombre, 'Indicador CON')
    assert.equal(i.nivel, 'componente')
    assert.equal(i.resumen_narrativo, 'Objetivo del indicador')
    assert.equal(i.formula, 'X / Y × 100')
    assert.equal(i.frecuencia, 'mensual')
    assert.equal(i.unidad_medida, 'Porcentaje')
    assert.equal(i.medio_verificacion, 'Informe mensual')
    assert.deepEqual(i.gerencia, { clave: `FA${s}`, nombre: `Gerencia FA ${s}` })
    assert.equal(i.tipo_calculo, 'valor_directo')
    assert.equal(i.acumulable, false)
  })

  test('línea base y meta anual: las de la meta validada del ejercicio', async () => {
    const { meta: m } = (await ficha(I.CON!, 'revisorA')).cuerpo
    assert.deepEqual(m, { ejercicio, meta_anual: 500, linea_base: 0 })
  })

  test('sin meta validada, meta nula (la pantalla dice «Pendiente»)', async () => {
    assert.equal((await ficha(I.NUEVO!, 'revisorA')).cuerpo.meta, null)
  })
})

describe('HU-R8-03 CA_3: periodo activo', () => {
  test('con reporte enviado en el periodo activo muestra estado, avance y cumplimiento', async () => {
    const { actual } = (await ficha(I.CON!, 'revisorA')).cuerpo
    assert.deepEqual(actual, { periodo: `M5-${s}`, estado: 'enviado_revision', avance: 25, cumplimiento: 50 })
  })

  test('un borrador muestra su estado, pero no el avance (no se ha enviado)', async () => {
    const { actual } = (await ficha(I.FRAC!, 'revisorA')).cuerpo
    assert.deepEqual(actual, { periodo: `M5-${s}`, estado: 'borrador', avance: null, cumplimiento: null })
  })

  test('sin reporte en un periodo abierto, actual es nulo', async () => {
    assert.equal((await ficha(I.NUEVO!, 'revisorA')).cuerpo.actual, null)
  })
})

describe('HU-R8-03 CA_2: historial de los últimos 3 periodos cerrados', () => {
  test('trae solo los 3 más recientes, del más nuevo al más viejo', async () => {
    const { historial } = (await ficha(I.CON!, 'revisorA')).cuerpo
    assert.deepEqual(historial.map((h: any) => h.periodo), [`M4-${s}`, `M3-${s}`, `M2-${s}`])
  })

  test('estado final, avance y % de cumplimiento: el congelado al cierre si existe; si no, calculado', async () => {
    const { historial } = (await ficha(I.CON!, 'revisorA')).cuerpo
    assert.deepEqual(historial, [
      { periodo: `M4-${s}`, estado: 'incumplido', avance: null, cumplimiento: null },
      { periodo: `M3-${s}`, estado: 'cerrado', avance: 9, cumplimiento: 91.5 },
      { periodo: `M2-${s}`, estado: 'cerrado', avance: 8, cumplimiento: 80 },
    ])
  })

  test('el avance de un indicador de fracción es numerador / denominador × 100', async () => {
    const { historial } = (await ficha(I.FRAC!, 'revisorA')).cuerpo
    assert.equal(historial[0].avance, 50)
  })

  test('sin periodos cerrados, historial vacío', async () => {
    assert.deepEqual((await ficha(I.NUEVO!, 'revisorA')).cuerpo.historial, [])
  })
})
