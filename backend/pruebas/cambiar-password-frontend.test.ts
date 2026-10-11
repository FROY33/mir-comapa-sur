// HU-R7-07 CA_3, frontend: cambiar-password.js valida antes de pedir y, con éxito, va a
// donde diga el servidor. El cambio en sí se prueba en usuarios.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { RAIZ } from './apoyo-frontend.js'

const esperar = () => new Promise((ok) => setImmediate(ok))

function cargar(respuesta: { status: number; cuerpo: unknown } = { status: 200, cuerpo: { redirigirA: 'dashboard-enlace.html' } }) {
  const codigo = readFileSync(path.join(RAIZ, 'cambiar-password.js'), 'utf8')
  const campos: Record<string, { value: string }> = { actual: { value: '' }, nueva: { value: '' }, confirmar: { value: '' } }
  const clases = new Set(['hidden'])
  const errorMsg = { textContent: '' }
  let alEnviar: (e: { preventDefault: () => void }) => void = () => {}
  const elementos: Record<string, unknown> = {
    ...campos, errorMsg,
    errorBox: { classList: { add: (c: string) => clases.add(c), remove: (c: string) => clases.delete(c) } },
    btnGuardar: { disabled: false },
    linkCerrarSesion: { addEventListener: () => {} },
    formPassword: { addEventListener: (_: string, fn: typeof alEnviar) => { alEnviar = fn } },
  }
  const peticiones: unknown[] = []
  const navegaciones: string[] = []
  const pedir = (ruta: string, o: { body: string }) => {
    peticiones.push({ ruta, cuerpo: JSON.parse(o.body) })
    return Promise.resolve({ ok: respuesta.status < 300, status: respuesta.status, json: () => Promise.resolve(respuesta.cuerpo) })
  }
  new Function('document', 'window', 'pedir', codigo)(
    { getElementById: (id: string) => elementos[id] }, { location: { replace: (u: string) => navegaciones.push(u) } }, pedir)
  const enviar = (actual: string, nueva: string, confirmar = nueva) => {
    campos.actual!.value = actual; campos.nueva!.value = nueva; campos.confirmar!.value = confirmar
    alEnviar({ preventDefault: () => {} })
  }
  return { enviar, peticiones, navegaciones, error: () => (clases.has('hidden') ? '' : errorMsg.textContent) }
}

describe('cambiar-password.js', () => {
  test('valida en el navegador: corta, sin confirmar o sin la actual no se envía', () => {
    const p = cargar()
    p.enviar('Temporal123456', 'corta')
    assert.match(p.error(), /12 caracteres/)
    p.enviar('Temporal123456', 'Una-Nueva-Larga-2026', 'otra')
    assert.match(p.error(), /no coincide/)
    p.enviar('', 'Una-Nueva-Larga-2026')
    assert.match(p.error(), /actual/)
    assert.deepEqual(p.peticiones, [])
  })

  test('con datos válidos la envía y va a donde diga el servidor', async () => {
    const p = cargar()
    p.enviar('Temporal123456', 'Una-Nueva-Larga-2026')
    await esperar(); await esperar()
    assert.deepEqual(p.peticiones, [{ ruta: '/api/auth/cambiar-password', cuerpo: { actual: 'Temporal123456', nueva: 'Una-Nueva-Larga-2026' } }])
    assert.deepEqual(p.navegaciones, ['dashboard-enlace.html'])
  })

  test('si el servidor la rechaza, muestra su mensaje y se queda', async () => {
    const p = cargar({ status: 422, cuerpo: { mensaje: 'La contraseña actual no es correcta' } })
    p.enviar('mala-actual-larga', 'Una-Nueva-Larga-2026')
    await esperar(); await esperar()
    assert.equal(p.error(), 'La contraseña actual no es correcta')
    assert.deepEqual(p.navegaciones, [])
  })
})
