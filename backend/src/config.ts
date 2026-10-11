// Configuración desde variables de entorno. Nada de valores secretos en el código.
//   desarrollo → .env        pruebas (NODE_ENV=test) → .env.test        producción → solo variables reales
// Las variables que ya existen en el entorno ganan sobre las del archivo.

import { existsSync } from 'node:fs'

export type Entorno = 'development' | 'test' | 'production'

export interface ConfigBD {
  url: string
  maxConexiones: number
  timeoutConexionMs: number
  timeoutConsultaMs: number
  nombreApp: string
}

export interface Config {
  entorno: Entorno
  puerto: number
  // Interfaz donde escucha. 127.0.0.1 por defecto: en producción solo el sitio (y por él, el
  // túnel de Cloudflare) llega a la API; nadie de la red puede hablarle directo ni falsear su IP.
  host: string
  bd: ConfigBD
  // Si el backend está detrás de un proxy o balanceador, la IP del cliente viene en
  // X-Forwarded-For. Apagado por defecto a propósito: expuesto directo, cualquiera
  // podría mandar esa cabecera y falsear su IP en la bitácora (TEC-05 CA-1).
  confiarProxy: boolean
  // Apertura automática de ciclos (HU-R3-01): al arrancar y cada hora. Apagada en pruebas, que
  // comparten base y no deben ver reportes generados por un servidor que otra prueba levantó.
  ciclosAutomaticos: boolean
}

const ENTORNOS: Entorno[] = ['development', 'test', 'production']

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const entorno = (env.NODE_ENV ?? 'development') as Entorno
  if (!ENTORNOS.includes(entorno)) throw new Error(`NODE_ENV debe ser ${ENTORNOS.join(', ')}`)

  if (env === process.env && entorno !== 'production') {
    const archivo = entorno === 'test' ? '.env.test' : '.env'
    if (existsSync(archivo)) process.loadEnvFile(archivo)
  }

  const url = env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL (ver .env.example)')

  // Las pruebas borran su base: que nunca apunten a la de desarrollo por error
  if (entorno === 'test' && !nombreBase(url).endsWith('_test')) {
    throw new Error('En pruebas, la base de DATABASE_URL debe terminar en _test')
  }

  return {
    entorno,
    puerto: entero(env, 'PORT', 3000),
    host: env.HOST || '127.0.0.1',
    confiarProxy: env.CONFIAR_PROXY === 'true',
    ciclosAutomaticos: entorno !== 'test' && env.CICLOS_AUTOMATICOS !== 'false',
    bd: {
      url,
      maxConexiones: entero(env, 'BD_MAX_CONEXIONES', 10),
      timeoutConexionMs: entero(env, 'BD_TIMEOUT_CONEXION_MS', 5000),
      timeoutConsultaMs: entero(env, 'BD_TIMEOUT_CONSULTA_MS', 15000),
      nombreApp: 'comapa-mir-backend',
    },
  }
}

export function nombreBase(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1))
}

function entero(env: NodeJS.ProcessEnv, nombre: string, porDefecto: number): number {
  const valor = env[nombre]
  if (valor === undefined || valor === '') return porDefecto
  const n = Number(valor)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${nombre} debe ser un entero positivo`)
  return n
}
