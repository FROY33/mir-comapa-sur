// Regresiones de la auditoría del 10/10/2026 sobre el login (HU-R7-01 + HU-R7-06):
//   1. Muchos intentos simultáneos no deben comparar más de MAX_INTENTOS contraseñas.
//   2. Detrás de un proxy, un X-Forwarded-For basura no debe desactivar el bloqueo.
// Se cuentan las comparaciones por los eventos login_fallido cuyo motivo no es el bloqueo:
// cada uno corresponde a una contraseña que sí se comparó.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, test } from 'node:test'
import { crearApp } from '../src/app.js'
import { crearBD } from '../src/bd.js'
import { consultarBloqueo, MAX_INTENTOS } from '../src/datos/loginIntentos.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

async function servidor(confiarProxy: boolean) {
  const base = crearBD(configBD, crearLog(() => {}))
  const s = createServer(crearApp(base, crearLog(() => {}), { confiarProxy }))
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok))
  return {
    url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`,
    cerrar: async () => { s.closeAllConnections(); await new Promise((ok) => s.close(ok)); await base.cerrar() },
  }
}

const intentar = (url: string, email: string, xff?: string) => fetch(`${url}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) },
  body: JSON.stringify({ email, password: 'no-es-la-contraseña' }),
}).then((r) => r.status)

async function comparaciones(email: string): Promise<number> {
  const [fila] = await bd.consultar<{ n: number }>(
    `SELECT count(*)::int AS n FROM bitacora
      WHERE entidad = 'acceso' AND entidad_id = $1 AND accion = 'login_fallido'
        AND detalle->>'motivo' <> 'cuenta_bloqueada'`, [email])
  return fila!.n
}

describe('intentos simultáneos', () => {
  test('20 logins a la vez comparan como máximo 5 contraseñas y la cuenta queda bloqueada', async () => {
    const app = await servidor(false)
    try {
      const email = `simultaneo-${randomUUID()}@comapasur.gob.mx`
      const estados = await Promise.all(Array.from({ length: 20 }, () => intentar(app.url, email)))
      assert.equal(await comparaciones(email), MAX_INTENTOS)
      assert.ok(estados.every((s) => s === 401 || s === 423), `estados inesperados: ${estados.join(',')}`)
      assert.equal((await consultarBloqueo(bd, email)).bloqueado, true)
    } finally {
      await app.cerrar()
    }
  })
})

describe('X-Forwarded-For con CONFIAR_PROXY', () => {
  test('una cabecera basura no impide el bloqueo y la IP cae al socket', async () => {
    const app = await servidor(true)
    try {
      const email = `xff-${randomUUID()}@comapasur.gob.mx`
      const estados = []
      for (let i = 0; i < MAX_INTENTOS + 1; i++) estados.push(await intentar(app.url, email, 'no-es-ip'))
      assert.deepEqual(estados, [401, 401, 401, 401, 423, 423])
      const [evento] = await bd.consultar<{ ip: string }>(
        `SELECT host(ip) AS ip FROM bitacora WHERE entidad_id = $1 AND accion = 'cuenta_bloqueada'`, [email])
      assert.equal(evento?.ip, '127.0.0.1')
    } finally {
      await app.cerrar()
    }
  })
})
