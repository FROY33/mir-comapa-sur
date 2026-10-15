// HU-R4-11 CA_2 (ticket 3, issue 004): el formulario de indicadores marca cada campo con su error,
// avisa antes de descartar cambios y se opera con teclado. Mismo DOM mínimo que
// indicadores-admin-frontend.test.ts; como ese DOM crea cualquier id que se le pida, una prueba
// aparte revisa que los ids que usa el script existan de verdad en estructura-indicadores.html.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo } from './apoyo-frontend.js'
import { cargar, esperar, llenarFormulario, previo } from './apoyo-indicadores-admin.js'

type Pagina = ReturnType<typeof cargar>
const texto = (p: Pagina, id: string) => p.documento.getElementById(id)!.textContent
const guardar = async (p: Pagina) => { (p.ventana.saveIndicator as () => void)(); await esperar() }
const escrituras = (p: Pagina) => (p.ventana.llamadas as any[]).filter((l) => l.metodo !== 'GET')

async function nueva(): Promise<Pagina> {
  const p = cargar()
  await esperar()
  p.ventana.llamadas = []
  p.api._fijar!([], null, { acum: false, frac: false })
  llenarFormulario(p)
  p.documento.getElementById('fMedioId')!.value = 'medio-1'
  return p
}

describe('HU-R4-11 CA_2: errores junto al campo', () => {
  test('HU-R4-11 CA_2: el error 422 del servidor se pinta junto a cada campo (errores) y el formulario no se cierra', async () => {
    const p = await nueva()
    p.ventana.respuestaEscritura = {
      error: 'datos_incompletos', mensaje: 'Campos obligatorios: nombre, frecuencia', campo: 'nombre',
      errores: { nombre: 'Falta nombre', frecuencia: 'Falta frecuencia' },
    }
    await guardar(p)
    assert.equal(texto(p, 'err-nombre'), 'Falta nombre')
    assert.equal(texto(p, 'err-frecuencia'), 'Falta frecuencia')
    assert.equal(p.documento.getElementById('err-nombre')!.style.display, 'block')
    assert.equal(texto(p, 'err-codigo'), '')
    assert.ok(!p.ventana.cerrados, 'el formulario se cerró con errores')
  })

  test('HU-R4-11 CA_2: un error de un solo campo (409 código duplicado) sale junto a la clave', async () => {
    const p = await nueva()
    p.ventana.respuestaEscritura = { error: 'codigo_duplicado', mensaje: 'Ya existe un indicador con el código "PLA-1"', campo: 'codigo', errores: { codigo: 'Ya existe un indicador con el código "PLA-1"' } }
    await guardar(p)
    assert.match(texto(p, 'err-codigo'), /Ya existe/)
  })

  test('HU-R4-11 CA_2: al volver a guardar se limpian los errores anteriores', async () => {
    const p = await nueva()
    p.ventana.respuestaEscritura = { error: 'datos_incompletos', mensaje: 'x', campo: 'nombre', errores: { nombre: 'Falta nombre' } }
    await guardar(p)
    p.ventana.respuestaEscritura = undefined
    await guardar(p)
    assert.equal(texto(p, 'err-nombre'), '')
    assert.equal(p.documento.getElementById('err-nombre')!.style.display, 'none')
  })

  test('HU-R4-11 CA_2: sin medio de verificación un MIR no se envía y el error sale junto al medio', async () => {
    const p = await nueva()
    p.documento.getElementById('fMedioId')!.value = ''
    p.documento.getElementById('fNombre')!.value = ''
    await guardar(p)
    assert.equal(escrituras(p).length, 0)
    assert.match(texto(p, 'err-nombre'), /nombre/i)
    assert.match(texto(p, 'err-medio_verificacion_id'), /medio de verificación/i)
  })

  test('HU-R4-11 CA_2: un gerencial sin medio sí se envía, con medio_verificacion_id nulo', async () => {
    const p = await nueva()
    p.documento.getElementById('fTipo')!.value = 'gerencial'
    p.documento.getElementById('fMedioId')!.value = ''
    await guardar(p)
    const c = escrituras(p)[0].cuerpo
    assert.equal(c.tipo, 'gerencial')
    assert.equal(c.medio_verificacion_id, null)
  })
})

