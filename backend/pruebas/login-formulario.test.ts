// HU-R7-01, el formulario: CA_1 (validación de campos), CA_4 (redirección por rol),
// CA_5 (sesión existente), CA_6 (spinner y sin doble envío) y RN_3 y RN_4.
//
// Se ejecuta el script real de login.html contra un DOM mínimo simulado, porque lo
// que estos criterios describen es comportamiento del navegador y no de la API. No
// sustituye a verlo en un navegador —no comprueba que el spinner se vea— pero sí que
// la lógica haga lo que debe: no enviar con campos vacíos, no enviar dos veces,
// mostrar el error del backend y redirigir a donde diga el servidor.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

const RAIZ = path.resolve(import.meta.dirname, '../..')

/** Elemento simulado con lo que el script de login realmente usa. */
class ElementoFalso {
  value = ''
  textContent = ''
  readonly clases = new Set<string>()
  readonly oyentes: Record<string, ((e: unknown) => void)[]> = {}

  readonly classList = {
    add: (c: string) => { this.clases.add(c) },
    remove: (c: string) => { this.clases.delete(c) },
    contains: (c: string) => this.clases.has(c),
    toggle: (c: string, forzar?: boolean) => {
      const poner = forzar ?? !this.clases.has(c)
      if (poner) this.clases.add(c); else this.clases.delete(c)
    },
  }

  addEventListener(evento: string, fn: (e: unknown) => void) {
    (this.oyentes[evento] ??= []).push(fn)
  }

  /** Dispara un evento, como lo haría el navegador. */
  disparar(evento: string) {
    let prevenido = false
    const e = { preventDefault: () => { prevenido = true } }
    for (const fn of this.oyentes[evento] ?? []) fn(e)
    return { prevenido }
  }

  get oculto() { return this.clases.has('hidden') }
  get conError() { return this.clases.has('error') }
  focus() {}
}

interface Resultado { ok: boolean; user?: { redirect: string }; mensaje?: string; error?: string }

/**
 * Carga el script de login.html con un DOM y un Session simulados.
 * `respuesta` decide qué devuelve Session.login, y se puede dejar pendiente para
 * observar el estado mientras la petición está en vuelo.
 */
