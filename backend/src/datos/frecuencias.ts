import type { Ejecutor } from '../bd.js'

export interface Frecuencia {
  clave: string
  nombre: string
  meses: number
  dias_habiles: number
}

export function listarFrecuencias(bd: Ejecutor): Promise<Frecuencia[]> {
  return bd.consultar<Frecuencia>('SELECT clave, nombre, meses, dias_habiles FROM frecuencias ORDER BY meses')
}
