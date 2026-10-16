// HU-R8-03 en el navegador: detalle-indicador.js pinta la ficha de /api/indicadores/:id/ficha,
// es de solo lectura (CA_4), muestra el historial o su ausencia (CA_2, CA_3) y «no encontrado» con 404 (CA_5).

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador } from './apoyo-frontend.js'

const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)) }
const perfil = (rol: string) => `comapa_perfil=${encodeURIComponent(JSON.stringify({
  nombre: 'Ana Torres', email: 'a@b.mx', rol, gerencia: 'Comercial', gerenciaClave: 'COM', unidad: 'X', redirigirA: 'x.html',
}))}`

const FICHA = {
  indicador: {
    id: 'id-1', codigo: 'COM-2.1.1', nombre: 'Porcentaje de avance <b>anual</b>', tipo: 'mir', nivel: 'componente', numero: '2.1',
    resumen_narrativo: 'Objetivo del indicador', formula: 'X / Y × 100', numerador_desc: 'Casos atendidos', denominador_desc: 'Casos recibidos',
    frecuencia: 'trimestral', unidad_medida: 'Porcentaje', tipo_calculo: 'fraccion', acumulable: true, sentido_meta: 'ascendente',
    medio_verificacion: 'Informe trimestral', origen_mv: 'interno', supuestos: null, observaciones_mir: null, es_iso: false, activo: true,
    unidad: 'Coordinación Comercial', gerencia: { clave: 'COM', nombre: 'Gerencia Comercial' },
  },
  meta: { ejercicio: 2026, meta_anual: 1200, linea_base: 0 },
  actual: { periodo: 'T3-2026', estado: 'enviado_revision', avance: 30, cumplimiento: 50 },
  historial: [
    { periodo: 'T2-2026', estado: 'cerrado', avance: 25, cumplimiento: 91.5 },
    { periodo: 'T1-2026', estado: 'incumplido', avance: null, cumplimiento: null },
  ],
}

async function cargar(respuesta: unknown, rol = 'revisor') {
  const codigo = 'window.location.search = "?id=id-1";\n' + codigoSesion() + '\n;\n' + archivo('menu-rol.js') + '\n;\n' + archivo('detalle-indicador.js')
  const respuestas = respuesta === undefined ? {} : { '/api/indicadores/id-1/ficha': respuesta }
  const p = ejecutarEnNavegador(codigo, [], { cookie: perfil(rol), pagina: 'detalle-indicador.html', respuestas })
  await esperar()
  return p
}

describe('HU-R8-03 pantalla', () => {
  test('CA_1: pinta los campos del indicador: objetivo, fórmula, variables, tipo de cálculo, acumulable, medio, gerencia, unidad', async () => {
    const html = (await cargar(FICHA)).htmlPintado()
    for (const t of ['COM-2.1.1', 'Objetivo del indicador', 'X / Y × 100', 'Casos atendidos', 'Casos recibidos',
      'Fracción (numerador / denominador × 100)', 'Acumulable', 'Sí: se compara', 'Informe trimestral',
      'Gerencia Comercial', 'Coordinación Comercial', 'Componente', 'Trimestral']) {
      assert.ok(html.includes(t), `falta «${t}»`)
    }
  })

  test('CA_1: meta anual y línea base del ejercicio validado', async () => {
    const html = (await cargar(FICHA)).htmlPintado()
    assert.match(html, /1,200/)
    assert.match(html, /Línea base: 0/)
    assert.match(html, /ejercicio 2026/)
  })

  test('CA_3: periodo activo con estado, avance y cumplimiento', async () => {
    const html = (await cargar(FICHA)).htmlPintado()
    assert.match(html, /T3-2026/)
    assert.match(html, /En revisión/)
    assert.match(html, /50 %/)
  })

  test('CA_2: historial con avance, % y estado final; N/A sin cumplimiento', async () => {
    const html = (await cargar(FICHA)).htmlPintado()
    assert.match(html, /T2-2026[\s\S]*91\.5 %[\s\S]*Validado/)
    assert.match(html, /T1-2026[\s\S]*N\/A[\s\S]*Incumplido/)
  })

  test('CA_2: sin periodos cerrados lo dice en vez de una tabla vacía', async () => {
    const html = (await cargar({ ...FICHA, actual: null, historial: [] })).htmlPintado()
    assert.match(html, /Sin periodos cerrados todavía/)
    assert.match(html, /no tiene reporte en un periodo abierto/)
  })

  test('CA_4: solo lectura: no hay captura de avance, de meta ni de evidencia', async () => {
    const html = (await cargar(FICHA)).htmlPintado()
    for (const t of ['Reportar avance', 'Capturar meta', 'Subir MV', 'Subir evidencia', 'avanceInput', 'Guardar avance']) {
      assert.ok(!html.includes(t), `no debería aparecer «${t}»`)
    }
  })

  test('CA_4: solo el Administrador ve el enlace para editar en Estructura de Indicadores', async () => {
    assert.match((await cargar(FICHA, 'admin')).htmlPintado(), /estructura-indicadores.html/)
    assert.ok(!(await cargar(FICHA, 'revisor')).htmlPintado().includes('estructura-indicadores.html'))
  })

  test('CA_5: con 404 dice «Indicador no encontrado», sin datos', async () => {
    const html = (await cargar(undefined)).htmlPintado()
    assert.match(html, /Indicador no encontrado/)
  })

  test('los textos se escapan (XSS)', async () => {
    const html = (await cargar(FICHA)).htmlPintado()
    assert.ok(!html.includes('<b>anual</b>'))
    assert.match(html, /&lt;b&gt;anual/)
  })

  test('RN_2 de R8-01: la ficha ya no carga datos del prototipo', () => {
    assert.ok(!archivo('detalle-indicador.html').includes('data/mir-comapa-sur.js'))
    assert.ok(!archivo('detalle-indicador.js').includes('MIR_DATA'))
  })
})
