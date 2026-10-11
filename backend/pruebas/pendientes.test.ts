// HU-R1-01: pendientes del periodo para el Enlace. Dos gerencias propias, periodos con
// fecha límite relativa a hoy (vencida, urgente, lejana) y reportes en varios estados.

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
const ejercicio = 2030 + Math.floor(Math.random() * 60)
const cookie: Record<string, string> = {}
const G: Record<string, { gerencia: string; unidades: string[] }> = {}

async function gerencia(org: string, clave: string) {
  const [g] = await bd.consultar<{ id: string }>('INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id',
    [org, clave, `Gerencia ${clave} ${s}`])
  const unidades = []
  for (const [n, coord] of [['Coordinación', true], ['Otra unidad', false]] as const) {
    const [u] = await bd.consultar<{ id: string }>('INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, $3) RETURNING id', [g!.id, `${n} ${clave}`, coord])
    unidades.push(u!.id)
  }
  G[clave] = { gerencia: g!.id, unidades }
}

async function enlace(nombre: string, clave: string, unidad = 0) {
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'x', 'enlace', false) RETURNING id`, [G[clave]!.gerencia, G[clave]!.unidades[unidad], nombre, `${nombre}-${s}@comapasur.gob.mx`])
  cookie[nombre] = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
}

let numero = 0
/** Periodo abierto de la frecuencia, con fecha límite a `dias` de hoy. */
async function periodo(frecuencia: string, dias: number, estado: 'abierto' | 'cerrado' = 'abierto') {
  numero++
  const [p] = await bd.consultar<{ id: string }>(
    `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite, estado, cerrado_at)
     VALUES ($1, $2, $3, $4, current_date - 40, current_date - 10, current_date - 9, current_date + $5::int, $6, $7) RETURNING id`,
    [frecuencia, ejercicio, numero, `P${numero}-${s}`, dias, estado, estado === 'cerrado' ? new Date() : null])
  return p!.id
}

async function indicador(clave: string, codigo: string, frecuencia = 'mensual', unidad = 1) {
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (gerencia_id, unidad_id, codigo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ($1, $2, $3, 'actividad', $4, 'Porcentaje', $5) RETURNING id`, [G[clave]!.gerencia, G[clave]!.unidades[unidad], `${codigo}-${s}`, `Indicador ${codigo}`, frecuencia])
  return i!.id
}

async function reporte(indicadorId: string, periodoId: string, estado: string) {
  const enviado = ['enviado_revision', 'observado', 'corregido', 'aprobado_revisor', 'regresado_correccion', 'cerrado'].includes(estado)
  await bd.consultar(
    `INSERT INTO reportes (indicador_id, periodo_id, estado, enviado_at, cerrado_at) VALUES ($1, $2, $3, $4, $5)`,
    [indicadorId, periodoId, estado, enviado ? new Date() : null, estado === 'cerrado' ? new Date() : null])
}

async function pedir(ruta: string, quien?: string) {
  const r = await fetch(app.url + ruta, { headers: quien ? { cookie: cookie[quien]! } : {} })
  return { status: r.status, cuerpo: await r.json() as any }
}
const codigos = (lista: { codigo: string }[]) => lista.map((r) => r.codigo.replace(`-${s}`, ''))

