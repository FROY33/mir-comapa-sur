// Traduce los errores de PostgreSQL a unos pocos tipos que la API sabe responder.
// El mensaje original de pg se queda en `cause` (va al log); al navegador solo llega el mensaje genérico.

export type TipoError = 'conflicto' | 'referencia' | 'invalido' | 'bloqueado' | 'no_disponible' | 'interno'

const STATUS: Record<TipoError, number> = {
  conflicto: 409,
  referencia: 422,
  invalido: 422,
  bloqueado: 409,
  no_disponible: 503,
  interno: 500,
}

const MENSAJE: Record<TipoError, string> = {
  conflicto: 'Ya existe un registro con esos datos',
  referencia: 'El registro hace referencia a datos que no existen',
  invalido: 'Los datos no cumplen las reglas',
  bloqueado: 'El registro no se puede modificar',
  no_disponible: 'La base de datos no está disponible; intenta de nuevo en unos minutos',
  interno: 'Error interno',
}

export class ErrorBD extends Error {
  constructor(
    readonly tipo: TipoError,
    readonly codigo?: string,
    readonly restriccion?: string,
    opciones?: ErrorOptions,
  ) {
    super(MENSAJE[tipo], opciones)
    this.name = 'ErrorBD'
  }

  get status(): number {
    return STATUS[this.tipo]
  }
}

/**
 * Error atribuible a la petición, no a la base: cuerpo mal formado o demasiado grande.
 * Lleva su propio status y su mensaje sí se le muestra al cliente, porque describe
 * lo que mandó mal y no filtra nada interno.
 */
export class ErrorSolicitud extends Error {
  readonly tipo = 'solicitud_invalida'

  constructor(message: string, readonly status: number = 400) {
    super(message)
    this.name = 'ErrorSolicitud'
  }
}

// Errores de red de Node y clases de SQLSTATE que significan «no hay base»:
// 08 conexión, 28 autenticación, 53 recursos, 57P0x apagado, 57014 consulta cancelada por timeout, 3D000 base inexistente
const RED = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE'])
const SIN_BASE = /^(08|28|53|57P0|57014|3D000)/
const SIN_CODIGO = /^(Connection terminated|timeout exceeded when trying to connect)/

export function traducirErrorPg(err: unknown): ErrorBD {
  if (err instanceof ErrorBD) return err
  const { code = '', constraint, message = '' } = (err ?? {}) as { code?: string; constraint?: string; message?: string }

  let tipo: TipoError = 'interno'
  if (code === '23505' || code === '40001' || code === '40P01') tipo = 'conflicto'   // duplicado, serialización, deadlock
  else if (code === '23503') tipo = 'referencia'
  else if (code === '23001') tipo = 'bloqueado'                                       // triggers de protección (reportes, bitácora)
  else if (code.startsWith('23') || code.startsWith('22')) tipo = 'invalido'          // CHECK, NOT NULL, uuid o fecha mal formados
  else if (RED.has(code) || SIN_BASE.test(code) || (!code && SIN_CODIGO.test(message))) tipo = 'no_disponible'

  return new ErrorBD(tipo, code || undefined, constraint, { cause: err })
}

// Lo que se escribe en el log sobre un error (el log además oculta claves)
export function detalleError(err: unknown): Record<string, unknown> {
  if (err instanceof ErrorSolicitud) return { tipo: err.tipo, status: err.status, causa: err.message }
  const e = traducirErrorPg(err)
  const causa = e.cause as { message?: string; stack?: string } | undefined
  return {
    tipo: e.tipo,
    codigo: e.codigo,
    restriccion: e.restriccion,
    causa: causa?.message ?? String(err),
    ...(e.tipo === 'interno' && !e.codigo ? { pila: causa?.stack } : {}),   // errores de código, no de la base
  }
}
