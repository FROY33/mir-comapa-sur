// Operaciones de escritura sobre indicadores — solo Administrador (R4 CA_1).
// Las consultas de lectura siguen en indicadores.ts; aquí vive el CRUD completo.

import type { Ejecutor } from '../bd.js'

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface IndicadorCompleto {
  id: string
  codigo: string
  tipo: 'mir' | 'gerencial'
  nivel: string | null
  numero: string | null
  nombre: string
  resumen_narrativo: string | null
  tipo_indicador: string | null
  unidad_medida: string
  frecuencia: string
  tipo_calculo: string
  formula: string | null
  numerador_desc: string | null
  denominador_desc: string | null
  denominador_fijo: number | null
  acumulable: boolean
  sentido_meta: string
  medio_verificacion: string | null
  medio_verificacion_id: string | null
  origen_mv: string | null
  supuestos: string | null
  es_iso: boolean
  observaciones_mir: string | null
  activo: boolean
  gerencia: { id: string; clave: string; nombre: string }
  unidad: { id: string | null; nombre: string | null }
  created_at: string
  updated_at: string
}

export interface DatosIndicador {
  gerenciaId: string
  unidadId: string | null
  codigo: string
  tipo: 'mir' | 'gerencial'
  nivel: string | null
  numero: string | null
  nombre: string
  resumenNarrativo: string | null
  tipoIndicador: string | null
  unidadMedida: string
  frecuencia: string
  tipoCalculo: string
  formula: string | null
  numeradorDesc: string | null
  denominadorDesc: string | null
  denominadorFijo: number | null
  acumulable: boolean
  sentidoMeta: string
  medioVerificacion: string | null       // texto = nombre del medio elegido (lo escribe validar())
  medioVerificacionId: string | null
  origenMv: string | null
  supuestos: string | null
  esIso: boolean
  observacionesMir: string | null
}

// ── Constantes ──────────────────────────────────────────────────────────────

export const NIVELES_MIR = ['fin', 'proposito', 'componente', 'actividad'] as const
export const TIPOS_INDICADOR = ['estrategico', 'gestion'] as const
export const TIPOS_CALCULO = ['valor_directo', 'fraccion'] as const
export const SENTIDOS_META = ['ascendente', 'descendente'] as const
export const ORIGENES_MV = ['interno', 'externo', 'mixto'] as const

// Campos cuyo cambio tiene vigencia futura (CA_4): no se aplican de inmediato sino
// cuando se abre el siguiente periodo. Mientras tanto se guardan en cambios_pendientes.
export const CAMPOS_VIGENCIA_FUTURA = ['gerenciaId', 'frecuencia', 'tipoCalculo', 'acumulable'] as const

// ── Consultas ───────────────────────────────────────────────────────────────

export async function obtenerIndicadorCompleto(
  bd: Ejecutor, id: string,
): Promise<IndicadorCompleto | undefined> {
  const [fila] = await bd.consultar<any>(
    `SELECT i.*,
            g.clave AS gerencia_clave, g.nombre AS gerencia_nombre,
            u.nombre AS unidad_nombre
       FROM indicadores i
       JOIN gerencias g ON g.id = i.gerencia_id
       LEFT JOIN unidades u ON u.id = i.unidad_id
      WHERE i.id = $1`,
    [id],
  )
  if (!fila) return undefined
  return mapearIndicador(fila)
}

function mapearIndicador(f: any): IndicadorCompleto {
  return {
    id: f.id, codigo: f.codigo, tipo: f.tipo, nivel: f.nivel, numero: f.numero,
    nombre: f.nombre, resumen_narrativo: f.resumen_narrativo,
    tipo_indicador: f.tipo_indicador, unidad_medida: f.unidad_medida,
    frecuencia: f.frecuencia, tipo_calculo: f.tipo_calculo, formula: f.formula,
    numerador_desc: f.numerador_desc, denominador_desc: f.denominador_desc,
    denominador_fijo: f.denominador_fijo != null ? Number(f.denominador_fijo) : null,
    acumulable: f.acumulable, sentido_meta: f.sentido_meta,
    medio_verificacion: f.medio_verificacion, medio_verificacion_id: f.medio_verificacion_id, origen_mv: f.origen_mv,
    supuestos: f.supuestos, es_iso: f.es_iso,
    observaciones_mir: f.observaciones_mir, activo: f.activo,
    gerencia: { id: f.gerencia_id, clave: f.gerencia_clave, nombre: f.gerencia_nombre },
    unidad: { id: f.unidad_id, nombre: f.unidad_nombre },
    created_at: f.created_at, updated_at: f.updated_at,
  }
}

