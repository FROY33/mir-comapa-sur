// HU-R4-11 (ticket 3): administrar el catálogo de indicadores — permisos, visibilidad, desactivación y listado.
// Backend real y base de pruebas compartida (preparación en apoyo-catalogo-admin.ts).
// Todo lo que se crea lleva un sufijo propio; las filas no se borran (la bitácora y los reportes
// son de solo inserción), por eso cada corrida usa gerencias e indicadores nuevos.
//
// Las brechas conocidas del código van como `test.todo` con su motivo: documentan lo que falta
// sin declarar completo un criterio que no lo está.

import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { abrirCicloPlaneacion } from '../src/datos/aperturaCicloPlaneacion.js'
import { abrirCiclos } from '../src/datos/ciclos.js'
import { listarEventos } from '../src/datos/bitacora.js'
import {
  prepararCatalogoAdmin, bd, sufijo, A, B, usuarios, pedir, cookieAdmin, admin, datos, altaApi, comoCuerpo, fila, sinPersistir, FECHA_CICLO, reporteExistente,
} from './apoyo-catalogo-admin.js'

prepararCatalogoAdmin()

describe('HU-R4-11 CA_1: solo el Administrador administra el catálogo', () => {
  const rutas: [string, (id: string) => string][] = [
    ['GET', () => '/api/admin/indicadores'],
    ['GET', () => '/api/admin/indicadores/catalogo'],
    ['GET', (id) => `/api/admin/indicadores/${id}`],
    ['POST', () => '/api/admin/indicadores'],
    ['PUT', (id) => `/api/admin/indicadores/${id}`],
    ['POST', (id) => `/api/admin/indicadores/${id}/desactivar`],
    ['POST', (id) => `/api/admin/indicadores/${id}/reactivar`],
  ]
  for (const [metodo, ruta] of rutas) {
    test(`HU-R4-11 CA_1: ${metodo} ${ruta(':id')}: Administrador 2xx, Revisor y Enlace 403, sin sesión 401`, async () => {
      const ind = await altaApi()
      const url = ruta(ind.id)
      const cuerpoValido = metodo === 'POST' && url === '/api/admin/indicadores' ? datos() : metodo === 'PUT' ? comoCuerpo(ind, { nombre: 'Editado por admin' }) : {}
      const cuerpoAjeno = metodo === 'POST' && url === '/api/admin/indicadores' ? datos() : metodo === 'PUT' ? comoCuerpo(ind, { nombre: 'No debe guardarse' }) : {}

      const ok = await admin(metodo, url, cuerpoValido)
      assert.ok(ok.status >= 200 && ok.status < 300, `admin: ${ok.status} ${JSON.stringify(ok.cuerpo)}`)
      for (const rol of ['revisorA', 'enlaceA', 'revisorB', 'enlaceB']) {
        assert.equal((await pedir(metodo, url, usuarios[rol]!.cookie, cuerpoAjeno)).status, 403, rol)
      }
      assert.equal((await pedir(metodo, url, undefined, cuerpoAjeno)).status, 401)
    })
  }

  test('HU-R4-11 CA_1: los intentos rechazados no cambian el catálogo ni la bitácora', async () => {
    const ind = await altaApi()
    const eventos = (await listarEventos(bd, 'indicador', ind.id)).length
    await pedir('PUT', `/api/admin/indicadores/${ind.id}`, usuarios.enlaceA!.cookie, comoCuerpo(ind, { nombre: 'Hackeado' }))
    await pedir('POST', `/api/admin/indicadores/${ind.id}/desactivar`, usuarios.revisorA!.cookie, {})
    const despues = await fila(ind.id)
    assert.equal(despues.nombre, ind.nombre)
    assert.equal(despues.activo, true)
    assert.equal((await listarEventos(bd, 'indicador', ind.id)).length, eventos)
  })

  test('HU-R4-11 CA_1: Revisor y Enlace sí consultan el catálogo (GET /api/indicadores)', async () => {
    assert.equal((await pedir('GET', '/api/indicadores', usuarios.revisorA!.cookie)).status, 200)
    assert.equal((await pedir('GET', '/api/indicadores', usuarios.enlaceA!.cookie)).status, 200)
  })
})

