// ventanas-admin.js — Conecta «Ventana de captura de avance» de configuracion.html con la API
// (HU-R3-01). Los días son hábiles (lunes a viernes) contados desde que abre la captura, el día
// siguiente a que termina el periodo. El máximo lo pone el servidor: la ventana no puede ser
// más larga que el periodo (CA_2). Un cambio aplica a los periodos que se abran después (CA_5).

(function () {
  var MAXIMO = {};

  function preview(clave, dias) {
    var chip = document.getElementById('vt-prev-' + clave);
    if (!chip) return;
    var svg = chip.querySelector('svg');
    chip.textContent = dias + ' día' + (dias === 1 ? '' : 's') + ' hábil' + (dias === 1 ? '' : 'es') + ' desde que abre la captura';
    if (svg) chip.insertBefore(svg, chip.firstChild);
  }

  window.vtUpdate = function (clave) {
    var inp = document.getElementById('vt-dias-' + clave);
    var val = parseInt(inp.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (MAXIMO[clave] && val > MAXIMO[clave]) val = MAXIMO[clave];
    inp.value = val;
    preview(clave, val);
  };

  window.saveVentana = function () {
    var dias = {};
    Object.keys(MAXIMO).forEach(function (clave) {
      var inp = document.getElementById('vt-dias-' + clave);
      if (inp) dias[clave] = parseInt(inp.value, 10);
    });
    pedir('/api/admin/ventanas', { method: 'PUT', body: JSON.stringify({ dias: dias }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { showToast(r.d.mensaje || 'No se pudo guardar', 'error'); return; }
        showToast(r.d.cambios.length
          ? 'Ventana guardada. Aplica a los periodos que se abran después.'
          : 'Sin cambios que guardar', 'success');
      });
  };

  // Textos del prototipo que no corresponden al modelo
  var sub = document.querySelector('#secVentana .page-subtitle');
  if (sub) sub.textContent = 'Define cuántos días hábiles tiene el enlace para registrar el avance desde que abre la captura de cada periodo';
  var nota = document.querySelector('#secVentana > .config-card-subtitle');
  if (nota) nota.textContent = 'La captura de un periodo abre automáticamente el día siguiente a que termina, y la fecha límite es el último día hábil de la ventana (lunes a viernes). Un cambio aplica a los periodos que se abran después; los abiertos conservan su fecha límite.';
  document.querySelectorAll('#secVentana .vt-col-label').forEach(function (el) { el.textContent = 'Días hábiles desde que abre la captura'; });

  pedir('/api/admin/ventanas').then(function (r) { return r.ok ? r.json() : null; }).then(function (lista) {
    if (!lista) return;
    lista.forEach(function (f) {
      MAXIMO[f.clave] = f.maximo;
      var inp = document.getElementById('vt-dias-' + f.clave);
      if (!inp) return;
      inp.max = f.maximo;
      inp.value = f.dias_habiles;
      preview(f.clave, f.dias_habiles);
    });
  });
})();
