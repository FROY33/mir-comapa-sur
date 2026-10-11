// cambiar-password.js — Cambio de la contraseña propia (HU-R7-07 CA_3). Lo exige el servidor
// tras un alta o un restablecimiento; también sirve para cambiarla por voluntad propia.

(function () {
  var LARGO_MINIMO = 12;
  var form = document.getElementById('formPassword');
  var errorBox = document.getElementById('errorBox');
  var errorMsg = document.getElementById('errorMsg');
  var boton = document.getElementById('btnGuardar');
  var enviando = false;

  function mostrarError(texto) {
    errorMsg.textContent = texto;
    errorBox.classList.remove('hidden');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (enviando) return;
    errorBox.classList.add('hidden');
    var actual = document.getElementById('actual').value;
    var nueva = document.getElementById('nueva').value;
    var confirmar = document.getElementById('confirmar').value;

    if (!actual) return mostrarError('Escribe tu contraseña actual.');
    if (nueva.length < LARGO_MINIMO) return mostrarError('La nueva contraseña debe tener al menos ' + LARGO_MINIMO + ' caracteres.');
    if (nueva !== confirmar) return mostrarError('La confirmación no coincide con la nueva contraseña.');

    enviando = true;
    boton.disabled = true;
    pedir('/api/auth/cambiar-password', { method: 'POST', body: JSON.stringify({ actual: actual, nueva: nueva }) })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) { if (r.status !== 401) mostrarError(d.mensaje || 'No se pudo cambiar la contraseña.'); return; }
          window.location.replace(d.redirigirA || 'index.html');
        });
      }, function () { mostrarError('No se pudo conectar con el servidor. Intenta de nuevo.'); })
      .then(function () { enviando = false; boton.disabled = false; });
  });
})();
