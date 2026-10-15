// HU-R4-11 frontend: indicadores-admin.js (pantalla «Estructura de Indicadores») con un DOM mínimo.
// El script se carga en la página después del código en línea de estructura-indicadores.html, que
// aquí se sustituye por un preámbulo con las variables y funciones que el script espera encontrar.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador } from './apoyo-frontend.js'

const MALO = '<img src=x onerror=alert(1)>'
const ESCAPADO = '&lt;img src=x onerror=alert(1)&gt;'
const esperar = async () => { for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok)) }

// Lo que aporta la página: estado global, funciones de la interfaz y un `pedir` que registra las
// llamadas en window.llamadas. Las funciones que indicadores-admin.js publica en window se
// invocan sin prefijo en su código, así que se reenvían.
const PREAMBULO = `
var ALL = [], FILTERED = [], PAGE = 1, PER_PAGE = 15, EDITING_ID = null, SW = { acum: false, frac: false }, SEC_UNLOCKED = {};
window.llamadas = [];
function pedir(ruta, opciones) {
  opciones = opciones || {};
  window.llamadas.push({ ruta: ruta, metodo: opciones.method || 'GET', cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
  var esLectura = !opciones.method || opciones.method === 'GET';
  return Promise.resolve({ ok: !esLectura, json: function () { return Promise.resolve(esLectura ? { mensaje: '' } : {}); } });
}
function renderPagination() {}
function validateTab() { return true; }
function setAccordionOpen() {}
function resetForm() {}
function setToggle() {}
function closeModal() {}
function showToast(m, ok) { window.toasts = (window.toasts || []).concat([m]); }
function confirm() { return true; }
var renderTable = function () { return window.renderTable(); };
var applyFilters = function () { return window.applyFilters(); };
var updateStats = function () { return window.updateStats(); };
var cargarIndicadores = function () { return window.cargarIndicadores(); };
function _fijar(todos, editando, sw) { ALL = todos; FILTERED = todos; EDITING_ID = editando; SW = sw || { acum: false, frac: false }; }
`

function cargar() {
  const codigo = codigoSesion() + '\n;\n' + PREAMBULO + '\n;\n' + archivo('indicadores-admin.js')
  return ejecutarEnNavegador(codigo, ['_fijar'], { pagina: 'estructura-indicadores.html' })
}

/** Un indicador como lo deja adaptarIndicador (el estado interno de la pantalla). */
const previo = (cambios: Record<string, unknown> = {}) => ({
  _id: 'id-1', codigo: 'PLA-1', nombre: 'Nombre', tipo: 'gerencial', gerenciaId: 'g1', gerenciaClave: 'PLA',
  gerenciaNombre: 'Gerencia de Planeación', unidadId: 'u1', nivel: 'actividad', numero: '1.2.3', frecuencia: 'mensual',
  unidadMedida: 'Porcentaje', tipoCalculo: 'valor_directo', acumulable: false, tieneDenominador: false, denominadorFijo: false,
  numeradorDesc: '', denominadorDesc: '', formula: '', resumenNarrativo: '', tipoIndicador: 'estrategico',
  medioVerificacion: 'Texto viejo', origenMv: 'interno', sentidoMeta: 'descendente', supuestos: 'Hay presupuesto',
  esIso: true, observacionesMir: 'Nota del Excel', activo: true, ...cambios,
})

const llenarFormulario = (p: ReturnType<typeof cargar>) => {
  const v = (id: string, valor: string) => { p.documento.getElementById(id)!.value = valor }
  v('fGerencia', 'g1'); v('fClave', 'pla-1'); v('fNombre', '  Nombre editado '); v('fDescripcion', '')
  v('fFrecuencia', 'mensual'); v('fUnidad', 'Porcentaje'); v('fFormula', ''); v('fMedioTexto', '  Informe del medio  ')
  v('fNumLabel', ''); v('fDenLabel', ''); v('fDenomFijoVal', '')
}

describe('HU-R4-11 formulario de edición (saveIndicator)', () => {
  test('HU-R4-11 CA_2: al editar conserva los campos que el formulario no muestra y envía el texto de #fMedioTexto', async () => {
    const p = cargar()
    await esperar()
    p.ventana.llamadas = []
    p.api._fijar!([previo()], 'id-1')
    llenarFormulario(p)
    ;(p.ventana.saveIndicator as () => void)()
    await esperar()

    const put = (p.ventana.llamadas as any[]).find((l) => l.metodo === 'PUT')
    assert.equal(put.ruta, '/api/admin/indicadores/id-1')
    const c = put.cuerpo
    assert.equal(c.medio_verificacion, 'Informe del medio')
    assert.equal(c.nombre, 'Nombre editado')
    assert.equal(c.codigo, 'PLA-1')
    // Conservados del indicador cargado: el PUT reemplaza todo
    assert.deepEqual(
      [c.tipo, c.sentido_meta, c.unidad_id, c.numero, c.tipo_indicador, c.supuestos, c.es_iso, c.observaciones_mir],
      ['gerencial', 'descendente', 'u1', '1.2.3', 'estrategico', 'Hay presupuesto', true, 'Nota del Excel'])
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
    assert.equal(c.medio_verificacion, 'Informe del medio')
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
