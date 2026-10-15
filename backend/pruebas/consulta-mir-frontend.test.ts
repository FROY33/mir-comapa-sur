// HU-R8-01 en el navegador: consulta-mir.js pinta lo que devuelve /api/consulta-mir, ordena por
// cualquier columna (CA_3), muestra N/A sin cumplimiento (CA_4) y el menú del rol que la abre.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador } from './apoyo-frontend.js'

const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)) }
const perfil = (rol: string) => `comapa_perfil=${encodeURIComponent(JSON.stringify({
  nombre: 'Ana Torres', email: 'a@b.mx', rol, gerencia: 'Comercial', gerenciaClave: 'COM', unidad: 'X', redirigirA: 'x.html',
}))}`

const fila = (codigo: string, c: Record<string, unknown> = {}) => ({
  id: `id-${codigo}`, codigo, nombre: `Indicador ${codigo}`, nivel: 'actividad', frecuencia: 'mensual', activo: true,
  resumen_narrativo: null, formula: null, unidad_medida: 'Porcentaje', tipo_calculo: 'valor_directo',
  medio_verificacion: null, origen_mv: null, es_iso: false, gerencia: { clave: 'COM', nombre: 'Gerencia Comercial' },
  unidad: 'Unidad X', estado: null, periodo: null, meta_anual: null, cumplimiento: null, ...c,
})
const FILAS = [
  fila('COM-ACT-2', { cumplimiento: 87.25, meta_anual: 1200, estado: 'aprobado_revisor', periodo: { etiqueta: 'septiembre-2026', estado: 'abierto' } }),
  fila('COM-FIN-1', { nivel: 'fin', frecuencia: 'anual', estado: 'incumplido' }),
  fila('COM-ACT-10', { cumplimiento: 40, activo: false, nombre: '<img src=x onerror=alert(1)>' }),
]

async function cargar(rol = 'admin', filas: unknown = FILAS) {
  const codigo = codigoSesion() + '\n;\n' + archivo('consulta-mir.js')
  const p = ejecutarEnNavegador(codigo, ['ordenar', 'ordenarPor', 'menuDelRol', 'datos: () => DATA'], {
    cookie: perfil(rol), pagina: 'consulta-mir.html', respuestas: { '/api/consulta-mir': filas },
  })
  await esperar()
  return p
}
const codigos = (p: Awaited<ReturnType<typeof cargar>>) =>
  (p.api.ordenar!((p.api.datos as () => unknown[])()) as { codigo: string }[]).map((r) => r.codigo)

describe('HU-R8-01 pantalla', () => {
  test('pinta las filas de la API con estado, meta anual y cumplimiento; sin cumplimiento dice N/A', async () => {
    const html = (await cargar()).htmlPintado()
    assert.match(html, /COM-ACT-2/)
    assert.match(html, /Aprobado/)
    assert.match(html, /1,200/)
    assert.match(html, /87\.3 %/)
    assert.match(html, /Incumplido/)
    assert.match(html, /N\/A/)
    assert.match(html, /Sin reporte/)
  })

  test('HU-R4-11 CA_5: el inactivo se marca «Inactivo»', async () => {
    assert.match((await cargar()).htmlPintado(), /tag-inactivo">Inactivo/)
  })

  test('los datos se escapan (XSS)', async () => {
    const html = (await cargar()).htmlPintado()
    assert.ok(!html.includes('<img src=x'))
    assert.match(html, /&lt;img src=x/)
  })

  test('CA_3: ordena por código de forma natural y el segundo clic invierte', async () => {
    const p = await cargar()
    assert.deepEqual(codigos(p), ['COM-ACT-2', 'COM-ACT-10', 'COM-FIN-1'])
    p.api.ordenarPor!('codigo')
    assert.deepEqual(codigos(p), ['COM-FIN-1', 'COM-ACT-10', 'COM-ACT-2'])
  })

  test('CA_3: ordena por cumplimiento; los N/A quedan al final en los dos sentidos', async () => {
    const p = await cargar()
    p.api.ordenarPor!('cumplimiento')
    assert.deepEqual(codigos(p), ['COM-ACT-10', 'COM-ACT-2', 'COM-FIN-1'])
    p.api.ordenarPor!('cumplimiento')
    assert.deepEqual(codigos(p), ['COM-ACT-2', 'COM-ACT-10', 'COM-FIN-1'])
  })

  test('CA_3: ordena por nivel en el orden de la MIR, no alfabético', async () => {
    const p = await cargar()
    p.api.ordenarPor!('nivel')
    assert.equal(codigos(p)[0], 'COM-FIN-1')
  })

  test('si la API falla, lo dice en vez de mostrar una tabla vacía', async () => {
    const codigo = codigoSesion() + '\n;\n' + archivo('consulta-mir.js')
    const p = ejecutarEnNavegador(codigo, [], { cookie: perfil('admin'), pagina: 'consulta-mir.html', respuestas: {} })
    await esperar()
    assert.match(p.htmlPintado(), /No se pudo cargar el catálogo/)
  })

  test('RN_2: la pantalla ya no carga datos del prototipo', () => {
    const html = archivo('consulta-mir.html')
    assert.ok(!html.includes('data/mir-comapa-sur.js'))
    assert.ok(!archivo('consulta-mir.js').includes('MIR_DATA'))
  })
})

describe('HU-R8-01 flujo paso 1: se llega desde la navegación', () => {
  test('el menú de todas las páginas del Revisor enlaza a la Consulta MIR', () => {
    for (const p of ['dashboard-revisor.html', 'bandeja-revision.html', 'historial-revisor.html',
      'reportes-revisor.html', 'planeacion-metas-revisor.html', 'revision-actividad.html']) {
      assert.match(archivo(p), /href="consulta-mir.html"/, p)
    }
  })

  test('con sesión de Revisor la página cambia al menú del Revisor; con Admin lo deja como está', async () => {
    for (const [rol, esperado] of [['revisor', ['navAdmin:add', 'navRevisor:remove', 'dashboard-revisor.html']], ['admin', []]] as const) {
      const p = await cargar(rol)
      const hechos: string[] = []
      for (const id of ['navAdmin', 'navRevisor']) {
        p.documento.getElementById(id)!.classList = { add: () => hechos.push(`${id}:add`), remove: () => hechos.push(`${id}:remove`) }
      }
      p.documento.getElementById('migaInicio')!.setAttribute = (_: string, v: string) => hechos.push(v)
      ;(p.api.menuDelRol as () => void)()
      assert.deepEqual(hechos, esperado, rol)
    }
    const html = archivo('consulta-mir.html')
    assert.match(html, /id="navRevisor"[\s\S]*href="consulta-mir.html"/)
  })
})
