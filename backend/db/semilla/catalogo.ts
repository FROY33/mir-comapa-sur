// Carga del catálogo institucional de indicadores (S2-TEC-02, HU-R4-11 RN_4).
//
// Dos usos:
//   cargarIndicadores   el upsert por código de indicadores.csv. Lo usa la carga completa (cargar.ts)
//                       y el modo --catalogo.
//   importarCatalogo    el modo --catalogo sobre una base del sprint 1: renombra cada MIR del prototipo
//                       a su código institucional (mismo id, sus reportes se conservan), hace el
//                       upsert, desactiva sin borrar los que no tienen equivalente y deja un evento
//                       `catalogo_importado` en la bitácora. Se carga una sola vez: con un evento previo
//                       se niega, y --forzar no pisa lo que el Administrador editó desde la pantalla.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BD, Ejecutor } from '../../src/bd.js'
import { registrarEvento } from '../../src/datos/bitacora.js'
import { booleano, DATOS, leerCsv, numeroONulo, vacioANulo } from './csv.js'
import { cargarGerencias, cargarOrganizacion, cargarUnidades } from './organizacion.js'

export class ErrorCatalogo extends Error {}

/** Acción con que la API registra la edición de un indicador (nombre del RQM). */
const EDICION = 'indicador_editado'
/** Un cambio programado que se aplicó al abrir un periodo: también es una edición del Administrador (antes/despues). */
const CAMBIO_APLICADO = 'cambio_programado_aplicado'
const ACCION_CARGA = 'catalogo_importado'

// Columna de la tabla → cómo se saca del renglón del CSV. gerencia_id y unidad_id se agregan aparte.
const COLUMNAS: [string, (i: Record<string, string>) => unknown][] = [
  ['tipo', (i) => i.tipo], ['nivel', (i) => vacioANulo(i.nivel)], ['numero', (i) => vacioANulo(i.numero)],
  ['nombre', (i) => i.nombre], ['resumen_narrativo', (i) => vacioANulo(i.resumen_narrativo)],
  ['tipo_indicador', (i) => vacioANulo(i.tipo_indicador)], ['unidad_medida', (i) => i.unidad_medida],
  ['frecuencia', (i) => i.frecuencia], ['tipo_calculo', (i) => i.tipo_calculo],
  ['formula', (i) => vacioANulo(i.formula)], ['numerador_desc', (i) => vacioANulo(i.numerador_desc)],
  ['denominador_desc', (i) => vacioANulo(i.denominador_desc)], ['denominador_fijo', (i) => numeroONulo(i.denominador_fijo)],
  ['acumulable', (i) => booleano(i.acumulable)], ['sentido_meta', (i) => i.sentido_meta],
  ['medio_verificacion', (i) => vacioANulo(i.medio_verificacion)], ['origen_mv', (i) => vacioANulo(i.origen_mv)],
  ['supuestos', (i) => vacioANulo(i.supuestos)], ['es_iso', (i) => booleano(i.es_iso)],
  ['observaciones_mir', (i) => vacioANulo(i.observaciones_mir)], ['activo', (i) => booleano(i.activo)],
]
const CAMPOS_CARGA = new Set(['gerencia_id', 'unidad_id', ...COLUMNAS.map(([c]) => c)])
// En la foto de bitácora de la API, `gerencia` es la clave de la gerencia; en la tabla, gerencia_id
const COLUMNA_DE_FOTO: Record<string, string> = { gerencia: 'gerencia_id' }

/** Código → columnas que el Administrador editó y que la recarga no debe sobrescribir. */
type Protegidos = Map<string, Set<string>>
export interface NoSobrescrito { codigo: string; campos: string[] }

const igual = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