describe('HU-R4-11 CA_3: el indicador nuevo es visible para los de su gerencia', () => {
  test('HU-R4-11 CA_3: aparece en GET /api/indicadores del Enlace y del Revisor de su gerencia, no en los de otra', async () => {
    const ind = await altaApi({ gerencia_id: A.gerencia })
    const ids = async (rol: string) =>
      ((await pedir('GET', '/api/indicadores', usuarios[rol]!.cookie)).cuerpo as any[]).map((i) => i.id)
    assert.ok((await ids('enlaceA')).includes(ind.id), 'enlace de la gerencia')
    assert.ok((await ids('revisorA')).includes(ind.id), 'revisor de la gerencia')
    assert.ok(!(await ids('enlaceB')).includes(ind.id), 'enlace de otra gerencia')
    assert.ok(!(await ids('revisorB')).includes(ind.id), 'revisor de otra gerencia')
  })

  test('HU-R4-11 CA_3: un gerencia_id en la URL no deja a un Enlace ver la otra gerencia', async () => {
    const ind = await altaApi({ gerencia_id: B.gerencia })
    const r = await pedir('GET', `/api/indicadores?gerencia_id=${B.gerencia}`, usuarios.enlaceA!.cookie)
    assert.ok(!(r.cuerpo as any[]).some((i) => i.id === ind.id))
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.enlaceA!.cookie)).status, 404)
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.enlaceB!.cookie)).status, 200)
  })

  test('HU-R4-11 RN_1: el indicador se asigna a la gerencia, no a un Enlace ni a una unidad', async () => {
    const ind = await altaApi({ gerencia_id: A.gerencia, unidad_id: null })
    assert.equal(ind.unidad.id, null)
    // Cualquier Enlace de la gerencia lo ve, haya o no unidad
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.enlaceA!.cookie)).status, 200)
  })

  test('HU-R4-11 RN_1: dos Enlaces de la gerencia en unidades distintas ven el indicador en /api/pendientes y en su detalle', async () => {
    const ind = await altaApi({ gerencia_id: A.gerencia, unidad_id: null, frecuencia: 'mensual' })
    await reporteExistente(ind.id)   // periodo abierto: lo que /api/pendientes lista
    const [u1, u2] = [usuarios.enlaceA!, usuarios.enlaceA2!]
    const unidad = async (id: string) => (await bd.consultar<{ unidad_id: string }>('SELECT unidad_id FROM usuarios WHERE id = $1', [id]))[0]!.unidad_id
    assert.notEqual(await unidad(u1.id), await unidad(u2.id))
    for (const u of [u1, u2]) {
      const p = await pedir('GET', '/api/pendientes', u.cookie)
      assert.equal(p.status, 200)
      assert.ok(p.cuerpo.reportes.some((r: any) => r.indicador_id === ind.id), 'falta en /api/pendientes')
      assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, u.cookie)).status, 200)
    }
    // El de otra gerencia no lo ve
    const pB = await pedir('GET', '/api/pendientes', usuarios.enlaceB!.cookie)
    assert.ok(!pB.cuerpo.reportes.some((r: any) => r.indicador_id === ind.id))
    // El alta no guardó Enlace ni unidad como destinatario
    assert.equal((await fila(ind.id)).unidad_id, null)
  })

  test('HU-R4-11 RN_1: el alta no acepta ni guarda un Enlace como destinatario', async () => {
    const ind = await altaApi({ enlace_id: usuarios.enlaceA!.id, usuario_id: usuarios.enlaceA!.id })
    const columnas = Object.keys(await fila(ind.id))
    assert.ok(!columnas.some((c) => /enlace|usuario/.test(c)), `columnas de destinatario: ${columnas}`)
  })

  test('HU-R4-11 CA_3: al reasignar a otra gerencia, deja de verse en la anterior y pasa a la nueva', async () => {
    const ind = await altaApi({ gerencia_id: A.gerencia })
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { gerencia_id: B.gerencia, unidad_id: null }))
    assert.equal(r.status, 200)
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.enlaceA!.cookie)).status, 404)
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.enlaceB!.cookie)).status, 200)
  })
})

