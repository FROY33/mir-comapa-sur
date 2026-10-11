// Límite de logins fallidos por IP (auditoría de seguridad del 11/10/2026).
//
// El bloqueo de HU-R7-06 es por cuenta: no frena a quien prueba una contraseña común contra
// muchas cuentas, ni una ráfaga de logins que, a ~250 ms de bcrypt cada uno, satura la CPU.
// Esto cuenta los FALLOS por IP en una ventana: los logins correctos no cuentan, para no
// bloquear a una oficina entera que sale a internet por la misma IP.
//
// En memoria, por instancia: es una barrera contra abuso, no un registro. Con varias
// instancias detrás de un balanceador el límite efectivo se multiplica; si eso importa, se
// mueve a la base o al balanceador.

export const MAX_FALLOS_POR_IP = 30
export const VENTANA_MS = 15 * 60 * 1000

export function crearLimitePorIp(max = MAX_FALLOS_POR_IP, ventanaMs = VENTANA_MS, ahora = () => Date.now()) {
  const fallos = new Map<string, number[]>()

  const vigentes = (ip: string) => {
    const desde = ahora() - ventanaMs
    const lista = (fallos.get(ip) ?? []).filter((t) => t > desde)
    if (lista.length > 0) fallos.set(ip, lista)
    else fallos.delete(ip)
    return lista
  }

  return {
    /**
     * Aparta un intento antes de comparar la contraseña y lo cuenta como fallo desde ya, como en
     * R7-06: revisar y apartar ocurren juntos (un solo hilo), así una ráfaga simultánea no pasa.
     * Devuelve 0 si puede intentar, o los segundos que debe esperar.
     */
    reservar(ip: string | undefined): number {
      if (!ip) return 0
      const lista = vigentes(ip)
      if (lista.length >= max) return Math.max(1, Math.ceil((lista[lista.length - max]! + ventanaMs - ahora()) / 1000))
      fallos.set(ip, [...lista, ahora()])
      // Sin limpieza periódica el mapa crecería con cada IP vista: se purga al pasar de 10 000
      if (fallos.size > 10_000) for (const clave of [...fallos.keys()]) vigentes(clave)
      return 0
    },
    /** El login fue correcto: el intento apartado no era un fallo. */
    liberar(ip: string | undefined): void {
      if (!ip) return
      const lista = vigentes(ip)
      lista.pop()
      if (lista.length > 0) fallos.set(ip, lista)
      else fallos.delete(ip)
    },
  }
}

export type LimitePorIp = ReturnType<typeof crearLimitePorIp>
