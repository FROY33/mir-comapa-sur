// HU-R4-11 (ticket 3): administrar el catálogo de indicadores. Backend real, base de pruebas
// compartida. Todo lo que se crea lleva un sufijo propio; las filas no se borran (la bitácora y
// los reportes son de solo inserción), por eso cada corrida usa gerencias e indicadores nuevos.
//
// Las brechas conocidas del código van como `test.todo` con su motivo: documentan lo que falta
// sin declarar completo un criterio que no lo está.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { abrirCiclos } from '../src/datos/ciclos.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>
const sufijo = randomUUID().slice(0, 8)
const A = { gerencia: '', unidad: '' }
const B = { gerencia: '', unidad: '' }
const usuarios: Record<string, { id: string; cookie: string }> = {}
let contador = 0

async function pedir(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown) {
  const r = await fetch(app.url + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: cuerpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  return { status: r.status, cuerpo: (texto ? JSON.parse(texto) : {}) as any }
}

const cookieAdmin = () => usuarios.admin!.cookie
const admin = (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, ruta, cookieAdmin(), cuerpo)

/** Cuerpo válido para un indicador MIR nuevo; `cambios` pisa campos. */
const datos = (cambios: Record<string, unknown> = {}) => ({
  gerencia_id: A.gerencia, codigo: `T3-${sufijo}-${++contador}`, tipo: 'mir', nivel: 'actividad',
  nombre: `Indicador de prueba ${sufijo} ${contador}`, unidad_medida: 'Porcentaje', frecuencia: 'mensual',
  tipo_calculo: 'valor_directo', acumulable: false, medio_verificacion: 'Informe mensual de la gerencia',
  ...cambios,
})

/** Da de alta un indicador por la API y devuelve su representación. */
async function altaApi(cambios: Record<string, unknown> = {}) {
  const r = await admin('POST', '/api/admin/indicadores', datos(cambios))
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
  return r.cuerpo.indicador as any
}

/** El cuerpo de un PUT que deja el indicador igual salvo `cambios` (el PUT reemplaza todo). */
const comoCuerpo = (i: any, cambios: Record<string, unknown> = {}) => ({
  gerencia_id: i.gerencia.id, unidad_id: i.unidad.id, codigo: i.codigo, tipo: i.tipo, nivel: i.nivel, numero: i.numero,
  nombre: i.nombre, resumen_narrativo: i.resumen_narrativo, tipo_indicador: i.tipo_indicador,
  unidad_medida: i.unidad_medida, frecuencia: i.frecuencia, tipo_calculo: i.tipo_calculo, formula: i.formula,
  numerador_desc: i.numerador_desc, denominador_desc: i.denominador_desc, denominador_fijo: i.denominador_fijo,
  acumulable: i.acumulable, sentido_meta: i.sentido_meta, medio_verificacion: i.medio_verificacion,
  origen_mv: i.origen_mv, supuestos: i.supuestos, es_iso: i.es_iso, observaciones_mir: i.observaciones_mir,
  ...cambios,
})

const fila = async (id: string) => (await bd.consultar<any>('SELECT * FROM indicadores WHERE id = $1', [id]))[0]

class Revertir extends Error {}
/** Corre `fn` dentro de una transacción que se revierte: así abrir ciclos no deja reportes en la base compartida. */
async function sinPersistir<T>(fn: (tx: Parameters<Parameters<typeof bd.transaccion>[0]>[0]) => Promise<T>): Promise<T> {
  let resultado!: T
  await bd.transaccion(async (tx) => { resultado = await fn(tx); throw new Revertir() }).catch((e) => { if (!(e instanceof Revertir)) throw e })
  return resultado
}
const FECHA_CICLO = '2090-04-02'   // lejos de cualquier dato real: ese día abren el mensual de marzo-2090 y el trimestral T1-2090

before(async () => {
  app = await levantar()
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R4-11 ${sufijo}`])
  for (const [g, clave] of [[A, 'IA'], [B, 'IB']] as const) {
    const [ger] = await bd.consultar<{ id: string }>(
      'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org!.id, clave, `Gerencia ${clave} ${sufijo}`])
    const [uni] = await bd.consultar<{ id: string }>(
      'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [ger!.id, `Coordinación ${clave}`])
    g.gerencia = ger!.id
    g.unidad = uni!.id
  }
  const nuevo = async (nombre: string, rol: string, g: typeof A) => {
    const [u] = await bd.consultar<{ id: string }>(
      `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`, [g.gerencia, g.unidad, nombre, `${nombre}-${sufijo}@comapasur.gob.mx`, rol])
    usuarios[nombre] = { id: u!.id, cookie: `${COOKIE_SESION}=${await crear(bd, u!.id)}` }
  }
  await nuevo('admin', 'admin', A)
  await nuevo('revisorA', 'revisor', A)
  await nuevo('enlaceA', 'enlace', A)
  await nuevo('revisorB', 'revisor', B)
  await nuevo('enlaceB', 'enlace', B)
})
after(async () => { await app.cerrar(); await bd.cerrar() })

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

describe('HU-R4-11 CA_2: datos obligatorios y validaciones', () => {
  const faltantes: [string, Record<string, unknown>, RegExp][] = [
    ['gerencia', { gerencia_id: '' }, /gerencia/],
    ['nombre', { nombre: '  ' }, /nombre/],
    ['unidad de medida', { unidad_medida: '' }, /unidad de medida/],
    ['frecuencia', { frecuencia: '' }, /frecuencia/],
    ['tipo de cálculo', { tipo_calculo: '' }, /tipo de cálculo/],
    ['medio de verificación', { medio_verificacion: '' }, /medio de verificación/],
    ['nivel (indicador MIR)', { tipo: 'mir', nivel: null }, /nivel MIR/],
  ]
  for (const [campo, cambios, mensaje] of faltantes) {
    test(`HU-R4-11 CA_2: sin ${campo}: 422 datos_incompletos y no se crea`, async () => {
      const cuerpo = datos(cambios)
      const r = await admin('POST', '/api/admin/indicadores', cuerpo)
      assert.equal(r.status, 422)
      assert.equal(r.cuerpo.error, 'datos_incompletos')
      assert.match(r.cuerpo.mensaje, mensaje)
      assert.equal((await bd.consultar('SELECT 1 FROM indicadores WHERE codigo = $1', [cuerpo.codigo])).length, 0)
    })
  }

  test('HU-R4-11 CA_2: un gerencial sin medio de verificación sí se crea (DECISIONES.md, opción (a))', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ tipo: 'gerencial', nivel: null, medio_verificacion: '' }))
    assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
  })

  test('HU-R4-11 CA_2: sin campo gerencia en el cuerpo (ausente, no vacío) también es 422', async () => {
    const { gerencia_id: _, ...sinGerencia } = datos()
    const r = await admin('POST', '/api/admin/indicadores', sinGerencia)
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.mensaje, /gerencia/)
  })

  test('HU-R4-11 CA_2: varios faltantes se reportan juntos', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ nombre: '', frecuencia: '', medio_verificacion: '' }))
    assert.equal(r.status, 422)
    assert.match(r.cuerpo.mensaje, /nombre.*frecuencia.*medio de verificación/)
  })

  test('HU-R4-11 CA_2: un indicador gerencial no necesita nivel', async () => {
    const r = await admin('POST', '/api/admin/indicadores', datos({ tipo: 'gerencial', nivel: null }))
    assert.equal(r.status, 201)
    assert.equal(r.cuerpo.indicador.nivel, null)
  })

  test('HU-R4-11 CA_2: la edición exige los mismos obligatorios', async () => {
    const ind = await altaApi()
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { medio_verificacion: '' }))
    assert.equal(r.status, 422)
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
    assert.deepEqual(a.unidades.map((u: any) => u.id), [A.unidad])
    assert.ok(r.cuerpo.frecuencias.some((f: any) => f.clave === 'mensual'))
    assert.deepEqual(r.cuerpo.niveles, ['fin', 'proposito', 'componente', 'actividad'])
    assert.deepEqual(r.cuerpo.tipos_calculo, ['valor_directo', 'fraccion'])
  })

  test.todo('HU-R4-11 CA_2: «acumulable» es obligatorio — hoy validar() lo toma como false si falta, en vez de responder 422')
  test.todo('HU-R4-11 CA_2: el medio de verificación debe ser uno del catálogo — hoy es texto libre (el catálogo llega en S2-TEC-03)')
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

  test.todo('HU-R4-11 CA_5: el desactivado debe seguir en Consulta MIR — GET /api/indicadores filtra «WHERE i.activo» y lo oculta del listado')
})

/** Un reporte persistente (periodo propio, lejano) del indicador; la foto la toma el trigger. */
async function reporteExistente(indicadorId: string) {
  const [ind] = await bd.consultar<{ frecuencia: string }>('SELECT frecuencia FROM indicadores WHERE id = $1', [indicadorId])
  const ejercicio = 2030 + Math.floor(Math.random() * 60)
  const numero = 1 + Math.floor(Math.random() * 12)
  const etiqueta = `t3-${randomUUID().slice(0, 8)}`
  await bd.consultar(
    `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
     VALUES ($1, $2, $3, $4, '2030-01-01', '2030-01-31', '2030-02-01', '2030-02-10') ON CONFLICT DO NOTHING`,
    [ind!.frecuencia, ejercicio, numero, etiqueta])
  const [periodo] = await bd.consultar<{ id: string }>(
    'SELECT id FROM periodos_reporte WHERE frecuencia = $1 AND ejercicio = $2 AND numero = $3', [ind!.frecuencia, ejercicio, numero])
  const [rep] = await bd.consultar<{ id: string }>(
    'INSERT INTO reportes (indicador_id, periodo_id) VALUES ($1, $2) RETURNING id', [indicadorId, periodo!.id])
  return rep!.id
}

describe('HU-R4-11 CA_6: la bitácora registra alta, edición y desactivación', () => {
  test('HU-R4-11 CA_6: el alta deja un evento con usuario, rol, fecha y los valores nuevos', async () => {
    const antes = new Date(Date.now() - 2000)
    const ind = await altaApi({ nombre: 'Nombre original' })
    const eventos = await listarEventos(bd, 'indicador', ind.id)
    assert.equal(eventos.length, 1)
    const e = eventos[0]!
    assert.equal(e.accion, 'indicador_alta')
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
    const r = await admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, { nombre: 'Después', frecuencia: 'trimestral', acumulable: true, medio_verificacion: 'Nuevo medio' }))
    assert.equal(r.status, 200)
    const eventos = await listarEventos(bd, 'indicador', ind.id)
    assert.deepEqual(eventos.map((e) => e.accion), ['indicador_alta', 'indicador_edicion'])
    const e = eventos[1]!
    assert.equal(e.usuario_id, usuarios.admin!.id)
    assert.equal(e.rol, 'admin')
    const d = e.detalle as any
    assert.deepEqual([d.antes.nombre, d.antes.frecuencia, d.antes.acumulable, d.antes.medio_verificacion],
      ['Antes', 'mensual', false, ind.medio_verificacion])
    assert.deepEqual([d.despues.nombre, d.despues.frecuencia, d.despues.acumulable, d.despues.medio_verificacion],
      ['Después', 'trimestral', true, 'Nuevo medio'])
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
    assert.deepEqual(eventos.map((e) => e.accion), ['indicador_alta', 'indicador_desactivado', 'indicador_reactivado'])
    assert.ok(eventos.every((e) => e.usuario_id === usuarios.admin!.id))
    assert.equal((eventos[1]!.detalle as any).antes.activo, true)
    assert.equal((eventos[2]!.detalle as any).antes.activo, false)
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

  test('HU-R4-11 CA_6: el evento queda ligado al indicador (indicador_id) para consultarlo por indicador', async () => {
    const ind = await altaApi()
    const filas = await bd.consultar('SELECT 1 FROM bitacora WHERE indicador_id = $1', [ind.id])
    assert.equal(filas.length, 1)
  })

  test.todo('HU-R4-11 CA_6: la desactivación debe guardar también el valor nuevo — hoy el detalle solo trae «antes» (activo: true)')
  test.todo('HU-R4-11 CA_6: los nombres de acción deben ser los del RQM (indicador_creado / indicador_editado) — hoy son indicador_alta / indicador_edicion')
})

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

  test.todo('HU-R4-11 CA_4: los cambios de gerencia, frecuencia, cálculo y acumulable deben aplicar desde el siguiente periodo — hoy el PUT los escribe en indicadores de inmediato (CAMPOS_VIGENCIA_FUTURA no se usa y no hay tabla cambios_pendientes)')
  test.todo('HU-R4-11 CA_4: las metas de periodos anteriores conservan sus valores — no hay metas en el esquema todavía')
  test.todo('HU-R4-11 CA_4: un cambio pendiente debería poder verse/cancelarse antes de que abra el periodo — sin implementar')
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
