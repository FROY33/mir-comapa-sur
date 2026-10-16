// PRD0_1, ticket 9, en el navegador (HU-R4-02): planeacion-metas-enlace.js pinta la lista de
// GET /api/planeacion/pendientes. Se ejecuta el código real con un DOM mínimo.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador, RAIZ } from './apoyo-frontend.js'

const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)) }
const MALO = '<img src=x onerror=alert(1)>'

const meta = (m: Record<string, unknown> = {}) => ({
  meta_id: 'm1', indicador_id: 'i1', codigo: 'COM-1', nombre: 'Cobertura de agua', tipo: 'mir', nivel: 'actividad',
  estado: 'meta_pendiente', vencida: false, ...m,
})
const respuesta = (metas: unknown[], extra: Record<string, unknown> = {}) => ({
  ciclo: { ejercicio: 2027, fase: 'captura', inicio_captura: '2026-11-01', fin_captura: '2026-11-15', inicio_revision: '2026-11-20' },
  hoy: '2026-11-10', metas,
  resumen: { total: metas.length, pendientes: 0, borradores: 0, vencidas: 0 }, ...extra,
})

async function cargar(cuerpo: unknown) {
  const codigo = codigoSesion() + '\n;\n' + archivo('planeacion-metas-enlace.js')
  const p = ejecutarEnNavegador(codigo, ['cargarMetas'], {
    pagina: 'planeacion-metas-enlace.html',
    respuestas: cuerpo === undefined ? {} : { '/api/planeacion/pendientes': cuerpo },
  })
  await (p.api.cargarMetas as () => Promise<void>)()
  await esperar()
  return p
}
const texto = (p: Awaited<ReturnType<typeof cargar>>, id: string) => p.documento.getElementById(id)!.innerHTML + p.documento.getElementById(id)!.textContent

describe('lista de metas del Enlace (HU-R4-02)', () => {
  test('cada fila muestra código, nombre, tipo, nivel y estado, y enlaza a la captura', async () => {
    const p = await cargar(respuesta([meta()]))
    const html = texto(p, 'metasLista')
    assert.match(html, /COM-1/)
    assert.match(html, /Cobertura de agua/)
    assert.match(html, /MIR/)
    assert.match(html, /Actividad/)
    assert.match(html, /Pendiente/)
    assert.match(html, /href="planeacion-enlace\.html\?indicador=COM-1"/)
  })

  test('el borrador se distingue del pendiente por texto y por estilo', async () => {
    const html = texto(await cargar(respuesta([meta({ estado: 'borrador_meta', codigo: 'COM-2' })])), 'metasLista')
    assert.match(html, /Borrador/)
    assert.match(html, /meta-borrador/)
    assert.doesNotMatch(texto(await cargar(respuesta([meta()])), 'metasLista'), /meta-borrador/)
  })

  test('la meta vencida lleva la marca', async () => {
    assert.match(texto(await cargar(respuesta([meta({ vencida: true })])), 'metasLista'), /Vencida/)
    assert.doesNotMatch(texto(await cargar(respuesta([meta()])), 'metasLista'), /Vencida/)
  })

  test('los nombres, códigos y niveles con HTML se escapan', async () => {
    const html = texto(await cargar(respuesta([meta({ nombre: MALO, codigo: MALO, nivel: MALO })])), 'metasLista')
    assert.ok(!html.includes('<img'), html)
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  })

  test('el resumen sale de la API', async () => {
    const p = await cargar(respuesta([meta()], { resumen: { total: 7, pendientes: 4, borradores: 3, vencidas: 2 } }))
    assert.equal(p.documento.getElementById('rpTotal')!.textContent, '7')
    assert.equal(p.documento.getElementById('rpPendiente')!.textContent, '4')
    assert.equal(p.documento.getElementById('rpBorrador')!.textContent, '3')
    assert.equal(p.documento.getElementById('rpVencida')!.textContent, '2')
  })

  test('muestra el fin de captura del ciclo', async () => {
    assert.match(texto(await cargar(respuesta([meta()])), 'metasCiclo'), /15 nov\. 2026/)
  })

  test('sin ciclo: «No hay ciclo de planeación abierto»', async () => {
    const p = await cargar({ ciclo: null, hoy: '2026-11-10', metas: [] })
    assert.match(texto(p, 'metasMensaje'), /No hay ciclo de planeación abierto/)
    assert.equal(texto(p, 'metasLista'), '')
  })

  test('sin pendientes: «Ya configuraste todas tus metas»', async () => {
    const p = await cargar(respuesta([]))
    assert.match(texto(p, 'metasMensaje'), /Ya configuraste todas tus metas\. Espera la validación del Revisor\./)
  })

  test('un filtro sin resultados muestra el estado vacío, no «todas configuradas»', async () => {
    const codigo = codigoSesion() + '\n;\n' + archivo('planeacion-metas-enlace.js')
    const p = ejecutarEnNavegador(codigo, ['cargarMetas'], {
      respuestas: { '/api/planeacion/pendientes': respuesta([]) },
    })
    p.documento.getElementById('filtroNivel')!.value = 'fin'
    await (p.api.cargarMetas as () => Promise<void>)()
    await esperar()
    const m = texto(p, 'metasMensaje')
    assert.match(m, /Ninguna meta coincide/)
    assert.doesNotMatch(m, /Ya configuraste/)
  })

  test('si la API falla avisa sin pintar filas', async () => {
    const p = await cargar(undefined)
    assert.match(texto(p, 'metasMensaje'), /No se pudieron cargar tus metas/)
  })
})

describe('la página', () => {
  const h = readFileSync(`${RAIZ}/planeacion-metas-enlace.html`, 'utf8')
  test('no carga los datos de prueba del prototipo', () => {
    assert.doesNotMatch(h, /planeacion-data\.js/)
    assert.doesNotMatch(h, /mir-actividades-data\.js/)
    assert.doesNotMatch(h, /demo-data\.js/)
    assert.doesNotMatch(h, /comapa-ciclo/)
  })
  test('carga su script y pide las metas', () => {
    assert.match(h, /<script src="planeacion-metas-enlace\.js"><\/script>/)
    assert.match(h, /cargarMetas\(\)/)
  })
})
