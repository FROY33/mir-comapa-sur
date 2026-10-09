// Bitácora (AUDIT_LOG): solo se inserta y se lee; la base rechaza UPDATE y DELETE.

import type { Ejecutor } from '../bd.js'

export type Rol = 'admin' | 'revisor' | 'enlace'

export interface Evento {
  usuarioId?: string          // sin usuario = acción del sistema (entonces tampoco hay rol)
  rol?: Rol
  accion: string
  entidad: string
  entidadId: string
  indicadorId?: string
  estadoAnterior?: string
  estadoNuevo?: string
  comentario?: string
  detalle?: unknown
  ip?: string
}

export interface EventoGuardado {
  id: string                  // bigint: pg lo entrega como texto para no perder precisión
  usuario_id: string | null
  rol: Rol | null
  accion: string
  entidad: string
  entidad_id: string
  detalle: unknown
  created_at: Date
}

export async function registrarEvento(bd: Ejecutor, e: Evento): Promise<string> {
  const [fila] = await bd.consultar<{ id: string }>(
    `INSERT INTO bitacora (usuario_id, rol, accion, entidad, entidad_id, indicador_id,
                           estado_anterior, estado_nuevo, comentario, detalle, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [e.usuarioId ?? null, e.rol ?? null, e.accion, e.entidad, e.entidadId, e.indicadorId ?? null,
     e.estadoAnterior ?? null, e.estadoNuevo ?? null, e.comentario ?? null,
     e.detalle === undefined ? null : JSON.stringify(e.detalle), e.ip ?? null],
  )
  return fila!.id
}

export function listarEventos(bd: Ejecutor, entidad: string, entidadId: string): Promise<EventoGuardado[]> {
  return bd.consultar<EventoGuardado>(
    `SELECT id, usuario_id, rol, accion, entidad, entidad_id, detalle, created_at
       FROM bitacora
      WHERE entidad = $1 AND entidad_id = $2
      ORDER BY created_at, id`,
    [entidad, entidadId],
  )
}
