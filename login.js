// login.js — pantalla de inicio de sesión (HU-R7-01, R7-02, R7-04 CA_4, R7-05 CA_1).
// Antes estaba en línea en login.html; se carga al final del <body>, después del formulario.

// CA-5: si ya hay sesión activa, esta página no se muestra — al dashboard del rol.
// Se pregunta al servidor, que es quien sabe; el navegador no puede leer la cookie.
Session.cargar().then(function (user) {
  if (user) window.location.replace(user.redirect);
});

// Por qué se llegó al login: ?sesion=cerrada (HU-R7-04 CA_4) o ?sesion=expirada (HU-R7-05 CA_1).
// Se quita de la URL después de leerlo, para que recargar no repita el aviso.
(function () {
  const AVISOS = {
    cerrada: 'Sesión cerrada correctamente',
    expirada: 'Tu sesión expiró. Inicia sesión nuevamente.'
  };
  const motivo = new URLSearchParams(window.location.search).get('sesion');
  if (!AVISOS[motivo]) return;
  const aviso = document.getElementById('avisoBox');
  aviso.textContent = AVISOS[motivo];
  aviso.classList.remove('hidden');
  try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
})();

// ── Rotación de fondos ──────────────────────────────────────────────────
const scenes   = document.querySelectorAll('.bg-scene');
const captions = [
  'Laguna Madre · pastos acuáticos',
  'Laguna Madre · aguas abiertas',
  'Laguna San Andrés · vista aérea',
  'Laguna del Carpintero',
  'Laguna de Champayán · manglar'
];
const captionNameEl = document.getElementById('captionName');
let current = 0;

setInterval(function () {
  scenes[current].classList.remove('active');
  current = (current + 1) % scenes.length;
  scenes[current].classList.add('active');
  captionNameEl.style.opacity = '0';
  setTimeout(function () {
    captionNameEl.textContent = captions[current];
    captionNameEl.style.opacity = '1';
  }, 350);
}, 7000);

// ── Formulario ──────────────────────────────────────────────────────────
const form     = document.getElementById('loginForm');
const emailEl  = document.getElementById('email');
const passEl   = document.getElementById('password');
const btnLogin = document.getElementById('btnLogin');
const spinner  = document.getElementById('spinner');
const btnText  = document.getElementById('btnText');
const errorBox = document.getElementById('errorBox');
const errorMsg = document.getElementById('errorMsg');
const emailErr = document.getElementById('emailErr');
const passErr  = document.getElementById('passErr');

function setLoading(on) {
  btnLogin.disabled = on;
  spinner.classList.toggle('hidden', !on);
  btnText.textContent = on ? 'Verificando...' : 'Iniciar sesión';
}

function clearErrors() {
  errorBox.classList.add('hidden');
  emailEl.classList.remove('error');
  passEl.classList.remove('error');
  emailErr.classList.add('hidden');
  passErr.classList.add('hidden');
}

// ── Envío del formulario (CA-1, CA-6, RN_4) ─────────────────────────────
let enviando = false;

form.addEventListener('submit', function (e) {
  e.preventDefault();
  if (enviando) return;                       // CA-6: ni doble clic ni doble Enter
  clearErrors();

  const email    = emailEl.value.trim();
  const password = passEl.value;
  let hasError   = false;

  // CA-1: ambos campos con contenido antes de pedirle nada al backend
  if (!email)    { emailEl.classList.add('error'); emailErr.classList.remove('hidden'); hasError = true; }
  if (!password) { passEl.classList.add('error');  passErr.classList.remove('hidden');  hasError = true; }
  if (hasError) return;

  enviando = true;
  setLoading(true);

  Session.login(email, password).then(function (r) {
    if (!r.ok) {
      // RN_4: se muestra el mensaje del backend tal cual; es genérico a propósito
      errorMsg.textContent = r.mensaje || 'Usuario o contraseña incorrectos. Verifica tus datos.';
      errorBox.classList.remove('hidden');
      emailEl.classList.add('error');
      passEl.classList.add('error');
      passEl.value = '';
      passEl.focus();
      return;
    }
    // CA-4: a dónde ir lo decide el backend según el rol, no esta página
    window.location.href = r.user.redirect;
  }).catch(function () {
    errorMsg.textContent = 'No se pudo conectar con el servidor. Intenta de nuevo.';
    errorBox.classList.remove('hidden');
  }).finally(function () {
    enviando = false;
    setLoading(false);
  });
});

// RN_3: en esta fase no hay recuperación por correo; el Administrador restablece
const forgotLink = document.getElementById('forgotLink');
if (forgotLink) {
  forgotLink.addEventListener('click', function (e) {
    e.preventDefault();
    errorMsg.textContent = 'Para restablecer tu contraseña, contacta al Administrador del sistema.';
    errorBox.classList.remove('hidden');
  });
}

// Los atajos de demostración que entraban sin contraseña se eliminaron con
// HU-R7-01: el único camino es el formulario contra POST /api/auth/login.