/** Lista para el admin: incluye inactivos y soporta filtros (CA_5). */
export async function listarIndicadoresAdmin(
  bd: Ejecutor,
  filtros: { gerenciaId?: string; nivel?: string; frecuencia?: string; activo?: boolean; texto?: string },
): Promise<IndicadorCompleto[]> {
  const filas = await bd.consultar<any>(
    `SELECT i.*,
            g.clave AS gerencia_clave, g.nombre AS gerencia_nombre,
            u.nombre AS unidad_nombre
       FROM indicadores i
       JOIN gerencias g ON g.id = i.gerencia_id
       LEFT JOIN unidades u ON u.id = i.unidad_id
      WHERE ($1::uuid IS NULL OR i.gerencia_id = $1)
        AND ($2::text IS NULL OR i.nivel = $2)
        AND ($3::text IS NULL OR i.frecuencia = $3)
        AND ($4::boolean IS NULL OR i.activo = $4)
        AND ($5 = '' OR (i.codigo || ' ' || i.nombre) ILIKE '%' || $5 || '%')
      ORDER BY g.clave, i.codigo`,
    [
      filtros.gerenciaId ?? null,
      filtros.nivel ?? null,
      filtros.frecuencia ?? null,
      filtros.activo ?? null,
      (filtros.texto ?? '').trim(),
    ],
  )
  return filas.map(mapearIndicador)
}

/** Catálogo para el formulario: gerencias con sus unidades, frecuencias, niveles. */
export async function catalogoIndicadores(bd: Ejecutor) {
  const gerencias = await bd.consultar<{ id: string; clave: string; nombre: string; activo: boolean }>(
    `SELECT id, clave, nombre, activo FROM gerencias WHERE activo ORDER BY clave`,
  )
  const unidades = await bd.consultar<{ id: string; gerencia_id: string; nombre: string }>(
    `SELECT id, gerencia_id, nombre FROM unidades ORDER BY nombre`,
  )
  const frecuencias = await bd.consultar<{ clave: string; nombre: string; meses: number }>(
    `SELECT clave, nombre, meses FROM frecuencias ORDER BY meses`,
  )
  // Provisional: solo alimenta el <select> del formulario; la consulta y el mantenimiento de medios son del ticket 4 (S2-TEC-03)
  const medios = await bd.consultar<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM medios_verificacion WHERE activo ORDER BY nombre`)
  return {
    medios_verificacion: medios,
    gerencias: gerencias.map(g => ({
      ...g,
      unidades: unidades.filter(u => u.gerencia_id === g.id).map(u => ({ id: u.id, nombre: u.nombre })),
    })),
    frecuencias,
    niveles: [...NIVELES_MIR],
    tipos_indicador: [...TIPOS_INDICADOR],
    tipos_calculo: [...TIPOS_CALCULO],
    sentidos_meta: [...SENTIDOS_META],
    origenes_mv: [...ORIGENES_MV],
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

export async function crearIndicador(bd: Ejecutor, d: DatosIndicador): Promise<string> {
  const [fila] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (
       gerencia_id, unidad_id, codigo, tipo, nivel, numero, nombre, resumen_narrativo,
       tipo_indicador, unidad_medida, frecuencia, tipo_calculo, formula, numerador_desc,
       denominador_desc, denominador_fijo, acumulable, sentido_meta, medio_verificacion,
       origen_mv, supuestos, es_iso, observaciones_mir, medio_verificacion_id, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,true)
     RETURNING id`,
    [
      d.gerenciaId, d.unidadId, d.codigo, d.tipo,
      d.nivel, d.numero, d.nombre, d.resumenNarrativo,
      d.tipoIndicador, d.unidadMedida, d.frecuencia, d.tipoCalculo,
      d.formula, d.numeradorDesc, d.denominadorDesc, d.denominadorFijo,
      d.acumulable, d.sentidoMeta, d.medioVerificacion,
      d.origenMv, d.supuestos, d.esIso, d.observacionesMir, d.medioVerificacionId,
    ],
  )
  return fila!.id
}

