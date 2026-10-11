// vistas-mir.js — Utilidades que comparten las vistas del prototipo: fechas, estados e
// indicadores de los datos demo. No tiene que ver con la sesión; vivía en session.js.

function formatFecha(dateStr) {
  if (!dateStr) return '—';
  var p = String(dateStr).split('-');
  if (p.length < 3) return dateStr;
  var meses = ['ene.','feb.','mar.','abr.','may.','jun.','jul.','ago.','sep.','oct.','nov.','dic.'];
  return +p[2]+' '+(meses[+p[1]-1]||p[1])+' '+p[0];
}

function diasRestantes(fechaLimite) {
  if (!fechaLimite) return 0;
  var p = String(fechaLimite).split('-');
  var hoy = new Date(); hoy.setHours(0,0,0,0);
  var lim = new Date(+p[0], +p[1]-1, +p[2]);
  return Math.round((lim - hoy) / (1000*60*60*24));
}

// Configuración de visualización de estados MIR.
// La clase CSS se corresponde directamente con la clase .estado-badge.{estado} en shared.css.
var ESTADO_CFG_MIR = {
  pendiente_carga:  { label:'Sin capturar',      cls:'pendiente_carga',  accion:'Cargar evidencia',    btnCls:'primary' },
  pendiente_envio:  { label:'Listo para enviar', cls:'pendiente_carga',  accion:'Enviar a revisión',   btnCls:'primary' },
  borrador:         { label:'En borrador',        cls:'borrador',         accion:'Continuar captura',   btnCls:'primary' },
  enviado_revision:  { label:'En revisión',           cls:'enviado_revision', accion:'Ver seguimiento',     btnCls:'neutral' },
  pendiente_revision:{ label:'Pendiente de revisión', cls:'enviado_revision', accion:'Revisar ahora',       btnCls:'primary' },
  corregido:        { label:'Corregido',          cls:'corregido',        accion:'Ver seguimiento',     btnCls:'neutral' },
  observado:        { label:'Con observaciones',  cls:'observado',        accion:'Atender observación', btnCls:'warning' },
  aprobado_revisor: { label:'Aprobado',           cls:'aprobado_revisor', accion:'Ver detalle',         btnCls:'neutral' },
  cerrado:          { label:'Validado',           cls:'cerrado',          accion:'Ver detalle',         btnCls:'neutral' },
  listo_validar:    { label:'Listo para validar', cls:'listo_validar',    accion:'Ver detalle',         btnCls:'neutral' },
  vencido:          { label:'Vencido',            cls:'vencido',          accion:'Ver detalle',         btnCls:'danger'  },
  proximo_periodo:  { label:'Próximo período',    cls:'proximo_periodo',  accion:'Ver calendario',      btnCls:'neutral' },
  regresado_correccion: { label:'Regresado a corrección', cls:'observado', accion:'Atender corrección', btnCls:'warning' },
};

// Normaliza el estado raw de un indicador al estado de visualización.
function estadoVista(act) {
  var e = act.estado;
  if (['pendiente_envio','incompleto'].includes(e)) return 'borrador';
  return e;
}

// Busca un indicador por id en ACTIVIDADES_ENLACE (incluye datos demo).
function getActividad(id) {
  if (typeof ACTIVIDADES_ENLACE === 'undefined') return null;
  return ACTIVIDADES_ENLACE.find(function(a) { return a.id === id; }) || null;
}

// Mapa de nivel a etiqueta y clase CSS para badges.
var NIVEL_CFG = {
  'Fin':        { label: 'Fin',        cls: 'nivel-fin' },
  'Propósito':  { label: 'Propósito',  cls: 'nivel-proposito' },
  'Componente': { label: 'Componente', cls: 'nivel-componente' },
  'Actividad':  { label: 'Actividad',  cls: 'nivel-actividad' }
};

// Calcula prioridad de un indicador según días restantes y estado.
function prioridad(act) {
  var d = diasRestantes(act.fechaLimite);
  if (d < 0) return 'vencida';
  var activos = ['pendiente_carga','enviado_revision','pendiente_revision','corregido','observado'];
  if (activos.indexOf(act.estado) === -1) return 'normal';
  if (d <= 7)  return 'alta';
  if (d <= 14) return 'media';
  return 'normal';
}

// Fecha en que el indicador fue enviado a revisión por última vez (desde historial).
function fechaEnvio(act) {
  if (!act || !act.historial || !act.historial.length) return null;
  var envios = act.historial.filter(function(h) { return h.estadoNuevo === 'enviado_revision'; });
  if (!envios.length) return null;
  return envios[envios.length - 1].fecha;
}

// Devuelve un badge HTML "ISO" si el indicador está marcado como ISO.
function isoBadge(act) {
  return (act && act.iso && act.iso.toLowerCase() === 'x') ? '<span class="iso-badge">ISO</span> ' : '';
}

// Devuelve todos los indicadores de la gerencia del Revisor activo.
// La gerencia sale de la sesión del servidor, no de un override del navegador.
function getActividadesRevisor() {
  if (typeof ACTIVIDADES_ENLACE === 'undefined') return [];
  var user = Session.getUser();
  if (!user) return ACTIVIDADES_ENLACE;
  return ACTIVIDADES_ENLACE.filter(function(a) { return a.gerencia === user.gerencia; });
}

// Devuelve los indicadores MIR del usuario enlace activo.
// La gerencia y la unidad salen de la sesión del servidor.
// Coordinación General → todos los de la gerencia.
// Coordinación específica → solo los de esa unidad.
// Sin unidad asignada → todos los de la gerencia.
// Reportes reales del periodo abierto (HU-R1-01), una vez cargados con cargarPendientesEnlace().
// Mientras no se cargan, las vistas usan los datos demo del prototipo.
var PENDIENTES_ENLACE = null;
var RESUMEN_PENDIENTES = null;

