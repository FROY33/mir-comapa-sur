// Gestión del catálogo de indicadores — solo Administrador (R4).
// Todas las rutas van bajo /api/admin/indicadores y se registran con protegida(['admin']) (CA_1).
// Cada cambio y su evento en la bitácora se guardan en la misma transacción (CA_6).

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD, Ejecutor } from './bd.js'
import { registrarEvento } from './datos/bitacora.js'
import {
  actualizarIndicador, cambiarActivoIndicador, catalogoIndicadores, codigoExiste,
  crearIndicador, frecuenciaExiste, gerenciaExiste, listarIndicadoresAdmin,
  NIVELES_MIR, obtenerIndicadorCompleto, ORIGENES_MV, SENTIDOS_META, tieneReportes,
  TIPOS_CALCULO, TIPOS_INDICADOR, unidadEsDeGerencia,
  type DatosIndicador, type IndicadorCompleto,
} from './datos/indicadoresAdmin.js'
import type { Respuesta } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const error = (status: number, codigo: string, mensaje: string): Respuesta =>
  ({ status, cuerpo: { error: codigo, mensaje } })
const NO_ENCONTRADO = error(404, 'no_encontrado', 'Indicador no encontrado')

/** Lo que se guarda en la bitácora: la foto completa del indicador. */
const foto = (i: IndicadorCompleto) => ({
  codigo: i.codigo, nombre: i.nombre, tipo: i.tipo, nivel: i.nivel,
  gerencia: i.gerencia.clave, frecuencia: i.frecuencia, tipo_calculo: i.tipo_calculo,
  acumulable: i.acumulable, unidad_medida: i.unidad_medida, activo: i.activo,
  tipo_indicador: i.tipo_indicador, medio_verificacion: i.medio_verificacion,
})

function auditar(tx: Ejecutor, s: SolicitudConSesion, accion: string, indicadorId: string, detalle: unknown) {
  return registrarEvento(tx, {
    usuarioId: s.sesion.usuarioId, rol: 'admin', accion,
    entidad: 'indicador', entidadId: indicadorId,
    indicadorId, ip: s.ip, detalle,
  })
}

// ── Validación (CA_2) ───────────────────────────────────────────────────────

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const textoONulo = (v: unknown) => { const s = texto(v); return s || null }
const numONulo = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function validar(bd: Ejecutor, cuerpo: Record<string, unknown>, editandoId?: string): Promise<DatosIndicador | Respuesta> {
  const gerenciaId = texto(cuerpo.gerencia_id)
  const unidadId = textoONulo(cuerpo.unidad_id)
  const codigo = texto(cuerpo.codigo)
  const tipo = texto(cuerpo.tipo) as 'mir' | 'gerencial'
  const nivel = textoONulo(cuerpo.nivel)
  const numero = textoONulo(cuerpo.numero)
  const nombre = texto(cuerpo.nombre)
  const resumenNarrativo = textoONulo(cuerpo.resumen_narrativo)
  const tipoIndicador = textoONulo(cuerpo.tipo_indicador)
  const unidadMedida = texto(cuerpo.unidad_medida)
  const frecuencia = texto(cuerpo.frecuencia)
  const tipoCalculo = texto(cuerpo.tipo_calculo)
  const acumulable = cuerpo.acumulable === true
  const sentidoMeta = texto(cuerpo.sentido_meta) || 'ascendente'
  const formula = textoONulo(cuerpo.formula)
  const numeradorDesc = textoONulo(cuerpo.numerador_desc)
  const denominadorDesc = textoONulo(cuerpo.denominador_desc)
  const denominadorFijo = tipoCalculo === 'fraccion' ? numONulo(cuerpo.denominador_fijo) : null
  const medioVerificacion = textoONulo(cuerpo.medio_verificacion)
  const origenMv = textoONulo(cuerpo.origen_mv)
  const supuestos = textoONulo(cuerpo.supuestos)
  const esIso = cuerpo.es_iso === true
  const observacionesMir = textoONulo(cuerpo.observaciones_mir)

  // CA_2: campos obligatorios
  const faltan: string[] = []
  if (!UUID.test(gerenciaId)) faltan.push('gerencia')
  if (!codigo) faltan.push('código')
  if (!nombre) faltan.push('nombre')
  if (!unidadMedida) faltan.push('unidad de medida')
  if (!frecuencia) faltan.push('frecuencia')
  if (!tipoCalculo) faltan.push('tipo de cálculo')
  // Solo los MIR exigen medio; los gerenciales no lo tienen en la fuente (DECISIONES.md, opción (a))
  if (tipo === 'mir' && !medioVerificacion) faltan.push('medio de verificación')
  if (tipo === 'mir' && !nivel) faltan.push('nivel MIR')

  if (faltan.length > 0) {
    return error(422, 'datos_incompletos', `Campos obligatorios: ${faltan.join(', ')}`)
  }

  // Validar catálogos
  if (tipo !== 'mir' && tipo !== 'gerencial') return error(422, 'tipo_invalido', 'El tipo debe ser "mir" o "gerencial"')
  if (nivel && !NIVELES_MIR.includes(nivel as any)) return error(422, 'nivel_invalido', `Nivel inválido: ${nivel}`)
  if (!TIPOS_CALCULO.includes(tipoCalculo as any)) return error(422, 'calculo_invalido', `Tipo de cálculo inválido: ${tipoCalculo}`)
  if (!SENTIDOS_META.includes(sentidoMeta as any)) return error(422, 'sentido_invalido', `Sentido de meta inválido: ${sentidoMeta}`)
  if (tipoIndicador && !TIPOS_INDICADOR.includes(tipoIndicador as any)) return error(422, 'tipo_indicador_invalido', `Tipo de indicador inválido: ${tipoIndicador}`)
  if (origenMv && !ORIGENES_MV.includes(origenMv as any)) return error(422, 'origen_mv_invalido', `Origen MV inválido: ${origenMv}`)

  // Validar FK
  if (!(await gerenciaExiste(bd, gerenciaId))) return error(422, 'gerencia_no_existe', 'La gerencia no existe o no está activa')
  if (!(await frecuenciaExiste(bd, frecuencia))) return error(422, 'frecuencia_no_existe', `La frecuencia "${frecuencia}" no existe`)
  if (unidadId) {
    if (!UUID.test(unidadId)) return error(422, 'unidad_invalida', 'ID de unidad inválido')
    if (!(await unidadEsDeGerencia(bd, unidadId, gerenciaId))) {
      return error(422, 'unidad_de_otra_gerencia', 'La unidad no pertenece a la gerencia elegida')
    }
  }

  // Código único
  if (await codigoExiste(bd, codigo, editandoId)) {
    return error(409, 'codigo_duplicado', `Ya existe un indicador con el código "${codigo}"`)
  }

  return {
    gerenciaId, unidadId, codigo, tipo, nivel, numero, nombre, resumenNarrativo,
    tipoIndicador, unidadMedida, frecuencia, tipoCalculo, formula, numeradorDesc,
    denominadorDesc, denominadorFijo, acumulable, sentidoMeta, medioVerificacion,
    origenMv, supuestos, esIso, observacionesMir,
  }
}

