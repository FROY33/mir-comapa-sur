// index.js — La raíz manda a cada quien a su dashboard (HU-R7-02 CA_2). Quién es lo dice el
// servidor, no el navegador: se consulta la sesión y se redirige según el rol. Sin sesión, al
// login. Si el servidor no responde, también al login, que es el destino seguro.
// Va en un archivo y no en línea para que esta página tenga una CSP sin 'unsafe-inline'.
(function () {
  var ir = function (destino) { window.location.replace(destino); };
  fetch('/api/auth/sesion', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (datos) { ir(datos ? datos.redirigirA : 'login.html'); })
    .catch(function () { ir('login.html'); });
})();
