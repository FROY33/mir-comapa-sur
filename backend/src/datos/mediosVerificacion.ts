// Catálogo de medios de verificación — mantenimiento del Administrador (S2-TEC-03, ticket 4).
// La lectura que alimenta el <select> del formulario de indicadores sigue en datos/indicadoresAdmin.ts
// (catalogoIndicadores, solo activos); aquí vive el CRUD del catálogo como entidad propia.

import type { Ejecutor } from '../bd.js'

export interface MedioVerificacion {
  id: string
  nombre: string
  activo: boolean
  created_at: string
  updated_at: string
}

export async function listarMedios(
  bd: Ejecutor, filtros: { activo?: boolean; texto?: string } = {},
): Promise<MedioVerificacion[]> {
  return bd.consultar<MedioVerificacion>(
    `SELECT id, nombre, activo, created_at, updated_at
       FROM medios_verificacion
      WHERE ($1::boolean IS NULL OR activo = $1)
        AND ($2 = '' OR nombre ILIKE '%' || $2 || '%')
      ORDER BY nombre`,
    [filtros.activo ?? null, (filtros.texto ?? '').trim()],
  )
}

export async function obtenerMedio(bd: Ejecutor, id: string): Promise<MedioVerificacion | undefined> {
  const [fila] = await bd.consultar<MedioVerificacion>(
    `SELECT id, nombre, activo, created_at, updated_at FROM medios_verificacion WHERE id = $1`, [id])
  return fila
}

/** CA_2 (del catálogo): mismo criterio de la base (medio_normalizado) para no dejar pasar un casi-duplicado. */
export async function nombreNormalizadoExiste(bd: Ejecutor, nombre: string, excepto?: string): Promise<boolean> {
  const [fila] = await bd.consultar(
    `SELECT 1 FROM medios_verificacion
      WHERE medio_normalizado(nombre) = medio_normalizado($1) AND ($2::uuid IS NULL OR id <> $2)`,
    [nombre, excepto ?? null],
  )
  return fila !== undefined
}

export async function crearMedio(bd: Ejecutor, nombre: string): Promise<string> {
  const [fila] = await bd.consultar<{ id: string }>(
    `INSERT INTO medios_verificacion (nombre) VALUES ($1) RETURNING id`, [nombre])
  return fila!.id
}

export async function renombrarMedio(bd: Ejecutor, id: string, nombre: string): Promise<void> {
  await bd.consultar(`UPDATE medios_verificacion SET nombre = $2 WHERE id = $1`, [id, nombre])
}

export async function cambiarActivoMedio(bd: Ejecutor, id: string, activo: boolean): Promise<void> {
  await bd.consultar(`UPDATE medios_verificacion SET activo = $2 WHERE id = $1`, [id, activo])
}

/** Indicadores que hoy usan este medio: se muestran en el detalle y van en la bitácora al desactivar. */
export async function indicadoresQueUsanMedio(
  bd: Ejecutor, id: string,
): Promise<{ id: string; codigo: string; nombre: string }[]> {
  return bd.consultar(
    `SELECT id, codigo, nombre FROM indicadores WHERE medio_verificacion_id = $1 ORDER BY codigo`, [id])
}
