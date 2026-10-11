// Sesiones en servidor (HU-R7-01). El token viaja en una cookie HttpOnly y en la base
// solo se guarda su sha256: un volcado de la tabla no permite suplantar a nadie.
//
// RN_2: la sesión expira a las 8 horas de inactividad y se renueva en cada petición
// autenticada. El reloj lo pone PostgreSQL con now(), no Node.

import { createHash, randomBytes } from 'node:crypto'
import type { BD, Ejecutor } from '../bd.js'

export const HORAS_INACTIVIDAD = 8
export const COOKIE_SESION = 'comapa_sesion'
/**
 * Cookie acompañante con el perfil para mostrar: nombre, rol, gerencia, unidad.
 * NO es una credencial y no sustituye al token — existe para que el frontend sepa
 * de forma síncrona a quién pintar, sin tener que esperar una petición. Alterarla
 * solo cambia lo que ese navegador muestra: toda decisión de autorización se toma
 * en el servidor contra el token HttpOnly.
 */
export const COOKIE_PERFIL = 'comapa_perfil'

export interface SesionActiva {
  sesionId: string
  usuarioId: string
  rol: 'admin' | 'revisor' | 'enlace'
  /** De usuarios, nunca de la petición: decide qué datos ve (HU-R7-03 RN_2). */
  gerenciaId: string
  nombre: string
  email: string
  gerenciaClave: string
  gerenciaNombre: string
  unidadNombre: string
  debeCambiarPassword: boolean
  expiraAt: Date
}

/** 32 bytes al azar en base64url: 256 bits de entropía, seguro para un identificador de sesión. */
const nuevoToken = () => randomBytes(32).toString('base64url')
const hashear = (token: string) => createHash('sha256').update(token).digest('hex')

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

/** Abre una sesión y devuelve el token en claro, que solo existe en esta respuesta. */
export async function crear(bd: Ejecutor, usuarioId: string, cliente: DatosCliente = {}): Promise<string> {
  const token = nuevoToken()
  await bd.consultar(
    `INSERT INTO sesiones (usuario_id, token_hash, expira_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5)`,
    [usuarioId, hashear(token), HORAS_INACTIVIDAD, cliente.ip ?? null, recortarUserAgent(cliente.userAgent)],
  )
  return token
}

/**
 * Valida el token de una cookie y, de paso, corre la expiración hacia adelante (RN_2).
 * Una sola sentencia: validar y renovar no pueden separarse sin abrir una carrera.
 * Devuelve null si el token no existe, está revocado o ya expiró.
 */
export async function consultarYRenovar(bd: Ejecutor, token: string | undefined): Promise<SesionActiva | null> {
  if (!token) return null
  const [fila] = await bd.consultar<{
    sesion_id: string; usuario_id: string; rol: SesionActiva['rol']; gerencia_id: string; nombre: string; email: string
    gerencia_clave: string; gerencia_nombre: string; unidad_nombre: string
    debe_cambiar_password: boolean; expira_at: Date
  }>(
    `UPDATE sesiones s
        SET expira_at = now() + make_interval(hours => $2), ultimo_uso_at = now()
       FROM usuarios u
       JOIN gerencias g ON g.id = u.gerencia_id
       JOIN unidades  n ON n.id = u.unidad_id
      WHERE s.token_hash = $1
        AND s.revocada_at IS NULL
        AND s.expira_at > now()
        AND u.id = s.usuario_id
        AND u.activo
     RETURNING s.id AS sesion_id, u.id AS usuario_id, u.rol, u.gerencia_id, u.nombre, u.email::text AS email,
               g.clave AS gerencia_clave, g.nombre AS gerencia_nombre, n.nombre AS unidad_nombre,
               u.debe_cambiar_password, s.expira_at`,
    [hashear(token), HORAS_INACTIVIDAD],
  )
  if (!fila) return null
  return {
    sesionId: fila.sesion_id,
    usuarioId: fila.usuario_id,
    rol: fila.rol,
    gerenciaId: fila.gerencia_id,
    nombre: fila.nombre,
    email: fila.email,
    gerenciaClave: fila.gerencia_clave,
    gerenciaNombre: fila.gerencia_nombre,
    unidadNombre: fila.unidad_nombre,
    debeCambiarPassword: fila.debe_cambiar_password,
    expiraAt: fila.expira_at,
  }
}

/** Lo que hacía falta saber de una sesión que se acaba de cerrar, para auditarla. */
export interface SesionCerrada {
  usuarioId: string
  rol: SesionActiva['rol']
  email: string
}

/**
 * Cierra una sesión (HU-R7-04). Devuelve null si el token no existía o la sesión ya
 * estaba revocada, de modo que llamarlo dos veces no audita dos cierres.
 */
export async function revocar(bd: Ejecutor, token: string | undefined): Promise<SesionCerrada | null> {
  if (!token) return null
  const [fila] = await bd.consultar<{ usuario_id: string; rol: SesionActiva['rol']; email: string }>(
    `UPDATE sesiones s SET revocada_at = now()
       FROM usuarios u
      WHERE s.token_hash = $1 AND s.revocada_at IS NULL AND u.id = s.usuario_id
     RETURNING s.usuario_id, u.rol, u.email::text AS email`,
    [hashear(token)],
  )
  if (!fila) return null
  return { usuarioId: fila.usuario_id, rol: fila.rol, email: fila.email }
}

/**
 * Revoca todas las sesiones vigentes de un usuario. La necesita el restablecimiento
 * de contraseña del Administrador (HU-R7-07) y la baja de una cuenta.
 */
export async function revocarTodas(bd: Ejecutor, usuarioId: string): Promise<number> {
  const filas = await bd.consultar<{ id: string }>(
    `UPDATE sesiones SET revocada_at = now()
      WHERE usuario_id = $1 AND revocada_at IS NULL AND expira_at > now()
     RETURNING id`,
    [usuarioId],
  )
  return filas.length
}

/** El user agent es informativo; se recorta para no guardar cadenas absurdas. */
const recortarUserAgent = (ua: string | undefined) =>
  ua === undefined || ua === '' ? null : ua.slice(0, 300)
