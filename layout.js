/* layout.js — Auth guard + header injection para todas las páginas autenticadas */

// ── 1. AUTH CHECK (inmediato, antes de renderizar) ──────────────────────────
document.documentElement.style.visibility = 'hidden';

const _layoutUser = Session.requireAuth();
// requireAuth() redirige a login.html si no hay sesión activa

// ── 2. INYECCIÓN DE HEADER Y CSS (después del DOM) ─────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  if (!_layoutUser) return;

  const user = _layoutUser;
  const notifs = (typeof getNotificationsForRole === 'function')
    ? getNotificationsForRole(user.rol)
    : [];
  const unread = notifs.filter(n => !n.leida).length;

  const roleClass = {
    'Administrador': 'role-admin',
    'Revisor': 'role-revisor',
    'Enlace': 'role-enlace'
  }[user.rol] || 'role-admin';

  // ── CSS ──────────────────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
    /* Ajuste de layout para el header */
    .app-wrapper      { padding-top: 52px !important; }
    .sidebar          { top: 52px !important; height: calc(100vh - 52px) !important; }
    .right-panel      { top: 52px !important; height: calc(100vh - 52px) !important; }
    .rp-toggle        { top: 68px !important; }
    .detail-drawer    { top: 52px !important; height: calc(100vh - 52px) !important; }

    /* ── App header ── */
    .app-header {
      position: fixed; top: 0; left: 64px; right: 0; height: 52px;
      background: #fff; border-bottom: 1px solid #E5E7EB;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px 0 16px; z-index: 150;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    .h-brand {
      font-size: 13px; font-weight: 700; color: #111827; letter-spacing: -0.01em;
    }
    .h-right { display: flex; align-items: center; gap: 10px; }

    /* Notificaciones */
    .h-notif-wrap { position: relative; }
    .h-notif-btn {
      width: 34px; height: 34px; border-radius: 8px;
      background: transparent; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: #6B7280; position: relative; transition: background .15s, color .15s;
    }
    .h-notif-btn:hover { background: #F7F7F7; color: #111827; }
    .h-notif-btn.active { background: #F5E8EC; color: #8B1D3A; }
    .h-notif-btn svg { width: 18px; height: 18px; }
    .h-notif-badge {
      position: absolute; top: 4px; right: 4px;
      min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px;
      background: #8B1D3A; color: #fff; font-size: 9px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; pointer-events: none;
    }
    .h-notif-badge.hidden { display: none; }

    /* Panel de notificaciones */
    .h-notif-panel {
      position: absolute; top: calc(100% + 8px); right: 0;
      width: 340px; max-height: 460px;
      background: #fff; border: 1px solid #E5E7EB; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,.12);
      display: flex; flex-direction: column; overflow: hidden; z-index: 500;
    }
    .h-notif-panel.hidden { display: none; }
    .hnp-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 12px; border-bottom: 1px solid #F3F4F6; flex-shrink: 0;
    }
    .hnp-title { font-size: 13px; font-weight: 700; color: #111827; }
    .hnp-mark-all {
      font-size: 11px; font-weight: 600; color: #8B1D3A;
      background: none; border: none; cursor: pointer; padding: 0;
    }
    .hnp-mark-all:hover { text-decoration: underline; }
    .hnp-list { overflow-y: auto; flex: 1; }
    .hnp-item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 11px 16px; cursor: pointer; transition: background .1s;
      border-bottom: 1px solid #F7F7F7;
    }
    .hnp-item:last-child { border-bottom: none; }
    .hnp-item:hover { background: #F7F7F7; }
    .hnp-item.unread { background: #FDF5F7; }
    .hnp-item.unread:hover { background: #F5E8EC; }
    .hnp-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px;
    }
    .hnp-dot.upload { background: #8B1D3A; }
    .hnp-dot.clock  { background: #F59E0B; }
    .hnp-dot.alert  { background: #EF4444; }
    .hnp-dot.check  { background: #22C55E; }
    .hnp-dot.edit   { background: #6B7280; }
    .hnp-dot.x      { background: #9CA3AF; }
    .hnp-dot.read   { background: #D1D5DB; }
    .hnp-body { flex: 1; min-width: 0; }
    .hnp-item-title { font-size: 12px; font-weight: 600; color: #111827; line-height: 1.4; }
    .hnp-item-msg   { font-size: 11px; color: #6B7280; line-height: 1.4; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hnp-item-meta  { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .hnp-item-time  { font-size: 10px; color: #9CA3AF; }
    .hnp-act-id     { font-size: 10px; font-weight: 700; color: #8B1D3A; font-family: monospace; }
    .hnp-empty      { padding: 32px 16px; text-align: center; font-size: 12px; color: #9CA3AF; }
    .hnp-footer     { padding: 10px 16px; border-top: 1px solid #F3F4F6; text-align: center; flex-shrink: 0; }
    .hnp-footer a   { font-size: 12px; font-weight: 600; color: #8B1D3A; text-decoration: none; }
    .hnp-footer a:hover { text-decoration: underline; }

    /* Role badge */
    .h-role-badge {
      font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
      text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
    }
    .h-role-badge.role-admin   { background: #F5E8EC; color: #8B1D3A; }
    .h-role-badge.role-revisor { background: #F3F4F6; color: #374151; }
    .h-role-badge.role-enlace  { background: #F3F4F6; color: #374151; }

    /* User info */
    .h-user-wrap { display: flex; align-items: center; gap: 8px; }
    .h-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      background: #9CA3AF; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; flex-shrink: 0;
    }
    .h-avatar.role-admin { background: #8B1D3A; }
    .h-user-info { display: flex; flex-direction: column; line-height: 1.2; }
    .h-user-name { font-size: 12px; font-weight: 700; color: #111827; }
    .h-user-sub  { font-size: 10px; color: #9CA3AF; }

    /* Logout */
    .h-logout-btn {
      width: 30px; height: 30px; border-radius: 8px;
      background: transparent; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: #9CA3AF; transition: background .15s, color .15s;
    }
    .h-logout-btn:hover { background: #FEF2F2; color: #EF4444; }
    .h-logout-btn svg { width: 16px; height: 16px; }

    /* Separador vertical */
    .h-sep { width: 1px; height: 20px; background: #E5E7EB; flex-shrink: 0; }
  `;
  document.head.appendChild(css);

  // ── ITEMS DE NOTIFICACIONES ──────────────────────────────────────────────
  const notifItemsHtml = notifs.length
    ? notifs.slice(0, 7).map(n => `
        <div class="hnp-item ${n.leida ? '' : 'unread'}" data-id="${escaparHTML(n.id)}">
          <div class="hnp-dot ${n.leida ? 'read' : escaparHTML(n.icono)}"></div>
          <div class="hnp-body">
            <p class="hnp-item-title">${escaparHTML(n.titulo)}</p>
            <p class="hnp-item-msg">${escaparHTML(n.mensaje)}</p>
            <div class="hnp-item-meta">
              <span class="hnp-item-time">${escaparHTML(n.fecha)} · ${escaparHTML(n.hora)}</span>
              ${n.actividadId ? `<span class="hnp-act-id">${escaparHTML(n.actividadId)}</span>` : ''}
            </div>
          </div>
        </div>`).join('')
    : '<div class="hnp-empty">Sin notificaciones.</div>';

  // ── HTML DEL HEADER ──────────────────────────────────────────────────────
  // Nombre, gerencia y rol salen de la cookie de perfil (editable en el navegador) y las
  // notificaciones, de datos: todo pasa por escaparHTML (session.js) antes de entrar al HTML.
  const headerHtml = `
    <header class="app-header" id="appHeader">
      <span class="h-brand">MIR COMAPA Sur</span>
      <div class="h-right">

        <!-- Bell -->
        <div class="h-notif-wrap">
          <button class="h-notif-btn" id="hNotifBtn" title="Notificaciones">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/>
            </svg>
            <span class="h-notif-badge ${unread === 0 ? 'hidden' : ''}" id="hNotifBadge">${unread}</span>
          </button>

          <!-- Panel desplegable -->
          <div class="h-notif-panel hidden" id="hNotifPanel">
            <div class="hnp-head">
              <span class="hnp-title">Notificaciones</span>
              ${unread > 0 ? '<button class="hnp-mark-all" id="hMarkAll">Marcar como leídas</button>' : ''}
            </div>
            <div class="hnp-list" id="hNotifList">${notifItemsHtml}</div>
            <div class="hnp-footer"><a href="#">Ver todas las notificaciones</a></div>
          </div>
        </div>

        <div class="h-sep"></div>

        <!-- Role badge -->
        <span class="h-role-badge ${roleClass}">${escaparHTML(user.rol)}</span>

        <!-- User -->
        <div class="h-user-wrap">
          <div class="h-avatar ${roleClass === 'role-admin' ? 'role-admin' : ''}">${escaparHTML(user.iniciales)}</div>
          <div class="h-user-info">
            <span class="h-user-name">${escaparHTML(user.nombre)}</span>
            <span class="h-user-sub">${escaparHTML(user.gerencia)}</span>
          </div>
        </div>

        <div class="h-sep"></div>

        <!-- Logout -->
        <button class="h-logout-btn" id="hLogoutBtn" title="Cerrar sesión">
          <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25"/>
          </svg>
        </button>

      </div>
    </header>`;

  document.body.insertAdjacentHTML('afterbegin', headerHtml);

  // ── ACTUALIZAR AVATAR DEL SIDEBAR ────────────────────────────────────────
  document.querySelectorAll('.avatar-xs').forEach(el => {
    el.textContent = user.iniciales;
  });

  // ── ACTUALIZAR TOP-NAVBAR (páginas enlace/revisor) ───────────────────────
  const tnName   = document.querySelector('.topnav-name');
  const tnAvatar = document.querySelector('.topnav-avatar');
  const tnRole   = document.getElementById('topnavRole');
  if (tnName)   tnName.textContent   = user.nombre;
  if (tnAvatar) tnAvatar.textContent = user.iniciales;
  if (tnRole) {
    // De la sesión, no de localStorage: lo que se muestra no debe poder cambiarlo el navegador
    tnRole.textContent = user.unidadResponsable || user.gerencia || '';
  }

  // ── EVENTOS: NOTIFICACIONES ──────────────────────────────────────────────
  const notifBtn   = document.getElementById('hNotifBtn');
  const notifPanel = document.getElementById('hNotifPanel');

  notifBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = notifPanel.classList.toggle('hidden');
    notifBtn.classList.toggle('active', !notifPanel.classList.contains('hidden'));
  });

  document.addEventListener('click', () => {
    if (!notifPanel.classList.contains('hidden')) {
      notifPanel.classList.add('hidden');
      notifBtn.classList.remove('active');
    }
  });

  notifPanel.addEventListener('click', e => e.stopPropagation());

  const markAllBtn = document.getElementById('hMarkAll');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.hnp-item.unread').forEach(el => el.classList.remove('unread'));
      document.querySelectorAll('.hnp-dot').forEach(el => { el.className = 'hnp-dot read'; });
      document.getElementById('hNotifBadge').classList.add('hidden');
      markAllBtn.remove();
    });
  }

  // ── EVENTO: LOGOUT ───────────────────────────────────────────────────────
  // Delega en cerrarSesion() (session.js), que revoca la sesión en el servidor
  // antes de redirigir. Session.clear() sola no basta: solo borra la cookie de
  // perfil, la de sesión es HttpOnly y seguiría vigente, así que login.html
  // encontraría la sesión abierta y devolvería al usuario al dashboard.
  document.getElementById('hLogoutBtn').addEventListener('click', () => {
    cerrarSesion();
  });

  // ── REVELAR PÁGINA ───────────────────────────────────────────────────────
  document.documentElement.style.visibility = '';
});