describe('HU-R4-11 CA_5: desactivar no borra ni afecta el historial', () => {
  test('HU-R4-11 CA_5: un indicador desactivado no recibe reporte al abrir un periodo; reactivado, sí', async () => {
    const activo = await altaApi({ frecuencia: 'mensual' })
    const inactivo = await altaApi({ frecuencia: 'mensual' })
    assert.equal((await admin('POST', `/api/admin/indicadores/${inactivo.id}/desactivar`, {})).status, 200)

    const reportesDe = (tx: { consultar: typeof bd.consultar }, ...ids: string[]) =>
      tx.consultar<{ indicador_id: string }>('SELECT indicador_id FROM reportes WHERE indicador_id = ANY($1::uuid[])', [ids])

    const antes = await sinPersistir(async (tx) => {
      await abrirCiclos(tx, FECHA_CICLO)
      return (await reportesDe(tx, activo.id, inactivo.id)).map((r) => r.indicador_id)
    })
    assert.deepEqual(antes, [activo.id])

    assert.equal((await admin('POST', `/api/admin/indicadores/${inactivo.id}/reactivar`, {})).status, 200)
    const despues = await sinPersistir(async (tx) => {
      await abrirCiclos(tx, FECHA_CICLO)
      return (await reportesDe(tx, activo.id, inactivo.id)).map((r) => r.indicador_id).sort()
    })
    assert.deepEqual(despues, [activo.id, inactivo.id].sort())
  })

  test('HU-R4-11 CA_5: el desactivado sigue en el listado del admin con estado inactivo y en el detalle', async () => {
    const ind = await altaApi({ nombre: `Histórico ${sufijo}` })
    const r = await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.indicador.activo, false)

    const lista = await admin('GET', `/api/admin/indicadores?texto=${encodeURIComponent(ind.codigo)}`)
    assert.deepEqual(lista.cuerpo.indicadores.map((i: any) => [i.id, i.activo]), [[ind.id, false]])
    const soloInactivos = await admin('GET', `/api/admin/indicadores?estado=inactivo&texto=${encodeURIComponent(ind.codigo)}`)
    assert.equal(soloInactivos.cuerpo.indicadores.length, 1)
    const soloActivos = await admin('GET', `/api/admin/indicadores?estado=activo&texto=${encodeURIComponent(ind.codigo)}`)
    assert.equal(soloActivos.cuerpo.indicadores.length, 0)

    assert.equal((await admin('GET', `/api/admin/indicadores/${ind.id}`)).cuerpo.indicador.activo, false)
    // El detalle de consulta (GET /api/indicadores/:id) también lo devuelve, al Enlace de su gerencia incluido
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, cookieAdmin())).status, 200)
    assert.equal((await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.enlaceA!.cookie)).status, 200)
    assert.equal((await fila(ind.id)).activo, false)
  })

  test('HU-R4-11 CA_5: reactivar lo devuelve a activo; desactivar y reactivar dos veces es idempotente', async () => {
    const ind = await altaApi()
    for (let i = 0; i < 2; i++) assert.equal((await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})).cuerpo.indicador.activo, false)
    for (let i = 0; i < 2; i++) assert.equal((await admin('POST', `/api/admin/indicadores/${ind.id}/reactivar`, {})).cuerpo.indicador.activo, true)
    assert.equal((await fila(ind.id)).activo, true)
  })

  test('HU-R4-11 CA_5: los reportes de periodos anteriores se conservan al desactivar', async () => {
    const ind = await altaApi({ frecuencia: 'mensual' })
    const reporteId = await reporteExistente(ind.id)
    assert.equal((await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})).status, 200)
    const [r] = await bd.consultar<{ estado: string; frecuencia: string }>('SELECT estado, frecuencia FROM reportes WHERE id = $1', [reporteId])
    assert.deepEqual(r, { estado: 'pendiente_carga', frecuencia: 'mensual' })
  })

  test('HU-R4-11 CA_5: al desactivar un indicador de Consulta MIR sigue accesible por su detalle (GET /api/indicadores/:id)', async () => {
    const ind = await altaApi()
    await admin('POST', `/api/admin/indicadores/${ind.id}/desactivar`, {})
    const r = await pedir('GET', `/api/indicadores/${ind.id}`, usuarios.revisorA!.cookie)
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.id, ind.id)
  })

  test.todo('HU-R4-11 CA_5 (diferido al ticket 5): el desactivado debe seguir en Consulta MIR — GET /api/indicadores filtra «WHERE i.activo» y lo oculta del listado')

  test('HU-R4-11 CA_5: el desactivado no entra en ciclos de planeación nuevos (ticket 8)', async () => {
    const activo = await altaApi()
    const apagado = await altaApi()
    await admin('POST', `/api/admin/indicadores/${apagado.id}/desactivar`, {})
    const metas = await sinPersistir(async (tx) => {
      await abrirCicloPlaneacion(tx, {
        ejercicio: 2091, inicioCaptura: '2091-01-01', finCaptura: '2091-01-31', inicioRevision: '2091-02-05',
        autor: usuarios.admin!.id, hoy: '2090-12-01',
      })
      return tx.consultar<{ indicador_id: string }>('SELECT indicador_id FROM metas_planeacion WHERE indicador_id = ANY($1)', [[activo.id, apagado.id]])
    })
    assert.deepEqual(metas.map((m) => m.indicador_id), [activo.id])
  })
})

