// Ciclos de reporte (HU-R3-01): el periodo que toca abrir por frecuencia y sus reportes.
//
// Un periodo es la tabla `periodos_reporte` (los «ciclos» del RQM). Se abre cuando llega su
// `abre_captura`, al día siguiente de que termina. Su fecha límite es el n-ésimo día hábil
// desde ahí, con n = `frecuencias.dias_habiles` en el momento de abrirlo: se guarda y no se
// recalcula, así que un cambio de ventana solo afecta aperturas futuras (CA_5).
//
// Supuestos, a confirmar con el Product Owner:
//   - RN_2 se contradice («un ciclo abierto por frecuencia» y «el siguiente se abre aunque el
//     anterior siga abierto»). Se aplica la segunda: abrir un periodo no cierra el anterior,
//     que sigue abierto hasta que el Administrador lo cierre (HU-R3-05).
//   - Días hábiles de lunes a viernes, sin calendario de festivos (DECISIONES.md, pregunta 8).
//   - Solo se abre el periodo más reciente que ya toca por frecuencia, y solo si su ventana sigue
//     corriendo: al estrenar el sistema a mitad de año no se abren periodos cuya captura ya cerró
//     (nacerían vencidos).

import type { Ejecutor } from '../bd.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
               'septiembre', 'octubre', 'noviembre', 'diciembre']
const PREFIJO: Record<string, string> = { bimestral: 'B', trimestral: 'T', cuatrimestral: 'C', semestral: 'S' }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (anio: number, mes0: number, dia: number) => new Date(Date.UTC(anio, mes0, dia))
const esHabil = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

/** El n-ésimo día hábil contando desde `desde`, inclusive. */
export function diaHabil(desde: Date, n: number): Date {
  const d = new Date(desde)
  let vistos = esHabil(d) ? 1 : 0
  while (vistos < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (esHabil(d)) vistos++
  }
  return d
}

export interface Periodo {
  frecuencia: string; ejercicio: number; numero: number; etiqueta: string
  inicio_periodo: string; fin_periodo: string; abre_captura: string; fecha_limite: string
}

/** El periodo `numero` del ejercicio, con la ventana de `diasHabiles` días hábiles. */
export function calcularPeriodo(frecuencia: string, meses: number, ejercicio: number, numero: number, diasHabiles: number): Periodo {
  const inicio = utc(ejercicio, (numero - 1) * meses, 1)
  const fin = utc(ejercicio, numero * meses, 0)
  const abre = utc(ejercicio, numero * meses, 1)
  const etiqueta = frecuencia === 'mensual' ? `${MESES[inicio.getUTCMonth()]}-${ejercicio}`
    : frecuencia === 'anual' ? String(ejercicio)
    : `${PREFIJO[frecuencia]}${numero}-${ejercicio}`
  return {
    frecuencia, ejercicio, numero, etiqueta,
    inicio_periodo: iso(inicio), fin_periodo: iso(fin), abre_captura: iso(abre),
    fecha_limite: iso(diaHabil(abre, diasHabiles)),
  }
}

/** El periodo más reciente de la frecuencia cuya captura ya abrió en `hoy` ('AAAA-MM-DD'). */
export function periodoQueToca(frecuencia: string, meses: number, diasHabiles: number, hoy: string): Periodo {
  const anio = Number(hoy.slice(0, 4))
  const candidatos = [anio, anio - 1].flatMap((ej) =>
    Array.from({ length: 12 / meses }, (_, k) => calcularPeriodo(frecuencia, meses, ej, k + 1, diasHabiles)))
  return candidatos.filter((p) => p.abre_captura <= hoy).sort((a, b) => b.abre_captura.localeCompare(a.abre_captura))[0]!
}

export interface Apertura { frecuencia: string; etiqueta: string; fecha_limite: string; periodo_nuevo: boolean; reportes_creados: number }

/**
 * Abre el periodo que toca de cada frecuencia y genera un reporte `pendiente_carga` por cada
 * indicador activo de esa frecuencia (CA_3, RN_3). Idempotente: un periodo existente conserva su
 * fecha límite y un reporte existente no se duplica, así que correrlo de nuevo no cambia nada.
 * Un indicador sin meta validada genera su reporte igual (RN_4).
 */
export async function abrirCiclos(tx: Ejecutor, hoy: string): Promise<Apertura[]> {
  const frecuencias = await tx.consultar<{ clave: string; meses: number; dias_habiles: number }>(
    'SELECT clave, meses, dias_habiles FROM frecuencias ORDER BY meses')
  const resultado: Apertura[] = []
  for (const f of frecuencias) {
    const p = periodoQueToca(f.clave, f.meses, f.dias_habiles, hoy)
    const [existente] = await tx.consultar('SELECT 1 FROM periodos_reporte WHERE frecuencia = $1 AND ejercicio = $2 AND numero = $3',
      [p.frecuencia, p.ejercicio, p.numero])
    if (!existente && p.fecha_limite < hoy) continue
    const [nuevo] = await tx.consultar<{ id: string }>(
      `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (frecuencia, ejercicio, numero) DO NOTHING RETURNING id`,
      [p.frecuencia, p.ejercicio, p.numero, p.etiqueta, p.inicio_periodo, p.fin_periodo, p.abre_captura, p.fecha_limite])
    const [periodo] = await tx.consultar<{ id: string; estado: string; fecha_limite: string }>(
      'SELECT id, estado, fecha_limite FROM periodos_reporte WHERE frecuencia = $1 AND ejercicio = $2 AND numero = $3',
      [p.frecuencia, p.ejercicio, p.numero])
    // Un periodo que el Administrador ya cerró no se reabre ni recibe reportes nuevos
    if (periodo!.estado !== 'abierto') continue
    const creados = await tx.consultar(
      `INSERT INTO reportes (indicador_id, periodo_id)
       SELECT i.id, $1 FROM indicadores i WHERE i.activo AND i.frecuencia = $2
       ON CONFLICT (indicador_id, periodo_id) DO NOTHING RETURNING id`,
      [periodo!.id, f.clave])
    resultado.push({
      frecuencia: f.clave, etiqueta: p.etiqueta, fecha_limite: periodo!.fecha_limite,
      periodo_nuevo: nuevo !== undefined, reportes_creados: creados.length,
    })
  }
  return resultado
}

/**
 * El periodo abierto más reciente de cada frecuencia, con su fecha límite, para los tres
 * dashboards (CA_6). Como abrir uno no cierra el anterior (RN_2, supuesto), se dice además
 * cuántos periodos anteriores de la misma frecuencia siguen abiertos.
 */
export function periodosAbiertos(bd: Ejecutor) {
  return bd.consultar<{ frecuencia: string; etiqueta: string; abre_captura: string; fecha_limite: string; anteriores_abiertos: number }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (frecuencia) frecuencia, etiqueta, abre_captura, fecha_limite,
              (count(*) OVER (PARTITION BY frecuencia) - 1)::int AS anteriores_abiertos
         FROM periodos_reporte
        WHERE estado = 'abierto' AND abre_captura <= current_date
        ORDER BY frecuencia, abre_captura DESC) ultimos
      ORDER BY fecha_limite, frecuencia`)
}
