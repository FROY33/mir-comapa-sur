// Utilidades para probar el frontend del prototipo sin navegador.

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const RAIZ = path.resolve(import.meta.dirname, '../..')

/** Un archivo de la raíz del prototipo. */
export const archivo = (nombre: string) => readFileSync(path.join(RAIZ, nombre), 'utf8')

/** Los scripts de sesión en el orden en que los carga cada página, como un solo código. */
export const codigoSesion = () => ['session.js', 'guardia.js', 'vistas-mir.js'].map(archivo).join('\n;\n')

/** El <script> en línea de `pagina` que contiene `marca` (las vistas tienen su código en el HTML). */
export function scriptDePagina(pagina: string, marca: string): string {
  const bloques = [...archivo(pagina).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
  const bloque = bloques.find((b) => b.includes(marca))
  if (!bloque) throw new Error(`${pagina} no tiene un <script> con «${marca}»`)
  return bloque
}

export interface Elemento {
  id: string; innerHTML: string; textContent: string; value: string
  style: Record<string, string>; dataset: Record<string, string>
  hijos: Elemento[]; parentNode: Elemento | null; firstChild: null
  [k: string]: unknown
}

/**
 * Ejecuta código del navegador con un DOM mínimo: cada elemento guarda el HTML que le asignan,
 * para revisar después lo que se pintó. `respuestas` son los cuerpos JSON de la API por prefijo
 * de ruta; lo que no esté ahí responde 404. Devuelve lo que pida `exportar` y el DOM.
 */
export function ejecutarEnNavegador(codigo: string, exportar: string[], opciones: {
  cookie?: string; pagina?: string; respuestas?: Record<string, unknown>
} = {}) {
  const creados: Elemento[] = []
  const elemento = (id = '', padre: Elemento | null = null): Elemento => {
    const e: Elemento = {
      id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, hijos: [], parentNode: padre, firstChild: null,
      classList: { add() {}, remove() {}, toggle() { return false }, contains() { return false } },
      setAttribute() {}, getAttribute() { return null }, addEventListener() {}, remove() {}, focus() {},
      appendChild: (h: Elemento) => { h.parentNode = e; e.hijos.push(h); return h },
      insertBefore: (h: Elemento) => { h.parentNode = e; e.hijos.unshift(h); return h },
      removeChild: (h: Elemento) => { e.hijos = e.hijos.filter((x) => x !== h); h.parentNode = null; return h },
      insertAdjacentHTML: (_donde: string, html: string) => { e.innerHTML = html + e.innerHTML },
      querySelector: () => elemento('', e), querySelectorAll: () => [], closest: () => elemento('', e),
    }
    creados.push(e)
    return e
  }
  const porId = new Map<string, Elemento>()
  const oyentes: Record<string, () => void> = {}
  const body = elemento('body')
  const documento = {
    cookie: opciones.cookie ?? '', body, head: elemento('head'), documentElement: elemento('html'),
    getElementById: (id: string) => porId.get(id) ?? porId.set(id, elemento(id)).get(id),
    querySelector: () => elemento('', body),
    querySelectorAll: () => [],
    createElement: () => elemento(),
    addEventListener: (ev: string, fn: () => void) => { oyentes[ev] = fn },
  }
  const ventana = {
    location: { pathname: `/${opciones.pagina ?? 'pagina.html'}`, search: '', href: '', replace() {} },
    addEventListener() {},
  }
  const respuestas = opciones.respuestas ?? {}
  const fetchFalso = (ruta: string) => {
    const cuerpo = Object.entries(respuestas).find(([prefijo]) => ruta.startsWith(prefijo))?.[1]
    const ok = cuerpo !== undefined
    return Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(cuerpo ?? {}) })
  }
  const almacen = { getItem: () => null, setItem() {}, removeItem() {} }
  const api = new Function('window', 'document', 'fetch', 'localStorage', 'sessionStorage', 'navigator', 'setTimeout',
    `${codigo}\n;return { ${exportar.join(', ')} }`)(
    ventana, documento, fetchFalso, almacen, almacen, {}, () => 0) as Record<string, (...a: unknown[]) => unknown>

  /** Todo el HTML que el código asignó, de cualquier elemento. */
  const htmlPintado = () => creados.map((e) => e.innerHTML).join('\n')
  /** Todo el texto asignado con textContent. */
  const textoPintado = () => creados.map((e) => e.textContent).join('\n')
  const disparar = (ev: string) => oyentes[ev]?.()
  return { api, ventana: ventana as typeof ventana & Record<string, unknown>, documento, htmlPintado, textoPintado, disparar }
}
