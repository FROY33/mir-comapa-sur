// Preparación compartida de las pruebas del login (HU-R7-01): una gerencia y una unidad
// propias, usuarios con contraseña real y el backend levantado en un puerto libre.
// Registra sus propios before/after al llamarse en el nivel superior del archivo de prueba.

import { randomUUID } from 'node:crypto'
import { after, before } from 'node:test'
import bcrypt from 'bcryptjs'
import { crearBD } from '../src/bd.js'
import { COOKIE_SESION } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

export const PASSWORD = 'Contrasena-Valida-2026'

/** Extrae el valor de la cookie de sesión de un Set-Cookie. */
export const tokenDe = (setCookie: string[]) => {
  const linea = setCookie.find((c) => c.startsWith(`${COOKIE_SESION}=`))
  return linea?.slice(COOKIE_SESION.length + 1).split(';')[0]
}

export function prepararLogin() {
  const bd = crearBD(configBD, crearLog(() => {}))
  let app: Awaited<ReturnType<typeof levantar>>
  let gerenciaId: string
  let unidadId: string

  before(async () => {
    app = await levantar()
    const sufijo = randomUUID()
    const [org] = await bd.consultar<{ id: string }>(
      'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org login ${sufijo}`])
    const [g] = await bd.consultar<{ id: string }>(
      `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'TEC', 'Gerencia Técnica') RETURNING id`, [org!.id])
    const [n] = await bd.consultar<{ id: string }>(
      `INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, 'Coordinación General Técnica', true) RETURNING id`, [g!.id])
    gerenciaId = g!.id
    unidadId = n!.id
  })
  after(async () => { await app.cerrar(); await bd.cerrar() })

  /** Crea un usuario con contraseña real. bcrypt a 12 rondas, como manda RN_1. */
  async function crearUsuario(rol: 'admin' | 'revisor' | 'enlace', activo = true) {
    const email = `login-${randomUUID()}@comapasur.gob.mx`
    const hash = await bcrypt.hash(PASSWORD, 12)
    const [u] = await bd.consultar<{ id: string }>(
      `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, activo, debe_cambiar_password)
       VALUES ($1, $2, 'Quien inicia sesión', $3, $4, $5, $6, false) RETURNING id`,
      [gerenciaId, unidadId, email, hash, rol, activo])
    return { id: u!.id, email }
  }

  /** POST /api/auth/login contra el backend real. Devuelve status, cuerpo y cookies. */
  async function entrar(cuerpo: unknown, cookie?: string) {
    const r = await fetch(`${app.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    })
    return { status: r.status, cuerpo: await r.json() as Record<string, any>, setCookie: r.headers.getSetCookie() }
  }

  return { bd, crearUsuario, entrar, url: () => app.url }
}
