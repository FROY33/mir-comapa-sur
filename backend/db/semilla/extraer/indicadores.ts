// extraer/indicadores.ts — Indicadores MIR y gerenciales, su jerarquía, y el catálogo de 193.
// Parte del extractor de TEC-04 (../extraer.ts); se ejecuta una vez al importarse.

import { NIVELES, FRECUENCIAS, TIPOS_INDICADOR, claveGerencia, traducir } from '../mapeos.js'
import { src, colar } from './base.js'

// ── 4. Indicadores (MIR + gerenciales en una sola tabla, como el esquema) ────
export const nivelesSinTraduccion = new Set<string>()
export const frecuenciasSinTraduccion = new Set<string>()
export const tiposSinTraduccion = new Set<string>()

export interface FilaIndicador extends Record<string, unknown> {
  codigo: string; gerencia_clave: string; numero: string; frecuencia: string
}

export const indicadoresMir: FilaIndicador[] = src.operativos.map(x => {
  const tieneDenominador = Boolean(x.denominador)
  return {
    codigo: String(x.id),                                 // ← CLAVE NATURAL · indicadores.codigo (UNIQUE)
    tipo: 'mir',                                          // indicadores.tipo
    gerencia_clave: claveGerencia(x.gerencia),
    unidad_nombre: x.unidadResponsable ? String(x.unidadResponsable).trim() : '',
    parent_codigo: '',                                    // se calcula abajo
    nivel: traducir(NIVELES, x.nivel, nivelesSinTraduccion),
    numero: x.numeroIndicador ? String(x.numeroIndicador) : '',
    nombre: x.nombreIndicador,
    resumen_narrativo: x.resumenNarrativo,
    tipo_indicador: traducir(TIPOS_INDICADOR, x.tipoIndicador, tiposSinTraduccion),
    unidad_medida: x.unidadMedida,
    frecuencia: traducir(FRECUENCIAS, x.frecuenciaMedicion, frecuenciasSinTraduccion),
    tipo_calculo: tieneDenominador ? 'fraccion' : 'valor_directo',
    formula: '',                                          // metodoCalculo solo existe en el catálogo de 193
    numerador_desc: x.numerador,
    denominador_desc: x.denominador,
    denominador_fijo: x.denominadorFijo ? x.denomFijoVal : '',
    acumulable: false,                                    // no está en el prototipo; default del esquema
    sentido_meta: 'ascendente',                           // idem; DECISIONES.md pregunta 24e
    medio_verificacion: x.medioVerificacion,
    origen_mv: '',                                        // solo existe en el catálogo de 193
    supuestos: x.supuestos,
    es_iso: Boolean(x.iso),                               // indicadores.es_iso
    iso_codigo: x.iso || '',                              // ← el esquema no lo guarda. Ver INCONSISTENCIAS.md §13
    observaciones_mir: x.observacionesMIR,
    activo: true,
    meta_anual_prototipo: x.metaAnual ?? '',              // METAS está fuera de S1; se conserva como insumo
    linea_base_prototipo: x.lineaBase ?? '',
  }
})

export const indicadoresGerenciales: FilaIndicador[] = src.gerenciales.map(x => ({
  codigo: String(x.id),                                   // ← CLAVE NATURAL
  tipo: 'gerencial',
  gerencia_clave: claveGerencia(x.gerencia),
  unidad_nombre: x.area ? String(x.area).trim() : '',
  parent_codigo: '',
  nivel: '',                                              // CHECK (tipo = 'gerencial' OR nivel IS NOT NULL)
  numero: '',
  nombre: x.nombreIndicador,
  resumen_narrativo: '',
  tipo_indicador: '',
  unidad_medida: x.unidadMedida,
  frecuencia: traducir(FRECUENCIAS, x.frecuenciaMedicion, frecuenciasSinTraduccion),
  tipo_calculo: x.tieneDenominador ? 'fraccion' : 'valor_directo',
  formula: '', numerador_desc: x.numerador, denominador_desc: x.denominador ?? '',
  denominador_fijo: '', acumulable: false, sentido_meta: 'ascendente',
  medio_verificacion: '', origen_mv: '', supuestos: '',
  es_iso: false, iso_codigo: '', observaciones_mir: '', activo: true,
  meta_anual_prototipo: '', linea_base_prototipo: '',
}))

