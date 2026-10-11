// Utilidades para probar el frontend del prototipo sin navegador.

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const RAIZ = path.resolve(import.meta.dirname, '../..')

/** Los scripts de sesión en el orden en que los carga cada página, como un solo código. */
export const codigoSesion = () =>
  ['session.js', 'guardia.js', 'vistas-mir.js'].map((f) => readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n')
