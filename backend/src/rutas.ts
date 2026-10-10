// Qué páginas puede abrir cada rol (HU-R7-02 RN_1).
//
// ALCANCE: esto NO protege rutas. Sirve para una sola decisión — si al usuario se le
// guardó un destino antes de mandarlo al login, ¿se le devuelve ahí o a su dashboard?
// RN_1 pide descartarlo cuando el rol no tiene acceso. La protección de rutas de verdad
// (impedir que alguien escriba la URL y entre) es otra historia y no existe todavía.
//
// Fuente: la tabla «Mapeo de vistas por rol» de roles-usuarios.md, más las
// comprobaciones que cada página ya hace sobre `user.rol`.

export type Rol = 'admin' | 'revisor' | 'enlace'

const TODOS: Rol[] = ['admin', 'revisor', 'enlace']

/** Dashboard de cada rol. Es el destino por defecto tras iniciar sesión (CA_1). */
export const DASHBOARD: Record<Rol, string> = {
  admin: 'dashboard-admin.html',
  revisor: 'dashboard-revisor.html',
  enlace: 'dashboard-enlace.html',
}

/**
 * Página → roles que pueden abrirla. Lo que no esté aquí se trata como no permitido:
 * ante la duda, el destino se descarta y el usuario va a su dashboard, que nunca es
 * un error. Una página nueva hay que agregarla a propósito.
 */
const ACCESO: Record<string, Rol[]> = {
  // Dashboards
  'dashboard-admin.html': ['admin'],
  'dashboard-revisor.html': ['revisor'],
  'dashboard-enlace.html': ['enlace'],

  // Consulta compartida: el detalle de un indicador lo ven los tres (roles-usuarios.md)
  'consulta-mir.html': ['admin', 'revisor'],
  'detalle-indicador.html': TODOS,
  'detalle-indicador-gerencial.html': ['admin', 'revisor'],
  'estructura-indicadores.html': ['admin'],
  'planeacion-mir.html': ['admin'],

  // Enlace: carga de evidencia y seguimiento de lo suyo
  'mis-actividades.html': ['enlace'],
  'mis-observaciones.html': ['enlace'],
  'detalle-actividad.html': ['enlace', 'revisor'],
  'reporte-avance.html': ['enlace'],
  'planeacion-enlace.html': ['enlace'],
  'planeacion-metas-enlace.html': ['enlace'],

  // Revisor: bandeja, revisión y sus reportes
  'bandeja-revision.html': ['revisor'],
  'revision-actividad.html': ['revisor'],
  'historial-revisor.html': ['revisor'],
  'reportes-revisor.html': ['revisor'],
  'planeacion-metas-revisor.html': ['revisor'],

  // Administrador: validación, reportes y configuración
  'validacion-admin-dashboard.html': ['admin'],
  'validacion-gerencia-detalle.html': ['admin'],
  'validacion-indicador-detalle.html': ['admin'],
  'validacion-reportes.html': ['admin'],
  'detalle-gerencia.html': ['admin'],
  'reportes.html': ['admin'],
  'planeacion-indicadores.html': ['admin'],
  'planeacion-metas-admin.html': ['admin'],
  'configuracion.html': ['admin'],
}

/** Páginas que nunca son un destino válido tras iniciar sesión. */
const NO_SON_DESTINO = new Set(['login.html', 'index.html'])

export function puedeAbrir(rol: Rol, pagina: string): boolean {
  return ACCESO[pagina]?.includes(rol) ?? false
}

/**
 * Normaliza un destino guardado y decide si se puede honrar (RN_1).
 *
 * Devuelve la ruta a usar, o null si hay que descartarla. Se rechaza todo lo que no
 * sea una página interna del sitio: rutas absolutas a otro host, protocol-relative
 * (`//otro.com`), `javascript:`, rutas con `..`, y cualquier página que el rol no
 * pueda abrir. Un destino inválido no es un error: simplemente se va al dashboard.
 */
export function destinoPermitido(destino: string | undefined, rol: Rol): string | null {
  if (!destino) return null

  let ruta = destino.trim()
  if (ruta === '') return null

  // Nada de otro origen ni de otro esquema
  if (/^[a-z][a-z0-9+.-]*:/i.test(ruta)) return null     // http:, javascript:, data:
  if (ruta.startsWith('//')) return null                 // protocol-relative
  if (ruta.includes('\\')) return null                   // separador de Windows en una URL

  // Se queda solo con el nombre de la página: sin query, sin fragmento, sin carpetas
  ruta = ruta.split('?')[0]!.split('#')[0]!
  if (ruta.startsWith('/')) ruta = ruta.slice(1)
  if (ruta.includes('/') || ruta.includes('..')) return null

  try { ruta = decodeURIComponent(ruta) } catch { return null }
  if (ruta === '' || NO_SON_DESTINO.has(ruta)) return null

  return puedeAbrir(rol, ruta) ? ruta : null
}

/** A dónde mandar al usuario tras iniciar sesión: su destino guardado, o su dashboard. */
export function destinoTrasLogin(destinoGuardado: string | undefined, rol: Rol): string {
  return destinoPermitido(destinoGuardado, rol) ?? DASHBOARD[rol]
}
