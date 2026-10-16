// Auditoría de accesos bloqueados (S2-TEC-01): el 403 por rol, la página prohibida y el
// recurso de otra gerencia dejan un evento `acceso_bloqueado` en la bitácora. Un 401 no se
// audita: no hay usuario a quien atribuirlo. Del evento no se guarda cuerpo, cookies, query
// ni datos del recurso: solo quién, desde dónde, qué ruta y por qué.

import type { Ejecutor } from '../bd.js'
import { registrarEvento, type Rol } from './bitacora.js'

export type MotivoBloqueo = 'rol' | 'otra_gerencia'

export interface QuienBloqueado {
  usuarioId: string
  rol: Rol
  gerenciaId: string
}

export interface Bloqueo {
  metodo: string
  /** Ruta de API (sin query) o nombre de la página pedida. */
  ruta: string
  motivo: MotivoBloqueo
  ip?: string
}

/** Registra el bloqueo. Nunca lanza: si la bitácora falla, la petición sigue bloqueada igual. */
export async function auditarBloqueo(bd: Ejecutor, quien: QuienBloqueado, b: Bloqueo): Promise<void> {
  try {
    await registrarEvento(bd, {
      usuarioId: quien.usuarioId, rol: quien.rol, accion: 'acceso_bloqueado',
      entidad: 'acceso', entidadId: quien.usuarioId, ip: b.ip,
      detalle: { metodo: b.metodo, ruta: b.ruta, motivo: b.motivo, gerencia_id: quien.gerenciaId },
    })
  } catch {
    // sin bitácora no hay registro, pero el bloqueo ya ocurrió y la respuesta no cambia
  }
}

/** ¿Existe el indicador en otra gerencia distinta a la de la sesión? (404 que sí es un bloqueo.) */
export async function esDeOtraGerencia(bd: Ejecutor, indicadorId: string, gerenciaId: string): Promise<boolean> {
  const [fila] = await bd.consultar<{ ajeno: boolean }>(
    'SELECT gerencia_id <> $2 AS ajeno FROM indicadores WHERE id = $1', [indicadorId, gerenciaId])
  return fila?.ajeno === true
}
