// indicadores-admin.js — Conecta la sección «Estructura de Indicadores» con la API (R4).
// Se carga después del script en línea de estructura-indicadores.html; reemplaza las
// funciones de datos y renderizado (el formulario vive en indicadores-admin-form.js) para usar
// /api/admin/indicadores en vez de archivos
// locales del prototipo. Sigue el mismo patrón que usuarios-admin.js.

(function () {
  var CATALOGO = null;
  var GERENCIA_COLORES = {
    PLA: '#7C3AED', TEC: '#0891B2', COM: '#8B1D3A',
    ADM: '#065F46', GEN: '#6366F1',
  };
  var NIVEL_CORTO = { fin: 'F', proposito: 'P', componente: 'C', actividad: 'A' };
  var FRECUENCIA_NOMBRE = {};

  function api(metodo, ruta, cuerpo) {
    return pedir(ruta, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      });
  }

  function adaptarIndicador(ind) {
    return {
      _id: ind.id,
      codigo: ind.codigo,
      nombre: ind.nombre,
      tipo: ind.tipo || 'mir',
      gerenciaId: ind.gerencia.id,
      gerenciaClave: ind.gerencia.clave,
      gerenciaNombre: ind.gerencia.nombre,
      unidadId: (ind.unidad && ind.unidad.id) || null,
      nivel: ind.nivel,
      numero: ind.numero || '',
      frecuencia: ind.frecuencia,
      unidadMedida: ind.unidad_medida,
      tipoCalculo: ind.tipo_calculo,
      acumulable: ind.acumulable,
      tieneDenominador: ind.tipo_calculo === 'fraccion',
      denominadorFijo: ind.denominador_fijo != null,
      denominadorFijoVal: ind.denominador_fijo,
      numeradorDesc: ind.numerador_desc || '',
      denominadorDesc: ind.denominador_desc || '',
      formula: ind.formula || '',
      resumenNarrativo: ind.resumen_narrativo || '',
      tipoIndicador: ind.tipo_indicador || '',
      medioVerificacion: ind.medio_verificacion || '',
      medioVerificacionId: ind.medio_verificacion_id || null,
      origenMv: ind.origen_mv || '',
      sentidoMeta: ind.sentido_meta || 'ascendente',
      supuestos: ind.supuestos || '',
      esIso: ind.es_iso || false,
      observacionesMir: ind.observaciones_mir || '',
      activo: ind.activo,
    };
  }

  // Lo que el formulario (indicadores-admin-form.js) toma de esta pantalla
  window.IndicadoresAdmin = {
    api: api,
    catalogo: function () { return CATALOGO; },
    opciones: function (select, primera, lista) { return opciones(select, primera, lista); },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function opciones(select, primera, lista) {
    select.innerHTML = '<option value="">' + primera + '</option>' +
      lista.map(function (x) {
        return '<option value="' + escaparHTML(x.id || x.clave) + '">' +
          escaparHTML(x.nombre) + '</option>';
      }).join('');
  }

  // ── Catálogo (dropdowns del formulario y filtros) ─────────────────────────

  function cargarCatalogo() {
    return api('GET', '/api/admin/indicadores/catalogo').then(function (r) {
      if (!r.ok) return;
      CATALOGO = r.d;
      CATALOGO.frecuencias.forEach(function (f) { FRECUENCIA_NOMBRE[f.clave] = f.nombre; });

      opciones(document.getElementById('fGerencia'), 'Seleccionar…', CATALOGO.gerencias);
      opciones(document.getElementById('fFrecuencia'), 'Seleccionar…',
        CATALOGO.frecuencias.map(function (f) { return { id: f.clave, nombre: f.nombre }; }));

      opciones(document.getElementById('filterGerencia'), 'Todas las gerencias', CATALOGO.gerencias);
      opciones(document.getElementById('filterFrecuencia'), 'Todas las frecuencias',
        CATALOGO.frecuencias.map(function (f) { return { id: f.clave, nombre: f.nombre }; }));

      var nivelSel = document.getElementById('filterNivel');
      nivelSel.innerHTML = '<option value="">Todos los niveles</option>' +
        CATALOGO.niveles.map(function (n) {
          var corto = NIVEL_CORTO[n] || n.charAt(0).toUpperCase();
          var nombre = n.charAt(0).toUpperCase() + n.slice(1);
          return '<option value="' + escaparHTML(n) + '">' + escaparHTML(nombre) +
            ' (' + corto + ')</option>';
        }).join('');

      if (window.llenarCatalogoFormulario) window.llenarCatalogoFormulario(CATALOGO);
      updateStats();
    });
  }

  // ── Carga de indicadores ──────────────────────────────────────────────────

  window.cargarIndicadores = function () {
    return api('GET', '/api/admin/indicadores').then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje || 'No se pudieron cargar los indicadores'); return; }
      ALL = r.d.indicadores.map(adaptarIndicador);
      applyFilters();
      updateStats();
    });
  };

  // ── Tabla ─────────────────────────────────────────────────────────────────

  window.renderTable = function () {
    var tbody = document.getElementById('tableBody');
    var slice = FILTERED.slice((PAGE - 1) * PER_PAGE, PAGE * PER_PAGE);
    if (!slice.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state">' +
        '<p>No hay indicadores que coincidan con los filtros</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = slice.map(function (ind) {
      var gc = GERENCIA_COLORES[ind.gerenciaClave] || '#6B7280';
      var gn = ind.gerenciaNombre.replace('Gerencia ', '').replace(' Estratégica', '');
      var nivelCorto = NIVEL_CORTO[ind.nivel] || (ind.nivel ? ind.nivel.charAt(0).toUpperCase() : '—');
      var estadoClass = ind.activo ? 'activo' : 'inactivo';
      var estadoTexto = ind.activo ? 'Activo' : 'Inactivo';
      var trStyle = ind.activo ? '' : ' style="opacity:.55"';

      return '<tr' + trStyle + '>' +
        '<td><span class="td-clave">' + escaparHTML(ind.codigo) + '</span></td>' +
        '<td><span class="td-nombre" title="' + escaparHTML(ind.nombre) + '">' +
          escaparHTML(ind.nombre) + '</span></td>' +
        '<td><span class="gerencia-pill" style="background:' + gc + '18;color:' + gc + '">' +
          escaparHTML(gn) + '</span></td>' +
        '<td><span class="nivel-badge ' + escaparHTML(ind.nivel || '') + '">' +
          escaparHTML(nivelCorto) + '</span></td>' +
        '<td><span class="freq-chip">' +
          escaparHTML(FRECUENCIA_NOMBRE[ind.frecuencia] || ind.frecuencia) + '</span></td>' +
        '<td style="font-size:11px;color:var(--color-text-secondary)">' +
          escaparHTML(ind.unidadMedida || '—') + '</td>' +
        '<td style="text-align:center">' +
          (ind.acumulable ? '<span class="acum-icon">✓</span>' : '<span class="dash-icon">—</span>') + '</td>' +
        '<td style="text-align:center">' +
          (ind.tieneDenominador ? '<span class="frac-icon">½</span>' : '<span class="dash-icon">—</span>') + '</td>' +
        '<td><span class="estado-pill ' + estadoClass + '">' + estadoTexto + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="action-btn edit" data-id="' + escaparHTML(ind._id) +
            '" onclick="openModal(this.dataset.id)" title="Editar">' +
            '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/></svg></button>' +
          (ind.activo
            ? '<button class="action-btn del" data-id="' + escaparHTML(ind._id) +
              '" onclick="desactivarIndicador(this.dataset.id)" title="Desactivar">' +
              '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">' +
              '<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"/></svg></button>'
            : '<button class="action-btn" style="color:var(--color-success)" data-id="' + escaparHTML(ind._id) +
              '" onclick="reactivarIndicador(this.dataset.id)" title="Reactivar">' +
              '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">' +
              '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></button>') +
        '</div></td></tr>';
    }).join('');
  };

  // ── Filtros ───────────────────────────────────────────────────────────────

  window.applyFilters = function () {
    var q = (document.getElementById('searchInput').value || '').toLowerCase();
    var ger = document.getElementById('filterGerencia').value;
    var niv = document.getElementById('filterNivel').value;
    var frq = document.getElementById('filterFrecuencia').value;
    var estEl = document.getElementById('filterEstado');
    var est = estEl ? estEl.value : '';
    FILTERED = ALL.filter(function (i) {
      if (q && (i.nombre + ' ' + i.codigo).toLowerCase().indexOf(q) < 0) return false;
      if (ger && i.gerenciaId !== ger) return false;
      if (niv && i.nivel !== niv) return false;
      if (frq && i.frecuencia !== frq) return false;
      if (est === 'activo' && !i.activo) return false;
      if (est === 'inactivo' && i.activo) return false;
      return true;
    });
    PAGE = 1;
    renderTable();
    renderPagination();
  };

  window.clearFilters = function () {
    ['searchInput', 'filterGerencia', 'filterNivel', 'filterFrecuencia', 'filterEstado'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    applyFilters();
  };

  // ── Stats ─────────────────────────────────────────────────────────────────

  window.updateStats = function () {
    var activos = 0, m = 0, fr = 0, ac = 0, df = 0;
    var porGerencia = {};
    ALL.forEach(function (i) {
      if (!i.activo) return;
      activos++;
      if (i.frecuencia === 'mensual') m++;
      if (i.tieneDenominador) fr++;
      if (i.acumulable) ac++;
      if (i.denominadorFijo) df++;
      porGerencia[i.gerenciaClave] = (porGerencia[i.gerenciaClave] || 0) + 1;
    });
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiTotal', activos);
    set('kpiMensual', m);
    set('kpiFrac', fr);
    set('kpiAcum', ac);
    set('totalBadge', activos);
    set('tabCount', activos);
    set('rpTotal', activos);

    var container = document.getElementById('rpGerenciaStats');
    if (container && CATALOGO) {
      container.innerHTML = CATALOGO.gerencias.map(function (g) {
        var nombre = g.nombre.replace('Gerencia ', '').replace(' Estratégica', '');
        return '<div class="rp-stat-row"><span class="rp-stat-label">' + escaparHTML(nombre) +
          '</span><span class="rp-stat-val">' + (porGerencia[g.clave] || 0) + '</span></div>';
      }).join('');
    }

    set('rpFrac', fr);
    set('rpAcumRp', ac);
    set('rpDenFijo', df);
  };

  // ── Desactivar / Reactivar ────────────────────────────────────────────────

  window.desactivarIndicador = function (id) {
    var ind = ALL.find(function (i) { return i._id === id; });
    if (!ind) return;
    if (!confirm('¿Desactivar el indicador ' + ind.codigo +
        '?\nNo aparecerá en ciclos nuevos, pero sí en el historial.')) return;
    api('POST', '/api/admin/indicadores/' + id + '/desactivar').then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje || 'No se pudo desactivar'); return; }
      showToast('Indicador desactivado', true);
      cargarIndicadores();
    });
  };

  window.reactivarIndicador = function (id) {
    api('POST', '/api/admin/indicadores/' + id + '/reactivar').then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje || 'No se pudo reactivar'); return; }
      showToast('Indicador reactivado', true);
      cargarIndicadores();
    });
  };

  window.deleteIndicator = function (id) { window.desactivarIndicador(id); };

  // ── Init ──────────────────────────────────────────────────────────────────
  ALL = [];
  FILTERED = [];
  renderTable();
  renderPagination();
  updateStats();
  cargarCatalogo();
  cargarIndicadores();
})();