// ── Respuesta estándar ──────────────────────────────────────────────────────

async function resultado(bd: BD, id: string, status = 200, extra: Record<string, unknown> = {}): Promise<Respuesta> {
  return { status, cuerpo: { indicador: await obtenerIndicadorCompleto(bd, id), ...extra } }
}

// ── Rutas ───────────────────────────────────────────────────────────────────

/** GET /api/admin/indicadores?gerencia_id=&nivel=&frecuencia=&estado=activo|inactivo&texto= */
export const listar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const q = s.url.searchParams
  const estado = q.get('estado')
  const gerencia = q.get('gerencia_id') ?? ''
  const indicadores = await listarIndicadoresAdmin(bd, {
    gerenciaId: UUID.test(gerencia) ? gerencia : undefined,
    nivel: q.get('nivel') ?? undefined,
    frecuencia: q.get('frecuencia') ?? undefined,
    activo: estado === 'activo' ? true : estado === 'inactivo' ? false : undefined,
    texto: q.get('texto') ?? '',
  })
  return { status: 200, cuerpo: { indicadores } }
}

/** GET /api/admin/indicadores/catalogo — gerencias, unidades, frecuencias, niveles para el formulario. */
export const catalogo = (bd: BD) => async (): Promise<Respuesta> =>
  ({ status: 200, cuerpo: await catalogoIndicadores(bd) })

/** GET /api/admin/indicadores/:id — detalle completo. */
export const detalle = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  if (!UUID.test(id)) return NO_ENCONTRADO
  const ind = await obtenerIndicadorCompleto(bd, id)
  return ind ? { status: 200, cuerpo: { indicador: ind } } : NO_ENCONTRADO
}

/** POST /api/admin/indicadores — alta de indicador (CA_3: visible para todos los de la gerencia). */
export const crear = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const d = await validar(bd, await s.json())
  if ('status' in d) return d

  const id = await bd.transaccion(async (tx) => {
    const id = await crearIndicador(tx, d)
    const despues = await obtenerIndicadorCompleto(tx, id)
    await auditar(tx, s, 'indicador_alta', id, { despues: foto(despues!) })
    return id
  })
  return resultado(bd, id, 201)
}

/** PUT /api/admin/indicadores/:id — edición (CA_6: con valores antes/después). */
export const editar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const antes = UUID.test(id) ? await obtenerIndicadorCompleto(bd, id) : undefined
  if (!antes) return NO_ENCONTRADO

  const d = await validar(bd, await s.json(), id)
  if ('status' in d) return d

  await bd.transaccion(async (tx) => {
    await actualizarIndicador(tx, id, d)
    const despues = await obtenerIndicadorCompleto(tx, id)
    await auditar(tx, s, 'indicador_edicion', id, { antes: foto(antes), despues: foto(despues!) })
  })
  return resultado(bd, id)
}

/** POST /api/admin/indicadores/:id/desactivar — CA_5: no aparece en ciclos nuevos, sí en historial. */
export const desactivar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const ind = UUID.test(id) ? await obtenerIndicadorCompleto(bd, id) : undefined
  if (!ind) return NO_ENCONTRADO
  if (!ind.activo) return resultado(bd, id)

  await bd.transaccion(async (tx) => {
    await cambiarActivoIndicador(tx, id, false)
    await auditar(tx, s, 'indicador_desactivado', id, { antes: foto(ind) })
  })
  return resultado(bd, id)
}

/** POST /api/admin/indicadores/:id/reactivar */
export const reactivar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const ind = UUID.test(id) ? await obtenerIndicadorCompleto(bd, id) : undefined
  if (!ind) return NO_ENCONTRADO
  if (ind.activo) return resultado(bd, id)

  await bd.transaccion(async (tx) => {
    await cambiarActivoIndicador(tx, id, true)
    await auditar(tx, s, 'indicador_reactivado', id, { antes: foto(ind) })
  })
  return resultado(bd, id)
}