/** Upsert por código de indicadores.csv y, en una segunda pasada, la jerarquía. */
export async function cargarIndicadores(
  tx: Ejecutor, idGerencia: Map<string, string>, idUnidad: Map<string, string>, protegidos: Protegidos = new Map(),
) {
  const indicadores = leerCsv('indicadores.csv')
  const existentes = new Map((await tx.consultar<Record<string, unknown> & { codigo: string }>(
    'SELECT * FROM indicadores')).map((f) => [f.codigo, f]))
  let insertados = 0
  let actualizados = 0
  const noSobrescritos: NoSobrescrito[] = []

  for (const i of indicadores) {
    const gerenciaId = idGerencia.get(i.gerencia_clave!)
    if (gerenciaId === undefined) throw new Error(`${i.codigo}: gerencia ${i.gerencia_clave} desconocida`)
    const unidadId = i.unidad_nombre ? idUnidad.get(`${i.gerencia_clave}||${i.unidad_nombre}`) ?? null : null
    const valores: Record<string, unknown> = { gerencia_id: gerenciaId, unidad_id: unidadId }
    for (const [col, de] of COLUMNAS) valores[col] = de(i)

    // Un campo editado desde la pantalla conserva el valor que tiene en la base
    const actual = existentes.get(i.codigo!)
    if (actual === undefined) insertados++
    else {
      actualizados++
      const respetados = [...(protegidos.get(i.codigo!) ?? [])].filter((c) => !igual(actual[c], valores[c]))
      for (const c of respetados) valores[c] = actual[c]
      if (respetados.length > 0) noSobrescritos.push({ codigo: i.codigo!, campos: respetados.sort() })
    }

    const columnas = Object.keys(valores)
    await tx.consultar(
      `INSERT INTO indicadores (codigo, ${columnas.join(', ')})
       VALUES ($1, ${columnas.map((_, n) => `$${n + 2}`).join(', ')})
       ON CONFLICT (codigo) DO UPDATE SET ${columnas.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      [i.codigo, ...columnas.map((c) => valores[c])])
  }
  // Sin parent_codigo en el CSV, el padre se quita; un padre que no existe es un error del CSV
  for (const i of indicadores) {
    const filas = await tx.consultar(
      `UPDATE indicadores SET parent_id = (SELECT id FROM indicadores WHERE codigo = $2)
        WHERE codigo = $1 AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM indicadores WHERE codigo = $2))
       RETURNING id`, [i.codigo, vacioANulo(i.parent_codigo)])
    if (filas.length === 0) throw new Error(`${i.codigo}: el padre ${i.parent_codigo} no existe`)
  }
  return { filas: indicadores.length, insertados, actualizados, noSobrescritos }
}

/** Eventos de carga del catálogo: el primero (desde él cuentan las ediciones) y el más reciente. */
export async function cargasPrevias(bd: Ejecutor) {
  const [fila] = await bd.consultar<{ primera_id: string; ultima_id: string; ultima: Date }>(
    `SELECT min(id) AS primera_id, max(id) AS ultima_id, max(created_at) AS ultima
       FROM bitacora WHERE accion = $1 HAVING count(*) > 0`, [ACCION_CARGA])
  return fila
}

export const catalogoImportado = async (bd: Ejecutor) => (await cargasPrevias(bd)) !== undefined

/**
 * Campos que el Administrador editó desde la pantalla después de la primera carga, por código
 * (así una segunda recarga forzada tampoco los pisa):
 * los que cambian entre `antes` y `despues` en los eventos de edición, más `activo` (desactivar
 * y reactivar son eventos propios).
 */
async function camposEditados(tx: Ejecutor, desdeId: string): Promise<Protegidos> {
  type Foto = Record<string, unknown>
  const eventos = await tx.consultar<{ codigo: string; accion: string; detalle: { antes?: Foto; despues?: Foto } | null }>(
    `SELECT i.codigo, b.accion, b.detalle
       FROM bitacora b JOIN indicadores i ON i.id = b.indicador_id
      WHERE b.id > $1 AND b.accion = ANY($2)`,
    [desdeId, [EDICION, CAMBIO_APLICADO, 'indicador_desactivado', 'indicador_reactivado']])
  const protegidos: Protegidos = new Map()
  const marcar = (codigo: string, campo: string) => {
    const columna = COLUMNA_DE_FOTO[campo] ?? campo
    // El código no se protege: es la clave de la carga
    if (columna === 'codigo' || !CAMPOS_CARGA.has(columna)) return
    protegidos.set(codigo, (protegidos.get(codigo) ?? new Set()).add(columna))
  }
  for (const e of eventos) {
    if (e.accion === 'indicador_desactivado' || e.accion === 'indicador_reactivado') { marcar(e.codigo, 'activo'); continue }
    const { antes = {}, despues = {} } = e.detalle ?? {}
    for (const campo of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
      if (JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo])) marcar(e.codigo, campo)
    }
  }
  return protegidos
}

export interface ResumenCatalogo {
  conteos: { csv: number; mir: number; gerenciales: number; renombrados: number; insertados: number;
             actualizados: number; desactivados: number; no_sobrescritos: number }
  desactivados: { codigo: string; reportes: number }[]
  no_sobrescritos: NoSobrescrito[]
  sha256: string
  forzar: boolean
}

/** El hash que identifica lo cargado: los bytes de indicadores.csv. */
export const hashCatalogo = () =>
  createHash('sha256').update(readFileSync(path.join(DATOS, 'indicadores.csv'))).digest('hex')

export function importarCatalogo(bd: BD, forzar: boolean): Promise<ResumenCatalogo> {
  return bd.transaccion(async (tx) => {
    // Dos cargas a la vez no se pisan: la segunda espera y ve el evento de la primera
    await tx.consultar(`SELECT pg_advisory_xact_lock(hashtext('catalogo_importado'))`)

    const previa = await cargasPrevias(tx)
    if (previa !== undefined && !forzar) {
      throw new ErrorCatalogo(
        `El catálogo ya se importó el ${previa.ultima.toISOString().slice(0, 10)} (evento ${previa.ultima_id} de la bitácora). ` +
        'Después de la carga los indicadores se mantienen desde la pantalla del catálogo; no se cambió nada. ' +
        'Si la Product Owner pidió recargarlo, repite con --forzar: no sobrescribe los campos que el Administrador editó.')
    }
    const protegidos = previa === undefined ? new Map() : await camposEditados(tx, previa.primera_id)

    const organizacionId = await cargarOrganizacion(tx)
    const { idGerencia } = await cargarGerencias(tx, organizacionId)
    const { idUnidad } = await cargarUnidades(tx, idGerencia)

    // 1. Renombrar: el MIR del prototipo pasa a su código institucional conservando el id
    const equivalencias = leerCsv('equivalencias_prototipo.csv')
    let renombrados = 0
    for (const e of equivalencias.filter((f) => f.codigo && f.codigo !== f.codigo_prototipo)) {
      const filas = await tx.consultar(
        `UPDATE indicadores SET codigo = $2
          WHERE codigo = $1 AND NOT EXISTS (SELECT 1 FROM indicadores WHERE codigo = $2) RETURNING id`,
        [e.codigo_prototipo, e.codigo])
      renombrados += filas.length
    }

    // 2. Upsert por código
    const carga = await cargarIndicadores(tx, idGerencia, idUnidad, protegidos)
    const csv = leerCsv('indicadores.csv')

    // 3. Desactivar, sin borrar, los del prototipo sin equivalente
    const desactivados = await tx.consultar<{ codigo: string; reportes: string }>(
      `UPDATE indicadores i SET activo = false
        WHERE i.codigo = ANY($1) AND i.activo
       RETURNING i.codigo, (SELECT count(*) FROM reportes r WHERE r.indicador_id = i.id) AS reportes`,
      [equivalencias.filter((f) => !f.codigo).map((f) => f.codigo_prototipo)])

    const resumen: ResumenCatalogo = {
      conteos: {
        csv: carga.filas, mir: csv.filter((i) => i.tipo === 'mir').length,
        gerenciales: csv.filter((i) => i.tipo === 'gerencial').length,
        renombrados, insertados: carga.insertados, actualizados: carga.actualizados,
        desactivados: desactivados.length, no_sobrescritos: carga.noSobrescritos.length,
      },
      desactivados: desactivados.map((d) => ({ codigo: d.codigo, reportes: Number(d.reportes) }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
      no_sobrescritos: carga.noSobrescritos.sort((a, b) => a.codigo.localeCompare(b.codigo)),
      sha256: hashCatalogo(),
      forzar,
    }
    await registrarEvento(tx, {
      accion: ACCION_CARGA, entidad: 'catalogo', entidadId: 'indicadores',
      comentario: forzar ? 'Recarga forzada del catálogo institucional' : 'Carga del catálogo institucional',
      detalle: { fuente: 'datos/indicadores.csv', sha256: resumen.sha256, forzar, conteos: resumen.conteos,
                 desactivados: resumen.desactivados, no_sobrescritos: resumen.no_sobrescritos },
    })
    return resumen
  })
}
