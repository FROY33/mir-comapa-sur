// HU-R4-11 CA_4 (ticket 3, issue 007): la ficha de edición muestra los «Cambios programados» con los
// valores nuevos y desde cuándo aplican, y deja cancelarlos. Mismo DOM mínimo que
// indicadores-admin-frontend.test.ts.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo } from './apoyo-frontend.js'
import { cargar, esperar, previo } from './apoyo-indicadores-admin.js'

const MALO = '<img src=x onerror=alert(1)>'
const CAMBIO = {
  id: 'cambio-1', indicador_id: 'id-1', vigente_desde: '2026-11-01', created_at: '2026-10-15T10:00:00Z',
  valores: { frecuencia: 'trimestral', tipo_calculo: 'fraccion', acumulable: true },
}

async function nueva() {
  const p = cargar()
  await esperar()
  p.ventana.llamadas = []
  p.api._fijar!([previo()], 'id-1')
  return p
}
const mostrar = (p: Awaited<ReturnType<typeof nueva>>, cambio: unknown) => (p.ventana.mostrarCambiosProgramados as (c: unknown) => void)(cambio)
const caja = (p: Awaited<ReturnType<typeof nueva>>) => p.documento.getElementById('cambiosProgramados')!

describe('HU-R4-11 CA_4: «Cambios programados» en la ficha de edición', () => {
  test('muestra los valores nuevos y la fecha desde la que aplican', async () => {
    const p = await nueva()
    mostrar(p, CAMBIO)
    assert.equal(caja(p).style.display, 'block')
    const t = p.textoPintado()
    assert.match(t, /Cambios programados/)
    assert.match(t, /1 de noviembre de 2026/)
    assert.match(t, /Frecuencia: trimestral/)
    assert.match(t, /Tipo de cálculo: Fracción/)
    assert.match(t, /Acumulable: Sí/)
    assert.doesNotMatch(t, /Gerencia:/, 'solo lo que cambia')
  })

  test('sin cambio pendiente la sección se esconde', async () => {
    const p = await nueva()
    mostrar(p, CAMBIO)
    mostrar(p, null)
    assert.equal(caja(p).style.display, 'none')
  })

  test('los valores se pintan como texto, nunca como HTML', async () => {
    const p = await nueva()
    mostrar(p, { ...CAMBIO, valores: { frecuencia: MALO } })
    assert.ok(!p.htmlPintado().includes('onerror'))
    assert.ok(p.textoPintado().includes(MALO))
  })

  test('al editar un indicador pide su detalle para traer el cambio pendiente', async () => {
    const p = await nueva()
    ;(p.ventana.openModal as (id: string) => void)('id-1')
    await esperar()
    assert.ok((p.ventana.llamadas as any[]).some((l) => l.metodo === 'GET' && l.ruta === '/api/admin/indicadores/id-1'))
  })

  test('cancelar pide confirmación y llama a la API; si el Administrador se arrepiente no llama', async () => {
    const p = await nueva()
    mostrar(p, CAMBIO)
    ;(p.ventana.cancelarCambioProgramado as (id: string) => void)('cambio-1')
    await esperar()
    assert.deepEqual(
      (p.ventana.llamadas as any[]).filter((l) => l.metodo === 'POST').map((l) => l.ruta),
      ['/api/admin/cambios-programados/cambio-1/cancelar'])
    assert.ok((p.ventana.toasts as string[]).includes('Cambios programados cancelados'))

    p.ventana.llamadas = []
    p.ventana.permitirDescartar = false
    ;(p.ventana.cancelarCambioProgramado as (id: string) => void)('cambio-1')
    await esperar()
    assert.equal((p.ventana.llamadas as any[]).filter((l) => l.metodo === 'POST').length, 0)
  })

  test('la página trae el contenedor y carga el script', () => {
    const html = archivo('estructura-indicadores.html')
    assert.match(html, /id="cambiosProgramados"/)
    assert.match(html, /<script src="indicadores-admin-cambios\.js"><\/script>/)
  })
})