var NIVEL_VISTA = { fin: 'Fin', proposito: 'Propósito', componente: 'Componente', actividad: 'Actividad' };
var capitalizar = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

/** Un reporte de GET /api/pendientes con la forma que esperan las vistas del prototipo. */
function aActividad(r) {
  return {
    id: r.codigo, reporteId: r.reporte_id, tipo: r.tipo,
    nombreIndicador: r.nombre, unidadResponsable: r.unidad || '', area: r.unidad || '',
    nivel: NIVEL_VISTA[r.nivel] || '', medioVerificacion: r.medio_verificacion || '—',
    frecuenciaMedicion: capitalizar(r.frecuencia), periodo: r.periodo, fechaLimite: r.fecha_limite,
    estado: r.estado, ultimaActualizacion: String(r.actualizado_at || '').slice(0, 10),
    iso: r.es_iso ? 'x' : '', pendiente: r.pendiente, vencido: r.vencido, urgente: r.urgente
  };
}

/** Trae los reportes de la gerencia de la sesión. Resuelve con la respuesta, o null si falla. */
function cargarPendientesEnlace() {
  return pedir('/api/pendientes')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return null;
      PENDIENTES_ENLACE = d.reportes.map(aActividad);
      RESUMEN_PENDIENTES = d.resumen;
      return d;
    }, function () { return null; });
}

/**
 * ¿Pide acción del Enlace? Con datos reales lo dice el servidor (pendiente_carga, borrador,
 * observado y regresado a corrección; HU-R1-01 RN_2), y así la lista y el KPI del dashboard
 * cuentan exactamente lo mismo (CA_5).
 */
function esPendiente(a) {
  if (a.pendiente !== undefined) return a.pendiente;
  return ['pendiente_carga', 'borrador', 'incompleto'].indexOf(a.estado) !== -1;
}

// Indicadores MIR de la gerencia del Enlace. Cualquier Enlace de la gerencia los ve todos:
// la unidad responsable es informativa y no limita (HU-R1-01 RN_1, HU-R7-03).
function getActividadesEnlace() {
  if (PENDIENTES_ENLACE) return PENDIENTES_ENLACE.filter(function (a) { return a.tipo === 'mir'; });
  if (typeof ACTIVIDADES_ENLACE === 'undefined') return [];
  var user = Session.getUser();
  if (!user) return ACTIVIDADES_ENLACE;
  return ACTIVIDADES_ENLACE.filter(function (a) { return a.gerencia === user.gerencia; });
}

// Devuelve el nombre de la unidad/gerencia del usuario activo para mostrar en la UI.
function getNombreGerenciaEnlace() {
  var user = Session.getUser();
  if (!user) return 'Gerencia';
  var unidad, ger;
  try {
    unidad = user.unidadResponsable || null;
    ger    = user.gerencia || 'Gerencia';
  } catch(e) {
    unidad = user.unidadResponsable || null;
    ger    = user.gerencia || 'Gerencia';
  }
  return unidad || ger;
}

// Devuelve los indicadores gerenciales de las 4 gerencias generales.
function getActividadesGerencia() {
  if (PENDIENTES_ENLACE) return PENDIENTES_ENLACE.filter(function (a) { return a.tipo === 'gerencial'; });
  return (typeof ACTIVIDADES_GERENCIA !== 'undefined') ? ACTIVIDADES_GERENCIA : [];
}

// ── Periodos abiertos (HU-R3-01 CA_6) ───────────────────────────────────
// Franja al inicio del contenido con cada periodo abierto y su fecha límite. La usan los
// dashboards de los tres roles; los datos vienen de GET /api/periodos/abiertos.
var FRECUENCIA_VISTA = { mensual: 'Mensual', bimestral: 'Bimestral', trimestral: 'Trimestral',
                         cuatrimestral: 'Cuatrimestral', semestral: 'Semestral', anual: 'Anual' };

function pintarPeriodosAbiertos() {
  var main = document.querySelector('main');
  if (!main) return;
  pedir('/api/periodos/abiertos').then(function (r) { return r.ok ? r.json() : null; }).then(function (lista) {
    if (!lista) return;
    var franja = document.getElementById('periodosAbiertos') || document.createElement('section');
    franja.id = 'periodosAbiertos';
    franja.setAttribute('aria-label', 'Periodos de captura abiertos');
    franja.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px;padding:10px 14px;' +
      'border-radius:10px;background:var(--color-bg,#fff);border:1px solid var(--color-neutral-100,#E5E7EB);font-size:12px';
    var titulo = document.createElement('strong');
    titulo.textContent = lista.length ? 'Periodos abiertos:' : 'No hay periodos de captura abiertos.';
    franja.textContent = '';
    franja.appendChild(titulo);
    lista.forEach(function (p) {
      var dias = diasRestantes(p.fecha_limite);
      var chip = document.createElement('span');
      chip.style.cssText = 'padding:3px 10px;border-radius:999px;background:var(--color-neutral-50,#F9FAFB);' +
        'color:' + (dias <= 3 ? 'var(--color-danger,#DC2626)' : 'var(--color-text-primary,#111827)');
      chip.textContent = (FRECUENCIA_VISTA[p.frecuencia] || p.frecuencia) + ' ' + p.etiqueta +
        ' · fecha límite ' + formatFecha(p.fecha_limite) +
        (p.anteriores_abiertos ? ' (+' + p.anteriores_abiertos + ' anterior' + (p.anteriores_abiertos === 1 ? '' : 'es') + ' sin cerrar)' : '');
      franja.appendChild(chip);
    });
    if (!franja.parentNode) main.insertBefore(franja, main.firstChild);
  }, function () {});
}
