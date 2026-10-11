// guardia.js — Protección de páginas en el navegador (HU-R7-03), sesión expirada (HU-R7-05)
// y botón Atrás tras cerrar sesión (HU-R7-04 CA_5). Se carga justo después de session.js,
// en el <head>, para ocultar la página antes de que se pinte. Usa pedir(), paginaActual(),
// perfilDeCookie(), recordarDestino() y Session, de session.js.

// ── Sesión expirada (HU-R7-05) ────────────────────────────────────────────
// Se va al login con «Tu sesión expiró…» y se recuerda la página para volver a ella tras
// iniciar sesión (CA_3, con la cookie de destino de HU-R7-02). Si el usuario estaba
// escribiendo en un formulario, primero se le avisa en la propia página (CA_2): perder lo
// capturado sin explicación es peor que un clic de más.
var MENSAJE_EXPIRADA = 'Tu sesión expiró. Inicia sesión nuevamente.';
var _sinGuardar = false;
var _expirando = false;

/** Las páginas llaman esto al guardar con éxito, para que ya no cuente como pendiente. */
function marcarGuardado() { _sinGuardar = false; }

function sesionExpirada() {
  if (_expirando) return;
  _expirando = true;
  recordarDestino(paginaActual());
  var irAlLogin = function () { window.location.replace('login.html?sesion=expirada'); };
  if (!_sinGuardar || typeof document.createElement !== 'function') { irAlLogin(); return; }

  var aviso = document.createElement('div');
  aviso.setAttribute('role', 'alertdialog');
  aviso.setAttribute('aria-live', 'assertive');
  aviso.style.cssText = 'position:fixed;inset:0;z-index:99999;visibility:visible;display:flex;' +
    'align-items:center;justify-content:center;background:rgba(17,24,39,.55);font-family:inherit';
  var caja = document.createElement('div');
  caja.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:360px;margin:16px;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.2);font-size:14px;line-height:1.5;color:#111827';
  var texto = document.createElement('p');
  texto.style.margin = '0 0 8px';
  texto.textContent = MENSAJE_EXPIRADA;
  var nota = document.createElement('p');
  nota.style.cssText = 'margin:0 0 16px;font-size:12px;color:#6B7280';
  nota.textContent = 'Lo que capturaste en esta página no se guardó.';
  var boton = document.createElement('button');
  boton.type = 'button';
  boton.textContent = 'Iniciar sesión';
  boton.style.cssText = 'background:var(--color-primary,#8B1D3A);color:#fff;border:0;border-radius:8px;' +
    'padding:9px 16px;font-weight:600;cursor:pointer';
  boton.addEventListener('click', irAlLogin);
  caja.appendChild(texto); caja.appendChild(nota); caja.appendChild(boton);
  aviso.appendChild(caja);
  (document.body || document.documentElement).appendChild(aviso);
  try { boton.focus(); } catch (e) {}
}

// Algo escrito en un campo de formulario cuenta como pendiente de guardar (CA_2)
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('input', function (e) {
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') _sinGuardar = true;
  }, true);
}

// ── Guardia de páginas (HU-R7-03) ─────────────────────────────────────────
// Toda página que no sea pública se oculta hasta que el servidor confirme que esta sesión
// puede abrirla (GET /api/auth/acceso). Sin sesión, al login (CA_2); con un rol que no
// corresponde, al dashboard del propio rol (CA_1, CA_6). Es una comodidad, no la seguridad:
// los datos los protege el backend en cada petición (RN_1).
var PAGINAS_PUBLICAS = ['', 'index.html', 'login.html', 'demo-enlace.html', 'demo-revisor.html', 'design-system.html'];

function protegerPagina() {
  if (typeof window === 'undefined' || !window.location || typeof window.location.pathname !== 'string') return;
  if (typeof document.createElement !== 'function') return;
  var pagina = paginaActual();
  if (PAGINAS_PUBLICAS.indexOf(pagina) !== -1) return;
  Session._protegida = true;

  if (!perfilDeCookie()) {
    recordarDestino(pagina);
    window.location.replace('login.html');
    return;
  }
  var velo = document.createElement('style');
  velo.textContent = 'html{visibility:hidden!important}';
  (document.head || document.documentElement).appendChild(velo);
  var mostrar = function () { if (velo.parentNode) velo.parentNode.removeChild(velo); };

  pedir('/api/auth/acceso?pagina=' + encodeURIComponent(pagina)).then(function (r) {
    if (r.ok) return mostrar();
    if (r.status === 401) return;              // pedir() ya mandó al login (sesionExpirada)
    if (r.status === 403) {
      return r.json().then(function (d) { window.location.replace(d.redirigirA || 'login.html'); },
                           function () { window.location.replace('login.html'); });
    }
    mostrar();                                 // 5xx: se muestra; sin backend tampoco hay datos
  }, mostrar);                                 // sin red: igual
}

protegerPagina();

// HU-R7-04 CA_5: al volver con Atrás, el navegador puede mostrar la página desde su caché
// (bfcache) sin volver a correr ningún script, así que requireAuth() no se entera de que la
// sesión se cerró. Al restaurarse una página protegida se revisa: sin la cookie de perfil
// (el logout la borra) se va al login de inmediato; con ella, se confirma con el servidor.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted || !Session._protegida) return;
    var alLogin = function () { window.location.replace('login.html'); };
    Session._user = null;
    if (!perfilDeCookie()) { alLogin(); return; }
    Session.cargar().then(function (user) { if (!user) alLogin(); });
  });
}
