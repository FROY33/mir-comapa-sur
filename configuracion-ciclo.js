// configuracion-ciclo.js — Sección «Ciclo de planeación» de configuracion.html (PRD0_1, ticket 8).
// Lee GET /api/planeacion/ciclo-vigente y abre el ciclo con POST /api/admin/planeacion/ciclos; ya no
// guarda nada en localStorage. El historial viene de GET /api/admin/planeacion/ciclos. Requiere session.js (pedir, escaparHTML), vistas-mir.js (formatFecha),
// planeacion-ciclo.js (cargarCicloVigente, diasEntre) y showToast de la página.

(function () {
  var CAMPOS = ['ejercicio', 'inicio_captura', 'fin_captura', 'inicio_revision'];
  var ETIQUETA_FASE = {
    programado: 'Ciclo abierto — programado',
    captura: 'Ciclo activo · Captura de metas',
    fuera_de_plazo: 'Captura cerrada · Esperando la revisión',
    revision: 'Ciclo activo · Revisión de metas',
    cerrado: 'Ciclo cerrado'
  };
  var enCurso = false;

  function el(id) { return document.getElementById(id); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  function limpiarErrores() {
    CAMPOS.forEach(function (c) {
      var e = el('ciclo-error-' + c);
      if (e) { e.textContent = ''; e.style.display = 'none'; }
    });
  }

  /** Muestra cada mensaje junto a su campo; devuelve cuántos pudo colocar. */
  function mostrarErrores(errores) {
    var n = 0;
    CAMPOS.forEach(function (c) {
      if (!errores || !errores[c]) return;
      var e = el('ciclo-error-' + c);
      if (!e) return;
      e.textContent = errores[c];
      e.style.display = '';
      n++;
    });
    return n;
  }

  /** Texto del estado del ciclo vigente: la fase y los días que faltan (HU-R4-01). */
  function detalleDeFase(c, hoy) {
    if (c.fase === 'programado') {
      var faltan = diasEntre(hoy, c.inicio_captura);
      return 'La captura abre el ' + formatFecha(c.inicio_captura) + '. Faltan ' + plural(faltan, 'día', 'días') + '.';
    }
    if (c.fase === 'captura') {
      var quedan = diasEntre(hoy, c.fin_captura);
      return 'Los enlaces capturan metas hasta el ' + formatFecha(c.fin_captura) + '. ' +
        (quedan === 0 ? 'Vence hoy.' : 'Quedan ' + plural(quedan, 'día', 'días') + '.');
    }
    if (c.fase === 'fuera_de_plazo') return 'La captura terminó el ' + formatFecha(c.fin_captura) + '. La revisión abre el ' + formatFecha(c.inicio_revision) + '.';
    if (c.fase === 'revision') return 'La revisión de metas abrió el ' + formatFecha(c.inicio_revision) + '.';
    return '';
  }

  function pintarEstado(d) {
    var tarjeta = el('ciclo-status-card');
    var c = d && d.ciclo;
    if (tarjeta) tarjeta.className = 'ciclo-status-card ' + (c ? (c.fase === 'programado' ? 'pendiente' : c.fase === 'fuera_de_plazo' ? 'entre_fases' : c.fase) : 'inactivo');
    el('ciclo-status-label').textContent = c ? ETIQUETA_FASE[c.fase] + ' · Ejercicio ' + c.ejercicio : 'Sin ciclo abierto';
    el('ciclo-status-detail').textContent = c ? detalleDeFase(c, d.hoy)
      : 'Elige el ejercicio y las fechas, y abre el ciclo para que las gerencias empiecen a definir sus metas.';
  }

  /** Los ejercicios que se pueden abrir: el actual y el siguiente, según la fecha del servidor. */
  function pintarEjercicios(hoy) {
    var anio = Number(String(hoy).slice(0, 4));
    var sel = el('ciclo-ejercicio');
    sel.innerHTML = [anio, anio + 1].map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('');
    sel.value = String(anio);
  }

  /** Resumen tras abrir: metas por gerencia y cambios programados aplicados. Todo dato va escapado. */
  function pintarResumen(r) {
    var gerencias = r.metas_creadas.por_gerencia.map(function (g) {
      return '<li><strong>' + escaparHTML(g.gerencia) + '</strong> ' + escaparHTML(g.nombre) + ': ' + plural(g.total, 'meta', 'metas') + '</li>';
    }).join('');
    var cambios = r.cambios_aplicados.length
      ? '<p>Cambios programados aplicados antes de generar las metas:</p><ul>' + r.cambios_aplicados.map(function (c) {
          return '<li>' + escaparHTML(c.codigo) + ' (vigente desde ' + formatFecha(c.vigente_desde) + ')</li>';
        }).join('') + '</ul>'
      : '<p>No había cambios programados vencidos.</p>';
    el('ciclo-resumen').innerHTML =
      '<div class="config-card"><div class="config-card-title">Ciclo ' + escaparHTML(String(r.ciclo.ejercicio)) + ' abierto</div>' +
      '<p class="config-card-subtitle">Captura del ' + formatFecha(r.ciclo.inicio_captura) + ' al ' + formatFecha(r.ciclo.fin_captura) +
      ' · revisión desde el ' + formatFecha(r.ciclo.inicio_revision) + '.</p>' +
      '<p>' + plural(r.metas_creadas.total, 'meta pendiente creada', 'metas pendientes creadas') + ':</p><ul>' + gerencias + '</ul>' + cambios + '</div>';
    el('ciclo-resumen').style.display = '';
  }

  var ETIQUETA_FASE_CORTA = { programado: 'Programado', captura: 'Captura', fuera_de_plazo: 'Fuera de plazo', revision: 'Revisión', cerrado: 'Cerrado' };

  /** Día y hora en que se abrió el ciclo, en la hora de la base. */
  function fechaApertura(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-MX', { timeZone: 'America/Monterrey', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Historial: del ejercicio más reciente al más antiguo, con fase, fechas y quién lo abrió (HU-R4-01 CA_6). */
  function pintarHistorial(ciclos) {
    var caja = el('ciclo-historial');
    if (!caja) return;
    if (!ciclos) { caja.innerHTML = '<p class="config-card-subtitle">No se pudo cargar el historial.</p>'; return; }
    if (!ciclos.length) { caja.innerHTML = '<p class="config-card-subtitle">Aún no se ha abierto ningún ciclo.</p>'; return; }
    caja.innerHTML = '<table class="config-table"><thead><tr><th>Ejercicio</th><th>Fase</th><th>Captura</th><th>Revisión desde</th><th>Abierto por</th><th>Abierto el</th></tr></thead><tbody>' +
      ciclos.map(function (c) {
        return '<tr><td>' + escaparHTML(String(c.ejercicio)) + '</td><td>' + escaparHTML(ETIQUETA_FASE_CORTA[c.fase] || c.fase) + '</td><td>' +
          escaparHTML(formatFecha(c.inicio_captura)) + ' – ' + escaparHTML(formatFecha(c.fin_captura)) + '</td><td>' +
          escaparHTML(formatFecha(c.inicio_revision)) + '</td><td>' + escaparHTML(c.abierto_por || 'Carga inicial') + '</td><td>' +
          escaparHTML(fechaApertura(c.abierto_at)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function cargarHistorial() {
    return pedir('/api/admin/planeacion/ciclos')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { pintarHistorial(d && d.ciclos); }, function () { pintarHistorial(null); });
  }

  window.cicloCargar = function () {
    return cargarCicloVigente().then(function (d) {
      if (d) pintarEjercicios(d.hoy);
      pintarEstado(d);
      return cargarHistorial();
    });
  };

  window.abrirCiclo = function () {
    if (enCurso) return Promise.resolve();
    limpiarErrores();
    var cuerpo = {
      ejercicio: el('ciclo-ejercicio').value,
      inicio_captura: el('ciclo-inicio-captura').value,
      fin_captura: el('ciclo-fin-captura').value,
      inicio_revision: el('ciclo-inicio-revision').value
    };
    if (!confirm('Abrir el ciclo de planeación ' + cuerpo.ejercicio + ' crea una meta pendiente por cada indicador activo y no se deshace. ¿Continuar?')) {
      return Promise.resolve();
    }
    enCurso = true;
    var boton = el('ciclo-abrir-btn');
    if (boton) boton.disabled = true;
    return pedir('/api/admin/planeacion/ciclos', { method: 'POST', body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) {
          pintarResumen(r.d);
          showToast('Ciclo de planeación abierto', 'success');
          return window.cicloCargar();
        }
        var colocados = mostrarErrores(r.d && r.d.errores);
        showToast(colocados ? 'Revisa los campos marcados' : ((r.d && r.d.mensaje) || 'No se pudo abrir el ciclo'), 'error');
      }, function () { showToast('No se pudo abrir el ciclo', 'error'); })
      .then(function () { enCurso = false; if (boton) boton.disabled = false; });
  };
})();