// indicadores.parent_id — jerarquía por numeroIndicador ('1.1.1' cuelga de '1.1')
// dentro de la misma gerencia. El esquema la modela; el prototipo no la trae explícita.
export const porNumero = new Map<string, string[]>()
for (const i of indicadoresMir) {
  if (!i.numero) continue
  const llave = `${i.gerencia_clave}||${i.numero}`
  if (!porNumero.has(llave)) porNumero.set(llave, [])
  porNumero.get(llave)!.push(i.codigo)
}
export const numerosAmbiguos = [...porNumero.entries()].filter(([, c]) => c.length > 1)
export const huerfanosJerarquia: string[] = []

// La jerarquía NO es «quitar el último segmento»: el prototipo numera el Propósito
// como '1', el Componente como '1.2.1' y sus Actividades como '1.2.2', '1.2.3'…
// — las actividades son hermanas del componente, no sus hijas por prefijo.
//   actividad  a.b.c  -> componente a.b.1
//   componente a.b.1  -> propósito   a
// Regla inferida de la estructura observada, no confirmada por el RQM.
// Ver INCONSISTENCIAS.md §15.
export function numeroDelPadre(nivel: string, numero: string): string | null {
  const [a, b] = numero.split('.')
  const segmentos = numero.split('.').length
  if (a === undefined) return null
  if (nivel === 'actividad' && segmentos === 3 && b !== undefined) return `${a}.${b}.1`
  if (nivel === 'componente' && segmentos === 3) return a
  return null;                                            // propósito, fin, o numeración fuera de patrón
}

for (const i of indicadoresMir) {
  if (!i.numero) continue
  const padre = numeroDelPadre(String(i.nivel), String(i.numero))
  if (padre === null) continue
  if (padre === i.numero) continue;                       // un componente a.b.1 no es su propio padre
  const candidatos = porNumero.get(`${i.gerencia_clave}||${padre}`)
  const unico = candidatos?.length === 1 ? candidatos[0] : undefined
  if (unico !== undefined) i.parent_codigo = unico
  else huerfanosJerarquia.push(`${i.codigo} nivel=${i.nivel} numero=${i.numero} (busca ${i.gerencia_clave} ${padre})`)
}

export const filasIndicadores = [...indicadoresMir, ...indicadoresGerenciales]
  .sort((a, b) => colar(a.codigo, b.codigo))

// ── 5. Catálogo MIR de 193 (esquema propio, no empalma; §3) ─────────────────
export const filasCatalogo193 = src.catalogoMir.map(x => ({
  codigo: String(x.id),                                   // ← CLAVE NATURAL (espacio de IDs propio)
  gerencia_clave: claveGerencia(x.gerencia),
  orden: x.orden,
  nivel: traducir(NIVELES, x.nivel, nivelesSinTraduccion),
  nombre: x.denominacionIndicador,
  objetivo: x.objetivo,
  formula: x.metodoCalculo,
  numerador_desc: x.numerador,
  denominador_desc: x.denominador,
  tipo_calculo: x.tieneDenominador ? 'fraccion' : 'valor_directo',
  unidad_medida: x.unidadMedida,
  frecuencia: traducir(FRECUENCIAS, x.frecuenciaMedicion, frecuenciasSinTraduccion),
  origen_mv: x.medioVerificacionTipo ? String(x.medioVerificacionTipo).toLowerCase() : '',
  medio_verificacion: x.medioVerificacionNombre,
  medio_verificacion_fuente: x.medioVerificacionFuente,
  supuestos: x.supuestos,
}))
  .sort((a, b) => colar(a.codigo, b.codigo))
