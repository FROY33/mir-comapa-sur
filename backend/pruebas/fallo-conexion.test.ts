// CA-3 y CA-4: sin base, la API responde 503 controlado, el log registra la causa
// y ni la respuesta ni el log contienen la clave de la conexión.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { cargarConfig } from '../src/config.js'
import { ocultarSecretos } from '../src/log.js'
import { levantar } from './apoyo.js'

const CLAVE = 'Clave-Secreta-123'
// Puerto 1: nadie escucha ahí, la conexión se rechaza de inmediato
const URL_CAIDA = `postgres://comapa:${CLAVE}@127.0.0.1:1/comapa_mir_test`

let api: Awaited<ReturnType<typeof levantar>>
before(async () => { api = await levantar({ url: URL_CAIDA, timeoutConexionMs: 1000 }) })
after(() => api.cerrar())

test('GET /api/salud → 503 con mensaje genérico y número de solicitud', async () => {
  const r = await api.pedir('/api/salud')
  assert.equal(r.status, 503)
  const cuerpo = JSON.parse(r.texto)
  assert.equal(cuerpo.error, 'no_disponible')
  assert.equal(cuerpo.mensaje, 'La base de datos no está disponible; intenta de nuevo en unos minutos')
  assert.equal(cuerpo.solicitud, r.cabeceras.get('x-request-id'))
})

test('la respuesta no expone la clave, el host ni el error interno', async () => {
  const { texto } = await api.pedir('/api/frecuencias')
  for (const secreto of [CLAVE, '127.0.0.1', 'ECONNREFUSED', 'comapa_mir_test']) {
    assert.ok(!texto.includes(secreto), `la respuesta contiene ${secreto}`)
  }
})

test('el log registra la causa con el número de solicitud y sin la clave', async () => {
  const r = await api.pedir('/api/salud')
  const id = r.cabeceras.get('x-request-id')!
  const linea = api.lineas.find((l) => l.includes(id))
  assert.ok(linea, 'la solicitud fallida no quedó en el log')
  const entrada = JSON.parse(linea)
  assert.equal(entrada.nivel, 'error')
  assert.equal(entrada.status, 503)
  assert.equal(entrada.codigo, 'ECONNREFUSED')
  assert.ok(api.lineas.every((l) => !l.includes(CLAVE)), 'la clave apareció en el log')
})

test('el backend sigue respondiendo después de varios fallos', async () => {
  const estados = await Promise.all([1, 2, 3].map(() => api.pedir('/api/salud').then((r) => r.status)))
  assert.deepEqual(estados, [503, 503, 503])
})

test('el log oculta claves aunque lleguen dentro de un mensaje', () => {
  assert.equal(ocultarSecretos(`no conecta a ${URL_CAIDA}`), 'no conecta a postgres://comapa:***@127.0.0.1:1/comapa_mir_test')
  assert.equal(ocultarSecretos('host=db password=abc123 user=x'), 'host=db password=*** user=x')
})

test('sin DATABASE_URL el backend no arranca', () => {
  assert.throws(() => cargarConfig({ NODE_ENV: 'development' }), /Falta DATABASE_URL/)
})

test('en pruebas se niega a usar una base que no termine en _test', () => {
  assert.throws(() => cargarConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/comapa_mir' }), /_test/)
})
