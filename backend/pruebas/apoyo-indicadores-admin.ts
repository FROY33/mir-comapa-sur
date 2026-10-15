// Apoyo de las pruebas de la pantalla «Estructura de Indicadores»: carga indicadores-admin.js y
// indicadores-admin-form.js e indicadores-admin-cambios.js con un DOM mínimo y el preámbulo que aporta la página.

import { archivo, codigoSesion, ejecutarEnNavegador } from './apoyo-frontend.js'

export const esperar = async () => { for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok)) }

// Lo que aporta la página: estado global, funciones de la interfaz y un `pedir` que registra las
// llamadas en window.llamadas. Las funciones que indicadores-admin.js publica en window se
// invocan sin prefijo en su código, así que se reenvían.
export const PREAMBULO = `
var ALL = [], FILTERED = [], PAGE = 1, PER_PAGE = 15, EDITING_ID = null, SW = { acum: false, frac: false }, SEC_UNLOCKED = {};
window.llamadas = [];
function pedir(ruta, opciones) {
  opciones = opciones || {};
  window.llamadas.push({ ruta: ruta, metodo: opciones.method || 'GET', cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
  var esLectura = !opciones.method || opciones.method === 'GET';
  var rechazo = !esLectura && window.respuestaEscritura;
  return Promise.resolve({ ok: !esLectura && !rechazo, json: function () { return Promise.resolve(rechazo || (esLectura ? { mensaje: '' } : {})); } });
}
function renderPagination() {}
function validateTab(n) { return window.validateTab(n); }
function setAccordionOpen() {}
function resetForm() {}
function setToggle() {}
function closeModal() { window.cerrados = (window.cerrados || 0) + 1; }
function showToast(m, ok) { window.toasts = (window.toasts || []).concat([m]); }
function confirm(m) { window.confirmaciones = (window.confirmaciones || []).concat([m]); return window.permitirDescartar !== false; }
var renderTable = function () { return window.renderTable(); };
var populateForm = function (i) { return window.populateForm(i); };
var applyFilters = function () { return window.applyFilters(); };
var updateStats = function () { return window.updateStats(); };
var cargarIndicadores = function () { return window.cargarIndicadores(); };
function _fijar(todos, editando, sw) { ALL = todos; FILTERED = todos; EDITING_ID = editando; SW = sw || { acum: false, frac: false }; }
`

export function cargar() {
  const codigo = codigoSesion() + '\n;\n' + PREAMBULO + '\n;\n' + archivo('indicadores-admin.js') + '\n;\n' + archivo('indicadores-admin-form.js') + '\n;\n' + archivo('indicadores-admin-cambios.js')
  return ejecutarEnNavegador(codigo, ['_fijar'], { pagina: 'estructura-indicadores.html' })
}

/** Un indicador como lo deja adaptarIndicador (el estado interno de la pantalla). */
export const previo = (cambios: Record<string, unknown> = {}) => ({
  _id: 'id-1', codigo: 'PLA-1', nombre: 'Nombre', tipo: 'gerencial', gerenciaId: 'g1', gerenciaClave: 'PLA',
  gerenciaNombre: 'Gerencia de Planeación', unidadId: 'u1', nivel: 'actividad', numero: '1.2.3', frecuencia: 'mensual',
  unidadMedida: 'Porcentaje', tipoCalculo: 'valor_directo', acumulable: false, tieneDenominador: false, denominadorFijo: false,
  numeradorDesc: '', denominadorDesc: '', formula: '', resumenNarrativo: '', tipoIndicador: 'estrategico',
  medioVerificacion: 'Texto viejo', medioVerificacionId: 'medio-previo', origenMv: 'interno', sentidoMeta: 'descendente', supuestos: 'Hay presupuesto',
  esIso: true, observacionesMir: 'Nota del Excel', activo: true, ...cambios,
})

export const llenarFormulario = (p: ReturnType<typeof cargar>) => {
  const v = (id: string, valor: string) => { p.documento.getElementById(id)!.value = valor }
  v('fGerencia', 'g1'); v('fClave', 'pla-1'); v('fNombre', '  Nombre editado '); v('fDescripcion', '')
  v('fFrecuencia', 'mensual'); v('fUnidad', 'Porcentaje'); v('fFormula', ''); v('fMedioId', 'medio-1')
  v('fNumLabel', ''); v('fDenLabel', ''); v('fDenomFijoVal', '')
}

