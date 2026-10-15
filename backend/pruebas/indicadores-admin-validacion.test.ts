// HU-R4-11 (ticket 3): administrar el catálogo de indicadores — datos obligatorios y validaciones.
// Backend real y base de pruebas compartida (preparación en apoyo-catalogo-admin.ts).
// Todo lo que se crea lleva un sufijo propio; las filas no se borran (la bitácora y los reportes
// son de solo inserción), por eso cada corrida usa gerencias e indicadores nuevos.
//
// Las brechas conocidas del código van como `test.todo` con su motivo: documentan lo que falta
// sin declarar completo un criterio que no lo está.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'
import {
  prepararCatalogoAdmin, bd, A, B, MEDIO, MEDIO_2, MEDIO_INACTIVO, admin, datos, altaApi, comoCuerpo, fila,
} from './apoyo-catalogo-admin.js'

prepararCatalogoAdmin()

describe('HU-R4-11 CA_2: datos obligatorios y validaciones', () => {
  const faltantes: [string, Record<string, unknown>, string, RegExp][] = [
    ['gerencia', { gerencia_id: '' }, 'gerencia_id', /gerencia/],
    ['código', { codigo: ' ' }, 'codigo', /código/],
    ['nombre', { nombre: '  ' }, 'nombre', /nombre/],
    ['unidad de medida', { unidad_medida: '' }, 'unidad_medida', /unidad de medida/],
    ['frecuencia', { frecuencia: '' }, 'frecuencia', /frecuencia/],
    ['tipo de cálculo', { tipo_calculo: '' }, 'tipo_calculo', /tipo de cálculo/],
    ['medio de verificación (MIR)', { medio_verificacion_id: null }, 'medio_verificacion_id', /medio de verificación/],
    ['nivel (indicador MIR)', { tipo: 'mir', nivel: null }, 'nivel', /nivel MIR/],
  ]
  for (const [campo, cambios, campoApi, mensaje] of faltantes) {
    test(`HU-R4-11 CA_2: sin ${campo}: 422 datos_incompletos con campo ${campoApi} y no se crea`, async () => {
      const cuerpo = datos(cambios)
      const r = await admin('POST', '/api/admin/indicadores', cuerpo)
      assert.equal(r.status, 422)
      assert.equal(r.cuerpo.error, 'datos_incompletos')
      assert.equal(r.cuerpo.campo, campoApi)
      assert.match(r.cuerpo.errores[campoApi], mensaje)
      assert.match(r.cuerpo.mensaje, mensaje)
      assert.equal((await bd.consultar('SELECT 1 FROM indicadores WHERE codigo = $1', [cuerpo.codigo])).length, 0)
    })
  }

  test('HU-R4-11 CA_2: un gerencial sin medio de verificación sí se crea (DECISIONES.md, opción (a))', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ tipo: 'gerencial', nivel: null, medio_verificacion_id: null }))
    assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
    assert.equal(r.cuerpo.indicador.medio_verificacion_id, null)
    assert.equal(r.cuerpo.indicador.medio_verificacion, null)
  })

  test('HU-R4-11 CA_2: sin campo gerencia en el cuerpo (ausente, no vacío) también es 422', async () => {
    const { gerencia_id: _, ...sinGerencia } = datos()
    const r = await admin('POST', '/api/admin/indicadores', sinGerencia)
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.mensaje, /gerencia/)
  })

  test('HU-R4-11 CA_2: varios faltantes se reportan juntos', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ nombre: '', frecuencia: '', medio_verificacion_id: null }))
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.mensaje, /nombre.*frecuencia.*medio de verificación/)
    assert.deepEqual(Object.keys(r.cuerpo.errores).sort(), ['frecuencia', 'medio_verificacion_id', 'nombre'])
    assert.equal(r.cuerpo.campo, 'nombre')
  })

  test('HU-R4-11 CA_2: un indicador gerencial no necesita nivel', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ tipo: 'gerencial', nivel: null }))
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.indicador.nivel, null)
  })

  test('HU-R4-11 CA_2: la edición exige los mismos obligatorios', async () => {
    const ind = await altaApi()
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { medio_verificacion_id: null }))
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.campo, 'medio_verificacion_id')
    assert.equal((await fila(ind.id)).medio_verificacion, ind.medio_verificacion)
  })

  test('HU-R4-11 CA_2: código repetido es 409 codigo_duplicado, aun al editar otro indicador', async () => {
    const uno = await altaApi()
    const dup = await admin('POST', '/api/admin/indicadores', datos({ codigo: uno.codigo }))
    assert.equal(dup.status, 409)
    assert.equal(dup.cuerpo.error, 'codigo_duplicado')

    const otro = await altaApi()
    const edit = await admin('PUT', `/api/admin/indicadores/${otro.id}`, comoCuerpo(otro, { codigo: uno.codigo }))
    assert.equal(edit.status, 409)
    // Conservar el propio código al editar no es duplicado
    assert.equal((await admin('PUT', `/api/admin/indicadores/${otro.id}`, comoCuerpo(otro, { nombre: 'Otro nombre' }))).status, 200)
  })

  test('HU-R4-11 CA_2: una unidad de otra gerencia es 422 unidad_de_otra_gerencia', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ gerencia_id: A.gerencia, unidad_id: B.unidad }))
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.error, 'unidad_de_otra_gerencia')
    const ok = await admin('POST', '/api/admin/indicadores', datos({ gerencia_id: A.gerencia, unidad_id: A.unidad }))
    assert.equal(ok.status, 201)
    assert.equal(ok.cuerpo.indicador.unidad.id, A.unidad)
  })

  test('HU-R4-11 CA_2: gerencia inexistente, frecuencia inexistente y catálogos inválidos son 422', async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ gerencia_id: randomUUID() }, 'gerencia_no_existe'],
      [{ frecuencia: 'quincenal' }, 'frecuencia_no_existe'],
      [{ nivel: 'subcomponente' }, 'nivel_invalido'],
      [{ tipo_calculo: 'promedio' }, 'calculo_invalido'],
      [{ tipo: 'otro' }, 'tipo_invalido'],
      [{ sentido_meta: 'lateral' }, 'sentido_invalido'],
      [{ origen_mv: 'nube' }, 'origen_mv_invalido'],
      [{ tipo_indicador: 'raro' }, 'tipo_indicador_invalido'],
    ]
    for (const [cambios, error] of casos) {
      const r = await admin('POST', '/api/admin/indicadores', datos(cambios))
      assert.equal(r.status, 422, error)
      assert.equal(r.cuerpo.error, error)
    }
  })

  test('HU-R4-11 CA_2: el denominador fijo solo se guarda en fracciones', async () => {
    const directo = await altaApi({ denominador_fijo: 100 })
    assert.equal(directo.denominador_fijo, null)
    const fraccion = await altaApi({ tipo_calculo: 'fraccion', denominador_fijo: 100, numerador_desc: 'N', denominador_desc: 'D' })
    assert.equal(fraccion.denominador_fijo, 100)
  })

  test('HU-R4-11 CA_2: un id mal formado o inexistente es 404 en detalle, edición y cambios de estado', async () => {
    for (const id of ['no-es-uuid', randomUUID()]) {
      assert.equal((await admin('GET', `/api/admin/indicadores/${id}`)).status, 404)
      assert.equal((await admin('PUT', `/api/admin/indicadores/${id}`, datos())).status, 404)
      assert.equal((await admin('POST', `/api/admin/indicadores/${id}/desactivar`, {})).status, 404)
      assert.equal((await admin('POST', `/api/admin/indicadores/${id}/reactivar`, {})).status, 404)
    }
  })

  test('HU-R4-11 CA_2: el alta guarda todos los campos y nace activo', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({
      acumulable: true, sentido_meta: 'descendente', origen_mv: 'mixto', tipo_indicador: 'gestion',
      numero: '1.2.3', supuestos: 'Hay presupuesto', es_iso: true, formula: 'a/b', resumen_narrativo: 'Resumen',
    }))
    assert.equal(r.status, 201)
    const i = r.cuerpo.indicador
    assert.deepEqual(
      [i.activo, i.acumulable, i.sentido_meta, i.origen_mv, i.tipo_indicador, i.numero, i.supuestos, i.es_iso, i.formula, i.resumen_narrativo],
      [true, true, 'descendente', 'mixto', 'gestion', '1.2.3', 'Hay presupuesto', true, 'a/b', 'Resumen'])
  })

  test('HU-R4-11 CA_2: GET /catalogo trae gerencias con sus unidades, frecuencias y listas de valores', async () => {
    const r = await admin('GET', '/api/admin/indicadores/catalogo')
    assert.equal(r.status, 200)
    const a = r.cuerpo.gerencias.find((g: any) => g.id === A.gerencia)
    assert.ok(a.unidades.some((u: any) => u.id === A.unidad))
    assert.ok(r.cuerpo.frecuencias.some((f: any) => f.clave === 'mensual'))
    assert.deepEqual(r.cuerpo.niveles, ['fin', 'proposito', 'componente', 'actividad'])
    assert.deepEqual(r.cuerpo.tipos_calculo, ['valor_directo', 'fraccion'])
  })

  test('HU-R4-11 CA_2: «acumulable» es obligatorio: ausente, nulo o no booleano es 422 con campo y no se toma como false', async () => {
    const { acumulable: _, ...sinAcumulable } = datos() as Record<string, unknown>
    for (const cuerpo of [sinAcumulable, datos({ acumulable: null }), datos({ acumulable: 'si' })]) {
      const r = await admin('POST', '/api/admin/indicadores', cuerpo)
      assert.equal(r.status, 422, JSON.stringify(cuerpo.acumulable))
      assert.equal(r.cuerpo.error, 'datos_incompletos')
      assert.equal(r.cuerpo.campo, 'acumulable')
      assert.equal((await bd.consultar('SELECT 1 FROM indicadores WHERE codigo = $1', [cuerpo.codigo])).length, 0)
    }
    assert.equal((await admin('POST', '/api/admin/indicadores', datos({ acumulable: true }))).status, 201)
  })

  test('HU-R4-11 CA_2: el medio de verificación debe ser uno activo del catálogo: inexistente, inactivo o mal formado es 422 con campo', async () => {
    for (const id of [randomUUID(), MEDIO_INACTIVO.id, 'no-es-uuid', 5]) {
      const cuerpo = datos({ medio_verificacion_id: id })
      const r = await admin('POST', '/api/admin/indicadores', cuerpo)
      assert.equal(r.status, 422, String(id))
      assert.equal(r.cuerpo.campo, 'medio_verificacion_id', String(id))
      assert.equal((await bd.consultar('SELECT 1 FROM indicadores WHERE codigo = $1', [cuerpo.codigo])).length, 0)
    }
  })

  test('HU-R4-11 CA_2: un medio inexistente también se rechaza en un gerencial, y en la edición no cambia nada', async () => {
    const g = await admin('POST', '/api/admin/indicadores', datos({ tipo: 'gerencial', nivel: null, medio_verificacion_id: randomUUID() }))
    assert.equal(g.status, 422)
    assert.equal(g.cuerpo.campo, 'medio_verificacion_id')
    const ind = await altaApi()
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { medio_verificacion_id: MEDIO_INACTIVO.id }))
    assert.equal(r.status, 422)
    assert.equal((await fila(ind.id)).medio_verificacion_id, MEDIO.id)
  })

  test('HU-R4-11 CA_2: el texto medio_verificacion queda igual al nombre del medio elegido (alta y edición); el texto suelto del cuerpo se ignora', async () => {
    const ind = await altaApi({ medio_verificacion: 'Texto libre que no manda' })
    assert.deepEqual([ind.medio_verificacion_id, ind.medio_verificacion], [MEDIO.id, MEDIO.nombre])
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { medio_verificacion_id: MEDIO_2.id }))
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo))
    const f = await fila(ind.id)
    assert.deepEqual([f.medio_verificacion_id, f.medio_verificacion], [MEDIO_2.id, MEDIO_2.nombre])
    // Un gerencial que sí trae medio lo guarda; el texto viene del catálogo
    const g = await altaApi({ tipo: 'gerencial', nivel: null, medio_verificacion_id: MEDIO_2.id })
    assert.equal(g.medio_verificacion, MEDIO_2.nombre)
  })

  test('HU-R4-11 CA_2: sin medio_verificacion_id, un MIR con solo el texto antiguo sigue siendo 422', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ medio_verificacion_id: undefined, medio_verificacion: 'Informe' }))
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.campo, 'medio_verificacion_id')
  })

  test('HU-R4-11 CA_2: los errores de catálogo y el código duplicado también traen su campo', async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ gerencia_id: randomUUID() }, 'gerencia_id'], [{ frecuencia: 'quincenal' }, 'frecuencia'],
      [{ nivel: 'subcomponente' }, 'nivel'], [{ tipo_calculo: 'promedio' }, 'tipo_calculo'], [{ tipo: 'otro' }, 'tipo'],
      [{ sentido_meta: 'lateral' }, 'sentido_meta'], [{ origen_mv: 'nube' }, 'origen_mv'], [{ tipo_indicador: 'raro' }, 'tipo_indicador'],
      [{ unidad_id: B.unidad }, 'unidad_id'],
    ]
    for (const [cambios, campo] of casos) {
      const r = await admin('POST', '/api/admin/indicadores', datos(cambios))
      assert.equal(r.status, 422)
      assert.equal(r.cuerpo.campo, campo)
    }
    const dup = await admin('POST', '/api/admin/indicadores', datos({ codigo: (await altaApi()).codigo }))
    assert.equal(dup.status, 409)
    assert.equal(dup.cuerpo.campo, 'codigo')
  })
})
