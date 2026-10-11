// Autenticación (HU-R7-01). Login con credenciales reales, y la sesión del usuario
// para que el frontend sepa si ya hay una abierta.
//
// Tres reglas del RQM gobiernan este archivo:
//   RN_1  bcrypt de 12 rondas o más (el hash lo crea la carga inicial, aquí solo se compara)
//   RN_2  la sesión expira a las 8 h de inactividad y se renueva en cada petición
//   RN_4  el error de credenciales es genérico: nunca revela si el correo existe

import bcrypt from 'bcryptjs'
import type { BD } from './bd.js'
import { auditarAcceso, type MotivoFallo } from './datos/acceso.js'
import { confirmarFallo, MENSAJE_BLOQUEO, reiniciar, reservarIntento } from './datos/loginIntentos.js'
import {
  COOKIE_PERFIL, COOKIE_SESION,
  consultarYRenovar, crear, revocar, type SesionActiva,
} from './datos/sesiones.js'
import type { CookieSalida, Respuesta, Solicitud } from './http.js'
import { DASHBOARD, destinoTrasLogin } from './rutas.js'

/** RN_4: un solo mensaje para cuenta inexistente, contraseña mala y cuenta inactiva. */
const MENSAJE_CREDENCIALES = 'Usuario o contraseña incorrectos. Verifica tus datos'

/**
 * Hash señuelo con el que se compara cuando el correo no existe, para que la respuesta
 * tarde lo mismo que con un correo real. Sin esto, la diferencia de tiempo delata qué
 * correos existen — la misma fuga de enumeración que RN_4 quiere evitar.
 *
 * Tiene que ser un bcrypt válido de 60 caracteres y del mismo costo que los reales: con
 * un hash mal formado, bcrypt.compare() responde en microsegundos en vez de ~200 ms y el
 * señuelo no sirve de nada. Es el hash de un valor al azar que no se conserva, así que
 * no existe contraseña que coincida con él.
 */
const HASH_SEÑUELO = '$2b$12$6iHfgGx9Wuk5tNm71AZyCO1gGnB7hohsRPhaf2CXAq5H5424ukhgG'

interface FilaUsuario {
  id: string
  nombre: string
  email: string
  password_hash: string
  rol: SesionActiva['rol']
  activo: boolean
}

/**
 * Cookie con el destino al que el usuario quería ir antes de que lo mandaran al login
 * (HU-R7-02 RN_1). La pone el frontend al redirigir y la consume el backend al iniciar
 * sesión, que es quien puede validarla contra el rol. Vive poco: es para el viaje de
 * ida al login, no para recordarse entre sesiones.
 */
export const COOKIE_DESTINO = 'comapa_destino'
const DESTINO_MAX_EDAD_SEGUNDOS = 10 * 60

const borrarDestino = (produccion: boolean): CookieSalida =>
  ({ nombre: COOKIE_DESTINO, valor: '', maxEdadSegundos: 0, secure: produccion, httpOnly: false })

export function datosSesion(s: SesionActiva, destino?: string) {
  return {
    usuario: {
      id: s.usuarioId,
      nombre: s.nombre,
      email: s.email,
      rol: s.rol,
      gerencia: { clave: s.gerenciaClave, nombre: s.gerenciaNombre },
      unidad: s.unidadNombre,
      debeCambiarPassword: s.debeCambiarPassword,
    },
    // Con contraseña temporal, lo primero es cambiarla (HU-R7-07 CA_3)
    redirigirA: s.debeCambiarPassword ? 'cambiar-password.html' : destino ?? DASHBOARD[s.rol],
    expiraAt: s.expiraAt,
  }
}

/**
 * El token: HttpOnly siempre, el navegador no lo puede leer (CA-3). Sin Max-Age: con un
 * Max-Age de 8 h fijado al iniciar sesión, el navegador la borraba a las 8 h del login
 * aunque el usuario siguiera activo y el servidor ya hubiera renovado la sesión (RN_2).
 * La expiración por inactividad la decide el servidor; la cookie dura hasta cerrar el navegador.
 */
const cookieSesion = (valor: string, produccion: boolean): CookieSalida => ({
  nombre: COOKIE_SESION,
  valor,
  secure: produccion,
})

/**
 * El perfil para mostrar: legible por el frontend, sin credencial alguna. Dura lo mismo
 * que la cookie del token (hasta cerrar el navegador); si la sesión expira antes en el
 * servidor, la siguiente petición responde 401 y el frontend lo maneja (HU-R7-05).
 */
const cookiePerfil = (s: SesionActiva, produccion: boolean): CookieSalida => ({
  nombre: COOKIE_PERFIL,
  valor: JSON.stringify({
    nombre: s.nombre,
    email: s.email,
    rol: s.rol,
    gerencia: s.gerenciaNombre,
    gerenciaClave: s.gerenciaClave,
    unidad: s.unidadNombre,
    // En el perfil va siempre el dashboard del rol, no el destino de un login puntual:
    // la cookie sobrevive a la navegación y un destino viejo confundiría a CA_2.
    redirigirA: DASHBOARD[s.rol],
  }),
  secure: produccion,
  httpOnly: false,
})

/** Borra las dos cookies de sesión del navegador. */
export const cookiesBorradas = (produccion: boolean): CookieSalida[] => [
  { nombre: COOKIE_SESION, valor: '', maxEdadSegundos: 0, secure: produccion },
  { nombre: COOKIE_PERFIL, valor: '', maxEdadSegundos: 0, secure: produccion, httpOnly: false },
]

