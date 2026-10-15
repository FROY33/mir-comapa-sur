// HU-R4-11 frontend: indicadores-admin.js (pantalla «Estructura de Indicadores») con un DOM mínimo.
// El script se carga en la página después del código en línea de estructura-indicadores.html, que
// aquí se sustituye por un preámbulo con las variables y funciones que el script espera encontrar.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { cargar, esperar, llenarFormulario, previo } from './apoyo-indicadores-admin.js'

const MALO = '<img src=x onerror=alert(1)>'
const ESCAPADO = '&lt;img src=x onerror=alert(1)&gt;'
describe('HU-R4-11 formulario de edición (saveIndicator)', () => {
  test('HU-R4-11 CA_2: al editar envía el medio elegido por id (no el texto) y conserva lo que el formulario no muestra (numero, observaciones)', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([previo()], 'id-1')
    llenarFormulario(p)
    p.documento.getElementById('fTipo')!.value = 'gerencial'
    p.documento.getElementById('fUnidadResp')!.value = 'u1'
    p.documento.getElementById('fTipoIndicador')!.value = 'estrategico'
    p.documento.getElementById('fSentido')!.value = 'descendente'
    p.documento.getElementById('fSupuestos')!.value = '  Hay presupuesto '
    p.documento.getElementById('fIso')!.checked = true
    ;(p.ventana.saveIndicator as () => void)()
    await esperar()

    const put = (p.ventana.llamadas as any[]).find((l) => l.metodo === 'PUT')
    assert.equal(put.ruta, '/api/admin/indicadores/id-1')
    const c = put.cuerpo
    assert.equal(c.medio_verificacion_id, 'medio-1')
    assert.ok(!('medio_verificacion' in c), 'el texto ya no se envía: el servidor lo deriva del medio')
    assert.equal(c.nombre, 'Nombre editado')
    assert.equal(c.codigo, 'PLA-1')
    // Lo que el formulario ahora edita sale del formulario; lo que no muestra se conserva del indicador cargado
    assert.deepEqual(
      [c.tipo, c.sentido_meta, c.unidad_id, c.tipo_indicador, c.supuestos, c.es_iso],
      ['gerencial', 'descendente', 'u1', 'estrategico', 'Hay presupuesto', true])
    assert.deepEqual([c.numero, c.observaciones_mir], ['1.2.3', 'Nota del Excel'])
    assert.ok((p.ventana.toasts as string[]).includes('Indicador actualizado'))
  })

  test('HU-R4-11 CA_2: un alta usa POST y valores por omisión para lo que el formulario no muestra', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([], null, { acum: true, frac: false })
    llenarFormulario(p)
    ;(p.ventana.saveIndicator as () => void)()
    await esperar()

    const post = (p.ventana.llamadas as any[]).find((l) => l.metodo === 'POST')
    assert.equal(post.ruta, '/api/admin/indicadores')
    const c = post.cuerpo
    assert.deepEqual([c.tipo, c.sentido_meta, c.unidad_id, c.numero, c.tipo_indicador, c.supuestos, c.es_iso, c.observaciones_mir],
      ['mir', 'ascendente', null, null, null, null, false, null])
    assert.equal(c.acumulable, true)
    assert.equal(c.tipo_calculo, 'valor_directo')
    assert.equal(c.medio_verificacion_id, 'medio-1')
  })

  test('HU-R4-11 CA_4: el tipo de cálculo y el acumulable salen de los interruptores', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([], null, { acum: false, frac: true })
    llenarFormulario(p)
    p.documento.getElementById('fNumLabel')!.value = 'Atendidos'
    p.documento.getElementById('fDenLabel')!.value = 'Solicitados'
    ;(p.ventana.saveIndicator as () => void)()
    await esperar()
    const c = (p.ventana.llamadas as any[]).find((l) => l.metodo === 'POST').cuerpo
    assert.deepEqual([c.tipo_calculo, c.acumulable, c.numerador_desc, c.denominador_desc], ['fraccion', false, 'Atendidos', 'Solicitados'])
  })
})

describe('HU-R4-11 tabla de indicadores (renderTable)', () => {
  test('HU-R4-11 XSS: código, nombre, gerencia, unidad e id de la API se pintan como texto', async () => {
    const p = cargar()
    await esperar()
    const malo = previo({ _id: 'x" onmouseover="alert(1)', codigo: MALO, nombre: MALO, gerenciaNombre: MALO, unidadMedida: MALO, nivel: MALO, frecuencia: MALO })
    p.api._fijar!([malo, previo({ _id: "');alert(1);('", activo: false })], null)
    ;(p.ventana.renderTable as () => void)()
    const html = p.documento.getElementById('tableBody')!.innerHTML
    assert.ok(!html.includes('<img'), 'se pintó una etiqueta <img> activa')
    assert.ok(!html.includes('onmouseover="'), 'un id rompió el atributo')
    assert.ok(!html.includes("');alert(1)"), 'un id rompió el manejador en línea')
    assert.ok(html.includes(ESCAPADO), 'el dato no se pintó')
  })

  test('HU-R4-11 CA_5: los desactivados se pintan atenuados con «Inactivo» y botón de reactivar', async () => {
    const p = cargar()
    await esperar()
    p.api._fijar!([previo({ activo: false })], null)
    ;(p.ventana.renderTable as () => void)()
    const html = p.documento.getElementById('tableBody')!.innerHTML
    assert.match(html, /Inactivo/)
    assert.match(html, /reactivarIndicador/)
    assert.doesNotMatch(html, /desactivarIndicador/)
  })

  test('HU-R4-11: sin resultados muestra el aviso vacío', async () => {
    const p = cargar()
    await esperar()
    p.api._fijar!([], null)
    ;(p.ventana.renderTable as () => void)()
    assert.match(p.documento.getElementById('tableBody')!.innerHTML, /No hay indicadores/)
  })
})

describe('HU-R4-11 desactivar y reactivar desde la tabla', () => {
  test('HU-R4-11 CA_5: desactivar pide confirmación y llama al endpoint de desactivar; reactivar al de reactivar', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([previo()], null)
    ;(p.ventana.desactivarIndicador as (id: string) => void)('id-1')
    ;(p.ventana.reactivarIndicador as (id: string) => void)('id-1')
    await esperar()
    const posts = (p.ventana.llamadas as any[]).filter((l) => l.metodo === 'POST').map((l) => l.ruta)
    assert.deepEqual(posts, ['/api/admin/indicadores/id-1/desactivar', '/api/admin/indicadores/id-1/reactivar'])
  })

  test('HU-R4-11 RN_2: la pantalla nunca llama DELETE: «eliminar» desactiva', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([previo()], null)
    ;(p.ventana.deleteIndicator as (id: string) => void)('id-1')
    await esperar()
    const llamadas = p.ventana.llamadas as any[]
    assert.ok(!llamadas.some((l) => l.metodo === 'DELETE'))
    assert.ok(llamadas.some((l) => l.ruta === '/api/admin/indicadores/id-1/desactivar'))
  })
})
