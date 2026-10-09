// Acceso a PostgreSQL: un pool, consultas parametrizadas y transacciones.
// Todo error sale como ErrorBD (ver errores.ts). SQL a mano, sin ORM.

import pg from 'pg'
import type { ConfigBD } from './config.js'
import { detalleError, traducirErrorPg } from './errores.js'
import type { Log } from './log.js'

// DATE como texto 'AAAA-MM-DD': un Date de JS le sumaría la zona horaria y movería el día
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export interface Ejecutor {
  consultar<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface BD extends Ejecutor {
  transaccion<T>(fn: (tx: Ejecutor) => Promise<T>): Promise<T>
  versionEsquema(): Promise<string | null>
  cerrar(): Promise<void>
}

export function crearBD(config: ConfigBD, log: Log): BD {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.maxConexiones,
    connectionTimeoutMillis: config.timeoutConexionMs,
    statement_timeout: config.timeoutConsultaMs,
    application_name: config.nombreApp,
    // Fechas límite y «vencido» se calculan en hora de Tamaulipas, no en la del servidor (que suele ser UTC)
    options: '-c timezone=America/Monterrey',
  })

  // Si la base corta una conexión inactiva, pg emite 'error' en el pool; sin este manejador el proceso se cae
  pool.on('error', (err) => log.error('Se perdió una conexión inactiva con la BD', detalleError(err)))

  async function ejecutar<T>(cliente: pg.Pool | pg.PoolClient, sql: string, params?: unknown[]): Promise<T[]> {
    try {
      return (await cliente.query(sql, params)).rows as T[]
    } catch (err) {
      throw traducirErrorPg(err)
    }
  }

  return {
    consultar: (sql, params) => ejecutar(pool, sql, params),

    // BEGIN … COMMIT en una sola conexión; cualquier error hace ROLLBACK y se vuelve a lanzar
    async transaccion(fn) {
      let cliente: pg.PoolClient
      try {
        cliente = await pool.connect()
      } catch (err) {
        throw traducirErrorPg(err)
      }
      let rota = false
      try {
        await ejecutar(cliente, 'BEGIN')
        const resultado = await fn({ consultar: (sql, params) => ejecutar(cliente, sql, params) })
        await ejecutar(cliente, 'COMMIT')
        return resultado
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => { rota = true })
        throw err
      } finally {
        cliente.release(rota)   // una conexión que no pudo hacer ROLLBACK se descarta, no regresa al pool
      }
    },

    // Última migración aplicada; sirve para /api/salud y para saber si la base está migrada
    async versionEsquema() {
      const [fila] = await ejecutar<{ version: string | null }>(pool, 'SELECT max(version) AS version FROM schema_migrations')
      return fila?.version ?? null
    },

    cerrar: () => pool.end(),
  }
}
