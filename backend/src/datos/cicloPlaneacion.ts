// Ciclo de planeación de metas (HU-R4-01, HU-R4-02). La fase no se guarda: se calcula de las
// fechas del ciclo y de `cerrado_manual` para un día dado. Las fechas son días calendario en la zona
// de la base, como en el resto del sistema.

import type { Ejecutor } from '../bd.js'

export type FaseCiclo = 'programado' | 'captura' | 'fuera_de_plazo' | 'revision' | 'cerrado'

export interface CicloPlaneacion {
  inicio_captura: string      // 'AAAA-MM-DD'
  fin_captura: string
  inicio_revision: string
  cerrado_manual: boolean
}

/** Fases en las que el Enlace ve la sección de planeación: «ciclo abierto para el Enlace». */
export const FASES_ABIERTAS: readonly FaseCiclo[] = ['captura', 'fuera_de_plazo', 'revision']

/** Las fechas ISO se comparan como texto: el orden alfabético es el cronológico. */
export function faseCiclo(c: CicloPlaneacion, hoy: string): FaseCiclo {
  if (c.cerrado_manual) return 'cerrado'
  if (hoy < c.inicio_captura) return 'programado'
  if (hoy <= c.fin_captura) return 'captura'
  if (hoy < c.inicio_revision) return 'fuera_de_plazo'
  return 'revision'
}

export interface CicloVigente {
  id: string
  ejercicio: number
  inicio_captura: string
  fin_captura: string
  inicio_revision: string
  fase: FaseCiclo
}

/** Hoy en la hora de la base (America/Monterrey), no la del servidor. */
export async function hoyEnBase(bd: Ejecutor): Promise<string> {
  const [f] = await bd.consultar<{ hoy: string }>('SELECT current_date::text AS hoy')
  return f!.hoy
}

/** El ciclo no cerrado más reciente con su fase, o `null` si no hay ninguno. */
export async function cicloVigente(bd: Ejecutor, hoy?: string): Promise<CicloVigente | null> {
  const dia = hoy ?? await hoyEnBase(bd)
  const [c] = await bd.consultar<CicloPlaneacion & { id: string; ejercicio: number }>(
    `SELECT id, ejercicio, inicio_captura, fin_captura, inicio_revision, cerrado_manual
       FROM ciclos_planeacion WHERE NOT cerrado_manual ORDER BY ejercicio DESC LIMIT 1`)
  if (!c) return null
  return {
    id: c.id, ejercicio: c.ejercicio, inicio_captura: c.inicio_captura, fin_captura: c.fin_captura,
    inicio_revision: c.inicio_revision, fase: faseCiclo(c, dia),
  }
}

export interface CicloHistorial {
  ejercicio: number
  inicio_captura: string
  fin_captura: string
  inicio_revision: string
  fase: FaseCiclo
  abierto_por: string | null   // nombre de quien lo abrió; `null` si lo creó la carga inicial
  abierto_at: string
}

/** Todos los ciclos, del ejercicio más reciente al más antiguo, con su fase y quién los abrió (HU-R4-01 CA_6). */
export async function historialCiclos(bd: Ejecutor, hoy: string): Promise<CicloHistorial[]> {
  const filas = await bd.consultar<CicloPlaneacion & { ejercicio: number; abierto_por: string | null; abierto_at: string }>(
    `SELECT c.ejercicio, c.inicio_captura, c.fin_captura, c.inicio_revision, c.cerrado_manual,
            u.nombre AS abierto_por, c.abierto_at
       FROM ciclos_planeacion c LEFT JOIN usuarios u ON u.id = c.abierto_por
      ORDER BY c.ejercicio DESC`)
  return filas.map((c) => ({
    ejercicio: c.ejercicio, inicio_captura: c.inicio_captura, fin_captura: c.fin_captura,
    inicio_revision: c.inicio_revision, fase: faseCiclo(c, hoy), abierto_por: c.abierto_por, abierto_at: c.abierto_at,
  }))
}
