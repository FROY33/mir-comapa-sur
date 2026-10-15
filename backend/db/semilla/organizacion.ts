// Organización, gerencias y unidades de la carga (TEC-04). Compartido por la carga completa
// (cargar.ts) y por el modo --catalogo (catalogo.ts), que también deja al día las gerencias:
// el catálogo institucional activa Gerencia General.

import type { Ejecutor } from '../../src/bd.js'
import { booleano, leerCsv, vacioANulo } from './csv.js'

/** La organización es una sola en S1; existe para no migrar de forma destructiva después. */
export const ORGANIZACION = 'COMAPA Sur'

export async function cargarOrganizacion(tx: Ejecutor): Promise<string> {
  const [org] = await tx.consultar<{ id: string }>(
    `INSERT INTO organizaciones (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`, [ORGANIZACION])
  if (org === undefined) throw new Error('No se pudo registrar la organización')
  return org.id
}

/** Upsert de gerencias.csv; devuelve clave → id. */
export async function cargarGerencias(tx: Ejecutor, organizacionId: string) {
  const gerencias = leerCsv('gerencias.csv')
  const idGerencia = new Map<string, string>()
  for (const g of gerencias) {
    const [fila] = await tx.consultar<{ id: string }>(
      `INSERT INTO gerencias (organizacion_id, clave, nombre, titular_nombre, titular_cargo, activo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organizacion_id, clave) DO UPDATE
         SET nombre = EXCLUDED.nombre, titular_nombre = EXCLUDED.titular_nombre,
             titular_cargo = EXCLUDED.titular_cargo, activo = EXCLUDED.activo
       RETURNING id`,
      [organizacionId, g.clave, g.nombre, vacioANulo(g.titular_nombre), vacioANulo(g.titular_cargo), booleano(g.activo)])
    if (fila === undefined) throw new Error(`Gerencia ${g.clave}: sin id`)
    idGerencia.set(g.clave!, fila.id)
  }
  return { idGerencia, filas: gerencias.length }
}

/** Upsert de unidades.csv; devuelve «gerencia||nombre» → id. */
export async function cargarUnidades(tx: Ejecutor, idGerencia: Map<string, string>) {
  const unidades = leerCsv('unidades.csv')
  const idUnidad = new Map<string, string>()
  for (const u of unidades) {
    const gerenciaId = idGerencia.get(u.gerencia_clave!)
    if (gerenciaId === undefined) throw new Error(`Unidad "${u.nombre}": gerencia ${u.gerencia_clave} desconocida`)
    const [fila] = await tx.consultar<{ id: string }>(
      `INSERT INTO unidades (gerencia_id, nombre, es_coord_general, activo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (gerencia_id, nombre) DO UPDATE
         SET es_coord_general = EXCLUDED.es_coord_general, activo = EXCLUDED.activo
       RETURNING id`,
      [gerenciaId, u.nombre, booleano(u.es_coord_general), booleano(u.activo)])
    if (fila === undefined) throw new Error(`Unidad ${u.nombre}: sin id`)
    idUnidad.set(`${u.gerencia_clave}||${u.nombre}`, fila.id)
  }
  return { idUnidad, filas: unidades.length }
}