describe('HU-R4-11 RN_2: un indicador no se elimina', () => {
  test('HU-R4-11 RN_2: no existe ruta DELETE para indicadores y el indicador sigue ahí', async () => {
    const ind = await altaApi()
    for (const ruta of [`/api/admin/indicadores/${ind.id}`, '/api/admin/indicadores', `/api/indicadores/${ind.id}`]) {
      const r = await admin('DELETE', ruta)
      assert.ok(r.status === 404 || r.status === 405, `DELETE ${ruta}: ${r.status}`)
    }
    assert.ok(await fila(ind.id))
    assert.equal((await admin('GET', `/api/admin/indicadores/${ind.id}`)).status, 200)
  })

  test('HU-R4-11 RN_2: la base rechaza borrar un indicador que tiene reportes', async () => {
    const ind = await altaApi()
    await reporteExistente(ind.id)
    await assert.rejects(bd.consultar('DELETE FROM indicadores WHERE id = $1', [ind.id]))
    assert.ok(await fila(ind.id))
  })

  test('HU-R4-11 RN_2: la base rechaza modificar o borrar eventos de la bitácora del indicador', async () => {
    const ind = await altaApi()
    await assert.rejects(bd.consultar(`UPDATE bitacora SET accion = 'x' WHERE entidad_id = $1`, [ind.id]))
    await assert.rejects(bd.consultar(`DELETE FROM bitacora WHERE entidad_id = $1`, [ind.id]))
  })
})

