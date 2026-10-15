/**
 * Mapeos entre los valores del prototipo y los catálogos del esquema (TEC-02).
 *
 * Único lugar donde vive la traducción. Si una migración cambia un CHECK, se
 * cambia aquí y se vuelve a extraer; los datos de origen no se tocan.
 */

/** Gerencias. La clave es la del esquema: ver migración 20261008000002. */
export interface Gerencia {
  clave: string
  nombre: string
  /** Formas en que las fuentes del prototipo escriben esta gerencia. */
  alias: string[]
  /** false cuando la gerencia existe en el catálogo del prototipo pero no tiene indicadores. */
  activo: boolean
}

export const GERENCIAS: Gerencia[] = [
  { clave: 'PLA', nombre: 'Gerencia de Planeación Estratégica', activo: true,
    alias: ['Planeación Estratégica', 'Gerencia de Planeación Estratégica', 'Gerencia Planeación Estratégica'] },
  { clave: 'COM', nombre: 'Gerencia Comercial', activo: true,
    alias: ['Comercial', 'Gerencia Comercial'] },
  { clave: 'ADM', nombre: 'Gerencia Administrativa', activo: true,
    alias: ['Administrativa', 'Gerencia Administrativa'] },
  { clave: 'TEC', nombre: 'Gerencia Técnica', activo: true,
    alias: ['Técnica', 'Gerencia Técnica'] },
  // El CSV institucional (2026.09.14-MIR-COMAPA_UNIFICADA) confirma 2 indicadores
  // de Gerencia General (Fin + Propósito). Activa desde la importación del catálogo.
  { clave: 'GEN', nombre: 'Gerencia General', activo: true,
    alias: ['General', 'Gerencia General'] },
]

/** usuarios.rol — CHECK IN ('admin', 'revisor', 'enlace') */
export const ROLES: Record<string, string> = {
  'Administrador': 'admin',
  'Revisor': 'revisor',
  'Enlace': 'enlace',
}

/** indicadores.nivel — CHECK IN ('fin', 'proposito', 'componente', 'actividad') */
export const NIVELES: Record<string, string> = {
  'Fin': 'fin',
  'Propósito': 'proposito',
  'Componente': 'componente',
  'Actividad': 'actividad',
}

/** indicadores.frecuencia — FK a frecuencias(clave), las seis de la migración 20261008000004 */
export const FRECUENCIAS: Record<string, string> = {
  'Mensual': 'mensual',
  'Bimestral': 'bimestral',
  'Trimestral': 'trimestral',
  'Cuatrimestral': 'cuatrimestral',
  'Semestral': 'semestral',
  'Anual': 'anual',
}

/** Duración en meses por frecuencia (igual que frecuencias.meses). */
export const MESES_POR_FRECUENCIA: Record<string, number> = {
  mensual: 1, bimestral: 2, trimestral: 3, cuatrimestral: 4, semestral: 6, anual: 12,
}

/** Días hábiles de ventana de captura (igual que los INSERT de la migración). */
export const DIAS_HABILES_POR_FRECUENCIA: Record<string, number> = {
  mensual: 10, bimestral: 12, trimestral: 15, cuatrimestral: 18, semestral: 20, anual: 30,
}

/** indicadores.tipo_indicador — CHECK IN ('estrategico', 'gestion'); acepta NULL */
export const TIPOS_INDICADOR: Record<string, string> = {
  'Estratégico': 'estrategico',
  'Gestión': 'gestion',
}

/** reportes.estado — los nueve de la migración 20261008000007 */
export const ESTADOS_REPORTE = new Set([
  'pendiente_carga', 'borrador', 'enviado_revision', 'observado', 'corregido',
  'aprobado_revisor', 'regresado_correccion', 'cerrado', 'incumplido',
])

const ALIAS_A_CLAVE = new Map<string, string>()
for (const g of GERENCIAS) for (const a of g.alias) ALIAS_A_CLAVE.set(a.trim(), g.clave)

/** Nombres de gerencia que ninguna entrada de GERENCIAS reconoció. */
export const gerenciasSinAlias = new Set<string>()

export function claveGerencia(texto: unknown): string {
  if (!texto) return ''
  const clave = ALIAS_A_CLAVE.get(String(texto).trim())
  if (!clave) gerenciasSinAlias.add(String(texto).trim())
  return clave ?? ''
}

/** Traduce con tabla explícita; registra lo que no está en el catálogo. */
export function traducir(
  tabla: Record<string, string>,
  valor: unknown,
  sinTraduccion: Set<string>,
): string {
  if (valor === null || valor === undefined || valor === '') return ''
  const v = String(valor).trim()
  const t = tabla[v]
  if (t === undefined) { sinTraduccion.add(v); return ''; }
  return t
}
