// Autorización (HU-R7-03). Cada ruta protegida declara qué roles la usan, y recibe la
// sesión ya verificada contra la base. La gerencia sale de la sesión (de `usuarios`), nunca
// de la URL ni del cuerpo (RN_2): una ruta que filtra por gerencia usa `s.sesion.gerenciaId`.
//
// Esta es la capa de seguridad (RN_1). La guardia de páginas de guardia.js solo evita
// mostrar una pantalla que de todos modos no podría pedir sus datos.

import type { BD } from './bd.js'
import { cookiesBorradas } from './auth.js'
import { COOKIE_SESION, consultarYRenovar, type SesionActiva } from './datos/sesiones.js'
import type { Manejador, Respuesta, Solicitud } from './http.js'
import { DASHBOARD, puedeAbrir, type Rol } from './rutas.js'

export type SolicitudConSesion = Solicitud & { sesion: SesionActiva }

/** El mismo texto que muestra el login con ?sesion=expirada (HU-R7-05 CA_1). */
export const MENSAJE_SESION_EXPIRADA = 'Tu sesión expiró. Inicia sesión nuevamente.'
const MENSAJE_PROHIBIDO = 'No tienes permiso para esta sección'

export const sinSesion = (produccion: boolean): Respuesta => ({
  status: 401,
  cuerpo: { error: 'no_autenticado', mensaje: MENSAJE_SESION_EXPIRADA },
  // también se borran las cookies, para que el frontend no siga mostrando un perfil viejo
  cookies: cookiesBorradas(produccion),
})

export const prohibido = (rol: Rol): Respuesta => ({
  status: 403,
  cuerpo: { error: 'prohibido', mensaje: MENSAJE_PROHIBIDO, redirigirA: DASHBOARD[rol] },
})

/**
 * Envuelve un manejador: 401 sin sesión (o vencida, o revocada), 403 si el rol no está en
 * `roles`. Validar la sesión también la renueva (8 h de inactividad, HU-R7-01 RN_2).
 */
export function crearProtegida(bd: BD, produccion: boolean) {
  return (roles: readonly Rol[], manejador: (s: SolicitudConSesion) => Promise<Respuesta>): Manejador =>
    async (s) => {
      const sesion = await consultarYRenovar(bd, s.cookies[COOKIE_SESION])
      if (!sesion) return sinSesion(produccion)
      if (!roles.includes(sesion.rol)) return prohibido(sesion.rol)
      return manejador({ ...s, sesion })
    }
}

/**
 * GET /api/auth/acceso?pagina=configuracion.html — ¿puede este usuario abrir esa página?
 * Lo consulta la guardia de guardia.js antes de mostrar cualquier página protegida, y el
 * servidor de desarrollo antes de servirla. 200, 401 o 403 con el dashboard de su rol
 * (HU-R7-03 CA_1, CA_2 y CA_6). La tabla de qué rol abre qué página está en rutas.ts.
 */
export function acceso(bd: BD, produccion: boolean) {
  return async (s: Solicitud): Promise<Respuesta> => {
    const sesion = await consultarYRenovar(bd, s.cookies[COOKIE_SESION])
    if (!sesion) return sinSesion(produccion)
    const pagina = s.url.searchParams.get('pagina') ?? ''
    if (!puedeAbrir(sesion.rol, pagina)) return prohibido(sesion.rol)
    return { status: 200, cuerpo: { permitido: true } }
  }
}