export async function actualizarIndicador(bd: Ejecutor, id: string, d: DatosIndicador): Promise<void> {
  await bd.consultar(
    `UPDATE indicadores SET
       gerencia_id = $2, unidad_id = $3, codigo = $4, tipo = $5, nivel = $6, numero = $7,
       nombre = $8, resumen_narrativo = $9, tipo_indicador = $10, unidad_medida = $11,
       frecuencia = $12, tipo_calculo = $13, formula = $14, numerador_desc = $15,
       denominador_desc = $16, denominador_fijo = $17, acumulable = $18, sentido_meta = $19,
       medio_verificacion = $20, origen_mv = $21, supuestos = $22, es_iso = $23,
       observaciones_mir = $24, medio_verificacion_id = $25
     WHERE id = $1`,
    [
      id,
      d.gerenciaId, d.unidadId, d.codigo, d.tipo,
      d.nivel, d.numero, d.nombre, d.resumenNarrativo,
      d.tipoIndicador, d.unidadMedida, d.frecuencia, d.tipoCalculo,
      d.formula, d.numeradorDesc, d.denominadorDesc, d.denominadorFijo,
      d.acumulable, d.sentidoMeta, d.medioVerificacion,
      d.origenMv, d.supuestos, d.esIso, d.observacionesMir, d.medioVerificacionId,
    ],
  )
}

export async function cambiarActivoIndicador(bd: Ejecutor, id: string, activo: boolean): Promise<void> {
  await bd.consultar(`UPDATE indicadores SET activo = $2 WHERE id = $1`, [id, activo])
}

// ── Validaciones de integridad ──────────────────────────────────────────────

export async function codigoExiste(bd: Ejecutor, codigo: string, excepto?: string): Promise<boolean> {
  const [fila] = await bd.consultar(
    `SELECT 1 FROM indicadores WHERE codigo = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [codigo, excepto ?? null],
  )
  return fila !== undefined
}

export async function gerenciaExiste(bd: Ejecutor, gerenciaId: string): Promise<boolean> {
  const [fila] = await bd.consultar(`SELECT 1 FROM gerencias WHERE id = $1 AND activo`, [gerenciaId])
  return fila !== undefined
}

export async function unidadEsDeGerencia(bd: Ejecutor, unidadId: string, gerenciaId: string): Promise<boolean> {
  const [fila] = await bd.consultar(
    `SELECT 1 FROM unidades WHERE id = $1 AND gerencia_id = $2`, [unidadId, gerenciaId],
  )
  return fila !== undefined
}

/** Nombre del medio de verificación si existe y está activo (HU-R4-11 CA_2). */
export async function nombreDeMedioActivo(bd: Ejecutor, medioId: string): Promise<string | undefined> {
  const [fila] = await bd.consultar<{ nombre: string }>(
    `SELECT nombre FROM medios_verificacion WHERE id = $1 AND activo`, [medioId])
  return fila?.nombre
}

export async function frecuenciaExiste(bd: Ejecutor, clave: string): Promise<boolean> {
  const [fila] = await bd.consultar(`SELECT 1 FROM frecuencias WHERE clave = $1`, [clave])
  return fila !== undefined
}

/** RN_2: un indicador con reportes no se elimina, solo se desactiva. */
export async function tieneReportes(bd: Ejecutor, id: string): Promise<boolean> {
  const [fila] = await bd.consultar(`SELECT 1 FROM reportes WHERE indicador_id = $1 LIMIT 1`, [id])
  return fila !== undefined
}
