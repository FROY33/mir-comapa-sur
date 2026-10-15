// HU-R4-11 RN_3: cálculo del cumplimiento. Función pura, sin base.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { calcularCumplimiento, type AvancePeriodo, type EntradaCumplimiento } from '../src/cumplimiento.js'

const directo = (numero: number, avance: number | null): AvancePeriodo =>
  ({ numero, tipoCalculo: 'valor_directo', avance, numerador: null, denominador: null })
const fraccion = (numero: number, numerador: number | null, denominador: number | null): AvancePeriodo =>
  ({ numero, tipoCalculo: 'fraccion', avance: null, numerador, denominador })
const metas = (...v: Array<number | null>) => v.map((meta_periodo, i) => ({ numero: i + 1, meta_periodo }))

function entrada(c: Partial<EntradaCumplimiento>): EntradaCumplimiento {
  return {
    numero: 1, acumulable: false, frecuencia: 'mensual', sentidoMeta: 'ascendente',
    periodos: [directo(1, 50)], metas: metas(100), frecuenciaMeta: 'mensual', ...c,
  }
}

describe('no acumulable', () => {
  test('avance del periodo contra la meta del periodo, ignorando los demás', () => {
    const r = calcularCumplimiento(entrada({ numero: 3, periodos: [directo(1, 10), directo(2, 10), directo(3, 40)], metas: metas(100, 100, 80) }))
    assert.deepEqual(r, { calculable: true, cumplimiento: 50, avance: 40, meta: 80 })
  })

  test('sin tope: 120 % es válido; avance 0 es 0 % y es calculable', () => {
    assert.equal((calcularCumplimiento(entrada({ periodos: [directo(1, 120)] })) as { cumplimiento: number }).cumplimiento, 120)
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [directo(1, 0)] })), { calculable: true, cumplimiento: 0, avance: 0, meta: 100 })
  })
})

describe('acumulable', () => {
  test('a mitad de año: suma de avances contra suma de metas de los periodos 1..n', () => {
    const r = calcularCumplimiento(entrada({
      numero: 3, acumulable: true, periodos: [directo(1, 10), directo(2, 20), directo(3, 30)], metas: metas(20, 20, 20, 99, 99),
    }))
    assert.deepEqual(r, { calculable: true, cumplimiento: 100, avance: 60, meta: 60 })
  })

  test('un periodo anterior sin reporte suma 0 de avance pero su meta cuenta', () => {
    const r = calcularCumplimiento(entrada({ numero: 3, acumulable: true, periodos: [directo(1, 30), directo(3, 30)], metas: metas(20, 20, 20) }))
    assert.deepEqual(r, { calculable: true, cumplimiento: 100, avance: 60, meta: 60 })
  })

  test('falta la meta de un periodo que cuenta: no calculable', () => {
    const r = calcularCumplimiento(entrada({ numero: 2, acumulable: true, periodos: [directo(1, 1), directo(2, 1)], metas: metas(10, null) }))
    assert.deepEqual(r, { calculable: false, motivo: 'meta_periodo_ausente' })
    assert.deepEqual(calcularCumplimiento(entrada({ numero: 2, acumulable: true, periodos: [directo(2, 1)], metas: metas(10) })),
      { calculable: false, motivo: 'meta_periodo_ausente' }, 'fila de metas_periodo inexistente')
  })

  test('suma de metas 0: no calculable', () => {
    const r = calcularCumplimiento(entrada({ numero: 2, acumulable: true, periodos: [directo(1, 1), directo(2, 1)], metas: metas(0, 0) }))
    assert.deepEqual(r, { calculable: false, motivo: 'meta_cero' })
  })
})

describe('fracción', () => {
  test('el avance del periodo es numerador / denominador × 100', () => {
    const r = calcularCumplimiento(entrada({ periodos: [fraccion(1, 45, 50)], metas: metas(90) }))
    assert.deepEqual(r, { calculable: true, cumplimiento: 100, avance: 90, meta: 90 })
  })

  test('fracción acumulable: suma de los avances de cada periodo, cada uno con su propia foto', () => {
    const r = calcularCumplimiento(entrada({
      numero: 2, acumulable: true, periodos: [directo(1, 40), fraccion(2, 1, 2)], metas: metas(50, 50),
    }))
    assert.deepEqual(r, { calculable: true, cumplimiento: 90, avance: 90, meta: 100 })
  })

  test('denominador ausente o 0: no calculable, no infinito', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [fraccion(1, 5, null)] })), { calculable: false, motivo: 'denominador_ausente' })
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [fraccion(1, 5, 0)] })), { calculable: false, motivo: 'denominador_ausente' })
  })

  test('numerador ausente: no calculable (numerador 0 sí es válido)', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [fraccion(1, null, 5)] })), { calculable: false, motivo: 'numerador_ausente' })
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [fraccion(1, 0, 5)] })), { calculable: true, cumplimiento: 0, avance: 0, meta: 100 })
  })
})

describe('casos no calculables', () => {
  test('sin meta validada: resultado nulo, no cero', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ metas: null, frecuenciaMeta: null })), { calculable: false, motivo: 'sin_meta_validada' })
  })

  test('meta del periodo 0: no se divide', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ metas: metas(0) })), { calculable: false, motivo: 'meta_cero' })
  })

  test('meta del periodo vacía: no calculable', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ metas: metas(null) })), { calculable: false, motivo: 'meta_periodo_ausente' })
  })

  test('sin avance en el periodo evaluado: no calculable', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [directo(1, null)] })), { calculable: false, motivo: 'avance_ausente' })
    assert.deepEqual(calcularCumplimiento(entrada({ periodos: [] })), { calculable: false, motivo: 'avance_ausente' })
  })

  test('indicador descendente: el RQM no define la fórmula, no se inventa', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ sentidoMeta: 'descendente' })), { calculable: false, motivo: 'sentido_descendente' })
  })

  test('la meta se hizo con otra frecuencia que el reporte: los periodos no son comparables', () => {
    assert.deepEqual(calcularCumplimiento(entrada({ frecuenciaMeta: 'trimestral' })), { calculable: false, motivo: 'frecuencia_distinta' })
  })
})
