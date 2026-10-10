// Auditoría de acceso (TEC-05). Un solo vocabulario de eventos de autenticación y
// un solo camino para escribirlos, para que el login (R7-01), el cierre de sesión
// (R7-04) y el bloqueo (R7-06) no inventen cada uno su acción ni su formato.
//
// Los eventos van a la misma tabla `bitacora` que el resto de la auditoría, con
// entidad = 'acceso' y entidad_id = el correo normalizado. La base solo permite
// insertar: UPDATE, DELETE y TRUNCATE los rechaza un trigger (CA-5).

import type { Ejecutor } from '../bd.js'
import { ocultarSecretos } from '../log.js'
import { registrarEvento, type Rol } from './bitacora.js'

export const ENTIDAD = 'acceso'

/**
 * Acciones de acceso. Cerrar una sesión se audita como `logout`: es una propuesta
 * de TEC-05, no un CA original de R7-04 (ver las notas del ticket).
 */
export type AccionAcceso =
  | 'login_exitoso'
  | 'login_fallido'
  | 'logout'
  | 'cuenta_bloqueada'
  | 'cuenta_desbloqueada'

/** Motivo de un login fallido. No distingue para el usuario, solo para la auditoría. */
export type MotivoFallo = 'credenciales' | 'cuenta_inexistente' | 'cuenta_inactiva' | 'cuenta_bloqueada'

export interface EventoAcceso {
  accion: AccionAcceso
  /** Correo intentado. Se guarda aunque la cuenta no exista: es la llave de la auditoría. */
  email: string
  /** Solo cuando hay un usuario identificado; un login fallido normalmente no lo tiene. */
  usuarioId?: string
  rol?: Rol
  ip?: string
  /** Datos extra. Pasa por sinSecretos() antes de guardarse (CA-4). */
  detalle?: Record<string, unknown>
}

export const normalizarEmail = (email: string) => email.trim().toLowerCase()

/**
 * Claves que nunca se guardan en la bitácora (CA-4). Se comparan sin acentos ni
 * mayúsculas y por coincidencia parcial, así que `passwordHash` o `access_token`
 * también caen.
 */
const CLAVES_PROHIBIDAS = [
  'password', 'passwd', 'contrasena', 'contraseña', 'clave', 'secret', 'secreto',
  'token', 'cookie', 'authorization', 'auth', 'hash', 'salt', 'credential', 'credencial',
  'jwt', 'bearer', 'session', 'sesion', 'sesión', 'firma', 'signature', 'apikey', 'api_key',
]

const OCULTO = '[oculto]'

const esProhibida = (clave: string) => {
  const normal = clave.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return CLAVES_PROHIBIDAS.some((p) => normal.includes(p.normalize('NFD').replace(/[̀-ͯ]/g, '')))
}

/**
 * Quita de un detalle cualquier cosa que parezca un secreto, en vez de rechazar el
 * evento: perder un registro de auditoría por un error de quien lo llama es peor que
 * guardarlo incompleto. Lo quitado queda marcado como `[oculto]`.
 *
 * Recorre objetos y arreglos, y además pasa los textos por ocultarSecretos() para
 * que una cadena de conexión embebida en un mensaje no entre con su clave.
 */
export function sinSecretos(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 6) return OCULTO                 // corta estructuras cíclicas o absurdamente anidadas
  if (typeof valor === 'string') return ocultarSecretos(valor)
  if (Array.isArray(valor)) return valor.map((v) => sinSecretos(v, profundidad + 1))
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([clave, v]) =>
      [clave, esProhibida(clave) ? OCULTO : sinSecretos(v, profundidad + 1)]))
  }
  return valor
}

/** Escribe un evento de acceso. Devuelve el id del registro en la bitácora. */
export function registrarAcceso(bd: Ejecutor, e: EventoAcceso): Promise<string> {
  return registrarEvento(bd, {
    usuarioId: e.usuarioId,
    rol: e.usuarioId === undefined ? undefined : e.rol,   // la base exige que vayan juntos o ninguno
    accion: e.accion,
    entidad: ENTIDAD,
    entidadId: normalizarEmail(e.email),
    ip: e.ip,
    detalle: e.detalle === undefined ? undefined : sinSecretos(e.detalle),
  })
}

/** Atajos para los tres caminos del login, para que las rutas no repitan el armado. */
export const auditarAcceso = {
  loginExitoso: (bd: Ejecutor, email: string, usuario: { id: string; rol: Rol }, ip?: string) =>
    registrarAcceso(bd, { accion: 'login_exitoso', email, usuarioId: usuario.id, rol: usuario.rol, ip }),

  loginFallido: (bd: Ejecutor, email: string, motivo: MotivoFallo, ip?: string, intentos?: number) =>
    registrarAcceso(bd, {
      accion: 'login_fallido', email, ip,
      detalle: intentos === undefined ? { motivo } : { motivo, intentos_fallidos: intentos },
    }),

  logout: (bd: Ejecutor, email: string, usuario: { id: string; rol: Rol }, ip?: string) =>
    registrarAcceso(bd, { accion: 'logout', email, usuarioId: usuario.id, rol: usuario.rol, ip }),
}
