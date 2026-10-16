// Ayuda de pruebas del ciclo de planeación (base compartida de los tickets 8 y 9): una base
// propia (el «ciclo vigente» es global y en la compartida lo ensuciarían otras pruebas), y ciclos y
// metas con identificadores reconocibles para probar el ticket 9 sin depender de la apertura.

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { crearBD, type BD } from '../src/bd.js'
import { nombreBase } from '../src/config.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

/** Una fecha ISO ('AAAA-MM-DD') o un desplazamiento en días respecto de hoy (hora de la base). */
export type Fecha = string | number

export interface OpcionesCiclo {
  ejercicio: number
  inicioCaptura: Fecha
  finCaptura: Fecha
  /** Por omisión, el mismo día que termina la captura (sin hueco entre fases). */
  inicioRevision?: Fecha
  cerrado?: boolean
}

/** UUID estable y legible a partir de una etiqueta, para reconocer las filas de prueba. */
export const idDe = (etiqueta: string) => {
  const h = createHash('sha1').update(etiqueta).digest('hex')
  return `00000000-0000-4000-8000-${h.slice(0, 12)}`
}

const comoFecha = (f: Fecha) => typeof f === 'number' ? `current_date + ${Math.trunc(f)}` : `'${f}'::date`

export interface BasePlaneacion {
  bd: BD
  url: string
  soltar(): Promise<void>
}

/** Crea y migra una base `<nombre>_<sufijo>_test`, y devuelve una conexión como dueño. */
export async function prepararBase(sufijo: string): Promise<BasePlaneacion> {
  const url = new URL(configBD.url)
  url.pathname = `/${nombreBase(configBD.url).replace(/_test$/, '')}_${sufijo}_test`
  const base = url.pathname.slice(1)
  const administrar = async (sql: string) => {
    const m = new URL(configBD.url); m.pathname = '/postgres'
    const c = new pg.Client({ connectionString: m.toString() })
    await c.connect()
    try { await c.query(sql) } finally { await c.end() }
  }
  await administrar(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
  await administrar(`CREATE DATABASE ${base}`)
  execFileSync('bash', ['db/migrar.sh', 'up'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url.toString() } })
  const bd = crearBD({ ...configBD, url: url.toString() }, crearLog(() => {}))
  return {
    bd, url: url.toString(),
    soltar: async () => { await bd.cerrar(); await administrar(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`) },
  }
}

export interface Gerencia { id: string; unidadId: string }

export async function crearGerencia(bd: BD, clave: string): Promise<Gerencia> {
  const [org] = await bd.consultar<{ id: string }>(
    `INSERT INTO organizaciones (nombre) VALUES ('COMAPA')
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`)
  const [g] = await bd.consultar<{ id: string }>(
    'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org!.id, clave, `Gerencia ${clave}`])
  const [u] = await bd.consultar<{ id: string }>(
    'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [g!.id, `Coordinación ${clave}`])
  return { id: g!.id, unidadId: u!.id }
}

/** Un usuario del rol dado en la gerencia, ya con sesión: devuelve su cookie. */
export async function entrar(bd: BD, g: Gerencia, rol: 'admin' | 'revisor' | 'enlace', nombre: string): Promise<string> {
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`,
    [g.id, g.unidadId, nombre, `${nombre}-${randomUUID().slice(0, 6)}@comapasur.gob.mx`, rol])
  return `${COOKIE_SESION}=${await crear(bd, u!.id)}`
}

/** El ciclo del ejercicio con las fechas dadas (o relativas a hoy). Devuelve su id reconocible. */
export async function crearCiclo(bd: BD, o: OpcionesCiclo): Promise<string> {
  const id = idDe(`ciclo-${o.ejercicio}`)
  await bd.consultar(
    `INSERT INTO ciclos_planeacion (id, ejercicio, inicio_captura, fin_captura, inicio_revision, cerrado_manual, cerrado_at)
     VALUES ($1, $2, ${comoFecha(o.inicioCaptura)}, ${comoFecha(o.finCaptura)}, ${comoFecha(o.inicioRevision ?? o.finCaptura)}, $3, ${o.cerrado ? 'now()' : 'NULL'})`,
    [id, o.ejercicio, o.cerrado === true])
  return id
}

export interface OpcionesMeta {
  cicloId: string
  gerencia: Gerencia
  codigo: string
  estado?: 'meta_pendiente' | 'borrador_meta' | 'meta_enviada' | 'meta_observada' | 'meta_corregida' | 'meta_validada'
  nivel?: 'fin' | 'proposito' | 'componente' | 'actividad'
  vencida?: boolean
  metaAnual?: number
  /** Reutiliza el indicador ya creado con ese código (la meta de otro ejercicio del mismo indicador). */
  mismoIndicador?: boolean
}

export interface OpcionesIndicador {
  gerencia: Gerencia
  codigo: string
  nivel?: 'fin' | 'proposito' | 'componente' | 'actividad'
  tipo?: 'mir' | 'gerencial'
  activo?: boolean
}

/** Un indicador de la gerencia (activo por omisión; MIR o gerencial). Devuelve su id reconocible. */
export async function crearIndicador(bd: BD, o: OpcionesIndicador): Promise<string> {
  const gerencial = o.tipo === 'gerencial'
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (id, gerencia_id, unidad_id, codigo, tipo, nivel, nombre, unidad_medida, frecuencia, activo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Porcentaje', 'mensual', $8) RETURNING id`,
    [idDe(`indicador-${o.codigo}`), o.gerencia.id, o.gerencia.unidadId, o.codigo, o.tipo ?? 'mir',
     gerencial ? null : (o.nivel ?? 'actividad'), `Indicador ${o.codigo}`, o.activo !== false])
  return i!.id
}

/** Un indicador activo de la gerencia y su meta vigente en el estado dado. Devuelve el id de la meta. */
export async function crearMeta(bd: BD, o: OpcionesMeta): Promise<string> {
  const estado = o.estado ?? 'meta_pendiente'
  const indicadorId = o.mismoIndicador ? idDe(`indicador-${o.codigo}`)
    : await crearIndicador(bd, { gerencia: o.gerencia, codigo: o.codigo, nivel: o.nivel })
  const completa = estado === 'meta_enviada' || estado === 'meta_observada' || estado === 'meta_corregida' || estado === 'meta_validada'
  const id = idDe(`meta-${o.codigo}-${o.cicloId}`)
  await bd.consultar(
    `INSERT INTO metas_planeacion (id, indicador_id, ciclo_id, estado, vencida, vencida_at, meta_anual, linea_base, enviada_at, validada_at)
     VALUES ($1, $2, $3, $4, $5, ${o.vencida ? 'now()' : 'NULL'}, $6, $7, ${completa ? 'now()' : 'NULL'}, ${estado === 'meta_validada' ? 'now()' : 'NULL'})`,
    [id, indicadorId, o.cicloId, estado, o.vencida === true, completa ? (o.metaAnual ?? 100) : null, completa ? 0 : null])
  return id
}
