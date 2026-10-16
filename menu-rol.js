// menu-rol.js — Páginas que comparten Admin y Revisor (Consulta MIR, ficha técnica): traen los dos menús
// (#navAdmin y #navRevisor) y aquí se muestra el del rol. El acceso lo decide el servidor; esto es solo navegación.

function menuDelRol() {
  var u = typeof Session !== 'undefined' && Session.getUser();
  if (!u || u.rol !== 'Revisor') return;
  document.getElementById('navAdmin').classList.add('hidden');
  document.getElementById('navRevisor').classList.remove('hidden');
  var miga = document.getElementById('migaInicio');
  if (miga) miga.setAttribute('href', 'dashboard-revisor.html');
}
