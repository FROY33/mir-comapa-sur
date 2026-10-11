// extraer/organizacion.ts — Gerencias, unidades y usuarios.
// Parte del extractor de TEC-04 (../extraer.ts); se ejecuta una vez al importarse.

import { GERENCIAS, ROLES, claveGerencia, traducir } from '../mapeos.js'
import { src, cuenta, colar } from './base.js'

// ── 1. Gerencias ─────────────────────────────────────────────────────────────
export const porGerenciaOp  = cuenta(src.operativos,  x => claveGerencia(x.gerencia))
export const porGerenciaGer = cuenta(src.gerenciales, x => claveGerencia(x.gerencia))
export const porGerenciaMir = cuenta(src.catalogoMir, x => claveGerencia(x.gerencia))
export const catPorClave = new Map(src.catGerencias.map(g => [claveGerencia(g.gerenciaName || g.nombre), g]))

export const filasGerencias = GERENCIAS.map(g => {
  const cat = catPorClave.get(g.clave)
  return {
    clave: g.clave,                                       // ← CLAVE NATURAL · gerencias.clave
    nombre: g.nombre,                                     // gerencias.nombre
    titular_nombre: '',                                   // gerencias.titular_nombre — firma de PDF, no está en el prototipo
    titular_cargo: '',
    activo: g.activo,                                     // gerencias.activo
    indicadores_mir: porGerenciaOp[g.clave] || 0,         // ↓ columnas de revisión, no van a la tabla
    indicadores_gerenciales: porGerenciaGer[g.clave] || 0,
    indicadores_catalogo_193: porGerenciaMir[g.clave] || 0,
    confirmacion_institucional: 'PENDIENTE',               // ← requisito CA-1
  }
}).sort((a, b) => colar(a.clave, b.clave))

// ── 2. Unidades ──────────────────────────────────────────────────────────────
// No existen como catálogo en ninguna fuente: se derivan del texto libre de los
// indicadores. Ver INCONSISTENCIAS.md §6.
export interface Unidad { gerencia_clave: string; nombre: string; op: number; ger: number; usr: number; }
export const unidades = new Map<string, Unidad>()

export function registrarUnidad(gerencia: unknown, nombre: unknown, origen: 'op' | 'ger' | 'usr') {
  if (!nombre) return
  const gc = claveGerencia(gerencia)
  const n = String(nombre).trim()
  const llave = `${gc}||${n}`
  if (!unidades.has(llave)) unidades.set(llave, { gerencia_clave: gc, nombre: n, op: 0, ger: 0, usr: 0 })
  unidades.get(llave)![origen]++
}
src.operativos.forEach(x => registrarUnidad(x.gerencia, x.unidadResponsable, 'op'))
src.gerenciales.forEach(x => registrarUnidad(x.gerencia, x.area, 'ger'))
// Una unidad citada por un usuario también es una unidad real, aunque ningún
// indicador la referencie (es el caso de Gerencia General).
src.usuarios.forEach(x => registrarUnidad(x.gerencia, x.unidadResponsable, 'usr'))

// unidades.es_coord_general: índice único parcial, máximo una por gerencia
export const esCoordGeneral = (n: string) => /^Coordinaci[oó]n General\b/i.test(n)

export const filasUnidades = [...unidades.values()].map(u => ({
  gerencia_clave: u.gerencia_clave,                       // ← CLAVE NATURAL (compuesta) · FK a gerencias
  nombre: u.nombre,                                       // ← CLAVE NATURAL (compuesta) · UNIQUE (gerencia_id, nombre)
  es_coord_general: esCoordGeneral(u.nombre),             // unidades.es_coord_general
  activo: true,
  indicadores_mir: u.op,                                  // ↓ columnas de revisión
  indicadores_gerenciales: u.ger,
  solo_citada_por_usuarios: u.op === 0 && u.ger === 0,
  confirmacion_institucional: 'PENDIENTE',                // ← requisito CA-1
})).sort((a, b) => colar(a.gerencia_clave, b.gerencia_clave) || colar(a.nombre, b.nombre))

/** Coordinación General de cada gerencia, para los usuarios sin unidad asignada. */
export const coordGeneralDe = new Map<string, string>()
for (const u of filasUnidades) if (u.es_coord_general) coordGeneralDe.set(u.gerencia_clave, u.nombre)

// ── 3. Usuarios ──────────────────────────────────────────────────────────────
// usuarios.unidad_id es NOT NULL con FK compuesta (unidad_id, gerencia_id): todo
// usuario necesita una unidad de su propia gerencia. 6 del prototipo no la traen
// se les asigna la Coordinación General y queda marcado. Ver INCONSISTENCIAS.md §12.
export const rolesSinTraduccion = new Set<string>()

export const filasUsuarios = src.usuarios.map(u => {
  const gc = claveGerencia(u.gerencia)
  const propia = u.unidadResponsable ? String(u.unidadResponsable).trim() : ''
  const porDefecto = !propia
  const unidad = propia || coordGeneralDe.get(gc) || ''
  return {
    email: String(u.email).toLowerCase(),                 // ← CLAVE NATURAL · usuarios.email (citext UNIQUE)
    nombre: u.nombre,
    rol: traducir(ROLES, u.rol, rolesSinTraduccion),      // usuarios.rol
    gerencia_clave: gc,                                   // FK a gerencias
    unidad_nombre: unidad,                                // FK compuesta con gerencia_clave
    unidad_por_defecto: porDefecto,                       // ← marca de auditoría: la unidad la puso el extractor
    debe_cambiar_password: true,                          // usuarios.debe_cambiar_password
    activo: true,
    iniciales: u.iniciales || '',
    id_prototipo: u.id,
    gerencia_texto_origen: u.gerencia || '',
    // La contraseña NO se exporta: el hash bcrypt (≥12 rondas) lo genera el cargador. CA-2.
  }
}).sort((a, b) => colar(a.email, b.email))
