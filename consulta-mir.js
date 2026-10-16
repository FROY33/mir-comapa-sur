// consulta-mir.js — Consulta MIR (HU-R8-01) con datos de /api/consulta-mir.
// El servidor decide qué gerencias se ven (CA_6); aquí solo se filtra, ordena y pinta.
// Los filtros siguen en el navegador; pasarlos al servidor es de HU-R8-02.

var DATA = [];

var NIVEL_ORDER = ['Fin', 'Propósito', 'Componente', 'Actividad'];
var NIVEL_NOMBRE = { fin: 'Fin', proposito: 'Propósito', componente: 'Componente', actividad: 'Actividad' };
var FRECUENCIA_ORDER = ['mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual'];
var G_CLASE = { PLA: 'pe', TEC: 'tec', COM: 'com', ADM: 'adm' };
var ESTADO_EXTRA = { incumplido: { label: 'Incumplido', cls: 'vencido' } };

function capital(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
function lvClass(n) { return { 'Fin': 'fin', 'Propósito': 'proposito', 'Componente': 'componente', 'Actividad': 'actividad' }[n] || ''; }
function lvIndent(n) { return { 'Fin': '', 'Propósito': 'lv-proposito', 'Componente': 'lv-componente', 'Actividad': 'lv-actividad' }[n] || ''; }
function mvClass(t) { return { interno: 'interno', externo: 'externo', mixto: 'mixto' }[t] || ''; }
function isoBadge(r) { return r.esIso ? '<span class="iso-badge">ISO</span> ' : ''; }
function gChip(r) { return '<span class="g-chip ' + (G_CLASE[r.gerenciaClave] || 'pe') + '">' + escaparHTML(r.gerencia) + '</span>'; }

/** La fila de la API con los nombres que usa la vista. */
function adaptarFila(f) {
  return {
    id: f.id, codigo: f.codigo, nombre: f.nombre,
    gerencia: f.gerencia.nombre, gerenciaClave: f.gerencia.clave, unidad: f.unidad,
    nivel: NIVEL_NOMBRE[f.nivel] || f.nivel, frecuencia: capital(f.frecuencia), frecuenciaClave: f.frecuencia,
    activo: f.activo, estado: f.estado, periodo: f.periodo, metaAnual: f.meta_anual, cumplimiento: f.cumplimiento,
    resumen: f.resumen_narrativo, formula: f.formula, unidadMedida: f.unidad_medida,
    tieneDenominador: f.tipo_calculo === 'fraccion', medio: f.medio_verificacion, origenMv: f.origen_mv, esIso: f.es_iso,
  };
}

function estadoHtml(r) {
  if (!r.estado) return '<span class="estado-badge borrador">Sin reporte</span>';
  var c = ESTADO_EXTRA[r.estado] || ESTADO_CFG_MIR[r.estado] || { label: r.estado, cls: '' };
  return '<span class="estado-badge ' + escaparHTML(c.cls) + '">' + escaparHTML(c.label) + '</span>';
}
function metaTexto(r) { return r.metaAnual === null ? '—' : r.metaAnual.toLocaleString('es-MX'); }
function cumplimientoTexto(r) { return r.cumplimiento === null ? 'N/A' : (Math.round(r.cumplimiento * 10) / 10).toLocaleString('es-MX') + ' %'; }
function inactivoHtml(r) { return r.activo ? '' : ' <span class="tag-inactivo">Inactivo</span>'; }

var state = { gerencia: 'Todas', nivel: '', frecuencia: '', den: '', search: '', view: 'tabla', selected: null, orden: { campo: 'codigo', dir: 1 } };

function getFiltered() {
  return DATA.filter(function (r) {
    if (state.gerencia !== 'Todas' && r.gerencia !== state.gerencia) return false;
    if (state.nivel && r.nivel !== state.nivel) return false;
    if (state.frecuencia && r.frecuencia !== state.frecuencia) return false;
    if (state.den === 'si' && !r.tieneDenominador) return false;
    if (state.den === 'no' && r.tieneDenominador) return false;
    if (state.search) {
      var q = state.search.toLowerCase();
      if (r.nombre.toLowerCase().indexOf(q) === -1 && r.codigo.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });
}

// CA_3: cualquier columna, ascendente o descendente. Los vacíos van al final en los dos sentidos.
function valorOrden(r, campo) {
  if (campo === 'nivel') return NIVEL_ORDER.indexOf(r.nivel);
  if (campo === 'frecuencia') return FRECUENCIA_ORDER.indexOf(r.frecuenciaClave);
  if (campo === 'estado') return r.estado ? (ESTADO_EXTRA[r.estado] || ESTADO_CFG_MIR[r.estado] || { label: r.estado }).label : null;
  if (campo === 'meta_anual') return r.metaAnual;
  return r[campo] === undefined ? null : r[campo];
}
function ordenar(rows) {
  var campo = state.orden.campo, dir = state.orden.dir;
  return rows.slice().sort(function (a, b) {
    var x = valorOrden(a, campo), y = valorOrden(b, campo);
    if (x === null || x === '') return (y === null || y === '') ? 0 : 1;
    if (y === null || y === '') return -1;
    var c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true });
    return c * dir;
  });
}
function ordenarPor(campo) {
  state.orden = { campo: campo, dir: state.orden.campo === campo ? -state.orden.dir : 1 };
  render();
}

function hasFilters() {
  return state.gerencia !== 'Todas' || state.nivel || state.frecuencia || state.den || state.search;
}

function vacioHtml() {
  return '<div class="empty-state"><p>No se encontraron indicadores con los filtros seleccionados.</p>' +
    '<button class="btn btn-primary" onclick="clearFilters()" style="margin:0 auto">Limpiar filtros</button></div>';
}

function renderTable(rows) {
  var tbody = document.getElementById('tableBody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="10">' + vacioHtml() + '</td></tr>'; return; }
  tbody.innerHTML = rows.map(function (r) {
    return '<tr class="' + (state.selected === r.id ? 'selected' : '') + (r.activo ? '' : ' inactivo') + '" data-id="' + escaparHTML(r.id) + '" onclick="openDetail(this.dataset.id)">' +
      '<td><span class="row-id">' + escaparHTML(r.codigo) + '</span></td>' +
      '<td class="td-ind"><p>' + isoBadge(r) + escaparHTML(r.nombre) + inactivoHtml(r) + '</p></td>' +
      '<td>' + gChip(r) + '</td>' +
      '<td style="font-size:11px;color:var(--color-text-secondary)">' + escaparHTML(r.unidad || '—') + '</td>' +
      '<td><span class="level-tag ' + lvClass(r.nivel) + '">' + escaparHTML(r.nivel) + '</span></td>' +
      '<td><span class="freq-tag ' + escaparHTML(r.frecuenciaClave) + '">' + escaparHTML(r.frecuencia) + '</span></td>' +
      '<td>' + estadoHtml(r) + '</td>' +
      '<td class="td-num">' + escaparHTML(metaTexto(r)) + '</td>' +
      '<td class="td-num">' + escaparHTML(cumplimientoTexto(r)) + '</td>' +
      '<td><button class="btn-detail" data-id="' + escaparHTML(r.id) + '" onclick="event.stopPropagation();window.location=\'detalle-indicador.html?id=\'+encodeURIComponent(this.dataset.id)">Ver detalle</button></td>' +
      '</tr>';
  }).join('');
}

function renderTree(rows) {
  var container = document.getElementById('viewJerarquica');
  if (!rows.length) { container.innerHTML = vacioHtml(); return; }
  var grouped = {}, gerencias = [];
  rows.forEach(function (r) {
    if (!grouped[r.gerencia]) { grouped[r.gerencia] = {}; gerencias.push(r.gerencia); }
    (grouped[r.gerencia][r.nivel] = grouped[r.gerencia][r.nivel] || []).push(r);
  });
  container.innerHTML = gerencias.map(function (g) {
    var count = NIVEL_ORDER.reduce(function (n, nv) { return n + (grouped[g][nv] || []).length; }, 0);
    var items = NIVEL_ORDER.filter(function (n) { return grouped[g][n]; }).map(function (n) {
      return grouped[g][n].map(function (r) {
        return '<div class="tree-item ' + lvIndent(r.nivel) + (state.selected === r.id ? ' selected' : '') + '" data-id="' + escaparHTML(r.id) + '" onclick="openDetail(this.dataset.id)">' +
          '<div class="tree-item-content"><p class="tree-item-name">' + isoBadge(r) + escaparHTML(r.nombre) + inactivoHtml(r) + '</p>' +
          '<div class="tree-item-meta"><span class="level-tag ' + lvClass(r.nivel) + '">' + escaparHTML(r.nivel) + '</span>' +
          '<span class="tree-item-id">' + escaparHTML(r.codigo) + '</span>' +
          '<span class="freq-tag ' + escaparHTML(r.frecuenciaClave) + '">' + escaparHTML(r.frecuencia) + '</span>' + estadoHtml(r) + '</div></div></div>';
      }).join('');
    }).join('');
    return '<div class="tree-gerencia"><div class="tree-g-header" onclick="this.parentNode.classList.toggle(\'collapsed\')">' +
      gChip(grouped[g][Object.keys(grouped[g])[0]][0]) + '<span class="tree-g-count">' + count + ' indicadores</span>' +
      '<svg class="tree-chevron" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg></div>' +
      '<div class="tree-body">' + items + '</div></div>';
  }).join('');
}

function contador(n) { return '<strong>' + n + '</strong> indicador' + (n !== 1 ? 'es' : '') + ' encontrado' + (n !== 1 ? 's' : ''); }

function updateFiltersBar(rows) {
  var bar = document.getElementById('filtersBar');
  var chips = [];
  if (state.nivel) chips.push(['Nivel: ' + state.nivel, 'filterNivel', 'nivel']);
  if (state.frecuencia) chips.push(['Frec.: ' + state.frecuencia, 'filterFrecuencia', 'frecuencia']);
  if (state.den) chips.push([state.den === 'si' ? 'Con denominador' : 'Sin denominador', 'filterDen', 'den']);
  if (state.search) chips.push(['"' + state.search + '"', 'filterSearch', 'search']);
  if (!chips.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = '<span class="result-count">' + contador(rows.length) + '</span>' + chips.map(function (c) {
    return '<span class="filter-chip" onclick="quitarFiltro(\'' + c[1] + '\',\'' + c[2] + '\')">' + escaparHTML(c[0]) +
      ' <svg fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></span>';
  }).join('');
}
function quitarFiltro(control, campo) { document.getElementById(control).value = ''; state[campo] = ''; render(); }

function marcarOrden() {
  document.querySelectorAll('th[data-orden]').forEach(function (th) {
    var activo = th.dataset.orden === state.orden.campo;
    th.classList.toggle('orden-asc', activo && state.orden.dir === 1);
    th.classList.toggle('orden-desc', activo && state.orden.dir === -1);
    th.setAttribute('aria-sort', activo ? (state.orden.dir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

function render() {
  var rows = ordenar(getFiltered());
  document.getElementById('resultCount').innerHTML = contador(rows.length);
  document.getElementById('btnClear').classList.toggle('hidden', !hasFilters());
  updateFiltersBar(rows);
  marcarOrden();
  if (state.view === 'tabla') renderTable(rows);
  else renderTree(rows);
}

function campo(etiqueta, valor) {
  return '<div class="d-field"><span class="d-label">' + etiqueta + '</span><span class="d-value">' + valor + '</span></div>';
}

function openDetail(id) {
  var r = DATA.find(function (d) { return d.id === id; });
  if (!r) return;
  state.selected = id;
  render();
  var periodo = r.periodo ? escaparHTML(r.periodo.etiqueta) + (r.periodo.estado === 'cerrado' ? ' (cerrado)' : '') : '—';
  document.getElementById('drawerBody').innerHTML =
    '<div class="drawer-id-row"><span class="d-id">' + escaparHTML(r.codigo) + '</span>' +
    '<span class="level-tag ' + lvClass(r.nivel) + '">' + escaparHTML(r.nivel) + '</span>' + gChip(r) + '</div>' +
    '<p class="drawer-name">' + isoBadge(r) + escaparHTML(r.nombre) + inactivoHtml(r) + '</p>' +
    '<div class="d-divider"></div>' +
    campo('Estado actual', estadoHtml(r)) +
    campo('Periodo', periodo) +
    campo('Meta anual', escaparHTML(metaTexto(r))) +
    campo('% Cumplimiento', escaparHTML(cumplimientoTexto(r))) +
    campo('Unidad responsable', escaparHTML(r.unidad || '—')) +
    campo('Objetivo resumido', escaparHTML(r.resumen || '—')) +
    campo('Método de cálculo', '<span class="code">' + escaparHTML(r.formula || '—') + '</span>') +
    campo('Frecuencia de medición', '<span class="freq-tag ' + escaparHTML(r.frecuenciaClave) + '">' + escaparHTML(r.frecuencia) + '</span>') +
    campo('Unidad de medida', escaparHTML(r.unidadMedida || '—')) +
    campo('Medio de verificación', escaparHTML(r.medio || '—') +
      (r.origenMv ? ' <span class="mv-tag ' + mvClass(r.origenMv) + '">' + escaparHTML(capital(r.origenMv)) + '</span>' : '')) +
    campo('Tiene denominador', r.tieneDenominador ? 'Sí' : 'No');
  document.getElementById('detailDrawer').classList.add('open');
  document.getElementById('backdrop').classList.add('active');
  document.getElementById('mainContent').classList.add('drawer-open');
}

function closeDrawer() {
  state.selected = null;
  render();
  document.getElementById('detailDrawer').classList.remove('open');
  document.getElementById('backdrop').classList.remove('active');
  document.getElementById('mainContent').classList.remove('drawer-open');
}

function clearFilters() {
  ['filterSearch', 'filterNivel', 'filterFrecuencia', 'filterUA', 'filterDen'].forEach(function (id) { document.getElementById(id).value = ''; });
  state.nivel = ''; state.frecuencia = ''; state.den = ''; state.search = '';
  syncTabsAndDropdown('Todas');
  render();
}

function syncTabsAndDropdown(gerencia) {
  state.gerencia = gerencia;
  document.querySelectorAll('.g-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.g === gerencia); });
  document.getElementById('filterUA').value = gerencia === 'Todas' ? '' : gerencia;
}

/** Pestañas y selector de gerencia con las gerencias que devolvió el servidor. Con una sola (Revisor) no se muestran. */
function pintarGerencias() {
  var conteo = {}, nombres = [];
  DATA.forEach(function (r) { if (!conteo[r.gerencia]) { conteo[r.gerencia] = 0; nombres.push(r.gerencia); } conteo[r.gerencia]++; });
  var tabs = document.getElementById('gerenciaTabs');
  var selector = document.getElementById('filterUA');
  var unaSola = nombres.length < 2;
  tabs.classList.toggle('hidden', unaSola);
  selector.closest('.filter-select-wrap').classList.toggle('hidden', unaSola);
  var boton = function (g, n) { return '<button class="g-tab' + (g === 'Todas' ? ' active' : '') + '" data-g="' + escaparHTML(g) + '">' + escaparHTML(g) + ' <span class="tab-count">' + n + '</span></button>'; };
  tabs.innerHTML = boton('Todas', DATA.length) + nombres.map(function (g) { return boton(g, conteo[g]); }).join('');
  selector.innerHTML = '<option value="">Gerencia</option>' + nombres.map(function (g) { return '<option value="' + escaparHTML(g) + '">' + escaparHTML(g) + '</option>'; }).join('');
}

function cargar() {
  return pedir('/api/consulta-mir').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (filas) {
    DATA = filas.map(adaptarFila);
    pintarGerencias();
    render();
  }).catch(function () {
    document.getElementById('resultCount').textContent = '';
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="10"><div class="empty-state"><p>No se pudo cargar el catálogo. Intenta de nuevo en un momento.</p></div></td></tr>';
  });
}

document.getElementById('gerenciaTabs').addEventListener('click', function (e) {
  var tab = e.target.closest('.g-tab');
  if (!tab) return;
  syncTabsAndDropdown(tab.dataset.g);
  render();
});
document.querySelectorAll('th[data-orden]').forEach(function (th) {
  th.addEventListener('click', function () { ordenarPor(th.dataset.orden); });
});
document.getElementById('filterSearch').addEventListener('input', function (e) { state.search = e.target.value.trim(); render(); });
document.getElementById('filterNivel').addEventListener('change', function (e) { state.nivel = e.target.value; render(); });
document.getElementById('filterFrecuencia').addEventListener('change', function (e) { state.frecuencia = e.target.value; render(); });
document.getElementById('filterUA').addEventListener('change', function (e) { syncTabsAndDropdown(e.target.value || 'Todas'); render(); });
document.getElementById('filterDen').addEventListener('change', function (e) { state.den = e.target.value; render(); });
document.getElementById('btnClear').addEventListener('click', clearFilters);
document.getElementById('backdrop').addEventListener('click', closeDrawer);
document.getElementById('drawerClose').addEventListener('click', closeDrawer);

function cambiarVista(vista) {
  state.view = vista;
  document.getElementById('btnTabla').classList.toggle('active', vista === 'tabla');
  document.getElementById('btnJerarquica').classList.toggle('active', vista !== 'tabla');
  document.getElementById('viewTabla').classList.toggle('hidden', vista !== 'tabla');
  document.getElementById('viewJerarquica').classList.toggle('hidden', vista === 'tabla');
  render();
}
document.getElementById('btnTabla').addEventListener('click', function () { cambiarVista('tabla'); });
document.getElementById('btnJerarquica').addEventListener('click', function () { cambiarVista('jerarquica'); });


menuDelRol();
cargar();