function cargarFormulario(opciones: {
  sesionExistente?: { redirect: string } | null
  respuesta?: () => Promise<Resultado>
} = {}) {
  const codigo = readFileSync(path.join(RAIZ, 'login.html'), 'utf8')
  const bloques = [...codigo.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
  const script = bloques.reduce((a, b) => (b.length > a.length ? b : a), '')

  const el: Record<string, ElementoFalso> = {}
  for (const id of ['btnLogin', 'btnText', 'captionName', 'email', 'emailErr', 'errorBox',
                    'errorMsg', 'forgotLink', 'loginForm', 'passErr', 'password', 'spinner']) {
    el[id] = new ElementoFalso()
  }
  el.spinner!.clases.add('hidden')
  el.errorBox!.clases.add('hidden')
  el.emailErr!.clases.add('hidden')
  el.passErr!.clases.add('hidden')

  const intentos: { email: string; password: string }[] = []
  const navegaciones: string[] = []
  const location = {
    get href() { return '' },
    set href(v: string) { navegaciones.push(v) },
    replace: (v: string) => { navegaciones.push(v) },
  }

  const Session = {
    cargar: () => Promise.resolve(opciones.sesionExistente ?? null),
    login: (email: string, password: string) => {
      intentos.push({ email, password })
      return (opciones.respuesta ?? (() => Promise.resolve({ ok: true, user: { redirect: 'dashboard-admin.html' } })))()
    },
  }

  const documento = {
    getElementById: (id: string) => el[id] ?? null,
    querySelectorAll: () => [] as unknown[],
    addEventListener: () => {},
  }

  const fn = new Function('document', 'window', 'Session', 'setInterval', 'setTimeout', 'location', script)
  fn(documento, { location, Session }, Session, () => 0, (f: () => void) => { f(); return 0 }, location)

  return { el, intentos, navegaciones, enviar: () => el.loginForm!.disparar('submit') }
}

const esperar = () => new Promise((ok) => setImmediate(ok))

describe('CA_1: validación de campos antes de enviar', () => {
  test('con los dos campos vacíos no se llama al backend y se marcan ambos', () => {
    const f = cargarFormulario()
    const { prevenido } = f.enviar()

    assert.equal(prevenido, true, 'el formulario debe cancelar el envío nativo')
    assert.deepEqual(f.intentos, [], 'no debía llamarse al backend')
    assert.equal(f.el.emailErr!.oculto, false, 'no se mostró el error del correo')
    assert.equal(f.el.passErr!.oculto, false, 'no se mostró el error de la contraseña')
    assert.equal(f.el.email!.conError, true)
    assert.equal(f.el.password!.conError, true)
  })

  test('con solo el correo vacío se marca solo el correo', () => {
    const f = cargarFormulario()
    f.el.password!.value = 'algo'
    f.enviar()
    assert.deepEqual(f.intentos, [])
    assert.equal(f.el.emailErr!.oculto, false)
    assert.equal(f.el.passErr!.oculto, true, 'la contraseña no debía marcarse')
  })

  test('un correo de solo espacios cuenta como vacío', () => {
    const f = cargarFormulario()
    f.el.email!.value = '   '
    f.el.password!.value = 'algo'
    f.enviar()
    assert.deepEqual(f.intentos, [], 'un correo en blanco no debe llegar al backend')
  })

  test('con los dos campos llenos sí se llama, y el correo va sin espacios', async () => {
    const f = cargarFormulario()
    f.el.email!.value = '  admin@comapa.mx  '
    f.el.password!.value = 'Secreta'
    f.enviar()
    await esperar()
    assert.equal(f.intentos.length, 1)
    assert.equal(f.intentos[0]!.email, 'admin@comapa.mx')
  })
})

describe('CA_6: spinner y sin doble envío', () => {
  test('el spinner se muestra mientras espera y se oculta al terminar', async () => {
    let resolver: (r: Resultado) => void = () => {}
    const f = cargarFormulario({ respuesta: () => new Promise((ok) => { resolver = ok }) })
    f.el.email!.value = 'admin@comapa.mx'
    f.el.password!.value = 'Secreta'

    f.enviar()
    assert.equal(f.el.spinner!.oculto, false, 'el spinner debía aparecer al enviar')

    resolver({ ok: false, mensaje: 'Usuario o contraseña incorrectos' })
    await esperar(); await esperar()
    assert.equal(f.el.spinner!.oculto, true, 'el spinner debía ocultarse al terminar')
  })

  test('dos envíos seguidos solo llaman al backend una vez', async () => {
    let resolver: (r: Resultado) => void = () => {}
    const f = cargarFormulario({ respuesta: () => new Promise((ok) => { resolver = ok }) })
    f.el.email!.value = 'admin@comapa.mx'
    f.el.password!.value = 'Secreta'

    f.enviar()
    f.enviar()
    f.enviar()
    assert.equal(f.intentos.length, 1, 'el doble envío llegó al backend')

    resolver({ ok: false, mensaje: 'no' })
    await esperar(); await esperar()
  })

  test('tras un intento fallido se puede volver a enviar', async () => {
    const f = cargarFormulario({ respuesta: () => Promise.resolve({ ok: false, mensaje: 'no' }) })
    f.el.email!.value = 'admin@comapa.mx'
    f.el.password!.value = 'mala'

    f.enviar()
    await esperar(); await esperar()
    f.el.password!.value = 'otra'
    f.enviar()
    await esperar()
    assert.equal(f.intentos.length, 2, 'el formulario quedó bloqueado tras fallar')
  })
})

describe('RN_4: el error que se muestra', () => {
  test('se muestra el mensaje genérico que mandó el backend', async () => {
    const generico = 'Usuario o contraseña incorrectos. Verifica tus datos'
    const f = cargarFormulario({ respuesta: () => Promise.resolve({ ok: false, error: 'credenciales', mensaje: generico }) })
    f.el.email!.value = 'admin@comapa.mx'
    f.el.password!.value = 'mala'
    f.enviar()
    await esperar(); await esperar()

    assert.equal(f.el.errorBox!.oculto, false, 'no se mostró la caja de error')
    assert.equal(f.el.errorMsg!.textContent, generico, 'no se pintó el mensaje del backend')
    assert.equal(f.el.password!.value, '', 'la contraseña debe limpiarse tras un fallo')
    assert.deepEqual(f.navegaciones, [], 'no debía redirigir con credenciales malas')
  })

  test('el mensaje no insinúa si la cuenta existe', async () => {
    const f = cargarFormulario({ respuesta: () => Promise.resolve({ ok: false, mensaje: 'Usuario o contraseña incorrectos. Verifica tus datos' }) })
    f.el.email!.value = 'fantasma@comapa.mx'
    f.el.password!.value = 'mala'
    f.enviar()
    await esperar(); await esperar()
    assert.ok(!/no existe|no encontrad|no registrad/i.test(String(f.el.errorMsg!.textContent)),
      'el mensaje insinúa si la cuenta existe')
  })
})

describe('CA_4: redirección por rol', () => {
  for (const destino of ['dashboard-admin.html', 'dashboard-revisor.html', 'dashboard-enlace.html']) {
    test(`va a donde diga el backend: ${destino}`, async () => {
      const f = cargarFormulario({ respuesta: () => Promise.resolve({ ok: true, user: { redirect: destino } }) })
      f.el.email!.value = 'quien@comapa.mx'
      f.el.password!.value = 'Secreta'
      f.enviar()
      await esperar(); await esperar()
      assert.deepEqual(f.navegaciones, [destino])
    })
  }
})

describe('CA_5: sesión existente', () => {
  test('con sesión activa, la página de login redirige al dashboard', async () => {
    const f = cargarFormulario({ sesionExistente: { redirect: 'dashboard-revisor.html' } })
    await esperar(); await esperar()
    assert.deepEqual(f.navegaciones, ['dashboard-revisor.html'])
  })

  test('sin sesión, la página de login se queda', async () => {
    const f = cargarFormulario({ sesionExistente: null })
    await esperar(); await esperar()
    assert.deepEqual(f.navegaciones, [])
  })
})

describe('RN_3: sin recuperación por correo', () => {
  test('el enlace de contraseña olvidada remite al Administrador y no navega', () => {
    const f = cargarFormulario()
    const { prevenido } = f.el.forgotLink!.disparar('click')
    assert.equal(prevenido, true, 'el enlace no debe navegar')
    assert.equal(f.el.errorBox!.oculto, false)
    assert.match(String(f.el.errorMsg!.textContent), /Administrador/,
      'debe remitir al Administrador, que es quien restablece (RN_3)')
    assert.deepEqual(f.navegaciones, [])
  })
})