describe('HU-R4-11: listado y filtros del administrador', () => {
  const ids: Record<string, string> = {}
  const etiqueta = `filtro${sufijo}`
  const consulta = async (params: Record<string, string>) => {
    const q = new URLSearchParams({ texto: etiqueta, ...params })
    const r = await admin('GET', `/api/admin/indicadores?${q}`)
    assert.equal(r.status, 200)
    return (r.cuerpo.indicadores as any[]).map((i) => i.codigo).sort()
  }

  before(async () => {
    const crearI = async (clave: string, c: Record<string, unknown>) => {
      const i = await altaApi({ codigo: `F-${sufijo}-${clave}`, nombre: `${etiqueta} ${clave}`, ...c })
      ids[clave] = i.id
    }
    await crearI('a1', { gerencia_id: A.gerencia, nivel: 'fin', frecuencia: 'mensual' })
    await crearI('a2', { gerencia_id: A.gerencia, nivel: 'actividad', frecuencia: 'mensual' })
    await crearI('a3', { gerencia_id: A.gerencia, nivel: 'actividad', frecuencia: 'trimestral' })
    await crearI('b1', { gerencia_id: B.gerencia, nivel: 'actividad', frecuencia: 'mensual' })
    await crearI('b2', { gerencia_id: B.gerencia, nivel: 'fin', frecuencia: 'trimestral' })
    await admin('POST', `/api/admin/indicadores/${ids.b2}/desactivar`, {})
  })
  const c = (...claves: string[]) => claves.map((k) => `F-${sufijo}-${k}`).sort()

  test('HU-R4-11 filtros: sin filtros trae activos e inactivos', async () => {
    assert.deepEqual(await consulta({}), c('a1', 'a2', 'a3', 'b1', 'b2'))
  })
  test('HU-R4-11 filtros: por gerencia', async () => {
    assert.deepEqual(await consulta({ gerencia_id: A.gerencia }), c('a1', 'a2', 'a3'))
    assert.deepEqual(await consulta({ gerencia_id: B.gerencia }), c('b1', 'b2'))
  })
  test('HU-R4-11 filtros: por nivel', async () => {
    assert.deepEqual(await consulta({ nivel: 'fin' }), c('a1', 'b2'))
  })
  test('HU-R4-11 filtros: por frecuencia', async () => {
    assert.deepEqual(await consulta({ frecuencia: 'trimestral' }), c('a3', 'b2'))
  })
  test('HU-R4-11 filtros: por estado activo e inactivo', async () => {
    assert.deepEqual(await consulta({ estado: 'activo' }), c('a1', 'a2', 'a3', 'b1'))
    assert.deepEqual(await consulta({ estado: 'inactivo' }), c('b2'))
  })
  test('HU-R4-11 filtros: por texto, en código o nombre y sin distinguir mayúsculas', async () => {
    const r = await admin('GET', `/api/admin/indicadores?texto=${`F-${sufijo}-A2`.toLowerCase()}`)
    assert.deepEqual(r.cuerpo.indicadores.map((i: any) => i.codigo), [`F-${sufijo}-a2`])
    const porNombre = await admin('GET', `/api/admin/indicadores?texto=${etiqueta.toUpperCase()}+B1`)
    assert.deepEqual(porNombre.cuerpo.indicadores.map((i: any) => i.id), [ids.b1])
  })
  test('HU-R4-11 filtros: combinados se intersectan', async () => {
    assert.deepEqual(await consulta({ gerencia_id: A.gerencia, nivel: 'actividad', frecuencia: 'mensual' }), c('a2'))
    assert.deepEqual(await consulta({ gerencia_id: B.gerencia, estado: 'inactivo', nivel: 'fin', frecuencia: 'trimestral' }), c('b2'))
    assert.deepEqual(await consulta({ gerencia_id: A.gerencia, estado: 'inactivo' }), [])
  })
  test('HU-R4-11 filtros: cada elemento trae gerencia, unidad y estado para pintar la tabla', async () => {
    const r = await admin('GET', `/api/admin/indicadores?texto=${encodeURIComponent(`F-${sufijo}-a1`)}`)
    const i = r.cuerpo.indicadores[0]
    assert.equal(i.gerencia.clave, 'IA')
    assert.equal(i.gerencia.id, A.gerencia)
    assert.equal(i.activo, true)
  })
})
