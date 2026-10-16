// HU-R4-11 RN_3 con la base: la consulta usa la foto del reporte y la meta validada, no el catálogo vigente.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { cumplimientoDeReporte } from '../src/datos/cumplimiento.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
const sufijo = randomUUID().slice(0, 8)
let gerencia = ''
let medio = ''
let cicloId = ''
let ejercicio = 0
let contador = 0

async function indicador(c: Record<string, unknown> = {}) {
  const v = { frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false, sentido_meta: 'ascendente', ...c }
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (gerencia_id, codigo, tipo, nivel, nombre, unidad_medida, frecuencia, tipo_calculo, acumulable, sentido_meta, medio_verificacion_id)
     VALUES ($1, $2, 'mir', 'actividad', 'Indicador de cumplimiento', 'Porcentaje', $3, $4, $5, $6, $7) RETURNING id`,
    [gerencia, `T3C-${sufijo}-${++contador}`, v.frecuencia, v.tipo_calculo, v.acumulable, v.sentido_meta, medio])
  return i!.id
}

/** Reporte del periodo `numero` del ejercicio; la foto la toma el trigger del catálogo de ese momento. */
async function reporte(indicadorId: string, numero: number, datos: { avance?: number; numerador?: number; denominador?: number } = {}) {
  const [ind] = await bd.consultar<{ frecuencia: string }>('SELECT frecuencia FROM indicadores WHERE id = $1', [indicadorId])
  await bd.consultar(
    `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
     VALUES ($1, $2, $3, $4, '2030-01-01', '2030-01-31', '2030-02-01', '2030-02-10') ON CONFLICT DO NOTHING`,
    [ind!.frecuencia, ejercicio, numero, `${ind!.frecuencia}-${ejercicio}-${numero}`])
  const [p] = await bd.consultar<{ id: string }>(
    'SELECT id FROM periodos_reporte WHERE frecuencia = $1 AND ejercicio = $2 AND numero = $3', [ind!.frecuencia, ejercicio, numero])
  const [r] = await bd.consultar<{ id: string }>(
    'INSERT INTO reportes (indicador_id, periodo_id, avance, numerador, denominador) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [indicadorId, p!.id, datos.avance ?? null, datos.numerador ?? null, datos.denominador ?? null])
  return r!.id
}

async function meta(indicadorId: string, porPeriodo: number[], estado = 'meta_validada') {
  const [m] = await bd.consultar<{ id: string }>(
    `INSERT INTO metas_planeacion (indicador_id, ciclo_id, estado, meta_anual, linea_base, enviada_at, validada_at)
     VALUES ($1, $2, $3, 1, 1, now(), CASE WHEN $3 = 'meta_validada' THEN now() END) RETURNING id`, [indicadorId, cicloId, estado])
  for (const [i, v] of porPeriodo.entries()) {
    await bd.consultar('INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ($1, $2, $3)', [m!.id, i + 1, v])
  }
  return m!.id
}

before(async () => {
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org cumplimiento ${sufijo}`])
  const [g] = await bd.consultar<{ id: string }>(
    'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org!.id, 'CU', `Gerencia cumplimiento ${sufijo}`])
  gerencia = g!.id
  const [mv] = await bd.consultar<{ id: string }>('INSERT INTO medios_verificacion (nombre) VALUES ($1) RETURNING id', [`Medio cumplimiento ${sufijo}`])
  medio = mv!.id
  ejercicio = 2030 + Math.floor(Math.random() * 60)
  const [c] = await bd.consultar<{ id: string }>(
    `INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision, cerrado_manual, cerrado_at)
     VALUES ($1, '2000-01-01', '2000-01-31', '2000-02-15', true, now())
     ON CONFLICT (ejercicio) DO UPDATE SET ejercicio = EXCLUDED.ejercicio RETURNING id`, [ejercicio])
  cicloId = c!.id
})
after(async () => { await bd.cerrar() })

