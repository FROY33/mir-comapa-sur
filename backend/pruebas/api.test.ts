// La API sobre una base sana: lectura por HTTP, 404 controlado y recuperación si la base corta conexiones.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import pg from 'pg'
import { configBD, levantar } from './apoyo.js'

const nombreApp = `comapa-api-prueba-${process.pid}`
let api: Awaited<ReturnType<typeof levantar>>
before(async () => { api = await levantar({ nombreApp }) })
after(() => api.cerrar())

test('GET /api/salud responde 200 con la versión del esquema', async () => {
  const r = await api.pedir('/api/salud')
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.texto), { estado: 'ok', bd: 'ok', esquema: '20261008000008' })
  assert.equal(r.cabeceras.get('cache-control'), 'no-store')
  assert.ok(r.cabeceras.get('x-request-id'))
})

test('GET /api/frecuencias lee de la base', async () => {
  const r = await api.pedir('/api/frecuencias')
  assert.equal(r.status, 200)
  assert.equal(JSON.parse(r.texto).length, 6)
})

test('ruta inexistente → 404 en JSON', async () => {
  const r = await api.pedir('/api/no-existe')
  assert.equal(r.status, 404)
  assert.equal(JSON.parse(r.texto).error, 'no_encontrado')
})

test('si la base corta las conexiones del backend, el proceso sigue y se recupera', async () => {
  await api.pedir('/api/salud')   // deja una conexión inactiva en el pool

  // Desde fuera del backend, la base mata sus conexiones (como un reinicio de PostgreSQL)
  const admin = new pg.Client({ connectionString: configBD.url })
  await admin.connect()
  const { rows } = await admin.query(
    `SELECT count(pg_terminate_backend(pid))::int AS cortadas FROM pg_stat_activity WHERE application_name = $1`,
    [nombreApp])
  await admin.end()
  assert.ok(rows[0].cortadas >= 1, 'no había conexiones que cortar')
  await new Promise((ok) => setTimeout(ok, 200))

  const r = await api.pedir('/api/salud')
  assert.equal(r.status, 200)
  assert.ok(api.lineas.some((l) => l.includes('Se perdió una conexión inactiva')), 'el corte debe quedar en el log')
})
