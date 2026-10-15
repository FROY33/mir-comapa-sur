// HU-R4-11 (ticket 3): administrar el catálogo de indicadores — bitácora y cambios sobre reportes generados.
// Backend real y base de pruebas compartida (preparación en apoyo-catalogo-admin.ts).
// Todo lo que se crea lleva un sufijo propio; las filas no se borran (la bitácora y los reportes
// son de solo inserción), por eso cada corrida usa gerencias e indicadores nuevos.
//
// Las brechas conocidas del código van como `test.todo` con su motivo: documentan lo que falta
// sin declarar completo un criterio que no lo está.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { abrirCiclos } from '../src/datos/ciclos.js'
import { listarEventos } from '../src/datos/bitacora.js'
import {
  prepararCatalogoAdmin, bd, A, B, usuarios, MEDIO_2, admin, datos, altaApi, comoCuerpo, sinPersistir, FECHA_CICLO, reporteExistente,
} from './apoyo-catalogo-admin.js'

prepararCatalogoAdmin()

describe('HU-R4-11 CA_6: la bitácora registra alta, edición y desactivación', () => {
  test('HU-R4-11 CA_6: el alta deja un evento con usuario, rol, fecha y los valores nuevos', async () => {
    const antes = new Date(Date.now() - 2000)
    const ind = await altaApi({ nombre: 'Nombre original' })
    const eventos = await listarEventos(bd, 'indicador', ind.id)
    assert.equal(eventos.length, 1)
    const e = eventos[0]!
    assert.equal(e.accion, 'indicador_creado')
    assert.equal(e.usuario_id, usuarios.admin!.id)
    assert.equal(e.rol, 'admin')
    assert.ok(e.created_at >= antes && e.created_at <= new Date(Date.now() + 2000))
    const d = e.detalle as any
    assert.equal(d.antes, undefined)
    assert.equal(d.despues.codigo, ind.codigo)
    assert.equal(d.despues.nombre, 'Nombre original')
    assert.equal(d.despues.activo, true)
  })

  test('HU-R4-11 CA_6: la edición deja los valores anteriores y los nuevos', async () => {
    const ind = await altaApi({ nombre: 'Antes', frecuencia: 'mensual', acumulable: false })
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { nombre: 'Después', frecuencia: 'trimestral', acumulable: true, medio_verificacion_id: MEDIO_2.id }))
    assert.equal(r.status, 200)
    const eventos = await listarEventos(bd, 'indicador', ind.id)
    assert.deepEqual(eventos.map((e) => e.accion), ['indicador_creado', 'indicador_editado'])
    const e = eventos[1]!
    assert.equal(e.usuario_id, usuarios.admin!.id)
    assert.equal(e.rol, 'admin')
    const d = e.detalle as any
    assert.deepEqual([d.antes.nombre, d.antes.frecuencia, d.antes.acumulable, d.antes.medio_verificacion],
      ['Antes', 'mensual', false, ind.medio_verificacion])
    assert.deepEqual([d.despues.nombre, d.despues.frecuencia, d.despues.acumulable, d.despues.medio_verificacion],
      ['Después', 'trimestral', true, MEDIO_2.nombre])
  })

  test('HU-R4-11 CA_6: la gerencia en el detalle va por su clave, antes y después', async () => {
    const ind = await altaApi({ gerencia_id: A.gerencia })
    await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { gerencia_id: B.gerencia, unidad_id: null }))
    const d = (await listarEventos(bd, 'indicador', ind.id))[1]!.detalle as any
    assert.deepEqual([d.antes.gerencia, d.despues.gerencia], ['IA', 'IB'])
  })

  test('HU-R4-11 CA_6: la desactivación y la reactivación quedan registradas con el usuario', async () => {
    const ind = await altaApi()
    await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})
    await admin('POST', `/api/admin/indicadores/${ind.id}/reactivar`, {})
    const eventos = await listarEventos(bd, 'indicador', ind.id)
    assert.deepEqual(eventos.map((e) => e.accion), ['indicador_creado', 'indicador_desactivado', 'indicador_reactivado'])
    assert.ok(eventos.every((e) => e.usuario_id === usuarios.admin!.id))
    // Guardan el valor anterior y el nuevo (CA_6)
    const [des, rea] = [eventos[1]!.detalle as any, eventos[2]!.detalle as any]
    assert.deepEqual([des.antes.activo, des.despues.activo], [true, false])
    assert.deepEqual([rea.antes.activo, rea.despues.activo], [false, true])
    assert.equal(des.despues.codigo, ind.codigo)
  })

  test('HU-R4-11 CA_6: repetir una desactivación que no cambia nada no agrega eventos', async () => {
    const ind = await altaApi()
    await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})
    await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})
    assert.equal((await listarEventos(bd, 'indicador', ind.id)).length, 2)
  })

  test('HU-R4-11 CA_6: una petición rechazada por validación no deja evento ni cambios', async () => {
    const ind = await altaApi()
    await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { nombre: '' }))
    await admin('POST', '/api/admin/indicadores', datos({ codigo: ind.codigo }))
    assert.equal((await listarEventos(bd, 'indicador', ind.id)).length, 1)
  })

  test('HU-R4-11 CA_6: nada escribe ni lee los nombres viejos de acción (indicador_alta / indicador_edicion)', () => {
    for (const ruta of ['../src/indicadoresAdmin.ts', '../db/semilla/catalogo.ts']) {
      const codigo = readFileSync(new URL(ruta, import.meta.url), 'utf8')
      assert.ok(!/indicador_alta|indicador_edicion/.test(codigo), ruta)
    }
  })

  test('HU-R4-11 CA_6: el evento queda ligado al indicador (indicador_id) para consultarlo por indicador', async () => {
    const ind = await altaApi()
    const filas = await bd.consultar('SELECT 1 FROM bitacora WHERE indicador_id = $1', [ind.id])
    assert.equal(filas.length, 1)
  })

})