before(async () => {
  app = await levantar()
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R1-01 ${s}`])
  await gerencia(org!.id, 'PA')
  await gerencia(org!.id, 'PB')
  await enlace('enlaceA', 'PA')
  await enlace('enlaceA-otra-unidad', 'PA', 1)
  await enlace('enlaceB', 'PB')

  const vencido = await periodo('mensual', -2)
  const urgente = await periodo('trimestral', 2)
  const lejano = await periodo('semestral', 20)
  const cerrado = await periodo('anual', 5, 'cerrado')

  // Gerencia A: un reporte por estado relevante
  await reporte(await indicador('PA', 'A-VENCIDO'), vencido, 'pendiente_carga')
  await reporte(await indicador('PA', 'A-URGENTE', 'trimestral'), urgente, 'borrador')
  await reporte(await indicador('PA', 'A-LEJANO', 'semestral'), lejano, 'observado')
  await reporte(await indicador('PA', 'A-ENVIADO', 'trimestral'), urgente, 'enviado_revision')
  await reporte(await indicador('PA', 'A-CORREGIDO', 'semestral'), lejano, 'corregido')
  await reporte(await indicador('PA', 'A-CERRADO'), vencido, 'cerrado')
  await reporte(await indicador('PA', 'A-PERIODO-CERRADO', 'anual'), cerrado, 'pendiente_carga')
  // Gerencia B
  await reporte(await indicador('PB', 'B-PENDIENTE'), vencido, 'pendiente_carga')
})
after(async () => { await app.cerrar(); await bd.cerrar() })

describe('HU-R1-01', () => {
  test('sin sesión, 401', async () => {
    assert.equal((await pedir('/api/pendientes')).status, 401)
  })

  test('CA_1 y RN_1: solo la gerencia del Enlace, y la unidad no limita', async () => {
    const a = await pedir('/api/pendientes', 'enlaceA')
    const otraUnidad = await pedir('/api/pendientes', 'enlaceA-otra-unidad')
    assert.ok(codigos(a.cuerpo.reportes).every((c) => c.startsWith('A-')))
    assert.deepEqual(codigos(otraUnidad.cuerpo.reportes), codigos(a.cuerpo.reportes))
    assert.deepEqual(codigos((await pedir('/api/pendientes', 'enlaceB')).cuerpo.reportes), ['B-PENDIENTE'])
  })

  test('CA_1: manipular la gerencia en la URL no cambia nada', async () => {
    const r = await pedir(`/api/pendientes?gerencia_id=${G.PB!.gerencia}`, 'enlaceA')
    assert.ok(codigos(r.cuerpo.reportes).every((c) => c.startsWith('A-')))
  })

  test('RN_2: enviado, corregido y cerrado no son pendientes; un periodo cerrado no aparece', async () => {
    const { cuerpo } = await pedir('/api/pendientes?solo_pendientes=1', 'enlaceA')
    assert.deepEqual(codigos(cuerpo.reportes).sort(), ['A-LEJANO', 'A-URGENTE', 'A-VENCIDO'])
    const todos = codigos((await pedir('/api/pendientes', 'enlaceA')).cuerpo.reportes)
    assert.ok(!todos.includes('A-PERIODO-CERRADO'))
    assert.ok(todos.includes('A-ENVIADO'), 'la lista completa sí trae los no pendientes, marcados')
  })

  test('CA_4: vencidos primero, luego por fecha límite', async () => {
    const { cuerpo } = await pedir('/api/pendientes?solo_pendientes=1', 'enlaceA')
    assert.deepEqual(codigos(cuerpo.reportes), ['A-VENCIDO', 'A-URGENTE', 'A-LEJANO'])
  })

  test('CA_2: urgente si vence en 3 días o ya venció; RN_4: el vencido sigue pendiente', async () => {
    const { cuerpo } = await pedir('/api/pendientes?solo_pendientes=1', 'enlaceA')
    const por = Object.fromEntries(cuerpo.reportes.map((r: any) => [r.codigo.replace(`-${s}`, ''), r]))
    assert.deepEqual([por['A-VENCIDO'].urgente, por['A-URGENTE'].urgente, por['A-LEJANO'].urgente], [true, true, false])
    assert.deepEqual([por['A-VENCIDO'].vencido, por['A-VENCIDO'].pendiente], [true, true])
  })

  test('CA_3 y CA_6: borrador y observado llegan con su estado para distinguirlos', async () => {
    const { cuerpo } = await pedir('/api/pendientes?solo_pendientes=1', 'enlaceA')
    const estados = Object.fromEntries(cuerpo.reportes.map((r: any) => [r.codigo.replace(`-${s}`, ''), r.estado]))
    assert.deepEqual(estados, { 'A-VENCIDO': 'pendiente_carga', 'A-URGENTE': 'borrador', 'A-LEJANO': 'observado' })
  })

  test('CA_5: el contador del resumen es el total de la lista de pendientes', async () => {
    const todo = await pedir('/api/pendientes', 'enlaceA')
    const solo = await pedir('/api/pendientes?solo_pendientes=1', 'enlaceA')
    assert.equal(todo.cuerpo.resumen.pendientes, solo.cuerpo.reportes.length)
    assert.deepEqual(
      [todo.cuerpo.resumen.observados, todo.cuerpo.resumen.borradores, todo.cuerpo.resumen.vencidos, todo.cuerpo.resumen.urgentes],
      [1, 1, 1, 2])
  })

  test('filtros por estado, nivel y fecha límite', async () => {
    assert.deepEqual(codigos((await pedir('/api/pendientes?estado=borrador', 'enlaceA')).cuerpo.reportes), ['A-URGENTE'])
    assert.equal((await pedir('/api/pendientes?nivel=fin', 'enlaceA')).cuerpo.reportes.length, 0)
    const hoy = new Date().toISOString().slice(0, 10)
    assert.deepEqual(codigos((await pedir(`/api/pendientes?solo_pendientes=1&hasta=${hoy}`, 'enlaceA')).cuerpo.reportes), ['A-VENCIDO'])
  })

  test('RN_3: un indicador no puede tener reporte en un periodo de otra frecuencia', async () => {
    const mensual = await indicador('PA', 'A-MENSUAL-EXTRA')
    const trimestral = await periodo('trimestral', 30)
    await assert.rejects(reporte(mensual, trimestral, 'pendiente_carga'))
  })

  test('sin pendientes, la lista viene vacía (el frontend muestra el vacío positivo)', async () => {
    const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org vacía ${s}`])
    await gerencia(org!.id, 'PV')
    await enlace('enlaceVacio', 'PV')
    const { cuerpo } = await pedir('/api/pendientes', 'enlaceVacio')
    assert.deepEqual([cuerpo.reportes, cuerpo.resumen.pendientes], [[], 0])
  })
})
