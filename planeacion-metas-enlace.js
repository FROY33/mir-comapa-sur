// planeacion-metas-enlace.js — Lista de metas por configurar del Enlace (PRD0_1, ticket 9; HU-R4-02).
// Todo viene de GET /api/planeacion/pendientes: la gerencia la decide el servidor por la sesión.
// Requiere session.js (pedir, escaparHTML) y vistas-mir.js (formatFecha).

var NIVEL_META = { fin: 'Fin', proposito: 'Propósito', componente: 'Componente', actividad: 'Actividad' };
var ESTADO_META = {
  meta_pendiente: { texto: 'Pendiente', clase: 'meta-pendiente' },
  borrador_meta: { texto: 'Borrador', clase: 'meta-borrador' }
};
// Provisional: la captura del prototipo, hasta el ticket 10 (captura real de metas)
var PAGINA_CAPTURA_META = 'planeacion-enlace.html';

function valorFiltro(id) {
  var el = document.getElementById(id);
  return el && el.value ? el.value : '';
}

function textoEn(id, texto) { var el = document.getElementById(id); if (el) el.textContent = texto; }
function htmlEn(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

/** Referencia de solo lectura (no un valor sugerido): la meta validada del ejercicio anterior. */
function textoMetaAnterior(valor) {
  if (valor === null || valor === undefined) return 'Meta ejercicio anterior: Sin antecedente';
  return 'Meta ejercicio anterior: <strong>' + escaparHTML(valor) + '</strong>';
}

function filaMeta(m) {
  var est = ESTADO_META[m.estado] || { texto: m.estado, clase: '' };
  var nivel = m.tipo === 'gerencial' ? 'Gerencial' : (NIVEL_META[m.nivel] || m.nivel || '');
  var href = PAGINA_CAPTURA_META + '?indicador=' + encodeURIComponent(m.codigo);
  return '<div class="meta-fila ' + escaparHTML(est.clase) + (m.vencida ? ' meta-vencida' : '') + '">' +
    '<div class="meta-info">' +
      '<span class="meta-codigo">' + escaparHTML(m.codigo) + '</span>' +
      '<p class="meta-nombre">' + escaparHTML(m.nombre) + '</p>' +
      '<p class="meta-detalle">' + (m.tipo === 'gerencial' ? 'Gerencial' : 'MIR') + ' · ' + escaparHTML(nivel) + '</p>' +
      '<p class="meta-anterior">' + textoMetaAnterior(m.meta_anterior) + '</p>' +
    '</div>' +
    '<div class="meta-estado">' +
      '<span class="meta-badge ' + escaparHTML(est.clase) + '">' + escaparHTML(est.texto) + '</span>' +
      (m.vencida ? '<span class="meta-badge meta-badge-vencida">Vencida</span>' : '') +
    '</div>' +
    '<a class="meta-enlace" href="' + escaparHTML(href) + '">' + (m.estado === 'borrador_meta' ? 'Continuar' : 'Configurar') + '</a>' +
  '</div>';
}

function pintarMetas(d, hayFiltro) {
  htmlEn('metasMensaje', '');
  htmlEn('metasLista', '');
  htmlEn('metasCiclo', '');
  var r = d.resumen || { total: 0, pendientes: 0, borradores: 0, vencidas: 0 };
  textoEn('rpTotal', String(r.total));
  textoEn('rpPendiente', String(r.pendientes));
  textoEn('rpBorrador', String(r.borradores));
  textoEn('rpVencida', String(r.vencidas));
  if (!d.ciclo) {
    htmlEn('metasMensaje', 'No hay ciclo de planeación abierto');
    return;
  }
  htmlEn('metasCiclo', 'Ejercicio ' + escaparHTML(d.ciclo.ejercicio) + ' · captura hasta el ' + escaparHTML(formatFecha(d.ciclo.fin_captura)));
  if (!d.metas.length) {
    htmlEn('metasMensaje', hayFiltro
      ? 'Ninguna meta coincide con los filtros.'
      : 'Ya configuraste todas tus metas. Espera la validación del Revisor.');
    return;
  }
  htmlEn('metasLista', d.metas.map(filaMeta).join(''));
}

/** Pide la lista con los filtros elegidos (los filtra el servidor) y la pinta. */
function cargarMetas() {
  var estado = valorFiltro('filtroEstado'), nivel = valorFiltro('filtroNivel');
  var consulta = [];
  if (estado) consulta.push('estado=' + encodeURIComponent(estado));
  if (nivel) consulta.push('nivel=' + encodeURIComponent(nivel));
  return pedir('/api/planeacion/pendientes' + (consulta.length ? '?' + consulta.join('&') : ''))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !('ciclo' in d)) { htmlEn('metasMensaje', 'No se pudieron cargar tus metas. Intenta de nuevo.'); return; }
      pintarMetas(d, !!(estado || nivel));
    }, function () { htmlEn('metasMensaje', 'No se pudieron cargar tus metas. Intenta de nuevo.'); });
}
