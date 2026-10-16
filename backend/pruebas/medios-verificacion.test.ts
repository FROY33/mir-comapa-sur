// S2-TEC-03 (ticket 4): mantenimiento directo del catálogo de medios de verificación — permisos,
// alta, edición, desactivación y bitácora. Backend real y base de pruebas compartida
// (preparación en apoyo-catalogo-admin.ts, que ya deja MEDIO, MEDIO_2 y MEDIO_INACTIVO listos).
//
// CA_2 del lado del indicador (no se permite referencia a un medio inexistente o inactivo) ya está
// cubierto en indicadores-admin.test.ts (ticket 3); aquí se repite una sola vez como control, y el
// resto de los CA_2 de este archivo son los propios del catálogo (nombre vacío, casi-duplicados).

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { listarEventos } from '../src/datos/bitacora.js'
import {
  admin, altaApi, bd, cookieAdmin, datos, MEDIO, MEDIO_INACTIVO, pedir, prepararCatalogoAdmin, sufijo, usuarios,
} from './apoyo-catalogo-admin.js'

prepararCatalogoAdmin()

const nombreNuevo = (etiqueta = '') =>
  `Medio de prueba ${sufijo}${etiqueta ? ' ' + etiqueta : ''} ${Math.random().toString(36).slice(2, 8)}`

async function altaMedio(nombre = nombreNuevo()) {
  const r = await admin('POST', '/api/admin/medios-verificacion', { nombre })
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
  return r.cuerpo.medio_verificacion as { id: string; nombre: string; activo: boolean }
}

describe('S2-TEC-03 CA-1: solo el Administrador administra el catálogo', () => {
  const rutas: [string, (id: string) => string][] = [
    ['GET', () => '/api/admin/medios-verificacion'],
    ['GET', (id) => `/api/admin/medios-verificacion/${id}`],
    ['POST', () => '/api/admin/medios-verificacion'],
    ['PUT', (id) => `/api/admin/medios-verificacion/${id}`],
    ['POST', (id) => `/api/admin/medios-verificacion/${id}/desactivar`],
    ['POST', (id) => `/api/admin/medios-verificacion/${id}/reactivar`],
  ]
  for (const [metodo, ruta] of rutas) {
    test(`${metodo} ${ruta(':id')}: Administrador 2xx, Revisor y Enlace 403, sin sesión 401`, async () => {
      const m = await altaMedio()
      const url = ruta(m.id)
      const cuerpo = metodo === 'POST' && url === '/api/admin/medios-verificacion' ? { nombre: nombreNuevo() }
        : metodo === 'PUT' ? { nombre: nombreNuevo('editado') } : {}

      const ok = await admin(metodo, url, cuerpo)
      assert.ok(ok.status >= 200 && ok.status < 300, `admin: ${ok.status} ${JSON.stringify(ok.cuerpo)}`)
      for (const rol of ['revisorA', 'enlaceA']) {
        assert.equal((await pedir(metodo, url, usuarios[rol]!.cookie, cuerpo)).status, 403, rol)
      }
      assert.equal((await pedir(metodo, url, undefined, cuerpo)).status, 401)
    })
  }
})

describe('S2-TEC-03 CA-4: cada operación queda en la bitácora', () => {
  test('alta, renombre, desactivación y reactivación se auditan en orden, con antes/después', async () => {
    const m = await altaMedio()
    const nuevoNombre = nombreNuevo('renombrado')
    await admin('PUT', `/api/admin/medios-verificacion/${m.id}`, { nombre: nuevoNombre })
    await admin('POST', `/api/admin/medios-verificacion/${m.id}/desactivar`, {})
    await admin('POST', `/api/admin/medios-verificacion/${m.id}/reactivar`, {})

    const eventos = await listarEventos(bd, 'medio_verificacion', m.id)
    assert.deepEqual(eventos.map((e) => e.accion), [
      'medio_verificacion_creado', 'medio_verificacion_editado',
      'medio_verificacion_desactivado', 'medio_verificacion_reactivado',
    ])
    assert.equal(eventos.every((e) => e.usuario_id === usuarios.admin!.id && e.rol === 'admin'), true)
    const editado = eventos[1]!.detalle as any
    assert.equal(editado.antes.nombre, m.nombre)
    assert.equal(editado.despues.nombre, nuevoNombre)
  })

  test('desactivar o reactivar un medio que ya está en ese estado no duplica el evento', async () => {
    const m = await altaMedio()
    await admin('POST', `/api/admin/medios-verificacion/${m.id}/desactivar`, {})
    await admin('POST', `/api/admin/medios-verificacion/${m.id}/desactivar`, {})
    const eventos = await listarEventos(bd, 'medio_verificacion', m.id)
    assert.equal(eventos.filter((e) => e.accion === 'medio_verificacion_desactivado').length, 1)
  })
})

