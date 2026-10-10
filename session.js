// session.js — Sesión real contra la API (HU-R7-01).
//
// El token de sesión vive en una cookie HttpOnly que este código NO puede leer ni
// escribir: la pone y la quita el backend (CA-3). Aquí solo se guarda en memoria lo
// que la API devuelve del usuario, y nada en localStorage.
//
// El frontend y la API se sirven del mismo origen detrás de un proxy inverso, así que
// las rutas son relativas y la cookie SameSite=Strict viaja sola. Para un desarrollo
// donde el estático y el backend están separados, define window.COMAPA_API_BASE antes
// de cargar este archivo.

var API = (typeof window !== 'undefined' && window.COMAPA_API_BASE) || '';

// Cookie legible con el perfil para mostrar. NO es una credencial: el token está en
// una cookie HttpOnly que este código no puede ver (CA-3). Existe para que la sesión
// se conozca de forma síncrona, sin que cada página tenga que esperar una petición.
// Alterarla solo cambia lo que este navegador pinta; la autorización la decide el
// servidor contra el token en cada llamada a la API.
var COOKIE_PERFIL = 'comapa_perfil';

function leerCookie(nombre) {
  var partes = String(document.cookie || '').split(';');
  for (var i = 0; i < partes.length; i++) {
    var p = partes[i].trim();
    if (p.indexOf(nombre + '=') === 0) {
      try { return decodeURIComponent(p.slice(nombre.length + 1)); } catch (e) { return null; }
    }
  }
  return null;
}

function perfilDeCookie() {
  var crudo = leerCookie(COOKIE_PERFIL);
  if (!crudo) return null;
  try { return JSON.parse(crudo); } catch (e) { return null; }
}

// El backend usa 'admin' | 'revisor' | 'enlace'; las vistas comparan contra el nombre
// en español ("rol !== 'Administrador'"). La traducción vive aquí para no tocar las vistas.
var ROL_VISTA = { admin: 'Administrador', revisor: 'Revisor', enlace: 'Enlace' };

// La tabla usuarios no guarda iniciales: se derivan del nombre.
function inicialesDe(nombre) {
  var partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '??';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Forma que esperan las vistas del prototipo, a partir de lo que devuelve la API
function adaptar(datos) {
  var u = datos.usuario;
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: ROL_VISTA[u.rol] || u.rol,
    rolClave: u.rol,
    iniciales: inicialesDe(u.nombre),
    gerencia: u.gerencia.nombre,
    gerenciaClave: u.gerencia.clave,
    unidadResponsable: u.unidad,
    debeCambiarPassword: u.debeCambiarPassword,
    redirect: datos.redirigirA
  };
}

function pedir(ruta, opciones) {
  var o = opciones || {};
  o.credentials = 'same-origin';          // sin esto el navegador no manda la cookie
  o.headers = Object.assign({ 'content-type': 'application/json' }, o.headers || {});
  return fetch(API + ruta, o);
}

var Session = {
  _user: null,          // caché en memoria
  _carga: null,         // la promesa en vuelo, para no pedir la sesión dos veces

  /**
   * Usuario de la sesión, de forma síncrona. Sale de la cookie de perfil, así que
   * está disponible desde la primera línea de cualquier página, sin esperar nada.
   */
  getUser: function () {
    if (this._user) return this._user;
    var perfil = perfilDeCookie();
    if (!perfil) return null;
    this._user = adaptar({ usuario: {
      id: null, nombre: perfil.nombre, email: perfil.email, rol: perfil.rol,
      gerencia: { clave: perfil.gerenciaClave, nombre: perfil.gerencia },
      unidad: perfil.unidad, debeCambiarPassword: false
    }, redirigirA: perfil.redirigirA });
    return this._user;
  },

  /** Alias histórico; algunas vistas llaman Session.get(). */
  get: function () { return this._user; },

  /**
   * Trae la sesión del servidor. Devuelve el usuario o null. Se memoiza, así que
   * llamarlo desde varias partes de la página hace una sola petición.
   */
  cargar: function () {
    var self = this;
    if (self._carga) return self._carga;
    self._carga = pedir('/api/auth/sesion')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (datos) {
        self._user = datos ? adaptar(datos) : null;
        self._carga = null;
        return self._user;
      })
      .catch(function () { self._carga = null; return null; });
    return self._carga;
  },

  /**
   * Inicia sesión. Resuelve con { ok: true, user } o con { ok: false, error, mensaje }.
   * Nunca lanza por credenciales malas: eso es una respuesta esperada, no un fallo.
   */
  login: function (email, password) {
    var self = this;
    return pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().then(function (datos) {
        if (!r.ok) return { ok: false, status: r.status, error: datos.error, mensaje: datos.mensaje };
        self._user = adaptar(datos);
        return { ok: true, user: self._user };
      });
    });
  },

  /**
   * Exige sesión. Si no hay, manda a login.html y devuelve null.
   *
   * Síncrono a propósito: las vistas lo usan en la primera línea de su script y
   * emplean el resultado de inmediato. Lo que decide es si hay sesión y qué pintar;
   * la autorización de verdad la aplica el servidor en cada llamada a la API, y la
   * protección de rutas entra con HU-R7-02.
   */
  requireAuth: function () {
    var user = this.getUser();
    if (!user) { window.location.href = 'login.html'; return null; }
    return user;
  },

  /**
   * Cierra la sesión en el servidor (HU-R7-04): revoca la sesión, deja el evento en la
   * bitácora y borra las dos cookies. Resuelve siempre, incluso si la red falla, porque
   * dejar al usuario atrapado en una página es peor que un cierre incompleto.
   */
  logout: function () {
    var self = this;
    return pedir('/api/auth/logout', { method: 'POST' })
      .catch(function () { /* sin red: se sigue limpiando del lado del cliente */ })
      .then(function () { self.clear(); });
  },

  /** Olvida la sesión solo del lado del cliente. Para cerrar de verdad, usa logout(). */
  clear: function () {
    this._user = null;
    this._carga = null;
    // La cookie de perfil sí se puede borrar desde aquí; la de sesión es HttpOnly y
    // la revoca el servidor (HU-R7-04).
    try { document.cookie = COOKIE_PERFIL + '=; Path=/; Max-Age=0; SameSite=Strict'; } catch (e) {}
  }
};

// ── Utilidades de fecha e indicadores ─────────────────────────────────────
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

// Cierra la sesión y vuelve al login. Lo llaman los botones «Cerrar sesión» de las
// vistas y el del encabezado que arma layout.js.
//
// Se espera a que el servidor revoque la sesión antes de redirigir: si se redirigiera
// de inmediato, el navegador podría cancelar la petición y la sesión seguiría vigente
// en la base. Si la red falla, se redirige igual — quedarse en la página sería peor.
function cerrarSesion() {
  var irAlLogin = function () { window.location.href = 'login.html'; };
  try { Session.logout().then(irAlLogin, irAlLogin); }
  catch (e) { irAlLogin(); }
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
