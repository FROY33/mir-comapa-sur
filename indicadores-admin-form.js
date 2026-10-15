// indicadores-admin-form.js — Formulario de alta y edición de indicadores (R4, HU-R4-11 CA_2).
// Se carga después de indicadores-admin.js (de donde toma la API y el catálogo con
// window.IndicadoresAdmin) y reemplaza las funciones del formulario de estructura-indicadores.html:
// errores por campo, formulario completo, aviso al cerrar con cambios y operación con teclado.

(function () {
  var cerrarOriginal = closeModal;
  var setToggleOriginal = setToggle;
  var resetFormOriginal = resetForm;
  var INSTANTANEA = null;   // el formulario como quedó al abrirlo; null = no hay nada que proteger
  var ULTIMO_FOCO = null;

  // Campo de la API (el mismo nombre que devuelve `campo`/`errores` en el 422) → control, sección del acordeón
  // y cuál de los dos pasos lo contiene. El mensaje va en <p id="err-{campo}"> junto al control.
  var CAMPOS = {
    gerencia_id: { id: 'fGerencia', sec: 1 }, codigo: { id: 'fClave', sec: 1 },
    tipo: { id: 'fTipo', sec: 1 }, unidad_id: { id: 'fUnidadResp', sec: 1 },
    nivel: { id: 'nF', sec: 1 }, nombre: { id: 'fNombre', sec: 1 },
    medio_verificacion_id: { id: 'fMedioId', sec: 1 }, origen_mv: { id: 'mvI', sec: 1 },
    frecuencia: { id: 'fFrecuencia', sec: 2 }, unidad_medida: { id: 'fUnidad', sec: 2 },
    acumulable: { id: 'swAcum', sec: 2 }, tipo_calculo: { id: 'swFrac', sec: 2 },
    tipo_indicador: { id: 'fTipoIndicador', sec: 2 }, sentido_meta: { id: 'fSentido', sec: 2 },
  };
  var CONTROLES = [
    'fGerencia', 'fClave', 'fTipo', 'fUnidadResp', 'fNombre', 'fDescripcion', 'fMedioId', 'fFrecuencia',
    'fUnidad', 'fFormula', 'fNumLabel', 'fDenLabel', 'fDenomFijoVal', 'fTipoIndicador', 'fSentido', 'fSupuestos',
  ];

  function el(id) { return document.getElementById(id); }
  function admin() { return window.IndicadoresAdmin; }
  function radio(nombre) { return document.querySelector('input[name=' + nombre + ']:checked'); }

  // ── Errores junto al campo ────────────────────────────────────────────────

  function ponerError(campo, mensaje) {
    var def = CAMPOS[campo];
    var err = el('err-' + campo);
    var control = def && el(def.id);
    if (err) { err.textContent = mensaje; err.style.display = mensaje ? 'block' : 'none'; }
    if (control) {
      control.classList.toggle('has-error', !!mensaje);
      control.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
      control.setAttribute('aria-describedby', 'err-' + campo);
    }
  }

  function limpiarErrores() {
    Object.keys(CAMPOS).forEach(function (campo) { ponerError(campo, ''); });
  }

  /** Pinta `{campo: mensaje}`, abre la sección del primero y le da el foco. Lo que no tiene sitio va a un aviso. */
  function mostrarErrores(errores) {
    limpiarErrores();
    var sueltos = [];
    var primero = null;
    Object.keys(errores).forEach(function (campo) {
      if (!CAMPOS[campo] || !el('err-' + campo)) { sueltos.push(errores[campo]); return; }
      ponerError(campo, errores[campo]);
      if (!primero) primero = CAMPOS[campo];
    });
    if (primero) {
      SEC_UNLOCKED[primero.sec] = true;
      setAccordionOpen(primero.sec, true);
      var control = el(primero.id);
      if (control && control.focus) control.focus();
    }
    if (sueltos.length) showToast(sueltos.join('. '));
  }

  /** Obligatorios que se pueden revisar sin el servidor (las mismas reglas que validar() de la API). */
  function validarCliente(seccion) {
    var errores = {};
    var vacio = function (id) { return !el(id).value.trim(); };
    if (seccion === 1) {
      if (!el('fGerencia').value) errores.gerencia_id = 'Selecciona la gerencia';
      if (vacio('fClave')) errores.codigo = 'Ingresa la clave del indicador';
      if (vacio('fNombre')) errores.nombre = 'Ingresa el nombre del indicador';
      if ((el('fTipo').value || 'mir') === 'mir' && !el('fMedioId').value) {
        errores.medio_verificacion_id = 'Selecciona el medio de verificación (obligatorio en un indicador MIR)';
      }
    } else {
      if (!el('fFrecuencia').value) errores.frecuencia = 'Selecciona la frecuencia de reporte';
      if (vacio('fUnidad')) errores.unidad_medida = 'Ingresa la unidad de medida';
    }
    return errores;
  }

  window.validateTab = function (n) {
    var errores = validarCliente(n);
    if (Object.keys(errores).length) { mostrarErrores(errores); return false; }
    limpiarErrores();
    return true;
  };

  // ── Catálogo en el formulario ─────────────────────────────────────────────

  function llenarUnidades(gerenciaId, seleccionada) {
    var catalogo = admin().catalogo();
    var gerencia = catalogo && catalogo.gerencias.find(function (g) { return g.id === gerenciaId; });
    admin().opciones(el('fUnidadResp'), 'Sin unidad asignada', gerencia ? gerencia.unidades : []);
    el('fUnidadResp').value = seleccionada || '';
  }

  // Los medios llegan en el catálogo de esta pantalla; la consulta y el mantenimiento de medios
  // (y su selector definitivo) son del ticket 4 (S2-TEC-03).
  window.llenarCatalogoFormulario = function (catalogo) {
    var seleccionado = el('fMedioId').value;
    admin().opciones(el('fMedioId'), 'Seleccionar…', catalogo.medios_verificacion || []);
    el('fMedioId').value = seleccionado;
  };

  window.updateIdSuggestion = function () {
    var gerenciaId = el('fGerencia').value;
    llenarUnidades(gerenciaId, '');
    var catalogo = admin().catalogo();
    if (!gerenciaId || !catalogo) return;
    var gerencia = catalogo.gerencias.find(function (g) { return g.id === gerenciaId; });
    if (!gerencia) return;
    var n = ALL.filter(function (i) { return i.gerenciaClave === gerencia.clave; }).length + 1;
    var sug = gerencia.clave + '-' + n;
    if (!el('fClave').value) el('fClave').value = sug;
    el('claveHint').textContent = 'Sugerida: ' + sug;
  };

  // ── Abrir, rellenar, restablecer ──────────────────────────────────────────

  window.resetForm = function () {
    resetFormOriginal();
    el('fTipo').value = 'mir';
    el('fMedioId').value = '';
    el('fTipoIndicador').value = '';
    el('fSentido').value = 'ascendente';
    el('fSupuestos').value = '';
    el('fIso').checked = false;
    llenarUnidades('', '');
    limpiarErrores();
  };

  window.populateForm = function (ind) {
    el('fGerencia').value = ind.gerenciaId;
    llenarUnidades(ind.gerenciaId, ind.unidadId);
    el('fTipo').value = ind.tipo || 'mir';
    el('fClave').value = ind.codigo;
    el('fNombre').value = ind.nombre;
    el('fDescripcion').value = ind.resumenNarrativo || '';
    el('fFrecuencia').value = ind.frecuencia;
    el('fUnidad').value = ind.unidadMedida || '';
    el('fFormula').value = ind.formula || '';
    el('fTipoIndicador').value = ind.tipoIndicador || '';
    el('fSentido').value = ind.sentidoMeta || 'ascendente';
    el('fSupuestos').value = ind.supuestos || '';
    el('fIso').checked = !!ind.esIso;
    el('fMedioId').value = ind.medioVerificacionId || '';

    var nEl = document.querySelector('input[name=fNivel][value="' + (ind.nivel || 'actividad') + '"]');
    if (nEl) nEl.checked = true;
    var mvEl = document.querySelector('input[name=fMV][value="' + (ind.origenMv || 'interno') + '"]');
    if (mvEl) mvEl.checked = true;

    setToggle('acum', !!ind.acumulable);
    setToggle('frac', ind.tieneDenominador);
    if (ind.tieneDenominador) {
      el('fNumLabel').value = ind.numeradorDesc || '';
      el('fDenLabel').value = ind.denominadorDesc || '';
      el('fDenomFijo').checked = ind.denominadorFijo;
      if (ind.denominadorFijo) {
        el('denomFijoValRow').style.display = 'block';
        el('fDenomFijoVal').value = ind.denominadorFijoVal || '';
      }
    }
  };

  window.setToggle = function (key, val) {
    setToggleOriginal(key, val);
    var sw = el(key === 'acum' ? 'swAcum' : 'swFrac');
    if (sw) sw.setAttribute('aria-checked', val ? 'true' : 'false');
  };

  function instantanea() {
    var valores = CONTROLES.map(function (id) { return el(id).value; });
    var n = radio('fNivel'), mv = radio('fMV');
    valores.push(el('fDenomFijo').checked, el('fIso').checked, SW.acum, SW.frac, n && n.value, mv && mv.value);
    return JSON.stringify(valores);
  }

  window.openModal = function (id) {
    EDITING_ID = id || null;
    SW = { acum: false, frac: false };
    ULTIMO_FOCO = document.activeElement || null;
    resetForm();
    if (id) {
      var ind = ALL.find(function (i) { return i._id === id; });
      if (!ind) return;
      el('modalTitle').textContent = 'Editar indicador';
      el('modalSubtitle').textContent = ind.codigo;
      populateForm(ind);
      window.cargarCambiosProgramados(id);   // HU-R4-11 CA_4: lo programado y aún sin aplicar
      SEC_UNLOCKED[1] = true;
      SEC_UNLOCKED[2] = true;
      setAccordionOpen(1, false);
      setAccordionOpen(2, true);
    } else {
      window.mostrarCambiosProgramados(null);
      el('modalTitle').textContent = 'Nuevo indicador';
      el('modalSubtitle').textContent = 'Completa las dos secciones para registrar el indicador';
      SEC_UNLOCKED[1] = true;
      SEC_UNLOCKED[2] = false;
      setAccordionOpen(1, true);
      setAccordionOpen(2, false);
    }
    el('modalOverlay').classList.add('open');
    INSTANTANEA = instantanea();
    var primero = el(id ? 'fFrecuencia' : 'fGerencia');
    if (primero && primero.focus) primero.focus();
  };

  // ── Cerrar con cambios sin guardar ────────────────────────────────────────

  window.closeModal = function () {
    if (INSTANTANEA !== null && instantanea() !== INSTANTANEA &&
        !confirm('Hay cambios sin guardar. ¿Cerrar el formulario y descartarlos?')) return;
    INSTANTANEA = null;
    cerrarOriginal();
    if (ULTIMO_FOCO && ULTIMO_FOCO.focus) ULTIMO_FOCO.focus();
  };

  // ── Teclado ───────────────────────────────────────────────────────────────

  /** Enter o Espacio sobre un interruptor o encabezado de sección hacen lo que su clic. */
  window.activarConTeclado = function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.currentTarget.click();
  };

  document.addEventListener('keydown', function (e) {
    var overlay = el('modalOverlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    if (e.key === 'Escape') { window.closeModal(); return; }
    if (e.key !== 'Tab') return;
    // El foco no sale del formulario mientras está abierto
    var visibles = Array.prototype.filter.call(
      overlay.querySelectorAll('button, input, select, textarea, [tabindex="0"]'),
      function (c) { return c.offsetParent !== null && !c.disabled; });
    if (!visibles.length) return;
    var primero = visibles[0], ultimo = visibles[visibles.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });

  // ── Guardar ───────────────────────────────────────────────────────────────

  window.saveIndicator = function () {
    var errores = Object.assign({}, validarCliente(1), validarCliente(2));
    if (Object.keys(errores).length) { mostrarErrores(errores); return; }
    limpiarErrores();

    var nivel = radio('fNivel');
    var mv = radio('fMV');
    var esFraccion = SW.frac;
    // Lo que el formulario no muestra se conserva del indicador cargado (el PUT reemplaza todo)
    var previo = EDITING_ID ? ALL.find(function (i) { return i._id === EDITING_ID; }) : null;

    var datos = {
      gerencia_id: el('fGerencia').value,
      codigo: el('fClave').value.trim().toUpperCase(),
      tipo: el('fTipo').value || 'mir',
      nivel: (nivel && nivel.value) || 'actividad',
      nombre: el('fNombre').value.trim(),
      resumen_narrativo: el('fDescripcion').value.trim() || null,
      unidad_medida: el('fUnidad').value.trim(),
      frecuencia: el('fFrecuencia').value,
      tipo_calculo: esFraccion ? 'fraccion' : 'valor_directo',
      acumulable: SW.acum,
      sentido_meta: el('fSentido').value || 'ascendente',
      // El texto del medio lo deriva el servidor del medio elegido
      medio_verificacion_id: el('fMedioId').value || null,
      origen_mv: (mv && mv.value) || 'interno',
      formula: el('fFormula').value.trim() || null,
      numerador_desc: esFraccion ? (el('fNumLabel').value.trim() || null) : null,
      denominador_desc: esFraccion ? (el('fDenLabel').value.trim() || null) : null,
      denominador_fijo: (esFraccion && el('fDenomFijo').checked)
        ? (parseFloat(el('fDenomFijoVal').value) || null)
        : null,
      unidad_id: el('fUnidadResp').value || null,
      numero: previo ? (previo.numero || null) : null,
      tipo_indicador: el('fTipoIndicador').value || null,
      supuestos: el('fSupuestos').value.trim() || null,
      es_iso: !!el('fIso').checked,
      observaciones_mir: previo ? (previo.observacionesMir || null) : null,
    };

    var ruta = EDITING_ID ? '/api/admin/indicadores/' + EDITING_ID : '/api/admin/indicadores';
    var editando = !!EDITING_ID;

    admin().api(editando ? 'PUT' : 'POST', ruta, datos).then(function (r) {
      if (!r.ok) {
        if (r.d && r.d.errores) { mostrarErrores(r.d.errores); showToast('Revisa los campos marcados'); }
        else showToast((r.d && r.d.mensaje) || 'No se pudo guardar el indicador');
        return;
      }
      INSTANTANEA = null;
      cerrarOriginal();
      var programado = r.d && r.d.cambio_programado;
      showToast(editando
        ? (programado ? 'Indicador actualizado. Gerencia, frecuencia, cálculo y acumulable aplican desde ' + programado.vigente_desde : 'Indicador actualizado')
        : 'Indicador registrado', true);
      cargarIndicadores();
    });
  };

  // ── Accesibilidad que no depende del HTML ─────────────────────────────────

  var overlay = el('modalOverlay');
  // Al corregir un campo se quita su error
  if (overlay && overlay.addEventListener) {
    var corregido = function (ev) {
      var id = ev.target && ev.target.id;
      Object.keys(CAMPOS).forEach(function (campo) { if (CAMPOS[campo].id === id) ponerError(campo, ''); });
      if (ev.target && ev.target.name === 'fNivel') ponerError('nivel', '');
      if (id === 'fTipo') ponerError('medio_verificacion_id', '');   // un gerencial no exige medio
    };
    overlay.addEventListener('input', corregido);
    overlay.addEventListener('change', corregido);
  }
})();
