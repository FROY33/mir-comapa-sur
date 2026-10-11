// Lectura de los CSV de datos/. Los CSV son el artefacto de revisión (Planeación confirma
// gerencias y unidades sobre ellos), así que son también la fuente de la carga: lo que se
// revisa es lo que se carga. Parser mínimo con comillas dobles, sin dependencias.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DATOS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'datos')

export function leerCsv(nombre: string): Record<string, string>[] {
  const texto = readFileSync(path.join(DATOS, nombre), 'utf8')
  const filas: string[][] = []
  let campo = ''
  let fila: string[] = []
  let enComillas = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') enComillas = false
      else campo += c
    } else if (c === '"') enComillas = true
    else if (c === ',') { fila.push(campo); campo = '' }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila) }

  const [encabezado, ...resto] = filas
  if (encabezado === undefined) throw new Error(`${nombre} está vacío`)
  return resto
    .filter((f) => f.some((v) => v !== ''))
    .map((f) => Object.fromEntries(encabezado.map((col, n) => [col, f[n] ?? ''])))
}

export const vacioANulo = (v: string | undefined) => (v === undefined || v === '' ? null : v)
export const numeroONulo = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v))
export const booleano = (v: string | undefined) => v === 'true'
