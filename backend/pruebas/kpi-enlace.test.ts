// HU-R1-01 CA_5 en el navegador: el KPI «Pendientes» de dashboard-enlace.html cuenta lo mismo que
// la lista de mis-actividades, también con indicadores gerenciales. Se encontró al verificar en
// Chrome: el dashboard contaba solo los MIR (5) y la lista MIR + gerenciales (12).

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { codigoSesion, ejecutarEnNavegador, scriptDePagina } from './apoyo-frontend.js'

const esperar = async () => { for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok)) }
const perfil = `comapa_perfil=${encodeURIComponent(JSON.stringify({
  nombre: 'Ana Torres', email: 'a@b.mx', rol: 'enlace', gerencia: 'Comercial', gerenciaClave: 'COM', unidad: 'X', redirigirA: 'dashboard-enlace.html',
}))}`
const reporte = (codigo: string, tipo: 'mir' | 'gerencial', pendiente: boolean) => ({
  reporte_id: codigo, indicador_id: codigo, codigo, nombre: codigo, tipo, nivel: tipo === 'mir' ? 'actividad' : null,
  frecuencia: 'mensual', unidad: 'X', medio_verificacion: '', es_iso: false, periodo: 'septiembre-2026',
  fecha_limite: '2026-10-14', estado: pendiente ? 'pendiente_carga' : 'enviado_revision', pendiente, vencido: false, urgente: false,
  actualizado_at: '2026-10-01',
})
const REPORTES = [
  reporte('COM-ACT-1', 'mir', true), reporte('COM-ACT-2', 'mir', true), reporte('COM-ACT-3', 'mir', false),
  reporte('GER-COM-001', 'gerencial', true), reporte('GER-COM-002', 'gerencial', true), reporte('GER-COM-003', 'gerencial', true),
]

describe('HU-R1-01 CA_5: KPI del dashboard = pendientes de la lista', () => {
  test('cuenta MIR y gerenciales: 5 pendientes, como el resumen del servidor', async () => {
    const codigo = codigoSesion() + '\n;\n' + scriptDePagina('dashboard-enlace.html', 'function pintarDashboardEnlace')
    const p = ejecutarEnNavegador(codigo, [], {
      cookie: perfil, pagina: 'dashboard-enlace.html',
      respuestas: { '/api/pendientes': { reportes: REPORTES, resumen: { pendientes: 5, total: 6 } } },
    })
    await esperar()
    assert.equal(p.documento.getElementById('kpiPend')!.textContent, 5)
    assert.equal(p.documento.getElementById('kpiTotal')!.textContent, 6)
  })

  test('un indicador gerencial enlaza a su propia ficha', async () => {
    const codigo = codigoSesion() + '\n;\n' + scriptDePagina('dashboard-enlace.html', 'function pintarDashboardEnlace')
    const p = ejecutarEnNavegador(codigo, [], {
      cookie: perfil, pagina: 'dashboard-enlace.html',
      respuestas: { '/api/pendientes': { reportes: [reporte('GER-COM-001', 'gerencial', true)], resumen: { pendientes: 1, total: 1 } } },
    })
    await esperar()
    assert.match(p.documento.getElementById('deadlineList')!.innerHTML, /detalle-indicador-gerencial\.html\?id=GER-COM-001/)
  })
})