describe('cumplimientoDeReporte', () => {
  test('un reporte que no existe devuelve undefined', async () => {
    assert.equal(await cumplimientoDeReporte(bd, randomUUID()), undefined)
  })

  test('no acumulable: avance del periodo contra su meta, de la meta validada', async () => {
    const id = await indicador()
    await meta(id, [100, 200])
    const rep = await reporte(id, 2, { avance: 150 })
    assert.deepEqual(await cumplimientoDeReporte(bd, rep), { calculable: true, cumplimiento: 75, avance: 150, meta: 200 })
  })

  test('sin meta validada (ni con otra en estado meta_enviada): no calculable', async () => {
    const sin = await indicador()
    assert.deepEqual(await cumplimientoDeReporte(bd, await reporte(sin, 1, { avance: 5 })), { calculable: false, motivo: 'sin_meta_validada' })
    const enviada = await indicador()
    await meta(enviada, [10], 'meta_enviada')
    assert.deepEqual(await cumplimientoDeReporte(bd, await reporte(enviada, 1, { avance: 5 })), { calculable: false, motivo: 'sin_meta_validada' })
  })

  test('fracción acumulable: suma lo de los periodos 1..n del ejercicio (un periodo sin reporte suma 0)', async () => {
    const id = await indicador({ tipo_calculo: 'fraccion', acumulable: true })
    await meta(id, [50, 50, 50])
    await reporte(id, 1, { numerador: 1, denominador: 2 })    // 50
    const rep = await reporte(id, 3, { numerador: 3, denominador: 4 })    // 75; el periodo 2 no se entregó
    assert.deepEqual(await cumplimientoDeReporte(bd, rep), { calculable: true, cumplimiento: (125 / 150) * 100, avance: 125, meta: 150 })
  })

  test('cambio de acumulable aplicado después: los periodos ya registrados conservan su cálculo', async () => {
    const id = await indicador({ acumulable: false })
    await meta(id, [100, 100])
    const r1 = await reporte(id, 1, { avance: 60 })
    assert.deepEqual(await cumplimientoDeReporte(bd, r1), { calculable: true, cumplimiento: 60, avance: 60, meta: 100 })

    // Se aplica el cambio programado: el catálogo pasa a acumulable antes de abrir el periodo 2
    await bd.consultar('UPDATE indicadores SET acumulable = true WHERE id = $1', [id])
    const r2 = await reporte(id, 2, { avance: 100 })

    assert.deepEqual(await cumplimientoDeReporte(bd, r1), { calculable: true, cumplimiento: 60, avance: 60, meta: 100 },
      'el reporte anterior sigue sin acumular')
    assert.deepEqual(await cumplimientoDeReporte(bd, r2), { calculable: true, cumplimiento: 80, avance: 160, meta: 200 },
      'el nuevo acumula')
  })

  test('un cambio de tipo de cálculo no reescribe el reporte anterior', async () => {
    const id = await indicador({ tipo_calculo: 'valor_directo' })
    await meta(id, [100, 100])
    const r1 = await reporte(id, 1, { avance: 40 })
    await bd.consultar(`UPDATE indicadores SET tipo_calculo = 'fraccion' WHERE id = $1`, [id])
    assert.deepEqual(await cumplimientoDeReporte(bd, r1), { calculable: true, cumplimiento: 40, avance: 40, meta: 100 })
    const r2 = await reporte(id, 2, { numerador: 1, denominador: 4 })
    assert.deepEqual(await cumplimientoDeReporte(bd, r2), { calculable: true, cumplimiento: 25, avance: 25, meta: 100 })
  })

  test('la meta con otra frecuencia que el reporte (cambio de frecuencia a mitad de ejercicio): no calculable', async () => {
    const id = await indicador({ frecuencia: 'trimestral' })
    await meta(id, [10, 10, 10, 10])
    await bd.consultar(`UPDATE indicadores SET frecuencia = 'mensual' WHERE id = $1`, [id])
    const rep = await reporte(id, 1, { avance: 5 })
    assert.deepEqual(await cumplimientoDeReporte(bd, rep), { calculable: false, motivo: 'frecuencia_distinta' })
  })

  test('descendente: no calculable', async () => {
    const id = await indicador({ sentido_meta: 'descendente' })
    await meta(id, [10])
    assert.deepEqual(await cumplimientoDeReporte(bd, await reporte(id, 1, { avance: 5 })), { calculable: false, motivo: 'sentido_descendente' })
  })

  test('meta del periodo 0: no calculable', async () => {
    const id = await indicador()
    await meta(id, [0])
    assert.deepEqual(await cumplimientoDeReporte(bd, await reporte(id, 1, { avance: 5 })), { calculable: false, motivo: 'meta_cero' })
  })
})
