// Cambio de contraseña del propio usuario (HU-R7-07 CA_3). Mientras `debe_cambiar_password`
// esté activo —alta o restablecimiento con contraseña temporal—, la sesión solo sirve para
// esto: el middleware responde 403 `cambio_password_requerido` a todo lo demás.

import bcrypt from 'bcryptjs'
import type { BD } from './bd.js'
import { registrarEvento } from './datos/bitacora.js'
import { COOKIE_SESION, consultarYRenovar } from './datos/sesiones.js'
import { RONDAS_BCRYPT } from './datos/usuarios.js'
import type { Respuesta, Solicitud } from './http.js'
import { sinSesion } from './autorizacion.js'
import { DASHBOARD } from './rutas.js'

/** Supuesto: 12 caracteres o más, como SEMILLA_PASSWORD. El RQM no fija una política. */
export const LARGO_MINIMO = 12

const error = (status: number, codigo: string, mensaje: string): Respuesta => ({ status, cuerpo: { error: codigo, mensaje } })

/** POST /api/auth/cambiar-password { actual, nueva } */
export function cambiarPassword(bd: BD, produccion: boolean) {
  return async (s: Solicitud): Promise<Respuesta> => {
    const token = s.cookies[COOKIE_SESION]
    const sesion = await consultarYRenovar(bd, token)
    if (!sesion) return sinSesion(produccion)

    const cuerpo = await s.json()
    const actual = typeof cuerpo.actual === 'string' ? cuerpo.actual : ''
    const nueva = typeof cuerpo.nueva === 'string' ? cuerpo.nueva : ''
    if (nueva.length < LARGO_MINIMO) {
      return error(422, 'password_corta', `La nueva contraseña debe tener al menos ${LARGO_MINIMO} caracteres`)
    }
    if (nueva === actual) return error(422, 'password_igual', 'La nueva contraseña debe ser distinta de la actual')

    const [u] = await bd.consultar<{ password_hash: string }>('SELECT password_hash FROM usuarios WHERE id = $1', [sesion.usuarioId])
    if (!u || !(await bcrypt.compare(actual, u.password_hash))) {
      return error(422, 'password_actual', 'La contraseña actual no es correcta')
    }

    await bd.transaccion(async (tx) => {
      await tx.consultar('UPDATE usuarios SET password_hash = $2, debe_cambiar_password = false WHERE id = $1',
        [sesion.usuarioId, await bcrypt.hash(nueva, RONDAS_BCRYPT)])
      // Las demás sesiones del usuario se cierran; la de este navegador sigue
      const otras = await tx.consultar<{ id: string }>(
        `UPDATE sesiones SET revocada_at = now()
          WHERE usuario_id = $1 AND id <> $2 AND revocada_at IS NULL RETURNING id`, [sesion.usuarioId, sesion.sesionId])
      await registrarEvento(tx, {
        usuarioId: sesion.usuarioId, rol: sesion.rol, accion: 'password_cambiada', entidad: 'usuario',
        entidadId: sesion.usuarioId, ip: s.ip, detalle: { otras_sesiones_revocadas: otras.length },
      })
    })
    return { status: 200, cuerpo: { mensaje: 'Contraseña actualizada', redirigirA: DASHBOARD[sesion.rol] } }
  }
}
