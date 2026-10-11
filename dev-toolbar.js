/* dev-toolbar.js
 * Panel flotante de estado para prototipado de COMAPA Platform.
 * Solo se activa en modo demo (sessionStorage.comapa-demo === '1') o con ?dev=1.
 * Persiste las selecciones en sessionStorage para sobrevivir recargas.
 */
(function () {
  var isDev =
    sessionStorage.getItem('comapa-demo') === '1' ||
    new URLSearchParams(location.search).get('dev') === '1';
  if (!isDev) return;

  // ── Constantes ─────────────────────────────────────────────────────────────

  var ESTADOS = [
    { key: 'pendiente_carga',  label: 'Borrador (sin paso 1)' },
    { key: 'borrador',         label: 'Borrador'              },
    { key: 'enviado_revision', label: 'Enviado'               },
    { key: 'observado',        label: 'Observado'    },
    { key: 'corregido',        label: 'Corregido'    },
    { key: 'aprobado_revisor', label: 'Aprobado'     },
    { key: 'cerrado',          label: 'Cerrado'      },
  ];

  var FRECUENCIAS = ['Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'];

  var SK = {
    estado : 'devt-estado',
    freq   : 'devt-freq',
    den    : 'devt-den',   // 'sin' | 'variable' | 'fijo'
    open   : 'devt-open',
  };

  // ── Utilidades ─────────────────────────────────────────────────────────────

  function hasActividad() {
    return typeof actividad !== 'undefined' && !!actividad &&
           typeof renderPage === 'function';
  }

  // ── Persistencia ───────────────────────────────────────────────────────────

  function currentDenMode() {
    if (!hasActividad()) return 'sin';
    if (!actividad.tieneDenominador) return 'sin';
    return actividad.denominadorFijo ? 'fijo' : 'variable';
  }

  function saveState() {
    if (!hasActividad()) return;
    try {
      sessionStorage.setItem(SK.estado, actividad.estado || '');
      sessionStorage.setItem(SK.freq,   actividad.frecuenciaMedicion || 'Mensual');
      sessionStorage.setItem(SK.den,    currentDenMode());
    } catch (e) {}
  }

  function restoreState() {
    if (!hasActividad()) return;
    var savedEstado = sessionStorage.getItem(SK.estado);
    var savedFreq   = sessionStorage.getItem(SK.freq);
    var savedDen    = sessionStorage.getItem(SK.den);
    // Orden: frecuencia → denominador → estado
    if (savedFreq && savedFreq !== actividad.frecuenciaMedicion) {
      applyFrecuencia(savedFreq, true);
    }
    if (savedDen && savedDen !== currentDenMode()) {
      applyDenominador(savedDen, true);
    }
    if (savedEstado && savedEstado !== actividad.estado) {
      applyEstado(savedEstado, true);
    }
  }

  // ── Reset de variables de estado de la página ──────────────────────────────
  // Variables `let` globales del script principal: accesibles por nombre desde
  // cualquier script del documento, pero NO via window[name].

  function resetPageState() {
    try { avanceSaved           = false; } catch (e) {}
    try { evidenciaSaved        = false; } catch (e) {}
    try { editingStep1          = false; } catch (e) {}
    try { editingStep2          = false; } catch (e) {}
    try { editingStep3          = false; } catch (e) {}
    try { viewingStep1          = false; } catch (e) {}
    try { viewingStep2          = false; } catch (e) {}
    try { viewingStep3          = false; } catch (e) {}
    try { analisisSaved         = false; } catch (e) {}
    try { step1Dirty            = false; } catch (e) {}
    try { step2Dirty            = false; } catch (e) {}
    try { step3Dirty            = false; } catch (e) {}
    try { correctionMade        = false; } catch (e) {}
    try { correctionNote        = '';    } catch (e) {}
    try { step1Modified         = false; } catch (e) {}
    try { step2Modified         = false; } catch (e) {}
    try { step3Modified         = false; } catch (e) {}
    try { metaLograda           = null;  } catch (e) {}
    try { avanceNum             = '';    } catch (e) {}
    try { avanceDen             = '';    } catch (e) {}
    try { avanceValue           = '';    } catch (e) {}
    try { justSaved             = false; } catch (e) {}
    try { justOpen              = false; } catch (e) {}
    try { justText              = '';    } catch (e) {}
    try { comentarioGuardado    = false; } catch (e) {}
    try { analisisLogro         = '';    } catch (e) {}
    try { analisisCausas        = '';    } catch (e) {}
    try { analisisRiesgos       = '';    } catch (e) {}
    try { analisisOportunidades = '';    } catch (e) {}
    try { analisisAcciones      = '';    } catch (e) {}
  }

  // ── Aplicar estado ─────────────────────────────────────────────────────────

  function applyEstado(key, silent) {
    if (!hasActividad()) return;
    resetPageState();

    actividad.estado = key;
    var hasDen   = !!actividad.tieneDenominador;
    var mockNum  = hasDen ? '4982000' : '2245';
    var mockDen  = hasDen ? String(actividad.denomFijoVal || '5400000') : '';
    var mockVal  = hasDen ? '92.26%' : '2,245';

    if (key === 'borrador') {
      // Regla de negocio: borrador = paso 1 completado (mínimo), paso 2 aún abierto
      try { avanceSaved  = true;    } catch (e) {}
      try { avanceNum    = mockNum; } catch (e) {}
      try { avanceDen    = mockDen; } catch (e) {}
      try { avanceValue  = mockVal; } catch (e) {}
    }

    var conAvance = ['enviado_revision','corregido','listo_validar',
                     'aprobado_revisor','cerrado','observado'];
    if (conAvance.indexOf(key) !== -1) {
      try { avanceSaved    = true;    } catch (e) {}
      try { evidenciaSaved = true;    } catch (e) {}
      try { avanceNum      = mockNum; } catch (e) {}
      try { avanceDen      = mockDen; } catch (e) {}
      try { avanceValue    = mockVal; } catch (e) {}
    }

    var conAnalisis = ['enviado_revision','corregido','listo_validar',
                       'aprobado_revisor','cerrado','observado'];
    if (conAnalisis.indexOf(key) !== -1) {
      try { analisisSaved = true; } catch (e) {}
      try { analisisLogro = 'Se logró la meta establecida para el período gracias a la optimización del proceso de facturación y atención al cliente.'; } catch (e) {}
    }

    if (key === 'observado') {
      actividad.observaciones = (actividad.observaciones && actividad.observaciones.length)
        ? actividad.observaciones
        : [{
            id: 'obs-dev-1',
            texto: 'El porcentaje reportado no coincide con el padrón actualizado. Favor de verificar cifras con el corte del mes.',
            fecha: '2026-06-10', hora: '11:32',
            autor: 'Carlos Mendoza', rolAutor: 'Revisor',
            categoria: 'Información ilegible', atendida: false
          }];
    }

    if (key === 'corregido') {
      actividad.observaciones = (actividad.observaciones && actividad.observaciones.length)
        ? actividad.observaciones
        : [{
            id: 'obs-dev-1',
            texto: 'El porcentaje reportado no coincide con el padrón actualizado. Favor de verificar cifras con el corte del mes.',
            fecha: '2026-06-10', hora: '11:32',
            autor: 'Carlos Mendoza', rolAutor: 'Revisor',
            categoria: 'Información ilegible', atendida: false
          }];
      actividad.correctionDetail = actividad.correctionDetail || {
        nota: 'Se actualizó el padrón con el corte oficial al 31 de mayo y se sustituyó el archivo por la versión firmada.',
        paso1: true,
        paso2: true,
        paso3: false,
        fecha: '2026-06-12',
        hora: '09:15'
      };
    }

    try { renderPage(); } catch (e) { console.error('[DevToolbar]', e); }
    if (!silent) saveState();
    syncUI();
  }

  // ── Aplicar frecuencia ─────────────────────────────────────────────────────

  function applyFrecuencia(freq, silent) {
    if (!hasActividad()) return;
    actividad.frecuenciaMedicion = freq;
    try { actividad.periodosAnteriores = computePeriodosAnteriores(actividad); } catch (e) {}
    try { renderPage(); } catch (e) { console.error('[DevToolbar]', e); }
    if (!silent) saveState();
    syncUI();
  }

  // ── Aplicar denominador ────────────────────────────────────────────────────
  // mode: 'sin' | 'variable' | 'fijo'

  function applyDenominador(mode, silent) {
    if (!hasActividad()) return;

    if (mode === 'sin') {
      actividad.tieneDenominador = false;
      actividad.denominadorFijo  = false;
      actividad.denominador      = '';
      actividad.denomFijoVal     = null;
    } else if (mode === 'variable') {
      actividad.tieneDenominador = true;
      actividad.denominadorFijo  = false;
      actividad.denomFijoVal     = null;
      actividad.denominador      = actividad.denominador || 'Total de usuarios activos en padrón';
    } else if (mode === 'fijo') {
      actividad.tieneDenominador = true;
      actividad.denominadorFijo  = true;
      actividad.denomFijoVal     = actividad.denomFijoVal || 5400000;
      actividad.denominador      = actividad.denominador || 'Total de usuarios activos en padrón';
    }

    var hasDen = mode !== 'sin';
    try {
      if (avanceSaved) {
        avanceNum   = hasDen ? '4982000' : '2245';
        avanceDen   = (hasDen && !actividad.denominadorFijo) ? String(actividad.denomFijoVal || '5400000') : '';
        avanceValue = hasDen ? '92.26%' : '2,245';
      }
    } catch (e) {}
    try { renderPage(); } catch (e) { console.error('[DevToolbar]', e); }
    if (!silent) saveState();
    syncUI();
  }

  // ── Sincronizar UI del toolbar ─────────────────────────────────────────────

  function syncUI() {
    if (!hasActividad()) return;

    document.querySelectorAll('.devt-estado-btn').forEach(function (b) {
      b.classList.toggle('devt-active', b.dataset.estado === actividad.estado);
    });

    var sel = document.getElementById('devtFreqSelect');
    if (sel) sel.value = actividad.frecuenciaMedicion || 'Mensual';

    var mode = currentDenMode();
    ['devtDenSin','devtDenVar','devtDenFijo'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('devt-active', el.dataset.denMode === mode);
    });
  }

  // ── CSS ────────────────────────────────────────────────────────────────────

  function injectStyles() {
    var s = document.createElement('style');
    s.textContent = `
      #devToolbar {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        background: #1E1E2E;
        color: #CDD6F4;
        border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        font-size: 12px;
        width: 248px;
        overflow: hidden;
      }
      .devt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 14px;
        background: #181825;
        gap: 8px;
        cursor: default;
      }
      .devt-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 10px;
        color: #89B4FA;
        letter-spacing: .08em;
        text-transform: uppercase;
        min-width: 0;
      }
      .devt-badge svg { width: 12px; height: 12px; flex-shrink: 0; }
      .devt-page-name {
        font-size: 10px;
        color: #585B70;
        font-weight: 400;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: 0;
        text-transform: none;
      }
      .devt-toggle-btn {
        background: none;
        border: none;
        color: #585B70;
        cursor: pointer;
        padding: 3px 4px;
        border-radius: 5px;
        line-height: 0;
        transition: color .15s, background .15s;
        flex-shrink: 0;
      }
      .devt-toggle-btn:hover { color: #CDD6F4; background: #313244; }
      #devtBody {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #devtBody[hidden] { display: none !important; }
      .devt-no-controls {
        font-size: 11px;
        color: #45475A;
        text-align: center;
        padding: 4px 0 2px;
        font-style: italic;
      }
      .devt-divider { height: 1px; background: #313244; }
      .devt-section { display: flex; flex-direction: column; gap: 6px; }
      .devt-label {
        font-size: 9.5px;
        font-weight: 700;
        color: #585B70;
        text-transform: uppercase;
        letter-spacing: .1em;
      }
      .devt-chips { display: flex; flex-wrap: wrap; gap: 4px; }
      .devt-chip {
        background: #313244;
        color: #BAC2DE;
        border: 1px solid #45475A;
        border-radius: 6px;
        padding: 3px 9px;
        font-size: 10.5px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        line-height: 1.5;
        transition: background .1s, color .1s, border-color .1s;
      }
      .devt-chip:hover { background: #45475A; color: #CDD6F4; }
      .devt-chip.devt-active {
        background: #89B4FA;
        color: #1E1E2E;
        border-color: #89B4FA;
        font-weight: 700;
      }
      .devt-select {
        background: #313244;
        color: #CDD6F4;
        border: 1px solid #45475A;
        border-radius: 7px;
        padding: 5px 8px;
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        width: 100%;
        outline: none;
      }
      .devt-select:focus { border-color: #89B4FA; }
    `;
    document.head.appendChild(s);
  }

  // ── Panel DOM ──────────────────────────────────────────────────────────────

  function buildPanel() {
    var collapsed = sessionStorage.getItem(SK.open) === '0';
    var pageName  = location.pathname.split('/').pop().replace('.html', '');

    var panel = document.createElement('div');
    panel.id = 'devToolbar';

    // Header
    var header = document.createElement('div');
    header.className = 'devt-header';

    var badge = document.createElement('div');
    badge.className = 'devt-badge';
    badge.innerHTML =
      '<svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877' +
      'M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l5.654-4.654' +
      'm5.656-4.656 4.24-4.24a1.5 1.5 0 0 1 2.12 2.12l-4.24 4.24m-5.656 4.656-1.477-1.477M6 20.25h.008v.008H6V20.25Z"/>' +
      '</svg><span>Dev</span>';
    // El nombre sale de la URL: como texto, nunca como HTML
    var pageNameEl = document.createElement('span');
    pageNameEl.className = 'devt-page-name';
    pageNameEl.textContent = pageName;
    badge.appendChild(pageNameEl);

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'devt-toggle-btn';
    toggleBtn.title = collapsed ? 'Expandir' : 'Colapsar';
    toggleBtn.innerHTML = collapsed ? iconPlus() : iconMinus();
    toggleBtn.addEventListener('click', function () {
      var body = document.getElementById('devtBody');
      if (!body) return;
      body.hidden = !body.hidden;
      var isNowCollapsed = body.hidden;
      toggleBtn.innerHTML = isNowCollapsed ? iconPlus() : iconMinus();
      toggleBtn.title     = isNowCollapsed ? 'Expandir' : 'Colapsar';
      try { sessionStorage.setItem(SK.open, isNowCollapsed ? '0' : '1'); } catch (e) {}
    });

    header.appendChild(badge);
    header.appendChild(toggleBtn);
    panel.appendChild(header);

    // Body
    var body = document.createElement('div');
    body.id = 'devtBody';
    if (collapsed) body.hidden = true;

    if (hasActividad()) {
      // — Estado —
      var secEstado = mkSection('Estado');
      var chipsEstado = document.createElement('div');
      chipsEstado.className = 'devt-chips';
      ESTADOS.forEach(function (e) {
        var btn = document.createElement('button');
        btn.className = 'devt-chip devt-estado-btn';
        btn.dataset.estado = e.key;
        btn.textContent = e.label;
        btn.addEventListener('click', function () { applyEstado(e.key); });
        chipsEstado.appendChild(btn);
      });
      secEstado.appendChild(chipsEstado);
      body.appendChild(secEstado);
      body.appendChild(mkDivider());

      // — Frecuencia —
      var secFreq = mkSection('Frecuencia');
      var sel = document.createElement('select');
      sel.className = 'devt-select';
      sel.id = 'devtFreqSelect';
      FRECUENCIAS.forEach(function (f) {
        var opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { applyFrecuencia(this.value); });
      secFreq.appendChild(sel);
      body.appendChild(secFreq);
      body.appendChild(mkDivider());

      // — Denominador —
      var secDen = mkSection('Denominador');
      var chipsDen = document.createElement('div');
      chipsDen.className = 'devt-chips';

      [
        { id: 'devtDenSin',  mode: 'sin',      label: 'Sin'      },
        { id: 'devtDenVar',  mode: 'variable',  label: 'Variable' },
        { id: 'devtDenFijo', mode: 'fijo',      label: 'Fijo'     },
      ].forEach(function (d) {
        var btn = document.createElement('button');
        btn.className = 'devt-chip';
        btn.id = d.id;
        btn.dataset.denMode = d.mode;
        btn.textContent = d.label;
        btn.addEventListener('click', function () { applyDenominador(d.mode); });
        chipsDen.appendChild(btn);
      });

      secDen.appendChild(chipsDen);
      body.appendChild(secDen);
    } else {
      var noCtrl = document.createElement('div');
      noCtrl.className = 'devt-no-controls';
      noCtrl.textContent = 'Sin controles para esta página';
      body.appendChild(noCtrl);
    }

    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  function mkSection(label) {
    var sec = document.createElement('div');
    sec.className = 'devt-section';
    var lbl = document.createElement('div');
    lbl.className = 'devt-label';
    lbl.textContent = label;
    sec.appendChild(lbl);
    return sec;
  }

  function mkDivider() {
    var d = document.createElement('div');
    d.className = 'devt-divider';
    return d;
  }

  function iconMinus() {
    return '<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14"/></svg>';
  }

  function iconPlus() {
    return '<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>';
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    injectStyles();
    buildPanel();
    syncUI();
    restoreState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }
})();
