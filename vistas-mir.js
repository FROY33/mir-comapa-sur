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
function getActividadesEnlace() {
  if (typeof ACTIVIDADES_ENLACE === 'undefined') return [];
  var user = Session.getUser();
  if (!user) return ACTIVIDADES_ENLACE;

  var ger    = user.gerencia;
  var unidad = user.unidadResponsable || null;

  var byGerencia = ACTIVIDADES_ENLACE.filter(function(a) {
    return a.gerencia === ger;
  });

  if (!unidad || unidad.toLowerCase().indexOf('general') !== -1) {
    return byGerencia;
  }

  return byGerencia.filter(function(a) {
    return a.unidadResponsable === unidad;
  });
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
  return (typeof ACTIVIDADES_GERENCIA !== 'undefined') ? ACTIVIDADES_GERENCIA : [];
}
