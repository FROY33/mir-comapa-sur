// Bloqueo por intentos fallidos (HU-R7-06). El contador vive en la base para que sobreviva reinicios
// y valga para todas las instancias del backend. La hora la pone PostgreSQL con now(), no Node.
//
// Uso desde el login (R7-01):
//   1. reservarIntento() ANTES de comparar: si no se permite, responder MENSAJE_BLOQUEO sin comparar.
//   2. Contraseña incorrecta o correo inexistente → confirmarFallo().
//   3. Contraseña correcta → reiniciar() y crear la sesión.
// Consultar el bloqueo y luego registrar el fallo NO basta: entre ambos pasos caben muchos
// intentos simultáneos, y cada uno compararía su contraseña (hallazgo de la auditoría del 10/10/2026).

import type { BD, Ejecutor } from '../bd.js'
import { normalizarEmail, registrarAcceso } from './acceso.js'

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

// citext ya compara sin mayúsculas, pero la bitácora guarda el correo como texto: se normaliza
// con la misma función que usa la auditoría de acceso, para que la llave coincida
const normalizar = normalizarEmail

export async function consultarBloqueo(bd: Ejecutor, email: string): Promise<EstadoBloqueo> {
  const [fila] = await bd.consultar<{ intentos: number; bloqueado_hasta: Date | null; bloqueado: boolean }>(
    `SELECT intentos, bloqueado_hasta, coalesce(bloqueado_hasta > now(), false) AS bloqueado
       FROM login_intentos WHERE email = $1`,
    [normalizar(email)],
  )
  if (!fila) return { intentos: 0, bloqueado: false, bloqueadoHasta: null }
  return { intentos: fila.intentos, bloqueado: fila.bloqueado, bloqueadoHasta: fila.bloqueado ? fila.bloqueado_hasta : null }
}

export type Reserva =
  | { permitido: true }
  // bloqueado: true también cuando el cupo lo agotan intentos en curso (bloqueadoHasta es null)
  | { permitido: false; estado: EstadoBloqueo }

/** Tras este tiempo, una reserva sin confirmar se da por perdida (el proceso murió a medio login). */
const SEGUNDOS_RESERVA_HUERFANA = 60

// Aparta un intento ANTES de comparar la contraseña y lo cuenta como fallo desde ya. Así, aunque
// lleguen 20 intentos simultáneos, solo MAX_INTENTOS llegan a comparar: los demás encuentran el
// cupo agotado. Si la contraseña resulta correcta, reiniciar() borra el conteo.
//
// Niega el intento si la cuenta está bloqueada o si ya hay MAX_INTENTOS en curso. Un bloqueo
// vencido, o un cupo agotado por reservas huérfanas, empieza la cuenta desde 1.
export async function reservarIntento(bd: Ejecutor, email: string): Promise<Reserva> {
  // Una sola sentencia: el bloqueo de fila del UPSERT ordena los intentos simultáneos. Solo una
  // reserva concedida mueve ultimo_intento_at; como now() es la hora de inicio de la
  // transacción, «permitido» solo es cierto si esta sentencia la movió.
  const [fila] = await bd.consultar<{ intentos: number; bloqueado_hasta: Date | null; permitido: boolean }>(
    `INSERT INTO login_intentos AS li (email, intentos) VALUES ($1, 1)
     ON CONFLICT (email) DO UPDATE SET
       intentos = CASE
         WHEN li.bloqueado_hasta > now()     THEN li.intentos
         WHEN li.bloqueado_hasta IS NOT NULL THEN 1
         WHEN li.intentos >= $2 AND li.ultimo_intento_at < now() - make_interval(secs => $3) THEN 1
         WHEN li.intentos >= $2              THEN li.intentos
         ELSE li.intentos + 1 END,
       bloqueado_hasta = CASE WHEN li.bloqueado_hasta > now() THEN li.bloqueado_hasta END,
       ultimo_intento_at = CASE
         WHEN li.bloqueado_hasta > now() THEN li.ultimo_intento_at
         WHEN li.bloqueado_hasta IS NULL AND li.intentos >= $2
              AND li.ultimo_intento_at >= now() - make_interval(secs => $3) THEN li.ultimo_intento_at
         ELSE now() END
     RETURNING intentos, bloqueado_hasta, ultimo_intento_at = now() AS permitido`,
    [normalizar(email), MAX_INTENTOS, SEGUNDOS_RESERVA_HUERFANA],
  )
  if (fila!.permitido) return { permitido: true }
  return {
    permitido: false,
    estado: { intentos: fila!.intentos, bloqueado: true, bloqueadoHasta: fila!.bloqueado_hasta },
  }
}

// La contraseña no coincidió: el intento reservado queda como fallo. Si con él se llegó a
// MAX_INTENTOS, bloquea MINUTOS_BLOQUEO y deja el evento en la bitácora (CA_1, CA_3).
export async function confirmarFallo(bd: BD, email: string, ip?: string): Promise<EstadoBloqueo> {
  const correo = normalizar(email)
  return bd.transaccion(async (tx) => {
    // «recien» solo es cierto si el bloqueo nació en esta sentencia (now() es fijo en la transacción)
    const [fila] = await tx.consultar<{ intentos: number; bloqueado_hasta: Date | null; recien: boolean }>(
      `UPDATE login_intentos SET bloqueado_hasta = CASE
           WHEN bloqueado_hasta IS NULL AND intentos >= $2 THEN now() + make_interval(mins => $3)
           ELSE bloqueado_hasta END
        WHERE email = $1
       RETURNING intentos, bloqueado_hasta,
                 coalesce(bloqueado_hasta = now() + make_interval(mins => $3), false) AS recien`,
      [correo, MAX_INTENTOS, MINUTOS_BLOQUEO],
    )
    // Sin fila: un login correcto simultáneo ya reinició el contador
    if (!fila) return { intentos: 0, bloqueado: false, bloqueadoHasta: null }
    if (fila.recien) {
      await registrarAcceso(tx, {
        accion: 'cuenta_bloqueada',
        email: correo,
        ip,
        detalle: { intentos_fallidos: fila.intentos, bloqueado_hasta: fila.bloqueado_hasta },
      })
    }
    return { intentos: fila.intentos, bloqueado: fila.bloqueado_hasta !== null, bloqueadoHasta: fila.bloqueado_hasta }
  })
}

// Un fallo completo en un paso (reservar + confirmar), para cuando no hay nada que comparar en medio.
// Durante un bloqueo activo no suma ni lo alarga.
export async function registrarFallo(bd: BD, email: string, ip?: string): Promise<EstadoBloqueo> {
  const reserva = await reservarIntento(bd, email)
  if (!reserva.permitido) return reserva.estado
  return confirmarFallo(bd, email, ip)
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
    await registrarAcceso(tx, {
      usuarioId: admin.usuarioId,
      rol: 'admin',
      accion: 'cuenta_desbloqueada',
      email: correo,
      ip,
      detalle: { intentos_fallidos: fila.intentos },
    })
    return true
  })
}
