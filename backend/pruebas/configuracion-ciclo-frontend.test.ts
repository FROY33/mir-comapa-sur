// PRD0_1, ticket 8, en el navegador: configuracion-ciclo.js (sección «Ciclo de planeación» de
// configuracion.html) abre el ciclo por la API, muestra los errores junto al campo, pide confirmación
// antes de abrir y pinta el resumen. DOM mínimo; el servidor se simula en window.respuestas.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador } from './apoyo-frontend.js'

const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)) }
const MALO = '<img src=x onerror=alert(1)>'
const ESCAPADO = '&lt;img src=x onerror=alert(1)&gt;'

// Lo que aporta la página: showToast, confirm y un `pedir` que registra las llamadas y responde con
// lo que el caso deja en window.respuestas (por «MÉTODO ruta»).
const PREAMBULO = `
window.llamadas = []; window.toasts = []; window.confirmaciones = []; window.respuestas = {};
function showToast(m) { window.toasts.push(m); }
function confirm(m) { window.confirmaciones.push(m); return window.aceptar !== false; }
function pedir(ruta, opciones) {
  opciones = opciones || {};
  var metodo = opciones.method || 'GET';
  window.llamadas.push({ metodo: metodo, ruta: ruta, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
  var r = window.respuestas[metodo + ' ' + ruta] || { status: 200, cuerpo: {} };
  return Promise.resolve({ ok: r.status < 300, status: r.status, json: function () { return Promise.resolve(r.cuerpo); } });
}
`

function cargar(respuestas: Record<string, unknown> = {}) {
  const codigo = codigoSesion() + '\n;\n' + PREAMBULO + '\n;\n' + archivo('configuracion-ciclo.js')
  const p = ejecutarEnNavegador(codigo, [], { pagina: 'configuracion.html' })
  p.ventana.respuestas = {
    'GET /api/planeacion/ciclo-vigente': { status: 200, cuerpo: { ciclo: null, hoy: '2026-10-15' } },
    ...respuestas,
  }
  return p
}
const el = (p: ReturnType<typeof cargar>, id: string) => p.documento.getElementById(id)!
const llamadas = (p: ReturnType<typeof cargar>) => p.ventana.llamadas as any[]
const posts = (p: ReturnType<typeof cargar>) => llamadas(p).filter((l) => l.metodo === 'POST')
const llenar = (p: ReturnType<typeof cargar>) => {
  el(p, 'ciclo-ejercicio').value = '2026'
  el(p, 'ciclo-inicio-captura').value = '2026-11-01'
  el(p, 'ciclo-fin-captura').value = '2026-11-15'
  el(p, 'ciclo-inicio-revision').value = '2026-11-20'
}
const abrir = async (p: ReturnType<typeof cargar>) => { (p.ventana.abrirCiclo as () => void)(); await esperar() }
const cicloCargar = async (p: ReturnType<typeof cargar>) => { (p.ventana.cicloCargar as () => void)(); await esperar() }

const CREADO = {
  ciclo: { ejercicio: 2026, inicio_captura: '2026-11-01', fin_captura: '2026-11-15', inicio_revision: '2026-11-20', fase: 'programado' },
  metas_creadas: { total: 3, por_gerencia: [{ gerencia: 'GOP', nombre: 'Operación', total: 2 }, { gerencia: 'GPL', nombre: MALO, total: 1 }] },
  cambios_aplicados: [{ codigo: 'IND-1', vigente_desde: '2026-10-01' }],
}