describe('S2-TEC-03 CA-2: el catálogo no admite nombres vacíos ni casi-duplicados', () => {
  test('alta con nombre vacío o solo espacios', async () => {
    assert.equal((await admin('POST', '/api/admin/medios-verificacion', { nombre: '   ' })).status, 422)
  })

  test('alta con un nombre que ya existe salvo mayúsculas, espacios y puntuación final', async () => {
    const base = nombreNuevo('dup')
    await altaMedio(base)
    const r = await admin('POST', '/api/admin/medios-verificacion', { nombre: `  ${base.toUpperCase()}.  ` })
    assert.equal(r.status, 409)
  })

  test('editar un medio con el nombre de otro ya existente también se rechaza', async () => {
    const a = await altaMedio()
    const b = await altaMedio()
    const r = await admin('PUT', `/api/admin/medios-verificacion/${b.id}`, { nombre: a.nombre })
    assert.equal(r.status, 409)
  })

  test('un indicador no admite el id de un medio inexistente ni el de uno inactivo (cubierto en indicadores-admin.test.ts, ticket 3)', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ medio_verificacion_id: MEDIO_INACTIVO.id }))
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.error, 'medio_no_existe')
  })
})

describe('S2-TEC-03 CA-3: editar o desactivar un medio no destruye las referencias existentes', () => {
  test('un indicador que ya usa el medio conserva la referencia tras renombrarlo y desactivarlo', async () => {
    const medio = await altaMedio()
    const ind = await altaApi({ medio_verificacion_id: medio.id })
    const nuevoNombre = nombreNuevo('ca3')

    await admin('PUT', `/api/admin/medios-verificacion/${medio.id}`, { nombre: nuevoNombre })
    await admin('POST', `/api/admin/medios-verificacion/${medio.id}/desactivar`, {})

    const detalle = await admin('GET', `/api/admin/indicadores/${ind.id}`)
    assert.equal(detalle.cuerpo.indicador.medio_verificacion_id, medio.id)
    assert.equal(detalle.cuerpo.indicador.medio_verificacion, nuevoNombre, 'el texto heredado se actualiza con el renombre')
  })

  test('un medio desactivado ya no se puede elegir para un indicador nuevo', async () => {
    const medio = await altaMedio()
    await admin('POST', `/api/admin/medios-verificacion/${medio.id}/desactivar`, {})
    const r = await admin('POST', '/api/admin/indicadores', datos({ medio_verificacion_id: medio.id }))
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.error, 'medio_no_existe')
  })

  test('GET /api/admin/medios-verificacion/:id lista los indicadores que lo usan hoy', async () => {
    const medio = await altaMedio()
    const ind = await altaApi({ medio_verificacion_id: medio.id })
    const r = await admin('GET', `/api/admin/medios-verificacion/${medio.id}`)
    assert.ok(r.cuerpo.indicadores.some((i: any) => i.id === ind.id))
  })
})

describe('S2-TEC-03: consulta del catálogo', () => {
  test('el catálogo trae activos e inactivos; "estado" filtra; el <select> de indicadores solo trae activos', async () => {
    const r = await admin('GET', '/api/admin/medios-verificacion')
    const ids = (r.cuerpo.medios_verificacion as any[]).map((m) => m.id)
    assert.ok(ids.includes(MEDIO.id))
    assert.ok(ids.includes(MEDIO_INACTIVO.id))

    const soloActivos = await admin('GET', '/api/admin/medios-verificacion?estado=activo')
    assert.ok(!(soloActivos.cuerpo.medios_verificacion as any[]).some((m) => m.id === MEDIO_INACTIVO.id))

    const soloInactivos = await admin('GET', '/api/admin/medios-verificacion?estado=inactivo')
    assert.ok((soloInactivos.cuerpo.medios_verificacion as any[]).some((m) => m.id === MEDIO_INACTIVO.id))

    const catalogoIndicador = await admin('GET', '/api/admin/indicadores/catalogo')
    assert.ok(!(catalogoIndicador.cuerpo.medios_verificacion as any[]).some((m: any) => m.id === MEDIO_INACTIVO.id))
  })

  test('"texto" filtra por nombre', async () => {
    const r = await admin('GET', `/api/admin/medios-verificacion?texto=${encodeURIComponent(MEDIO.nombre)}`)
    const ids = (r.cuerpo.medios_verificacion as any[]).map((m) => m.id)
    assert.ok(ids.includes(MEDIO.id))
  })

  test('GET /api/admin/medios-verificacion/:id de un id inexistente responde 404', async () => {
    assert.equal((await admin('GET', '/api/admin/medios-verificacion/00000000-0000-0000-0000-000000000000')).status, 404)
  })
})