// La vigencia futura de los cambios (programar, ver, cancelar, aplicar) está en indicadores-vigencia.test.ts

describe('HU-R4-11 CA_4: los cambios no tocan los reportes ya generados', () => {
  test('HU-R4-11 CA_4: editar frecuencia, tipo de cálculo y acumulable no cambia la foto de los reportes existentes', async () => {
    const ind = await altaApi({ frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false, sentido_meta: 'ascendente' })
    const reporteId = await reporteExistente(ind.id)
    const foto = () => bd.consultar<any>(
      'SELECT gerencia_id, unidad_id, frecuencia, tipo_calculo, acumulable, sentido_meta, rango_verde_min, rango_amarillo_min FROM reportes WHERE id = $1', [reporteId])
    const [original] = await foto()
    assert.deepEqual([original.frecuencia, original.tipo_calculo, original.acumulable, original.gerencia_id], ['mensual', 'valor_directo', false, A.gerencia])

    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, {
      gerencia_id: B.gerencia, unidad_id: null, frecuencia: 'trimestral', tipo_calculo: 'fraccion', acumulable: true, sentido_meta: 'descendente',
    }))
    assert.equal(r.status, 200)
    assert.deepEqual((await foto())[0], original, 'el reporte existente conserva la configuración con que se creó')
  })

  test('HU-R4-11 CA_4: el reporte del siguiente periodo que se abre sí toma la configuración nueva', async () => {
    const ind = await altaApi({ frecuencia: 'mensual', acumulable: false })
    await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { frecuencia: 'trimestral', acumulable: true, tipo_calculo: 'fraccion' }))
    const reportes = await sinPersistir(async (tx) => {
      await abrirCiclos(tx, FECHA_CICLO)
      return tx.consultar<any>('SELECT frecuencia, tipo_calculo, acumulable FROM reportes WHERE indicador_id = $1', [ind.id])
    })
    assert.deepEqual(reportes, [{ frecuencia: 'trimestral', tipo_calculo: 'fraccion', acumulable: true }])
  })

  test('HU-R4-11 CA_4: la base impide modificar la foto de un reporte', async () => {
    const ind = await altaApi()
    const reporteId = await reporteExistente(ind.id)
    await assert.rejects(bd.consultar(`UPDATE reportes SET acumulable = true WHERE id = $1`, [reporteId]))
  })

})
