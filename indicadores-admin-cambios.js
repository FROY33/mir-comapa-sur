// indicadores-admin-cambios.js — «Cambios programados» en la ficha de edición del catálogo (HU-R4-11 CA_4).
// Gerencia, frecuencia, tipo de cálculo y acumulable de un indicador con reportes o metas no cambian al
// guardar: aplican cuando abre el siguiente periodo. Aquí se muestran con la fecha desde la que aplican y
// el Administrador puede cancelarlos mientras sigan pendientes. Todo se pinta como texto (nada de innerHTML).

(function () {
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ETIQUETA = { gerencia_id: 'Gerencia', frecuencia: 'Frecuencia', tipo_calculo: 'Tipo de cálculo', acumulable: 'Acumulable' };
  var CALCULO = { valor_directo: 'Valor directo', fraccion: 'Fracción' };

  function el(id) { return document.getElementById(id); }
  function admin() { return window.IndicadoresAdmin; }

  /** 'AAAA-MM-DD' → '1 de noviembre de 2026' (sin pasar por Date: la zona horaria movería el día). */
  function fechaLarga(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1] + ' de ' + p[0];
  }

  function valorLegible(campo, valor) {
    var catalogo = admin().catalogo() || { gerencias: [], frecuencias: [] };
    if (campo === 'gerencia_id') {
      var g = catalogo.gerencias.find(function (x) { return x.id === valor; });
      return g ? g.clave + ' — ' + g.nombre : String(valor);
    }
    if (campo === 'frecuencia') {
      var f = catalogo.frecuencias.find(function (x) { return x.clave === valor; });
      return f ? f.nombre : String(valor);
    }
    if (campo === 'tipo_calculo') return CALCULO[valor] || String(valor);
    return valor ? 'Sí' : 'No';
  }

  function nodo(etiqueta, texto, clase) {
    var n = document.createElement(etiqueta);
    n.textContent = texto;
    if (clase) n.className = clase;
    return n;
  }

  /** Pinta el cambio pendiente (o esconde la sección si no hay). */
  window.mostrarCambiosProgramados = function (cambio) {
    var caja = el('cambiosProgramados');
    caja.innerHTML = '';
    if (!cambio) { caja.style.display = 'none'; return; }
    caja.style.display = 'block';
    caja.appendChild(nodo('p', 'Cambios programados', 'cambios-titulo'));
    caja.appendChild(nodo('p', 'Aplican desde el ' + fechaLarga(cambio.vigente_desde) +
      ', cuando abre el siguiente periodo. Los reportes y metas anteriores conservan sus valores.', 'cambios-nota'));
    var lista = document.createElement('ul');
    Object.keys(ETIQUETA).forEach(function (campo) {
      if (!(campo in cambio.valores)) return;
      lista.appendChild(nodo('li', ETIQUETA[campo] + ': ' + valorLegible(campo, cambio.valores[campo])));
    });
    caja.appendChild(lista);
    var boton = nodo('button', 'Cancelar cambios programados', 'btn-cancelar-cambio');
    boton.type = 'button';
    boton.id = 'btnCancelarCambio';
    boton.onclick = function () { window.cancelarCambioProgramado(cambio.id); };
    caja.appendChild(boton);
  };

  /** Trae el cambio pendiente del indicador y lo muestra. */
  window.cargarCambiosProgramados = function (indicadorId) {
    window.mostrarCambiosProgramados(null);
    return admin().api('GET', '/api/admin/indicadores/' + indicadorId).then(function (r) {
      if (r.ok && EDITING_ID === indicadorId) window.mostrarCambiosProgramados(r.d.cambio_programado || null);
    });
  };

  window.cancelarCambioProgramado = function (cambioId) {
    if (!confirm('¿Cancelar los cambios programados? El indicador conserva su configuración actual.')) return;
    admin().api('POST', '/api/admin/cambios-programados/' + cambioId + '/cancelar').then(function (r) {
      if (!r.ok) { showToast((r.d && r.d.mensaje) || 'No se pudo cancelar el cambio'); }
      else showToast('Cambios programados cancelados', true);
      // Si ya no estaba pendiente (409) también se vuelve a leer: la ficha dice lo que hay
      if (EDITING_ID) window.cargarCambiosProgramados(EDITING_ID);
    });
  };
})();
