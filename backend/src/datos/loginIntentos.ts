// Bloqueo por intentos fallidos (HU-R7-06). El contador vive en la base para que sobreviva reinicios
// y valga para todas las instancias del backend. La hora la pone PostgreSQL con now(), no Node.
//
// Uso desde el login (R7-01):
//   1. consultarBloqueo(): si está bloqueado, responder MENSAJE_BLOQUEO sin revisar la contraseña.
//   2. Contraseña incorrecta o correo inexistente → registrarFallo().
//   3. Contraseña correcta → reiniciar() y crear la sesión.

import type { BD, Ejecutor } from '../bd.js'
import { registrarEvento } from './bitacora.js'

export const MAX_INTENTOS = 5
export const MINUTOS_BLOQUEO = 15
export const MENSAJE_BLOQUEO =
  'Tu cuenta ha sido bloqueada temporalmente por múltiples intentos fallidos. ' +
  'Espera 15 minutos o contacta al Administrador'

export interface EstadoBloqueo {
  intentos: number              // fallos consecutivos
  bloqueado: boolean
  bloqueadoHasta: Date | null
}

// citext ya compara sin mayúsculas, pero la bitácora guarda el correo como texto: se normaliza aquí
const normalizar = (email: string) => email.trim().toLowerCase()

export async function consultarBloqueo(bd: Ejecutor, email: string): Promise<EstadoBloqueo> {
  const [fila] = await bd.consultar<{ intentos: number; bloqueado_hasta: Date | null; bloqueado: boolean }>(
    `SELECT intentos, bloqueado_hasta, coalesce(bloqueado_hasta > now(), false) AS bloqueado
       FROM login_intentos WHERE email = $1`,
    [normalizar(email)],
  )
  if (!fila) return { intentos: 0, bloqueado: false, bloqueadoHasta: null }
  return { intentos: fila.intentos, bloqueado: fila.bloqueado, bloqueadoHasta: fila.bloqueado ? fila.bloqueado_hasta : null }
}

// Suma un fallo. Al llegar a MAX_INTENTOS bloquea MINUTOS_BLOQUEO y deja el evento en la bitácora (CA_1, CA_3).
// Durante un bloqueo activo no suma ni lo alarga. Un bloqueo vencido empieza la cuenta desde 1.
export async function registrarFallo(bd: BD, email: string, ip?: string): Promise<EstadoBloqueo> {
  const correo = normalizar(email)
  return bd.transaccion(async (tx) => {
    // Una sola sentencia: dos fallos simultáneos se ordenan por el bloqueo de fila del UPSERT.
    // now() es fijo dentro de la transacción, así que «recien» solo es cierto si el bloqueo nació aquí.
    const [fila] = await tx.consultar<{ intentos: number; bloqueado_hasta: Date | null; recien: boolean }>(
      `INSERT INTO login_intentos AS li (email, intentos) VALUES ($1, 1)
       ON CONFLICT (email) DO UPDATE SET
         intentos = CASE
           WHEN li.bloqueado_hasta > now()      THEN li.intentos
           WHEN li.bloqueado_hasta IS NOT NULL  THEN 1
           ELSE li.intentos + 1 END,
         bloqueado_hasta = CASE
           WHEN li.bloqueado_hasta > now()      THEN li.bloqueado_hasta
           WHEN li.bloqueado_hasta IS NULL AND li.intentos + 1 >= $2
                                                THEN now() + make_interval(mins => $3)
           ELSE NULL END,
         ultimo_intento_at = now()
       RETURNING intentos, bloqueado_hasta,
                 coalesce(bloqueado_hasta = now() + make_interval(mins => $3), false) AS recien`,
      [correo, MAX_INTENTOS, MINUTOS_BLOQUEO],
    )
    if (fila!.recien) {
      await registrarEvento(tx, {
        accion: 'cuenta_bloqueada',
        entidad: 'acceso',
        entidadId: correo,
        ip,
        detalle: { intentos_fallidos: fila!.intentos, bloqueado_hasta: fila!.bloqueado_hasta },
      })
    }
    const bloqueado = fila!.bloqueado_hasta !== null
    return { intentos: fila!.intentos, bloqueado, bloqueadoHasta: fila!.bloqueado_hasta }
  })
}

// Login correcto: el contador vuelve a 0 (CA_5)
export async function reiniciar(bd: Ejecutor, email: string): Promise<void> {
  await bd.consultar('DELETE FROM login_intentos WHERE email = $1', [normalizar(email)])
}

// Desbloqueo manual del Administrador (CA_4). La ruta que lo llame (R7-07) debe exigir rol admin.
// Devuelve false si la cuenta no estaba bloqueada; en ese caso no deja evento.
export async function desbloquear(bd: BD, email: string, admin: { usuarioId: string }, ip?: string): Promise<boolean> {
  const correo = normalizar(email)
  return bd.transaccion(async (tx) => {
    const [fila] = await tx.consultar<{ intentos: number }>(
      `DELETE FROM login_intentos WHERE email = $1 AND bloqueado_hasta > now() RETURNING intentos`,
      [correo],
    )
    if (!fila) return false
    await registrarEvento(tx, {
      usuarioId: admin.usuarioId,
      rol: 'admin',
      accion: 'cuenta_desbloqueada',
      entidad: 'acceso',
      entidadId: correo,
      ip,
      detalle: { intentos_fallidos: fila.intentos },
    })
    return true
  })
}
