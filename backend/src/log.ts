// Log en una línea JSON por evento. Toda línea pasa por ocultarSecretos antes de escribirse,
// así que una cadena de conexión que llegue en un mensaje de error no sale con su clave.

export type Nivel = 'info' | 'aviso' | 'error'
export type Log = Record<Nivel, (mensaje: string, datos?: Record<string, unknown>) => void>

export function ocultarSecretos(texto: string): string {
  return texto
    .replace(/(\w+:\/\/[^:/\s@"]+:)[^@\s"]+@/g, '$1***@')   // postgres://usuario:CLAVE@host
    .replace(/(password\s*=\s*)[^\s"&]+/gi, '$1***')         // password=CLAVE
}

export function crearLog(escribir: (linea: string) => void = (l) => process.stdout.write(l + '\n')): Log {
  const registrar = (nivel: Nivel) => (mensaje: string, datos: Record<string, unknown> = {}) =>
    escribir(ocultarSecretos(JSON.stringify({ t: new Date().toISOString(), nivel, mensaje, ...datos })))
  return { info: registrar('info'), aviso: registrar('aviso'), error: registrar('error') }
}
