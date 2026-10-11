// extraer/base.ts — Rutas, carga de los archivos del prototipo y utilidades (CSV, fechas, etiquetas).
// Parte del extractor de TEC-04 (../extraer.ts); se ejecuta una vez al importarse.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')   // db/semilla
export const RAIZ = path.resolve(AQUI, '../../..');     // raíz del repo: ahí viven los archivos del prototipo
export const DATOS = path.join(AQUI, 'datos')

/** Ejercicio y corte de referencia del prototipo (los datos son de Q3 2026). */
export const EJERCICIO = 2026
export const CORTE = '2026-09-30'

// ── Carga de los archivos del prototipo ──────────────────────────────────────
// Son scripts de navegador, no módulos: se evalúan con new Function y stubs de
// window/document/localStorage para extraer la variable global que declaran. No es un
// entorno aislado (corre con los permisos de Node): solo se usa con archivos del repo.
export function cargar<T>(archivoRelativo: string, nombreVariable: string): T[] {
  const code = fs.readFileSync(path.join(RAIZ, archivoRelativo), 'utf8')
  const noop = () => {}
  const almacen = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop }
  const ventana: Record<string, unknown> = { location: { href: '' }, addEventListener: noop, localStorage: almacen }
  const documento = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] }
  const fn = new Function('window', 'document', 'localStorage', 'location',
    `${code}\n; return typeof ${nombreVariable} !== "undefined" ? ${nombreVariable} : (window.${nombreVariable} || null);`)
  const valor = fn(ventana, documento, almacen, ventana.location) as T[] | null
  if (!valor) throw new Error(`No se pudo extraer ${nombreVariable} de ${archivoRelativo}`)
  return valor
}

export const src = {
  operativos:  cargar<any>('mir-actividades-data.js', 'ACTIVIDADES_ENLACE'),
  gerenciales: cargar<any>('mir-gerencial-data.js', 'ACTIVIDADES_GERENCIA'),
  catGerencias: cargar<any>('mir-gerencias-data.js', 'GERENCIAS_MIR'),
  catalogoMir: cargar<any>('data/mir-comapa-sur.js', 'MIR_DATA'),
  // session.js ya no tiene usuarios (HU-R7-01 conectó el login real): se leen de la copia congelada
  usuarios:    cargar<any>('backend/db/semilla/origen/usuarios-prototipo.js', 'MOCK_USERS'),
}

// ── Utilidades ───────────────────────────────────────────────────────────────
export const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
export const cuenta = <T>(a: T[], f: (x: T) => string) =>
  a.reduce<Record<string, number>>((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {})
export const colar = (a: string, b: string) => a.localeCompare(b, 'es')

export function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const salidas: { archivo: string; filas?: number; sha256: string }[] = []

export function escribirCsv(nombre: string, filas: Record<string, unknown>[]) {
  const primera = filas[0]
  if (primera === undefined) throw new Error(`${nombre}: no hay filas que escribir`)
  const columnas = Object.keys(primera)
  const texto = [columnas.join(','), ...filas.map(f => columnas.map(c => celda(f[c])).join(','))].join('\n') + '\n'
  fs.writeFileSync(path.join(DATOS, nombre), texto, 'utf8')
  salidas.push({ archivo: `datos/${nombre}`, filas: filas.length, sha256: sha(texto) })
}

// ── Fechas (sin dependencias; todo en UTC para que no dependa del huso) ──────
export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const finDeMes = (anio: number, mes1: number) => new Date(Date.UTC(anio, mes1, 0))
export const masDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
export const esHabil = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

/** El n-ésimo día hábil contando desde `desde` inclusive. */
export function diaHabil(desde: Date, n: number): Date {
  let d = new Date(desde), vistos = esHabil(d) ? 1 : 0
  while (vistos < n) { d = masDias(d, 1); if (esHabil(d)) vistos++; }
  return d
}

export const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Etiqueta del periodo. Sigue las formas documentadas en estructura-datos-flujo.md. */
export function etiqueta(frecuencia: string, numero: number, inicio: Date): string {
  switch (frecuencia) {
    case 'mensual':       return `${MESES_ES[inicio.getUTCMonth()]}-${EJERCICIO}`
    case 'bimestral':     return `B${numero}-${EJERCICIO}`
    case 'trimestral':    return `T${numero}-${EJERCICIO}`
    case 'cuatrimestral': return `C${numero}-${EJERCICIO}`
    case 'semestral':     return `S${numero}-${EJERCICIO}`
    default:              return String(EJERCICIO)
  }
}