describe('HU-R4-11 CA_2: formulario completo', () => {
  test('HU-R4-11 CA_2: abrir un indicador para editar rellena también tipo, unidad, clasificación, sentido, supuestos e ISO, y guardar sin tocar nada no cambia nada', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([previo()], 'id-1')
    ;(p.ventana.openModal as (id: string) => void)('id-1')
    const v = (id: string) => p.documento.getElementById(id)!
    assert.deepEqual([v('fTipo').value, v('fUnidadResp').value, v('fTipoIndicador').value, v('fSentido').value, v('fSupuestos').value, v('fIso').checked, v('fMedioId').value],
      ['gerencial', 'u1', 'estrategico', 'descendente', 'Hay presupuesto', true, 'medio-previo'])
    await guardar(p)
    const c = escrituras(p)[0].cuerpo
    assert.deepEqual([c.tipo, c.unidad_id, c.tipo_indicador, c.sentido_meta, c.supuestos, c.es_iso, c.medio_verificacion_id, c.numero, c.observaciones_mir],
      ['gerencial', 'u1', 'estrategico', 'descendente', 'Hay presupuesto', true, 'medio-previo', '1.2.3', 'Nota del Excel'])
  })

  test('HU-R4-11 CA_2: todo id que usan los scripts del formulario existe en estructura-indicadores.html', () => {
    const html = archivo('estructura-indicadores.html')
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
    const usados = [...archivo('indicadores-admin.js').matchAll(/getElementById\('([^']+)'\)/g), ...archivo('indicadores-admin-form.js').matchAll(/getElementById\('([^']+)'\)/g),
      ...archivo('indicadores-admin-cambios.js').matchAll(/getElementById\('([^']+)'\)/g)]
      .map((m) => m[1]!)
    for (const id of usados) assert.ok(ids.has(id), `falta #${id} en la página`)
    // Un contenedor de error por campo que la API puede señalar
    for (const campo of ['gerencia_id', 'codigo', 'nivel', 'nombre', 'tipo', 'unidad_id', 'medio_verificacion_id', 'frecuencia', 'unidad_medida',
      'acumulable', 'tipo_calculo', 'tipo_indicador', 'sentido_meta']) assert.ok(ids.has(`err-${campo}`), `falta #err-${campo}`)
  })
})

describe('HU-R4-11 CA_2: cerrar con cambios sin guardar', () => {
  test('HU-R4-11 CA_2: sin cambios cierra sin preguntar', async () => {
    const p = cargar()
    await esperar()
    p.api._fijar!([], null)
    ;(p.ventana.openModal as () => void)()
    ;(p.ventana.closeModal as () => void)()
    assert.equal(p.ventana.cerrados, 1)
    assert.ok(!p.ventana.confirmaciones)
  })

  test('HU-R4-11 CA_2: con cambios pide confirmación; si el Administrador no confirma el formulario sigue abierto', async () => {
    const p = cargar()
    await esperar()
    p.api._fijar!([], null)
    ;(p.ventana.openModal as () => void)()
    p.documento.getElementById('fNombre')!.value = 'Algo escrito'
    p.ventana.permitirDescartar = false
    ;(p.ventana.closeModal as () => void)()
    assert.equal((p.ventana.confirmaciones as string[]).length, 1)
    assert.ok(!p.ventana.cerrados, 'se cerró sin confirmación')
    p.ventana.permitirDescartar = true
    ;(p.ventana.closeModal as () => void)()
    assert.equal(p.ventana.cerrados, 1)
  })

  test('HU-R4-11 CA_2: tras guardar con éxito cierra sin preguntar', async () => {
    const p = await nueva()
    ;(p.ventana.openModal as () => void)()
    llenarFormulario(p)
    p.documento.getElementById('fMedioId')!.value = 'medio-1'
    await guardar(p)
    assert.equal(escrituras(p).length, 1)
    assert.equal(p.ventana.cerrados, 1)
    assert.ok(!p.ventana.confirmaciones)
  })
})

describe('HU-R4-11 CA_2: operable con teclado', () => {
  test('HU-R4-11 CA_2: Enter y Espacio activan interruptores y encabezados; otras teclas no', () => {
    const p = cargar()
    for (const [key, activa] of [['Enter', true], [' ', true], ['a', false], ['Tab', false]] as const) {
      let clics = 0, evitado = false
      ;(p.ventana.activarConTeclado as (e: unknown) => void)({ key, preventDefault: () => { evitado = true }, currentTarget: { click: () => { clics++ } } })
      assert.deepEqual([clics, evitado], activa ? [1, true] : [0, false], key)
    }
  })

  test('HU-R4-11 CA_2: interruptores y encabezados de sección son enfocables, con rol y manejador de teclado; los campos tienen etiqueta', () => {
    const html = archivo('estructura-indicadores.html')
    for (const id of ['swAcum', 'swFrac']) assert.match(html, new RegExp(`id="${id}"[^>]*role="switch"[^>]*tabindex="0"|id="${id}"[^>]*tabindex="0"`), id)
    for (const id of ['acc1Hdr', 'acc2Hdr', 'swAcum', 'swFrac']) assert.match(html, new RegExp(`id="${id}"[^>]*onkeydown="activarConTeclado\\(event\\)"`), id)
    for (const id of ['fGerencia', 'fClave', 'fTipo', 'fUnidadResp', 'fNombre', 'fMedioId', 'fFrecuencia', 'fUnidad', 'fTipoIndicador', 'fSentido', 'fSupuestos'])
      assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `${id} sin <label for>`)
    assert.match(html, /class="modal-card" role="dialog" aria-modal="true"/)
  })
})
