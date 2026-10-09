// CA-1: la capa de datos lee y escribe en PostgreSQL, y traduce los errores de la base.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { listarEventos, registrarEvento } from '../src/datos/bitacora.js'
import { listarFrecuencias } from '../src/datos/frecuencias.js'
import { ErrorBD } from '../src/errores.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

// Espera que la promesa falle con un ErrorBD del tipo indicado
async function fallaCon(promesa: Promise<unknown>, tipo: ErrorBD['tipo'], status: number) {
  await assert.rejects(promesa, (err) => {
    assert.ok(err instanceof ErrorBD, `se esperaba ErrorBD y llegó ${String(err)}`)
    assert.equal(err.tipo, tipo)
    assert.equal(err.status, status)
    return true
  })
}

describe('lectura y escritura', () => {
  test('lee el catálogo de frecuencias sembrado por la migración', async () => {
    const frecuencias = await listarFrecuencias(bd)
    assert.deepEqual(frecuencias.map((f) => f.clave),
      ['mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual'])
  })

  test('escribe en la bitácora y lo vuelve a leer', async () => {
    const entidadId = randomUUID()
    const id = await registrarEvento(bd, { accion: 'prueba', entidad: 'prueba', entidadId, detalle: { n: 1 } })
    const eventos = await listarEventos(bd, 'prueba', entidadId)
    assert.equal(eventos.length, 1)
    assert.equal(eventos[0]!.id, id)
    assert.deepEqual(eventos[0]!.detalle, { n: 1 })
  })

  test('las fechas DATE llegan como texto AAAA-MM-DD, sin corrimiento de zona horaria', async () => {
    const [fila] = await bd.consultar<{ d: string }>(`SELECT '2026-12-31'::date AS d`)
    assert.equal(fila!.d, '2026-12-31')
  })

  test('la sesión usa la hora de Tamaulipas', async () => {
    const [fila] = await bd.consultar<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`)
    assert.equal(fila!.tz, 'America/Monterrey')
  })
})

describe('transacciones', () => {
  test('confirma todo junto', async () => {
    const nombre = `Prueba ${randomUUID()}`
    await bd.transaccion(async (tx) => {
      await tx.consultar('INSERT INTO organizaciones (nombre) VALUES ($1)', [nombre])
      await registrarEvento(tx, { accion: 'alta', entidad: 'organizacion', entidadId: nombre })
    })
    const filas = await bd.consultar('SELECT 1 FROM organizaciones WHERE nombre = $1', [nombre])
    assert.equal(filas.length, 1)
  })

  test('si algo falla a medio camino, no queda nada', async () => {
    const nombre = `Prueba ${randomUUID()}`
    await assert.rejects(bd.transaccion(async (tx) => {
      await tx.consultar('INSERT INTO organizaciones (nombre) VALUES ($1)', [nombre])
      throw new Error('falla de la aplicación')
    }), /falla de la aplicación/)
    const filas = await bd.consultar('SELECT 1 FROM organizaciones WHERE nombre = $1', [nombre])
    assert.equal(filas.length, 0)
  })
})

describe('errores de la base traducidos', () => {
  test('duplicado → conflicto 409, con el nombre de la restricción', async () => {
    const nombre = `Prueba ${randomUUID()}`
    await bd.consultar('INSERT INTO organizaciones (nombre) VALUES ($1)', [nombre])
    await assert.rejects(bd.consultar('INSERT INTO organizaciones (nombre) VALUES ($1)', [nombre]),
      (err: ErrorBD) => err.tipo === 'conflicto' && err.restriccion === 'organizaciones_nombre_key')
  })

  test('referencia inexistente → referencia 422', () =>
    fallaCon(bd.consultar(`INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'X', 'X')`,
      [randomUUID()]), 'referencia', 422))

  test('regla CHECK → invalido 422', () =>
    fallaCon(bd.consultar(`UPDATE frecuencias SET dias_habiles = 0 WHERE clave = 'mensual'`), 'invalido', 422))

  test('uuid mal formado → invalido 422', () =>
    fallaCon(bd.consultar('SELECT 1 FROM usuarios WHERE id = $1', ['no-es-uuid']), 'invalido', 422))

  test('modificar la bitácora → bloqueado 409', () =>
    fallaCon(bd.consultar(`UPDATE bitacora SET accion = 'otra'`), 'bloqueado', 409))

  test('error de SQL del propio código → interno 500', () =>
    fallaCon(bd.consultar('SELECT * FROM tabla_que_no_existe'), 'interno', 500))

  test('el mensaje del error es genérico; el de PostgreSQL queda solo en la causa', async () => {
    await assert.rejects(bd.consultar('SELECT * FROM tabla_que_no_existe'), (err: ErrorBD) => {
      assert.equal(err.message, 'Error interno')
      assert.match((err.cause as Error).message, /tabla_que_no_existe/)
      return true
    })
  })
})
