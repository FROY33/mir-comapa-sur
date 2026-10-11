// Consulta de indicadores con el filtro de gerencia (HU-R7-03 CA_5, RN_2). Quien llama pasa
// la gerencia de la SESIÓN, o null solo para el Administrador, que conserva el acceso global.
// Ninguna función de aquí recibe la gerencia de la petición.

import type { Ejecutor } from '../bd.js'

export interface IndicadorResumen {
  id: string
  codigo: string
  nombre: string
  tipo: 'mir' | 'gerencial'
  nivel: string | null
  numero: string | null
  frecuencia: string
  gerencia: { clave: string; nombre: string }
  unidad: string | null
}

interface Fila {
  id: string; codigo: string; nombre: string; tipo: IndicadorResumen['tipo']; nivel: string | null
  numero: string | null; frecuencia: string; gerencia_clave: string; gerencia_nombre: string; unidad: string | null
}

const COLUMNAS = `
  i.id, i.codigo, i.nombre, i.tipo, i.nivel, i.numero, i.frecuencia,
  g.clave AS gerencia_clave, g.nombre AS gerencia_nombre, u.nombre AS unidad
  FROM indicadores i
  JOIN gerencias g ON g.id = i.gerencia_id
  LEFT JOIN unidades u ON u.id = i.unidad_id`

const aResumen = (f: Fila): IndicadorResumen => ({
  id: f.id, codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, nivel: f.nivel, numero: f.numero,
  frecuencia: f.frecuencia, gerencia: { clave: f.gerencia_clave, nombre: f.gerencia_nombre }, unidad: f.unidad,
})

/**
 * Indicadores activos de una gerencia, o de todas si `gerenciaId` es null (Administrador).
 * `texto` busca en código y nombre, sin distinguir mayúsculas.
 */
export async function listarIndicadores(
  bd: Ejecutor, gerenciaId: string | null, texto = '',
): Promise<IndicadorResumen[]> {
  const filas = await bd.consultar<Fila>(
    `SELECT ${COLUMNAS}
      WHERE i.activo
        AND ($1::uuid IS NULL OR i.gerencia_id = $1)
        AND ($2 = '' OR (i.codigo || ' ' || i.nombre) ILIKE '%' || $2 || '%')
      ORDER BY g.clave, i.codigo`,
    [gerenciaId, texto.trim()],
  )
  return filas.map(aResumen)
}

/** Un indicador, solo si es de esa gerencia (o cualquiera, con null). Si no, undefined: no se dice si existe. */
export async function obtenerIndicador(
  bd: Ejecutor, id: string, gerenciaId: string | null,
): Promise<IndicadorResumen | undefined> {
  const [fila] = await bd.consultar<Fila>(
    `SELECT ${COLUMNAS} WHERE i.id = $1 AND ($2::uuid IS NULL OR i.gerencia_id = $2)`,
    [id, gerenciaId],
  )
  return fila && aResumen(fila)
}
