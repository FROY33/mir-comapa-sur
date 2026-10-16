// detalle-indicador.js — Ficha técnica del indicador (HU-R8-03) con datos de /api/indicadores/:id/ficha.
// Solo lectura (CA_4): la edición es del Administrador en Estructura de Indicadores (HU-R4-11).
// El servidor decide si la ficha se puede ver (CA_5); aquí solo se pinta.

var NIVEL_NOMBRE = { fin: 'Fin', proposito: 'Propósito', componente: 'Componente', actividad: 'Actividad' };
var PERIODOS_AL_ANIO = { mensual: 12, bimestral: 6, trimestral: 4, cuatrimestral: 3, semestral: 2, anual: 1 };
var G_CLASE = { PLA: 'pe', TEC: 'tec', COM: 'com', ADM: 'adm' };
var ESTADO_EXTRA = { incumplido: { label: 'Incumplido', cls: 'vencido' } };
var PENDING = '<span class="pending-tag">Pendiente de captura</span>';

function capital(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
function txt(v) { return (v !== null && v !== undefined && v !== '') ? escaparHTML(String(v)) : PENDING; }
function numero(v) { return v === null || v === undefined ? null : Number(v).toLocaleString('es-MX', { maximumFractionDigits: 2 }); }
function porcentaje(v) { return v === null || v === undefined ? 'N/A' : (Math.round(v * 10) / 10).toLocaleString('es-MX') + ' %'; }
function estadoHtml(e) {
  if (!e) return '<span class="estado-badge borrador">Sin reporte</span>';
  var c = ESTADO_EXTRA[e] || ESTADO_CFG_MIR[e] || { label: e, cls: '' };
  return '<span class="estado-badge ' + escaparHTML(c.cls) + '">' + escaparHTML(c.label) + '</span>';
}
function campo(etiqueta, valor, ancho) {
  return '<div class="field"' + (ancho ? ' style="grid-column:1/-1"' : '') + '><span class="field-label">' + etiqueta +
    '</span><span class="field-value">' + valor + '</span></div>';
}
function seccion(titulo, cuerpo) { return '<div class="section-card"><p class="section-title">' + titulo + '</p>' + cuerpo + '</div>'; }

function encabezado(i, esAdmin) {
  var nivel = NIVEL_NOMBRE[i.nivel] || i.nivel || 'Gerencial';
  var inicio = esAdmin ? 'dashboard-admin.html' : 'dashboard-revisor.html';
  return '<div class="breadcrumb"><a href="' + inicio + '">Inicio</a><span class="sep">›</span>' +
    '<a href="consulta-mir.html">Consulta MIR</a><span class="sep">›</span>' +
    '<span>' + escaparHTML(i.gerencia.nombre) + '</span><span class="sep">›</span>' +
    '<span class="current">' + escaparHTML(i.codigo) + '</span></div>' +
    '<div class="ind-header"><div class="ind-header-top"><div style="flex:1">' +
      '<div class="ind-meta-row">' +
        '<span class="ind-id">' + escaparHTML(i.codigo) + '</span>' +
        '<span class="level-tag ' + escaparHTML(i.nivel || '') + '">' + escaparHTML(nivel) + '</span>' +
        '<span class="g-chip ' + (G_CLASE[i.gerencia.clave] || 'pe') + '">' + escaparHTML(i.gerencia.nombre) + '</span>' +
        '<span class="freq-tag ' + escaparHTML(i.frecuencia) + '">' + escaparHTML(capital(i.frecuencia)) + '</span>' +
        (i.origen_mv ? '<span class="mv-tag ' + escaparHTML(i.origen_mv) + '">MV ' + escaparHTML(capital(i.origen_mv)) + '</span>' : '') +
        (i.activo ? '' : '<span class="tag-inactivo">Inactivo</span>') +
      '</div>' +
      '<h1 class="ind-title">' + (i.es_iso ? '<span class="iso-badge">ISO</span> ' : '') + escaparHTML(i.nombre) + '</h1>' +
      '<div class="ind-actions">' +
        (esAdmin ? '<a class="btn btn-secondary" href="estructura-indicadores.html">Editar en Estructura de Indicadores</a>' : '') +
        '<a class="btn btn-ghost" href="consulta-mir.html">Volver a Consulta MIR</a>' +
      '</div>' +
    '</div></div></div>';
}

function resumenSuperior(f) {
  var i = f.indicador, m = f.meta;
  var n = PERIODOS_AL_ANIO[i.frecuencia];
  var tarjeta = function (etiqueta, valor, sub) {
    return '<div class="sum-card"><p class="sum-label">' + etiqueta + '</p>' + valor + '<p class="sum-sub">' + sub + '</p></div>';
  };
  return '<div class="summary-strip">' +
    tarjeta('Nivel MIR', '<p class="sum-value" style="font-size:15px;margin-top:2px"><span class="level-tag ' + escaparHTML(i.nivel || '') + '">' + escaparHTML(NIVEL_NOMBRE[i.nivel] || '—') + '</span></p>', 'Lógica causal MIR') +
    tarjeta('Frecuencia', '<p class="sum-value">' + escaparHTML(capital(i.frecuencia)) + '</p>', n ? n + ' reporte' + (n !== 1 ? 's' : '') + ' al año' : '') +
    tarjeta('Unidad de medida', '<p class="sum-value">' + (i.unidad_medida === 'Porcentaje' ? '%' : txt(i.unidad_medida)) + '</p>', escaparHTML(i.unidad_medida || '')) +
    tarjeta('Meta anual', m && m.meta_anual !== null ? '<p class="sum-value" style="color:var(--color-accent)">' + numero(m.meta_anual) + '</p>' : '<div style="margin-top:4px">' + PENDING + '</div>',
      m && m.linea_base !== null ? 'Línea base: ' + numero(m.linea_base) : 'Línea base pendiente') +
  '</div>';
}

var PESTANAS = [['resumen', 'Resumen'], ['medicion', 'Medición'], ['mv', 'Medio de verificación'], ['planeacion', 'Planeación'], ['historial', 'Historial']];

function panelResumen(i) {
  return seccion('Objetivo del indicador', '<div class="obj-highlight"><p>' + txt(i.resumen_narrativo) + '</p></div>') +
    seccion('Ubicación en la MIR', '<div class="field-row">' +
      campo('Gerencia responsable', escaparHTML(i.gerencia.nombre)) +
      campo('Unidad responsable', txt(i.unidad)) +
      campo('Nivel MIR', escaparHTML(NIVEL_NOMBRE[i.nivel] || '—')) +
      campo('Número en la MIR', txt(i.numero)) + '</div>');
}

function panelMedicion(i) {
  var fraccion = i.tipo_calculo === 'fraccion';
  var variables = fraccion
    ? '<div class="num-den-grid"><div class="nd-item"><span class="nd-label num">Numerador (X)</span><p class="nd-value">' + txt(i.numerador_desc) + '</p></div>' +
      '<div class="nd-operator">÷</div><div class="nd-item"><span class="nd-label den">Denominador (Y)</span><p class="nd-value">' + txt(i.denominador_desc) + '</p></div></div>'
    : '<div class="direct-block"><p>Este indicador se mide como <strong>valor directo</strong>: se reporta el valor obtenido.</p></div>';
  return seccion('Método de cálculo',
    '<div class="formula-block"><p class="formula-label">Fórmula</p><p class="formula-text">' + txt(i.formula) + '</p></div>' +
    '<div class="divider" style="margin:20px 0"></div><p class="field-label" style="margin-bottom:12px">Variables del cálculo</p>' + variables +
    '<div class="divider" style="margin:20px 0"></div><div class="field-row">' +
      campo('Tipo de cálculo', fraccion ? 'Fracción (numerador / denominador × 100)' : 'Valor directo') +
      campo('Acumulable', i.acumulable ? 'Sí: se compara la suma de avances contra la suma de metas' : 'No: cada periodo contra su meta') +
      campo('Unidad de medida', txt(i.unidad_medida)) +
      campo('Sentido de la meta', escaparHTML(capital(i.sentido_meta))) + '</div>');
}

function panelMedio(i) {
  return seccion('Medio de verificación', '<div class="mv-card"><p class="mv-name">' + txt(i.medio_verificacion) + '</p>' +
    '<div class="divider"></div><div class="field-row">' + campo('Origen', i.origen_mv ? escaparHTML(capital(i.origen_mv)) : PENDING) + '</div></div>');
}

function panelPlaneacion(f) {
  var i = f.indicador, m = f.meta;
  var valor = function (v, acento) { return v !== null && v !== undefined ? '<p class="meta-num' + (acento ? ' accent' : '') + '">' + numero(v) + '</p>' : PENDING; };
  return seccion('Línea base y meta anual' + (m ? ' · ejercicio ' + m.ejercicio : ''),
      '<div class="meta-visual"><div class="meta-item"><p class="meta-lbl">Línea base</p>' + valor(m && m.linea_base) + '</div>' +
      '<div class="meta-item"><p class="meta-lbl">Meta anual</p>' + valor(m && m.meta_anual, true) + '</div></div>' +
      '<p class="nota">Se muestran cuando la meta del ejercicio está validada.</p>') +
    seccion('Supuestos', '<p class="field-value" style="line-height:1.7">' + txt(i.supuestos) + '</p>') +
    seccion('Observaciones', '<p class="field-value" style="line-height:1.7">' + txt(i.observaciones_mir) + '</p>');
}

function panelHistorial(f) {
  var a = f.actual;
  var actual = a
    ? '<div class="field-row">' + campo('Periodo', escaparHTML(a.periodo)) + campo('Estado actual', estadoHtml(a.estado)) +
      campo('Avance reportado', a.avance === null ? 'Sin enviar' : numero(a.avance)) + campo('% Cumplimiento', porcentaje(a.cumplimiento)) + '</div>'
    : '<p class="nota">El indicador no tiene reporte en un periodo abierto.</p>';
  var filas = f.historial.map(function (h) {
    return '<tr><td>' + escaparHTML(h.periodo) + '</td><td class="num">' + (h.avance === null ? '—' : numero(h.avance)) + '</td>' +
      '<td class="num">' + porcentaje(h.cumplimiento) + '</td><td>' + estadoHtml(h.estado) + '</td></tr>';
  }).join('');
  var historial = f.historial.length
    ? '<table class="hist-table"><thead><tr><th>Periodo</th><th class="num">Avance reportado</th><th class="num">% Cumplimiento</th><th>Estado final</th></tr></thead><tbody>' + filas + '</tbody></table>'
    : '<p class="nota">Sin periodos cerrados todavía. Aquí aparecerán los últimos 3 cuando se cierren.</p>';
  return seccion('Periodo activo', actual) + seccion('Últimos 3 periodos cerrados', historial);
}

function pintarFicha(f, esAdmin) {
  var i = f.indicador;
  document.title = i.codigo + ' — Ficha técnica · MIR COMAPA Sur';
  var paneles = { resumen: panelResumen(i), medicion: panelMedicion(i), mv: panelMedio(i), planeacion: panelPlaneacion(f), historial: panelHistorial(f) };
  document.getElementById('mainContent').innerHTML = encabezado(i, esAdmin) + resumenSuperior(f) +
    '<div class="tab-strip">' + PESTANAS.map(function (p, n) {
      return '<button class="tab-btn' + (n === 0 ? ' active' : '') + '" data-tab="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '</div>' +
    PESTANAS.map(function (p, n) {
      return '<div class="tab-panel' + (n === 0 ? ' active' : '') + '" id="tab-' + p[0] + '">' + paneles[p[0]] + '</div>';
    }).join('');
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab); });
    });
  });
}

function mensaje(texto) {
  document.getElementById('mainContent').innerHTML =
    '<p style="padding:48px 24px;color:var(--color-text-secondary);text-align:center">' + escaparHTML(texto) + '</p>';
}

function cargarFicha() {
  var id = new URLSearchParams(window.location.search).get('id') || '';
  var u = typeof Session !== 'undefined' && Session.getUser();
  var esAdmin = !u || u.rol === 'Administrador';
  if (!id) { mensaje('Falta el indicador: abre la ficha desde la Consulta MIR.'); return Promise.resolve(); }
  return pedir('/api/indicadores/' + encodeURIComponent(id) + '/ficha').then(function (r) {
    if (r.status === 404) { mensaje('Indicador no encontrado.'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json().then(function (f) { pintarFicha(f, esAdmin); });
  }).catch(function () { mensaje('No se pudo cargar la ficha. Intenta de nuevo en un momento.'); });
}

if (typeof menuDelRol === 'function') menuDelRol();
cargarFicha();
