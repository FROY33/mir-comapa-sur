// usuarios-admin.js — Conecta la sección «Usuarios del sistema» de configuracion.html con la
// API (HU-R7-07). La pantalla es la del prototipo; aquí se reemplazan sus datos simulados y
// las funciones que los modificaban por llamadas a /api/admin/usuarios. Se carga después del
// script en línea de configuracion.html: las funciones de aquí sustituyen a las de allá.
//
// Diferencias con el prototipo, por el modelo acordado: un usuario tiene una sola gerencia y
// una unidad de ella, y tres roles (sin «Solo lectura»). La contraseña temporal la genera el
// servidor y se muestra una única vez.

(function () {
  var CATALOGO = [];                       // gerencias con sus unidades, de /api/admin/catalogo
  var COLOR_ROL = { admin: '#8B1D3A', revisor: '#059669', enlace: '#0891B2' };

  function api(metodo, ruta, cuerpo) {
    return pedir(ruta, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }

  function fechaCorta(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  function aVista(u) {
    return {
      id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo, bloqueado: u.bloqueado,
      iniciales: inicialesDe(u.nombre), color: COLOR_ROL[u.rol] || '#6B7280',
      gerencias: [u.gerencia.nombre], gerenciaId: u.gerencia.id,
      unidadAdministrativa: u.unidad.nombre, unidadId: u.unidad.id,
      ultimoAcceso: fechaCorta(u.ultimo_acceso) + (u.bloqueado ? ' · bloqueada' : ''),
    };
  }

  // ── Advertencias (RN_4) ────────────────────────────────────────────────
  function pintarAdvertencias(lista) {
    var caja = document.getElementById('avisoCobertura');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'avisoCobertura';
      caja.setAttribute('role', 'status');
      caja.style.cssText = 'margin:0 0 14px;padding:10px 14px;border-radius:10px;font-size:12px;line-height:1.5;' +
        'background:var(--color-warning-tint,#FFFBEB);border:1px solid var(--color-warning,#F59E0B);color:var(--color-text-primary)';
      var filtros = document.querySelector('#secUsuarios .filter-bar');
      filtros.parentNode.insertBefore(caja, filtros);
    }
    if (!lista.length) { caja.style.display = 'none'; return; }
    var NOMBRE = { enlace: 'Enlace', revisor: 'Revisor' };
    caja.textContent = 'Gerencias con indicadores activos que necesitan atención: ' + lista.map(function (g) {
      return g.nombre + ' (sin ' + g.faltan.map(function (r) { return NOMBRE[r] || r; }).join(' ni ') + ' activo)';
    }).join('; ') + '.';
    caja.style.display = '';
  }

  // ── Carga ──────────────────────────────────────────────────────────────
  window.cargarUsuarios = function () {
    return api('GET', '/api/admin/usuarios').then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje || 'No se pudieron cargar los usuarios', 'error'); return; }
      USUARIOS = r.d.usuarios.map(aVista);
      pintarAdvertencias(r.d.advertencias || []);
      renderStats();
      renderTabla();
    });
  };

  function opciones(select, primera, lista) {
    select.innerHTML = '<option value="">' + primera + '</option>' + lista.map(function (x) {
      return '<option value="' + x.id + '">' + x.nombre.replace(/</g, '&lt;') + '</option>';
    }).join('');
  }

  function prepararFormulario() {
    // Tres roles y una sola gerencia: lo que el prototipo tenía de más se oculta
    document.querySelectorAll('[data-rol="lectura"], #filterRol option[value="lectura"]').forEach(function (el) { el.remove(); });
    var grupo = document.getElementById('gerenciasGroup');
    if (grupo) grupo.style.display = 'none';
    opciones(document.getElementById('fGerencia'), 'Selecciona una gerencia…', CATALOGO);
    opciones(document.getElementById('filterGer'), 'Todas las gerencias', CATALOGO);
  }

  // ── Filtros y formulario con ids reales ──────────────────────────────────
  window.filteredUsuarios = function () {
    var q = (document.getElementById('searchUsr').value || '').toLowerCase();
    var rol = document.getElementById('filterRol').value || '';
    var ger = document.getElementById('filterGer').value || '';
    var est = document.getElementById('filterEstado').value || '';
    return USUARIOS.filter(function (u) {
      if (rol && u.rol !== rol) return false;
      if (ger && u.gerenciaId !== ger) return false;
      if (est === 'activo' && !u.activo) return false;
      if (est === 'inactivo' && u.activo) return false;
      if (q && (u.nombre + ' ' + u.email).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  };

  // CA_2 / checklist: las unidades se filtran por la gerencia elegida
  window.onGerenciaChange = function () {
    var gerencia = CATALOGO.find(function (g) { return g.id === document.getElementById('fGerencia').value; });
    var grupo = document.getElementById('fUnidadAdminGroup');
    if (!gerencia) { grupo.style.display = 'none'; return; }
    opciones(document.getElementById('fUnidadAdmin'), 'Selecciona la unidad…', gerencia.unidades);
    grupo.style.display = '';
  };

  var abrirNuevoOriginal = window.openNuevoUsuario;
  window.openNuevoUsuario = function () {
    abrirNuevoOriginal();
    // La contraseña temporal la genera el servidor al guardar (CA_3)
    document.getElementById('fPasswordGroup').style.display = 'none';
  };

  var abrirEditarOriginal = window.openEditarUsuario;
  window.openEditarUsuario = function (id) {
    abrirEditarOriginal(id);
    var u = USUARIOS.find(function (x) { return x.id === id; });
    document.getElementById('fGerencia').value = u.gerenciaId;
    window.onGerenciaChange();
    document.getElementById('fUnidadAdmin').value = u.unidadId;
    // Acciones de acceso junto al botón de desactivar
    var pie = document.getElementById('modalFooterLeft');
    var boton = function (texto, fn) {
      var b = document.createElement('button');
      b.className = 'btn btn-ghost';
      b.type = 'button';
      b.textContent = texto;
      b.addEventListener('click', fn);
      pie.appendChild(b);
    };
    boton('Restablecer contraseña', function () { restablecer(u); });
    if (u.bloqueado) boton('Desbloquear', function () { desbloquear(u); });
  };

  // ── Guardar, activar, restablecer, desbloquear ─────────────────────────
  window.guardarUsuario = function () {
    var datos = {
      nombre: (document.getElementById('fNombre').value || '').trim(),
      email: (document.getElementById('fEmail').value || '').trim(),
      gerencia_id: document.getElementById('fGerencia').value,
      unidad_id: document.getElementById('fUnidadAdmin').value,
      rol: selectedRol,
    };
    var id = editingId;
    var editado = id && USUARIOS.find(function (x) { return x.id === id; });
    var activo = document.getElementById('swActivo').classList.contains('on');
    api(id ? 'PUT' : 'POST', id ? '/api/admin/usuarios/' + id : '/api/admin/usuarios', datos).then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje || 'No se pudo guardar', 'error'); return null; }
      closeModal();
      if (!id) { mostrarPassword(datos.nombre, r.d.passwordTemporal); return null; }
      showToast(r.d.sesionesRevocadas ? 'Cambios guardados; se cerró su sesión por el cambio de rol o gerencia' : 'Cambios guardados', 'success');
      // El interruptor de estado del modal también se respeta
      if (editado && editado.activo !== activo) return api('POST', '/api/admin/usuarios/' + id + (activo ? '/reactivar' : '/desactivar'));
      return null;
    }).then(function (r) {
      if (r && !r.ok) showToast(r.d.mensaje, 'error');
      return window.cargarUsuarios();
    });
  };

  window.ejecutarToggle = function () {
    var u = USUARIOS.find(function (x) { return x.id === pendingToggleId; });
    closeConfirm();
    if (!u) return;
    api('POST', '/api/admin/usuarios/' + u.id + (u.activo ? '/desactivar' : '/reactivar')).then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje, 'error'); return; }
      showToast('Cuenta ' + (u.activo ? 'desactivada' : 'activada') + ' correctamente', 'success');
      window.cargarUsuarios();
    });
  };

  function restablecer(u) {
    closeModal();
    api('POST', '/api/admin/usuarios/' + u.id + '/restablecer').then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje, 'error'); return; }
      mostrarPassword(u.nombre, r.d.passwordTemporal);
      window.cargarUsuarios();
    });
  }

  function desbloquear(u) {
    closeModal();
    api('POST', '/api/admin/usuarios/' + u.id + '/desbloquear').then(function (r) {
      if (!r.ok) { showToast(r.d.mensaje, 'error'); return; }
      showToast(r.d.desbloqueado ? 'Cuenta desbloqueada' : 'La cuenta no estaba bloqueada', 'success');
      window.cargarUsuarios();
    });
  }

  /** La contraseña temporal se ve una sola vez: el servidor no la guarda en claro (CA_3). */
  function mostrarPassword(nombre, password) {
    document.getElementById('confirmTitle').textContent = 'Contraseña temporal';
    document.getElementById('confirmBody').textContent = 'Entrégale a ' + nombre + ' esta contraseña por un medio seguro: ' +
      password + ' . Deberá cambiarla al iniciar sesión. No se volverá a mostrar.';
    var btn = document.getElementById('confirmBtn');
    btn.textContent = 'Copiar y cerrar';
    btn.onclick = function () {
      try { navigator.clipboard.writeText(password); } catch (e) {}
      closeConfirm();
      showToast('Contraseña copiada', 'success');
    };
    document.getElementById('modalConfirm').classList.add('open');
  }

  // ── Inicio: fuera los datos simulados ───────────────────────────────────
  USUARIOS = [];
  renderStats();
  renderTabla();
  api('GET', '/api/admin/catalogo').then(function (r) {
    if (!r.ok) return;
    CATALOGO = r.d.gerencias;
    prepararFormulario();
  });
  window.cargarUsuarios();
})();