describe('sección «Ciclo de planeación» de Configuración', () => {
  test('sin ciclo: «Sin ciclo abierto» y los ejercicios actual y siguiente', async () => {
    const p = cargar()
    await cicloCargar(p)
    assert.equal(el(p, 'ciclo-status-label').textContent, 'Sin ciclo abierto')
    assert.match(el(p, 'ciclo-ejercicio').innerHTML, /value="2026"[\s\S]*value="2027"/)
    assert.equal(el(p, 'ciclo-ejercicio').value, '2026')
  })

  test('con ciclo en captura: fase, ejercicio y días que quedan', async () => {
    const p = cargar({ 'GET /api/planeacion/ciclo-vigente': { status: 200, cuerpo: {
      ciclo: { ejercicio: 2026, fase: 'captura', inicio_captura: '2026-10-01', fin_captura: '2026-10-20', inicio_revision: '2026-10-25' }, hoy: '2026-10-15' } } })
    await cicloCargar(p)
    assert.match(el(p, 'ciclo-status-label').textContent, /Captura de metas.*2026/)
    assert.match(el(p, 'ciclo-status-detail').textContent, /Quedan 5 días/)
  })

  test('con ciclo programado: cuántos días faltan para la captura', async () => {
    const p = cargar({ 'GET /api/planeacion/ciclo-vigente': { status: 200, cuerpo: {
      ciclo: { ejercicio: 2027, fase: 'programado', inicio_captura: '2026-10-16', fin_captura: '2026-10-30', inicio_revision: '2026-11-05' }, hoy: '2026-10-15' } } })
    await cicloCargar(p)
    assert.match(el(p, 'ciclo-status-detail').textContent, /Faltan 1 día\./)
  })

  test('historial: un ciclo en cada fase, con quién lo abrió y las fechas, y el nombre escapado', async () => {
    const f = (ejercicio: number, fase: string, abierto_por: string | null) => ({
      ejercicio, fase, abierto_por, abierto_at: '2026-10-01T15:00:00.000Z',
      inicio_captura: '2026-11-01', fin_captura: '2026-11-15', inicio_revision: '2026-11-20' })
    const p = cargar({ 'GET /api/admin/planeacion/ciclos': { status: 200, cuerpo: { hoy: '2026-10-15', ciclos: [
      f(2031, 'programado', 'Ana'), f(2030, 'captura', MALO), f(2029, 'fuera_de_plazo', 'Luis'),
      f(2028, 'revision', 'Eva'), f(2027, 'cerrado', null)] } } })
    await cicloCargar(p)
    const html = el(p, 'ciclo-historial').innerHTML
    for (const t of ['2031', '2030', '2029', '2028', '2027']) assert.ok(html.includes(t), t)
    for (const t of ['Programado', 'Captura', 'Fuera de plazo', 'Revisión', 'Cerrado']) assert.ok(html.includes(t), t)
    assert.ok(html.includes('Ana') && html.includes('Luis'))
    assert.ok(html.includes(ESCAPADO) && !html.includes(MALO))
    assert.match(html, /Carga inicial/)   // sin usuario que lo abriera
    assert.equal(html.split('<tr><td>').length - 1, 5)
  })

  test('historial sin ciclos: mensaje vacío, sin error', async () => {
    const p = cargar({ 'GET /api/admin/planeacion/ciclos': { status: 200, cuerpo: { hoy: '2026-10-15', ciclos: [] } } })
    await cicloCargar(p)
    assert.match(el(p, 'ciclo-historial').innerHTML, /Aún no se ha abierto ningún ciclo/)
    assert.equal((p.ventana.toasts as string[]).length, 0)
  })

  test('si el historial falla, el formulario y el estado siguen funcionando', async () => {
    const p = cargar({ 'GET /api/admin/planeacion/ciclos': { status: 500, cuerpo: {} } })
    await cicloCargar(p)
    assert.equal(el(p, 'ciclo-status-label').textContent, 'Sin ciclo abierto')
    assert.match(el(p, 'ciclo-historial').innerHTML, /No se pudo cargar el historial/)
  })

  test('tras abrir un ciclo, el historial se recarga', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 201, cuerpo: CREADO } })
    llenar(p)
    await abrir(p)
    assert.equal(llamadas(p).filter((l) => l.ruta === '/api/admin/planeacion/ciclos' && l.metodo === 'GET').length, 1)
  })

  test('pide confirmación antes de abrir y, si se rechaza, no llama a la API', async () => {
    const p = cargar()
    llenar(p)
    p.ventana.aceptar = false
    await abrir(p)
    assert.equal((p.ventana.confirmaciones as string[]).length, 1)
    assert.match((p.ventana.confirmaciones as string[])[0]!, /no se deshace/)
    assert.equal(posts(p).length, 0)
  })

  test('confirmado, envía ejercicio y las tres fechas', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 201, cuerpo: CREADO } })
    llenar(p)
    await abrir(p)
    assert.equal(posts(p).length, 1)
    assert.deepEqual(posts(p)[0].cuerpo, {
      ejercicio: '2026', inicio_captura: '2026-11-01', fin_captura: '2026-11-15', inicio_revision: '2026-11-20' })
    assert.ok((p.ventana.toasts as string[]).includes('Ciclo de planeación abierto'))
  })

  test('errores 422: cada mensaje junto a su campo y nada de resumen', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 422, cuerpo: {
      error: 'datos_invalidos', campo: 'fin_captura', errores: { fin_captura: 'El fin de captura debe ser posterior al inicio de captura' } } } })
    llenar(p)
    await abrir(p)
    assert.equal(el(p, 'ciclo-error-fin_captura').textContent, 'El fin de captura debe ser posterior al inicio de captura')
    assert.notEqual(el(p, 'ciclo-error-fin_captura').style.display, 'none')
    assert.equal(el(p, 'ciclo-error-inicio_captura').textContent, '')
    assert.equal(el(p, 'ciclo-resumen').innerHTML, '')
  })

  test('el error de un intento anterior se limpia al reintentar', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 422, cuerpo: { errores: { fin_captura: 'mal' } } } })
    llenar(p)
    await abrir(p)
    assert.equal(el(p, 'ciclo-error-fin_captura').textContent, 'mal')
    p.ventana.respuestas = { ...(p.ventana.respuestas as object), 'POST /api/admin/planeacion/ciclos': { status: 201, cuerpo: CREADO } }
    await abrir(p)
    assert.equal(el(p, 'ciclo-error-fin_captura').textContent, '')
  })

  test('409 ciclo_existente: el mensaje queda junto al ejercicio', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 409, cuerpo: {
      error: 'ciclo_existente', campo: 'ejercicio', errores: { ejercicio: 'Ya existe un ciclo de planeación para el ejercicio 2026' } } } })
    llenar(p)
    await abrir(p)
    assert.match(el(p, 'ciclo-error-ejercicio').textContent, /Ya existe un ciclo/)
  })

  test('tras abrir pinta el resumen: metas por gerencia y cambios aplicados, con los nombres escapados', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 201, cuerpo: CREADO } })
    llenar(p)
    await abrir(p)
    const html = el(p, 'ciclo-resumen').innerHTML
    assert.match(html, /3 metas pendientes creadas/)
    assert.match(html, /GOP<\/strong> Operación: 2 metas/)
    assert.match(html, /IND-1/)
    assert.ok(html.includes(ESCAPADO), 'el nombre se escapa')
    assert.ok(!html.includes(MALO), 'el nombre no se inserta como HTML')
  })

  test('un segundo clic mientras la solicitud sigue en curso no envía otra apertura', async () => {
    const p = cargar({ 'POST /api/admin/planeacion/ciclos': { status: 201, cuerpo: CREADO } })
    llenar(p)
    ;(p.ventana.abrirCiclo as () => void)()
    ;(p.ventana.abrirCiclo as () => void)()
    await esperar()
    assert.equal(posts(p).length, 1)
  })

  test('la página ya no usa localStorage para el ciclo y carga el script nuevo', () => {
    const html = archivo('configuracion.html')
    assert.ok(!html.includes('comapa-ciclo'))
    assert.match(html, /<script src="configuracion-ciclo\.js"><\/script>/)
    assert.match(html, /<script src="planeacion-ciclo\.js"><\/script>/)
    for (const id of ['ciclo-ejercicio', 'ciclo-inicio-captura', 'ciclo-fin-captura', 'ciclo-inicio-revision', 'ciclo-resumen', 'ciclo-abrir-btn',
      'ciclo-historial', 'ciclo-error-ejercicio', 'ciclo-error-inicio_captura', 'ciclo-error-fin_captura', 'ciclo-error-inicio_revision']) {
      assert.ok(html.includes(`id="${id}"`), id)
    }
  })
})
