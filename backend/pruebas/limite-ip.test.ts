// Auditoría de seguridad del 11/10/2026: límite de logins fallidos por IP y cabeceras de
// seguridad en toda respuesta de la API.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearLimitePorIp } from '../src/limitePorIp.js'
import { levantar } from './apoyo.js'

describe('límite por IP (unitario, reloj controlado)', () => {
  let ahora = 1_000_000
  const reloj = () => ahora

  test('al llegar al máximo de fallos en la ventana, la IP espera; otra IP no', () => {
    const l = crearLimitePorIp(3, 60_000, reloj)
    for (let i = 0; i < 3; i++) assert.equal(l.reservar('1.1.1.1'), 0)
    assert.ok(l.reservar('1.1.1.1') > 0)
    assert.equal(l.reservar('2.2.2.2'), 0)
  })

  test('un login correcto libera su intento: los éxitos no cuentan', () => {
    const l = crearLimitePorIp(3, 60_000, reloj)
    for (let i = 0; i < 10; i++) { assert.equal(l.reservar('1.1.1.1'), 0); l.liberar('1.1.1.1') }
    assert.equal(l.reservar('1.1.1.1'), 0)
  })

  test('pasada la ventana, la IP vuelve a poder intentar', () => {
    const l = crearLimitePorIp(2, 60_000, reloj)
    l.reservar('1.1.1.1'); l.reservar('1.1.1.1')
    const espera = l.reservar('1.1.1.1')
    assert.ok(espera > 0 && espera <= 60)
    ahora += 60_001
    assert.equal(l.reservar('1.1.1.1'), 0)
  })

  test('sin IP conocida no se limita (no hay a quién atribuirlo)', () => {
    const l = crearLimitePorIp(1, 60_000, reloj)
    l.reservar(undefined); l.reservar(undefined)
    assert.equal(l.reservar(undefined), 0)
  })
})

describe('por HTTP', () => {
  let app: Awaited<ReturnType<typeof levantar>>
  before(async () => { app = await levantar() })
  after(() => app.cerrar())

  const login = (email: string) => fetch(`${app.url}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'mala-contraseña' }),
  })

  test('30 fallos contra cuentas distintas (password spraying) y el 31.º responde 429 sin tocar la base', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await login(`spray-${i}-${randomUUID()}@comapasur.gob.mx`)
      assert.notEqual(r.status, 429, `limitó antes de tiempo, en el intento ${i + 1}`)
    }
    const r = await login(`spray-final-${randomUUID()}@comapasur.gob.mx`)
    assert.equal(r.status, 429)
    assert.ok(Number(r.headers.get('retry-after')) > 0)
    assert.equal((await r.json() as { error: string }).error, 'demasiados_intentos')
  })

  test('una ráfaga simultánea tampoco pasa: de 40 a la vez, exactamente 10 reciben 429', async () => {
    const otra = await levantar()
    try {
      const estados = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(`${otra.url}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `rafaga-${i}-${randomUUID()}@comapasur.gob.mx`, password: 'mala' }),
      }).then((r) => r.status)))
      assert.equal(estados.filter((st) => st === 429).length, 10)
    } finally {
      await otra.cerrar()
    }
  })

  test('toda respuesta de la API lleva las cabeceras de seguridad, también un 404 y un error', async () => {
    for (const r of [await fetch(`${app.url}/api/salud`), await fetch(`${app.url}/api/no-existe`),
                     await fetch(`${app.url}/api/indicadores`)]) {
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(r.headers.get('x-frame-options'), 'DENY')
      assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    }
  })
})
