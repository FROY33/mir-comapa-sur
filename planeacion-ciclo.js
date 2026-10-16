// planeacion-ciclo.js — Ciclo de planeación de metas vigente (PRD0_1). Lo que se muestra viene de
// GET /api/planeacion/ciclo-vigente, no de localStorage. Requiere session.js (pedir, escaparHTML) y
// vistas-mir.js (formatFecha).

var FASES_CICLO_ABIERTO = ['captura', 'fuera_de_plazo', 'revision'];

/** { ciclo, hoy } de la API, o null si falla. */
function cargarCicloVigente() {
  return pedir('/api/planeacion/ciclo-vigente')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { return d && 'ciclo' in d ? d : null; }, function () { return null; });
}

/** Días calendario de `desde` a `hasta` ('AAAA-MM-DD'), sin depender de la zona del navegador. */
function diasEntre(desde, hasta) {
  var a = String(desde).split('-'), b = String(hasta).split('-');
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}

/** Muestra el ítem «Planeación de metas» solo con el ciclo en captura, fuera de plazo o revisión. */
function pintarNavPlaneacion() {
  var item = document.getElementById('navPlaneacionMetas');
  if (!item) return Promise.resolve();
  item.style.display = 'none';
  return cargarCicloVigente().then(function (d) {
    if (d && d.ciclo && FASES_CICLO_ABIERTO.indexOf(d.ciclo.fase) !== -1) item.style.display = '';
  });
}

/** El aviso del dashboard: «abierto» en captura, «próximo» en programado; en otro caso, nada. */
function avisoDeCiclo(d) {
  if (!d || !d.ciclo) return null;
  var c = d.ciclo;
  if (c.fase === 'captura') {
    var dias = diasEntre(d.hoy, c.fin_captura);
    return {
      bg: '#ECFDF5', border: '#BBF7D0', dot: '#10B981', activo: true,
      title: 'Ciclo de planeación abierto — Configura tus metas',
      detail: 'Tienes hasta el ' + formatFecha(c.fin_captura) + ' para configurar y enviar las metas de tus indicadores. ' +
              (dias === 0 ? 'Vence hoy.' : dias === 1 ? 'Queda 1 día.' : 'Quedan ' + dias + ' días.'),
      href: 'planeacion-metas-enlace.html', btn: 'Ir a mis metas'
    };
  }
  if (c.fase === 'programado') {
    return {
      bg: '#FFF7ED', border: '#FED7AA', dot: '#F97316', activo: false,
      title: 'Ciclo de planeación próximo',
      detail: 'El período de captura de metas abrirá el ' + formatFecha(c.inicio_captura) + '. Se avisará cuando esté disponible.',
      href: null, btn: null
    };
  }
  return null;
}

function pintarAvisoCiclo() {
  return cargarCicloVigente().then(function (d) {
    var aviso = avisoDeCiclo(d);
    if (!aviso) return;
    var el = document.createElement('div');
    el.className = 'cp-banner';
    el.style.cssText = 'background:' + aviso.bg + ';border-color:' + aviso.border + ';';
    el.innerHTML = '<div class="cp-banner-dot" style="background:' + aviso.dot + (aviso.activo ? ';animation:cp-pulse-g 2s infinite' : '') + ';"></div>' +
      '<div class="cp-banner-info"><div class="cp-banner-title">' + escaparHTML(aviso.title) + '</div>' +
      '<div class="cp-banner-detail">' + escaparHTML(aviso.detail) + '</div></div>' +
      (aviso.btn ? '<button class="cp-banner-btn" onclick="location.href=\'' + aviso.href + '\'">' + escaparHTML(aviso.btn) + '</button>' : '');
    var estilo = document.createElement('style');
    estilo.textContent = '@keyframes cp-pulse-g{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.4);}50%{box-shadow:0 0 0 5px rgba(16,185,129,0);}}';
    document.head.appendChild(estilo);
    var hero = document.querySelector('.dash-hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(el, hero);
  });
}
