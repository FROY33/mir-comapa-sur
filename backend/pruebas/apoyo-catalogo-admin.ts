// Preparación compartida de las pruebas del catálogo administrable (HU-R4-11, ticket 3): servidor real,
// base de pruebas compartida y datos con sufijo propio. Cada archivo de pruebas llama prepararCatalogoAdmin().

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before } from 'node:test'
import { crearBD } from '../src/bd.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

export const bd = crearBD(configBD, crearLog(() => {}))
export let app: Awaited<ReturnType<typeof levantar>>
export const sufijo = randomUUID().slice(0, 8)
export const A = { gerencia: '', unidad: '' }
export const B = { gerencia: '', unidad: '' }
export const usuarios: Record<string, { id: string; cookie: string }> = {}
export const MEDIO = { id: '', nombre: '' }
export const MEDIO_2 = { id: '', nombre: '' }
export const MEDIO_INACTIVO = { id: '', nombre: '' }
let contador = 0

export async function pedir(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown) {
  const r = await fetch(app.url + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: cuerpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  return { status: r.status, cuerpo: (texto ? JSON.parse(texto) : {}) as any }
}

export const cookieAdmin = () => usuarios.admin!.cookie
export const admin = (metodo: string, ruta: string, cuerpo?: unknown) => pedir(metodo, ruta, cookieAdmin(), cuerpo)

/** Cuerpo válido para un indicador MIR nuevo; `cambios` pisa campos. */
export const datos = (cambios: Record<string, unknown> = {}) => ({
  gerencia_id: A.gerencia, codigo: `T3-${sufijo}-${++contador}`, tipo: 'mir', nivel: 'actividad',
  nombre: `Indicador de prueba ${sufijo} ${contador}`, unidad_medida: 'Porcentaje', frecuencia: 'mensual',
  tipo_calculo: 'valor_directo', acumulable: false, medio_verificacion_id: MEDIO.id,
  ...cambios,
})

/** Da de alta un indicador por la API y devuelve su representación. */
export async function altaApi(cambios: Record<string, unknown> = {}) {
  const r = await admin('POST', '/api/admin/indicadores', datos(cambios))
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo))
  return r.cuerpo.indicador as any
}

/** El cuerpo de un PUT que deja el indicador igual salvo `cambios` (el PUT reemplaza todo). */
export const comoCuerpo = (i: any, cambios: Record<string, unknown> = {}) => ({
  gerencia_id: i.gerencia.id, unidad_id: i.unidad.id, codigo: i.codigo, tipo: i.tipo, nivel: i.nivel, numero: i.numero,
  nombre: i.nombre, resumen_narrativo: i.resumen_narrativo, tipo_indicador: i.tipo_indicador,
  unidad_medida: i.unidad_medida, frecuencia: i.frecuencia, tipo_calculo: i.tipo_calculo, formula: i.formula,
  numerador_desc: i.numerador_desc, denominador_desc: i.denominador_desc, denominador_fijo: i.denominador_fijo,
  acumulable: i.acumulable, sentido_meta: i.sentido_meta, medio_verificacion_id: i.medio_verificacion_id,
  origen_mv: i.origen_mv, supuestos: i.supuestos, es_iso: i.es_iso, observaciones_mir: i.observaciones_mir,
  ...cambios,
})

export const fila = async (id: string) => (await bd.consultar<any>('SELECT * FROM indicadores WHERE id = $1', [id]))[0]

class Revertir extends Error {}
/** Corre `fn` dentro de una transacción que se revierte: así abrir ciclos no deja reportes en la base compartida. */
export async function sinPersistir<T>(fn: (tx: Parameters<Parameters<typeof bd.transaccion>[0]>[0]) => Promise<T>): Promise<T> {
  let resultado!: T
  await bd.transaccion(async (tx) => { resultado = await fn(tx); throw new Revertir() }).catch((e) => { if (!(e instanceof Revertir)) throw e })
  return resultado
}
export const FECHA_CICLO = '2090-04-02'   // lejos de cualquier dato real: ese día abren el mensual de marzo-2090 y el trimestral T1-2090

/** Registra la preparación compartida (servidor, gerencias A y B, usuarios y medios) en el archivo que la llama. */
export function prepararCatalogoAdmin() {
before(async () => {
  app = await levantar()
  for (const [m, nombre, activo] of [[MEDIO, `Informe mensual ${sufijo}`, true], [MEDIO_2, `Reporte trimestral ${sufijo}`, true], [MEDIO_INACTIVO, `Medio retirado ${sufijo}`, false]] as const) {
    const [fila] = await bd.consultar<{ id: string }>('INSERT INTO medios_verificacion (nombre, activo) VALUES ($1, $2) RETURNING id', [nombre, activo])
    m.id = fila!.id
    m.nombre = nombre
  }
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
  // Segundo Enlace de la gerencia A, en otra unidad (RN_1: el indicador no es de una unidad)
  const [otra] = await bd.consultar<{ id: string }>(
    'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, false) RETURNING id', [A.gerencia, `Otra unidad IA ${sufijo}`])
  await nuevo('enlaceA2', 'enlace', { gerencia: A.gerencia, unidad: otra!.id })
})
after(async () => { await app.cerrar(); await bd.cerrar() })
}

/** Un reporte persistente (periodo propio, lejano) del indicador; la foto la toma el trigger. */
export async function reporteExistente(indicadorId: string) {
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

