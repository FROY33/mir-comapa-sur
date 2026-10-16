// HU-R4-11 CA_4: los cambios de gerencia, frecuencia, tipo de cálculo y acumulable de un indicador con
// reportes o metas aplican desde el siguiente periodo. Backend real sobre la base de pruebas compartida;
// lo que abre ciclos corre en una transacción que se revierte (ver sinPersistir).

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { aplicarCambiosProgramados, siguienteApertura } from '../src/datos/cambiosProgramados.js'
import { abrirCiclos } from '../src/datos/ciclos.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>
const sufijo = randomUUID().slice(0, 8)
const A = { gerencia: '', unidad: '' }
const B = { gerencia: '', unidad: '' }
const cookies: Record<string, string> = {}
let medio = ''
let contador = 0
let cicloId = ''
const FECHA_CICLO = '2090-04-02'   // ese día abren el mensual de marzo-2090 y el trimestral T1-2090

async function pedir(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown) {
  const r = await fetch(app.url + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: cuerpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  return { status: r.status, cuerpo: (texto ? JSON.parse(texto) : {}) as any }
}
const admin = (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, ruta, cookies.admin, cuerpo)

async function altaApi(cambios: Record<string, unknown> = {}) {
  const r = await admin('POST', '/api/admin/indicadores', {
    gerencia_id: A.gerencia, codigo: `T3V-${sufijo}-${++contador}`, tipo: 'mir', nivel: 'actividad',
    nombre: `Indicador de vigencia ${sufijo} ${contador}`, unidad_medida: 'Porcentaje', frecuencia: 'mensual',
    tipo_calculo: 'valor_directo', acumulable: false, medio_verificacion_id: medio, ...cambios,
  })
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
  return r.cuerpo.indicador as any
}

const comoCuerpo = (i: any, cambios: Record<string, unknown> = {}) => ({
  gerencia_id: i.gerencia.id, unidad_id: i.unidad.id, codigo: i.codigo, tipo: i.tipo, nivel: i.nivel, numero: i.numero,
  nombre: i.nombre, resumen_narrativo: i.resumen_narrativo, tipo_indicador: i.tipo_indicador,
  unidad_medida: i.unidad_medida, frecuencia: i.frecuencia, tipo_calculo: i.tipo_calculo, formula: i.formula,
  numerador_desc: i.numerador_desc, denominador_desc: i.denominador_desc, denominador_fijo: i.denominador_fijo,
  acumulable: i.acumulable, sentido_meta: i.sentido_meta, medio_verificacion_id: i.medio_verificacion_id,
  origen_mv: i.origen_mv, supuestos: i.supuestos, es_iso: i.es_iso, observaciones_mir: i.observaciones_mir,
  ...cambios,
})

const fila = async (id: string) => (await bd.consultar<any>('SELECT * FROM indicadores WHERE id = $1', [id]))[0]
const editar = (ind: any, cambios: Record<string, unknown>) => admin('PUT', `/api/admin/indicadores/${ind.id}`, comoCuerpo(ind, cambios))
const detalle = async (id: string) => (await admin('GET', `/api/admin/indicadores/${id}`)).cuerpo

/** Un reporte persistente (periodo propio, lejano) del indicador. */
async function conReporte(indicadorId: string) {
  const [ind] = await bd.consultar<{ frecuencia: string }>('SELECT frecuencia FROM indicadores WHERE id = $1', [indicadorId])
  const ejercicio = 2030 + Math.floor(Math.random() * 60)
  const numero = 1 + Math.floor(Math.random() * 12)
  await bd.consultar(
    `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
     VALUES ($1, $2, $3, $4, '2030-01-01', '2030-01-31', '2030-02-01', '2030-02-10') ON CONFLICT DO NOTHING`,
    [ind!.frecuencia, ejercicio, numero, `t3v-${randomUUID().slice(0, 8)}`])
  const [periodo] = await bd.consultar<{ id: string }>(
    'SELECT id FROM periodos_reporte WHERE frecuencia = $1 AND ejercicio = $2 AND numero = $3', [ind!.frecuencia, ejercicio, numero])
  const [rep] = await bd.consultar<{ id: string }>('INSERT INTO reportes (indicador_id, periodo_id) VALUES ($1, $2) RETURNING id', [indicadorId, periodo!.id])
  return rep!.id
}

/** Una meta del indicador en el ciclo de planeación de pruebas. */
async function conMeta(indicadorId: string) {
  const [meta] = await bd.consultar<{ id: string }>('INSERT INTO metas_planeacion (indicador_id, ciclo_id) VALUES ($1, $2) RETURNING id', [indicadorId, cicloId])
  return meta!.id
}

class Revertir extends Error {}
async function sinPersistir<T>(fn: (tx: Parameters<Parameters<typeof bd.transaccion>[0]>[0]) => Promise<T>): Promise<T> {
  let resultado!: T
  await bd.transaccion(async (tx) => { resultado = await fn(tx); throw new Revertir() }).catch((e) => { if (!(e instanceof Revertir)) throw e })
  return resultado
}

before(async () => {
  app = await levantar()
  const [m] = await bd.consultar<{ id: string }>('INSERT INTO medios_verificacion (nombre) VALUES ($1) RETURNING id', [`Medio vigencia ${sufijo}`])
  medio = m!.id
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org vigencia ${sufijo}`])
  for (const [g, clave] of [[A, 'VA'], [B, 'VB']] as const) {
    const [ger] = await bd.consultar<{ id: string }>(
      'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org!.id, clave, `Gerencia ${clave} ${sufijo}`])
    const [uni] = await bd.consultar<{ id: string }>(
      'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [ger!.id, `Coordinación ${clave}`])
    g.gerencia = ger!.id
    g.unidad = uni!.id
  }
  for (const rol of ['admin', 'revisor'] as const) {
    const [u] = await bd.consultar<{ id: string }>(
      `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`, [A.gerencia, A.unidad, rol, `${rol}-vig-${sufijo}@comapasur.gob.mx`, rol])
    cookies[rol] = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
  }
  // Un ciclo de planeación propio (ejercicio único por base compartida: se reutiliza si ya existe)
  const ejercicio = 2000 + Math.floor(Math.random() * 100)
  const [c] = await bd.consultar<{ id: string }>(
    `INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision, cerrado_manual, cerrado_at)
     VALUES ($1, '2000-01-01', '2000-01-31', '2000-02-15', true, now())
     ON CONFLICT (ejercicio) DO UPDATE SET ejercicio = EXCLUDED.ejercicio RETURNING id`, [ejercicio])
  cicloId = c!.id
})
after(async () => { await app.cerrar(); await bd.cerrar() })

describe('HU-R4-11 CA_4: programar el cambio', () => {
  test('con reportes: los cuatro campos sensibles no se escriben y la respuesta trae el cambio con su vigencia', async () => {
    const ind = await altaApi({ frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false })
    await conReporte(ind.id)
    const r = await editar(ind, { gerencia_id: B.gerencia, unidad_id: null, frecuencia: 'trimestral', tipo_calculo: 'fraccion', acumulable: true })
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo))

    const hoy = (await bd.consultar<{ hoy: string }>('SELECT current_date::text AS hoy'))[0]!.hoy
    const programado = r.cuerpo.cambio_programado
    assert.deepEqual(programado.valores, { gerencia_id: B.gerencia, unidad_id: null, frecuencia: 'trimestral', tipo_calculo: 'fraccion', acumulable: true })
    assert.equal(programado.vigente_desde, siguienteApertura(1, hoy), 'desde que abre el siguiente periodo de su frecuencia actual')
    assert.ok(programado.vigente_desde > hoy)

    const f = await fila(ind.id)
    assert.deepEqual([f.gerencia_id, f.frecuencia, f.tipo_calculo, f.acumulable], [A.gerencia, 'mensual', 'valor_directo', false])
    assert.equal(r.cuerpo.indicador.frecuencia, 'mensual')
  })

  test('con reportes: los demás campos se aplican de inmediato', async () => {
    const ind = await altaApi()
    await conReporte(ind.id)
    const r = await editar(ind, { nombre: 'Nombre nuevo', unidad_medida: 'Número', acumulable: true })
    assert.equal(r.status, 200)
    const f = await fila(ind.id)
    assert.deepEqual([f.nombre, f.unidad_medida, f.acumulable], ['Nombre nuevo', 'Número', false])
    assert.deepEqual(r.cuerpo.cambio_programado.valores, { acumulable: true })
  })

  test('con metas y sin reportes también se programa', async () => {
    const ind = await altaApi()
    await conMeta(ind.id)
    const r = await editar(ind, { frecuencia: 'semestral' })
    assert.deepEqual(r.cuerpo.cambio_programado.valores, { frecuencia: 'semestral' })
    assert.equal((await fila(ind.id)).frecuencia, 'mensual')
  })

  test('sin reportes ni metas todo se aplica de inmediato y no queda nada programado', async () => {
    const ind = await altaApi()
    const r = await editar(ind, { gerencia_id: B.gerencia, unidad_id: null, frecuencia: 'trimestral', tipo_calculo: 'fraccion', acumulable: true })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.cambio_programado, null)
    const f = await fila(ind.id)
    assert.deepEqual([f.gerencia_id, f.frecuencia, f.tipo_calculo, f.acumulable], [B.gerencia, 'trimestral', 'fraccion', true])
  })

  test('editar sin tocar los campos sensibles no programa nada', async () => {
    const ind = await altaApi()
    await conReporte(ind.id)
    const r = await editar(ind, { nombre: 'Solo el nombre' })
    assert.equal(r.cuerpo.cambio_programado, null)
  })

  test('un cambio nuevo reemplaza al pendiente: queda uno solo con los valores de ambos', async () => {
    const ind = await altaApi()
    await conReporte(ind.id)
    const primero = (await editar(ind, { acumulable: true })).cuerpo.cambio_programado
    const segundo = (await editar(ind, { frecuencia: 'bimestral' })).cuerpo.cambio_programado
    assert.notEqual(segundo.id, primero.id)
    assert.deepEqual(segundo.valores, { acumulable: true, frecuencia: 'bimestral' })
    const [cuenta] = await bd.consultar<{ n: number }>(
      'SELECT count(*)::int AS n FROM indicador_cambios_programados WHERE indicador_id = $1 AND aplicado_at IS NULL AND cancelado_at IS NULL', [ind.id])
    assert.equal(cuenta!.n, 1)
  })

  test('el detalle del indicador devuelve el cambio programado, para la ficha de edición', async () => {
    const ind = await altaApi()
    await conReporte(ind.id)
    assert.equal((await detalle(ind.id)).cambio_programado, null)
    const programado = (await editar(ind, { frecuencia: 'anual' })).cuerpo.cambio_programado
    assert.deepEqual((await detalle(ind.id)).cambio_programado, programado)
  })

  test('programar queda en la bitácora con antes, después y vigente_desde', async () => {
    const ind = await altaApi({ frecuencia: 'mensual', acumulable: false })
    await conReporte(ind.id)
    const programado = (await editar(ind, { frecuencia: 'trimestral', gerencia_id: B.gerencia, unidad_id: null })).cuerpo.cambio_programado
    const e = (await listarEventos(bd, 'indicador', ind.id)).find((x) => x.accion === 'cambio_programado')!
    assert.equal(e.rol, 'admin')
    const d = e.detalle as any
    assert.equal(d.vigente_desde, programado.vigente_desde)
    assert.deepEqual([d.antes.frecuencia, d.antes.gerencia], ['mensual', 'VA'])
    assert.deepEqual([d.despues.frecuencia, d.despues.gerencia], ['trimestral', 'VB'])
  })
})

describe('HU-R4-11 CA_4: la foto de reportes y metas no cambia', () => {
  test('un cambio de frecuencia en un indicador con reportes y metas deja intactos sus reportes y sus metas', async () => {
    const ind = await altaApi({ frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false })
    const reporteId = await conReporte(ind.id)
    const metaId = await conMeta(ind.id)
    const fotoReporte = () => bd.consultar<any>('SELECT gerencia_id, frecuencia, tipo_calculo, acumulable FROM reportes WHERE id = $1', [reporteId])
    // La meta apunta a la versión del indicador con que se creó; esa versión queda congelada
    const fotoMeta = () => bd.consultar<any>(
      `SELECT m.indicador_version_id, v.definicion->>'frecuencia' AS frecuencia, v.definicion->>'tipo_calculo' AS tipo_calculo,
              v.definicion->'acumulable' AS acumulable, v.gerencia_id
         FROM metas_planeacion m JOIN indicador_versiones v ON v.id = m.indicador_version_id WHERE m.id = $1`, [metaId])
    const [r0, m0] = [await fotoReporte(), await fotoMeta()]

    await editar(ind, { frecuencia: 'trimestral', acumulable: true, tipo_calculo: 'fraccion', gerencia_id: B.gerencia, unidad_id: null })
    // ...ni siquiera cuando el cambio se aplica al abrir el periodo
    await bd.transaccion(async (tx) => {
      await aplicarCambiosProgramados(tx, '2090-01-01', { indicadorId: ind.id })
    })
    assert.equal((await fila(ind.id)).frecuencia, 'trimestral', 'el cambio sí llegó al catálogo')
    assert.deepEqual(await fotoReporte(), r0)
    assert.deepEqual(await fotoMeta(), m0)
  })
})

describe('HU-R4-11 CA_4: aplicar el cambio al abrir el periodo', () => {
  test('abrir el periodo de reporte aplica el cambio en la misma transacción y deja el evento', async () => {
    const ind = await altaApi({ frecuencia: 'mensual', acumulable: false })
    await conReporte(ind.id)
    const programado = (await editar(ind, { frecuencia: 'trimestral', acumulable: true })).cuerpo.cambio_programado

    const { f, reportes, pendiente, eventos } = await sinPersistir(async (tx) => {
      await abrirCiclos(tx, FECHA_CICLO)
      return {
        f: (await tx.consultar<any>('SELECT frecuencia, acumulable FROM indicadores WHERE id = $1', [ind.id]))[0],
        reportes: await tx.consultar<any>('SELECT r.frecuencia, r.acumulable FROM reportes r JOIN periodos_reporte p ON p.id = r.periodo_id WHERE r.indicador_id = $1 AND p.ejercicio = 2090', [ind.id]),
        pendiente: (await tx.consultar<any>('SELECT aplicado_at FROM indicador_cambios_programados WHERE id = $1', [programado.id]))[0],
        eventos: await listarEventos(tx, 'indicador', ind.id),
      }
    })
    assert.deepEqual(f, { frecuencia: 'trimestral', acumulable: true })
    assert.deepEqual(reportes, [{ frecuencia: 'trimestral', acumulable: true }], 'el reporte del periodo nuevo toma la configuración nueva')
    assert.ok(pendiente.aplicado_at)
    const aplicado = eventos.find((e) => e.accion === 'cambio_programado_aplicado')!
    assert.equal(aplicado.usuario_id, null, 'lo hace el sistema al abrir el periodo')
    assert.equal((aplicado.detalle as any).vigente_desde, programado.vigente_desde)
    assert.deepEqual([(aplicado.detalle as any).antes.frecuencia, (aplicado.detalle as any).despues.frecuencia], ['mensual', 'trimestral'])

    // La transacción se revirtió: nada quedó aplicado
    assert.equal((await fila(ind.id)).frecuencia, 'mensual')
    assert.ok((await detalle(ind.id)).cambio_programado)
  })

  test('el cambio aún no vigente no se aplica, y aplicar dos veces no repite', async () => {
    const ind = await altaApi({ frecuencia: 'mensual' })
    await conReporte(ind.id)
    await editar(ind, { acumulable: true })
    const r = await sinPersistir(async (tx) => {
      const antes = await aplicarCambiosProgramados(tx, '2000-01-01')
      const primera = await aplicarCambiosProgramados(tx, '2090-01-01', { frecuencia: 'mensual' })
      const segunda = await aplicarCambiosProgramados(tx, '2090-01-01')
      return { antes, primera: primera.filter((c) => c.indicador_id === ind.id), segunda: segunda.filter((c) => c.indicador_id === ind.id) }
    })
    assert.equal(r.antes.length, 0)
    assert.equal(r.primera.length, 1)
    assert.equal(r.segunda.length, 0)
  })

  test('un cambio cancelado no se aplica', async () => {
    const ind = await altaApi({ frecuencia: 'mensual' })
    await conReporte(ind.id)
    const programado = (await editar(ind, { acumulable: true })).cuerpo.cambio_programado
    await admin('POST', `/api/admin/cambios-programados/${programado.id}/cancelar`)
    const aplicados = await sinPersistir((tx) => aplicarCambiosProgramados(tx, '2090-01-01'))
    assert.equal(aplicados.filter((c) => c.indicador_id === ind.id).length, 0)
  })

  test('el siguiente periodo abre en el primer día después del periodo en curso', () => {
    assert.equal(siguienteApertura(1, '2026-10-15'), '2026-11-01')
    assert.equal(siguienteApertura(3, '2026-10-15'), '2027-01-01')
    assert.equal(siguienteApertura(3, '2026-07-01'), '2026-10-01')
    assert.equal(siguienteApertura(12, '2026-12-31'), '2027-01-01')
  })
})

describe('HU-R4-11 CA_4: cancelar el cambio antes de que abra el periodo', () => {
  test('el Administrador cancela un cambio pendiente: el indicador queda como está y la bitácora lo registra', async () => {
    const ind = await altaApi({ frecuencia: 'mensual' })
    await conReporte(ind.id)
    const programado = (await editar(ind, { frecuencia: 'trimestral' })).cuerpo.cambio_programado

    const r = await admin('POST', `/api/admin/cambios-programados/${programado.id}/cancelar`)
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo))
    assert.equal((await detalle(ind.id)).cambio_programado, null)
    assert.equal((await fila(ind.id)).frecuencia, 'mensual')

    const e = (await listarEventos(bd, 'indicador', ind.id)).find((x) => x.accion === 'cambio_programado_cancelado')!
    const d = e.detalle as any
    assert.equal(d.vigente_desde, programado.vigente_desde)
    assert.deepEqual([d.antes.frecuencia, d.despues.frecuencia], ['trimestral', 'mensual'])
    assert.ok(e.usuario_id)
  })

  test('cancelar dos veces, o uno ya aplicado, da 409 y no cambia nada', async () => {
    const ind = await altaApi({ frecuencia: 'mensual' })
    await conReporte(ind.id)
    const cancelado = (await editar(ind, { acumulable: true })).cuerpo.cambio_programado
    await admin('POST', `/api/admin/cambios-programados/${cancelado.id}/cancelar`)
    assert.equal((await admin('POST', `/api/admin/cambios-programados/${cancelado.id}/cancelar`)).status, 409)

    const aplicado = (await editar(ind, { frecuencia: 'bimestral' })).cuerpo.cambio_programado
    await bd.transaccion((tx) => aplicarCambiosProgramados(tx, '2090-01-01', { indicadorId: ind.id }))
    const r = await admin('POST', `/api/admin/cambios-programados/${aplicado.id}/cancelar`)
    assert.equal(r.status, 409)
    assert.equal((await fila(ind.id)).frecuencia, 'bimestral', 'lo aplicado se queda')
  })

  test('un cambio inexistente da 404; Revisor 403 y sin sesión 401', async () => {
    const ind = await altaApi()
    await conReporte(ind.id)
    const programado = (await editar(ind, { acumulable: true })).cuerpo.cambio_programado
    assert.equal((await admin('POST', `/api/admin/cambios-programados/${randomUUID()}/cancelar`)).status, 404)
    assert.equal((await admin('POST', '/api/admin/cambios-programados/no-es-uuid/cancelar')).status, 404)
    assert.equal((await pedir('POST', `/api/admin/cambios-programados/${programado.id}/cancelar`, cookies.revisor)).status, 403)
    assert.equal((await pedir('POST', `/api/admin/cambios-programados/${programado.id}/cancelar`)).status, 401)
    assert.ok((await detalle(ind.id)).cambio_programado, 'sigue pendiente')
  })
})
