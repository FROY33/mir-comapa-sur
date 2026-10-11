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
//
// Va acompañado de guardia.js (guardia de páginas, sesión expirada y botón Atrás) y de
// vistas-mir.js (utilidades de fechas e indicadores). Las páginas los cargan en ese orden.

var API = (typeof window !== 'undefined' && window.COMAPA_API_BASE) || '';

// Cookie legible con el perfil para mostrar. NO es una credencial: el token está en
// una cookie HttpOnly que este código no puede ver (CA-3). Existe para que la sesión
// se conozca de forma síncrona, sin que cada página tenga que esperar una petición.
// Alterarla solo cambia lo que este navegador pinta; la autorización la decide el
// servidor contra el token en cada llamada a la API.
var COOKIE_PERFIL = 'comapa_perfil';

// Destino al que el usuario quería ir antes de que lo mandáramos al login (HU-R7-02
// CA_4). Se guarda en cookie, nunca en localStorage (RN_1). Quien decide si se honra
// es el servidor al iniciar sesión, que es el único que conoce el rol: aquí solo se
// anota la intención.
var COOKIE_DESTINO = 'comapa_destino';
var DESTINO_MINUTOS = 10;

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

// Rutas de autenticación: su 401 es una respuesta esperada (credenciales malas, sin sesión
// todavía), no una sesión que expiró a media página.
var RUTAS_SIN_INTERCEPTAR = ['/api/auth/login', '/api/auth/sesion', '/api/auth/logout'];

function pedir(ruta, opciones) {
  var o = opciones || {};
  o.credentials = 'same-origin';          // sin esto el navegador no manda la cookie
  o.headers = Object.assign({ 'content-type': 'application/json' }, o.headers || {});
  return fetch(API + ruta, o).then(function (r) {
    // HU-R7-05 CA_1: cualquier 401 de una ruta protegida es una sesión vencida o inválida
    if (r.status === 401 && RUTAS_SIN_INTERCEPTAR.indexOf(ruta.split('?')[0]) === -1) sesionExpirada();
    return r;
  });
}

/** Guarda a dónde iba el usuario, para volver ahí tras iniciar sesión. */
function recordarDestino(pagina) {
  if (!pagina || pagina === 'login.html' || pagina === 'index.html' || pagina === '') return;
  try {
    document.cookie = COOKIE_DESTINO + '=' + encodeURIComponent(pagina) +
      '; Path=/; Max-Age=' + (DESTINO_MINUTOS * 60) + '; SameSite=Strict';
  } catch (e) {}
}

/** La página actual, sin carpetas ni query, como la espera el servidor. */
function paginaActual() {
  var partes = String(window.location.pathname || '').split('/');
  return partes[partes.length - 1] || '';
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

  /**
   * Alias histórico; configuracion.html y planeacion-indicadores.html llaman Session.get().
   * Devolvía solo la caché en memoria, que esas páginas nunca llenan: el Admin salía expulsado al login.
   */
  get: function () { return this.getUser(); },

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
    this._protegida = true;              // para revisar la sesión al volver con Atrás (HU-R7-04 CA_5)
    var user = this.getUser();
    if (!user) {
      recordarDestino(paginaActual());   // CA_4: para volver aquí tras iniciar sesión
      window.location.href = 'login.html';
      return null;
    }
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
    // la revoca el servidor (HU-R7-04). El destino también se olvida: un cierre de
    // sesión deliberado no debe arrastrar a dónde iba el usuario antes.
    try {
      document.cookie = COOKIE_PERFIL + '=; Path=/; Max-Age=0; SameSite=Strict';
      document.cookie = COOKIE_DESTINO + '=; Path=/; Max-Age=0; SameSite=Strict';
    } catch (e) {}
  }
};

// Cierra la sesión y vuelve al login. Lo llaman los botones «Cerrar sesión» de las
// vistas y el del encabezado que arma layout.js.
//
// Se espera a que el servidor revoque la sesión antes de redirigir: si se redirigiera
// de inmediato, el navegador podría cancelar la petición y la sesión seguiría vigente
// en la base. Si la red falla, se redirige igual — quedarse en la página sería peor.
function cerrarSesion() {
  // replace y no href: la página protegida sale del historial, y el login muestra el aviso (CA_4)
  var irAlLogin = function () { window.location.replace('login.html?sesion=cerrada'); };
  try { Session.logout().then(irAlLogin, irAlLogin); }
  catch (e) { irAlLogin(); }
}