/** POST /api/auth/login */
export function login(bd: BD, produccion: boolean) {
  return async (s: Solicitud): Promise<Respuesta> => {
    const cuerpo = await s.json()
    const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim() : ''
    const password = typeof cuerpo.password === 'string' ? cuerpo.password : ''

    // CA-1 lo valida también en el formulario; el backend no confía en eso
    if (email === '' || password === '') {
      return { status: 400, cuerpo: { error: 'campos_requeridos', mensaje: 'Ingresa tu correo y tu contraseña' } }
    }

    const rechazar = async (motivo: MotivoFallo) => {
      const estado = await confirmarFallo(bd, email, s.ip)
      await auditarAcceso.loginFallido(bd, email, motivo, s.ip, estado.intentos)
      // Si este fallo fue el que bloqueó, se dice; el bloqueo no es información que haya que esconder
      return estado.bloqueado
        ? { status: 423, cuerpo: { error: 'cuenta_bloqueada', mensaje: MENSAJE_BLOQUEO } }
        : { status: 401, cuerpo: { error: 'credenciales', mensaje: MENSAJE_CREDENCIALES } }
    }

    // El intento se aparta ANTES de comparar la contraseña (R7-06): si la cuenta está bloqueada,
    // o ya hay MAX_INTENTOS en curso, no se compara. Revisar el bloqueo y registrar el fallo
    // después dejaba que muchos intentos simultáneos compararan su contraseña.
    const reserva = await reservarIntento(bd, email)
    if (!reserva.permitido) {
      await auditarAcceso.loginFallido(bd, email, 'cuenta_bloqueada', s.ip, reserva.estado.intentos)
      return { status: 423, cuerpo: { error: 'cuenta_bloqueada', mensaje: MENSAJE_BLOQUEO } }
    }

    const [usuario] = await bd.consultar<FilaUsuario>(
      `SELECT id, nombre, email::text AS email, password_hash, rol, activo
         FROM usuarios WHERE email = $1`, [email])

    // Correo inexistente: se compara igual contra un hash señuelo para no delatarlo por tiempo
    const coincide = await bcrypt.compare(password, usuario?.password_hash ?? HASH_SEÑUELO)

    if (!usuario) return rechazar('cuenta_inexistente')
    if (!coincide) return rechazar('credenciales')
    if (!usuario.activo) return rechazar('cuenta_inactiva')

    // Credenciales buenas: se limpia el contador (R7-06 CA_5) y se abre la sesión
    await reiniciar(bd, email)
    const token = await crear(bd, usuario.id, { ip: s.ip, userAgent: s.req.headers['user-agent'] })
    const sesion = await consultarYRenovar(bd, token)
    if (!sesion) throw new Error('La sesión recién creada no se pudo leer')

    await auditarAcceso.loginExitoso(bd, usuario.email, { id: usuario.id, rol: usuario.rol }, s.ip)
    await bd.consultar('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [usuario.id])

    // CA_4: vuelve a donde iba, si el rol puede abrirlo; si no, a su dashboard (RN_1).
    // La validación es del servidor: una cookie manipulada simplemente se descarta.
    const destino = destinoTrasLogin(s.cookies[COOKIE_DESTINO], usuario.rol)

    return {
      status: 200,
      cuerpo: datosSesion(sesion, destino),
      cookies: [cookieSesion(token, produccion), cookiePerfil(sesion, produccion), borrarDestino(produccion)],
    }
  }
}

/**
 * POST /api/auth/logout — cierra la sesión.
 *
 * Es POST y no GET a propósito: un GET podría dispararse desde una imagen o un
 * prefetch y cerrarle la sesión al usuario sin que lo pidiera. Con POST más la cookie
 * SameSite=Strict, otro sitio no puede provocarlo.
 *
 * Responde 200 siempre, haya o no sesión: el navegador queda sin cookies en los dos
 * casos, y distinguirlos solo serviría para que alguien averigüe si una cookie que
 * tiene sigue sirviendo. Idempotente, así que repetirlo no es un error.
 */
export function logout(bd: BD, produccion: boolean) {
  return async (s: Solicitud): Promise<Respuesta> => {
    const cerrada = await revocar(bd, s.cookies[COOKIE_SESION])

    // Solo se audita si de verdad había una sesión que cerrar (TEC-05 CA-2)
    if (cerrada) {
      await auditarAcceso.logout(bd, cerrada.email, { id: cerrada.usuarioId, rol: cerrada.rol }, s.ip)
    }

    return {
      status: 200,
      cuerpo: { mensaje: 'Sesión cerrada' },
      cookies: cookiesBorradas(produccion),
    }
  }
}

/**
 * GET /api/auth/sesion — quién está dentro. Lo usa el frontend para CA-5: si ya hay
 * sesión y se abre /login, redirige al dashboard del rol. 401 si no hay sesión.
 */
export function sesion(bd: BD, produccion: boolean) {
  return async (s: Solicitud): Promise<Respuesta> => {
    const activa = await consultarYRenovar(bd, s.cookies[COOKIE_SESION])
    if (!activa) {
      // Sin sesión, se borra el perfil para que el frontend no quede mostrando a un fantasma
      return {
        status: 401,
        cuerpo: { error: 'sin_sesion', mensaje: 'No hay sesión activa' },
        cookies: cookiesBorradas(produccion),
      }
    }
    // Se refresca el perfil junto con la expiración de la sesión
    return { status: 200, cuerpo: datosSesion(activa), cookies: [cookiePerfil(activa, produccion)] }
  }
}
