// Cálculo del cumplimiento de un reporte (HU-R4-11 RN_3). Función pura: no toca la base.
// La consulta que arma sus entradas es `datos/cumplimiento.ts`.
//
// Reglas del RQM:
//   - No acumulable: avance del periodo contra meta del periodo.
//   - Acumulable: suma de avances contra suma de metas de los periodos transcurridos del ejercicio.
//   - Fracción: el avance del periodo es numerador / denominador × 100.
//   Cumplimiento = avance / meta × 100, sin tope (un 120 % es válido; el semáforo es de otro ticket).
//
// La configuración (tipo de cálculo, acumulable, frecuencia) viene de la FOTO del reporte y de la versión del
// indicador a la que apunta la meta (S2-TEC-01),
// nunca del catálogo vigente: un cambio programado (HU-R4-11 CA_4) no reescribe resultados anteriores.
//
// Cuando el cálculo no se puede hacer, el resultado es `calculable: false` con un motivo; nunca 0 ni
// NaN. «Sin dato» y «0 %» son cosas distintas (HU-R1-05 RN_5: semáforo `na`).

export type TipoCalculo = 'valor_directo' | 'fraccion'

/** Un periodo reportado del ejercicio, con la foto de su propio reporte. */
export interface AvancePeriodo {
  numero: number
  tipoCalculo: TipoCalculo
  avance: number | null
  numerador: number | null
  denominador: number | null
}

/** Una fila de `metas_periodo` de la meta validada. */
export interface MetaPeriodo {
  numero: number
  meta_periodo: number | null
}

export interface EntradaCumplimiento {
  /** Número del periodo que se evalúa (el del reporte). */
  numero: number
  /** Foto del reporte evaluado. */
  acumulable: boolean
  frecuencia: string
  sentidoMeta: 'ascendente' | 'descendente'
  /** Reportes del indicador en el ejercicio, del periodo 1 al evaluado (incluido). Los periodos sin reporte no aparecen. */
  periodos: AvancePeriodo[]
  /** `metas_periodo` de la meta vigente en `meta_validada` del ejercicio; `null` si no hay. */
  metas: MetaPeriodo[] | null
  /** Frecuencia de la versión del indicador con que se creó la meta; si difiere de la del reporte los números de periodo no son comparables. */
  frecuenciaMeta: string | null
}

export type MotivoNoCalculable =
  | 'sin_meta_validada'        // no hay meta en meta_validada para el ejercicio
  | 'frecuencia_distinta'      // la meta se hizo con otra frecuencia que el reporte
  | 'meta_periodo_ausente'     // falta (o está vacía) la meta de algún periodo que cuenta
  | 'meta_cero'                // meta del periodo (o suma de metas) en 0: no se divide
  | 'avance_ausente'           // el periodo evaluado no tiene avance capturado
  | 'numerador_ausente'
  | 'denominador_ausente'      // ausente o 0
  | 'sentido_descendente'      // el RQM no define la fórmula; pregunta abierta al PO

export type ResultadoCumplimiento =
  | { calculable: true; cumplimiento: number; avance: number; meta: number }
  | { calculable: false; motivo: MotivoNoCalculable }

const noCalculable = (motivo: MotivoNoCalculable): ResultadoCumplimiento => ({ calculable: false, motivo })

type AvanceResuelto = { ok: true; valor: number } | { ok: false; motivo: MotivoNoCalculable }

/** Avance de un periodo: el capturado, o numerador / denominador × 100 si su foto es fracción. */
export function avanceDelPeriodo(p: AvancePeriodo): AvanceResuelto {
  if (p.tipoCalculo === 'fraccion') {
    if (p.numerador === null) return { ok: false, motivo: 'numerador_ausente' }
    if (p.denominador === null || p.denominador === 0) return { ok: false, motivo: 'denominador_ausente' }
    return { ok: true, valor: (p.numerador / p.denominador) * 100 }
  }
  return p.avance === null ? { ok: false, motivo: 'avance_ausente' } : { ok: true, valor: p.avance }
}

/**
 * Cumplimiento del periodo `entrada.numero`, en porcentaje (sin redondear ni topar).
 *
 * Periodos transcurridos (acumulable): del 1 al evaluado. Cada uno aporta su meta (obligatoria: si falta
 * alguna, no es calculable). Su avance sale de su propio reporte; un periodo sin reporte o con avance
 * incompleto suma 0 (no se entregó), pero el periodo evaluado sí debe tener avance completo.
 */
export function calcularCumplimiento(entrada: EntradaCumplimiento): ResultadoCumplimiento {
  if (entrada.metas === null) return noCalculable('sin_meta_validada')
  if (entrada.frecuenciaMeta !== entrada.frecuencia) return noCalculable('frecuencia_distinta')
  if (entrada.sentidoMeta === 'descendente') return noCalculable('sentido_descendente')

  const evaluado = entrada.periodos.find((p) => p.numero === entrada.numero)
  const propio: AvanceResuelto = evaluado ? avanceDelPeriodo(evaluado) : { ok: false, motivo: 'avance_ausente' }
  if (!propio.ok) return noCalculable(propio.motivo)

  const numeros = entrada.acumulable
    ? Array.from({ length: entrada.numero }, (_, i) => i + 1)
    : [entrada.numero]

  let meta = 0
  let avance = 0
  for (const n of numeros) {
    const m = entrada.metas.find((x) => x.numero === n)?.meta_periodo ?? null
    if (m === null) return noCalculable('meta_periodo_ausente')
    meta += m
    if (n === entrada.numero) { avance += propio.valor; continue }
    const previo = entrada.periodos.find((p) => p.numero === n)
    const r = previo ? avanceDelPeriodo(previo) : undefined
    if (r?.ok) avance += r.valor
  }

  if (meta === 0) return noCalculable('meta_cero')
  return { calculable: true, cumplimiento: (avance / meta) * 100, avance, meta }
}
