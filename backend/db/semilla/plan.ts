// Qué se carga y dónde (TEC-04 CA-4 y la nota «no guardar contraseñas en el repositorio»).
// Funciones puras: se prueban sin base y sin correr la carga.
//
// Dos modos, según la base destino:
//
//   demostración   base local o de pruebas, fuera de producción. Carga además los usuarios
//                  del prototipo y los de prueba, y con --con-fixtures, los reportes de prueba.
//   inicial        producción o cualquier base remota. Solo catálogo y UNA cuenta de
//                  Administrador con correo, nombre y contraseña de variables de entorno.
//                  Si la base ya tiene usuarios no hace nada: la carga inicial no se repite,
//                  así una segunda corrida no revierte lo que se haya cambiado desde la app.
//
// No hay contraseña por defecto en ningún modo: sin SEMILLA_PASSWORD la carga no corre.

import type { Entorno } from '../../src/config.js'

export class ErrorPlan extends Error {}

export interface Plan {
  modo: 'demostracion' | 'inicial'
  fixtures: boolean
  soloVerificar: boolean
  /** Solo el catálogo de indicadores sobre una base del sprint 1 (S2-TEC-02). */
  catalogo: boolean
  /** Con --catalogo: repetir una carga ya registrada, sin pisar lo que se editó desde la pantalla. */
  forzar: boolean
}

const BANDERAS = new Set(['--con-fixtures', '--verificar', '--catalogo', '--forzar'])
const HOSTS_LOCALES = new Set(['', 'localhost', '127.0.0.1', '[::1]', '::1'])
export const LARGO_MINIMO_PASSWORD = 12

/** Base en este equipo (socket o localhost) o de pruebas (_test). */
export function esBaseLocal(url: string): boolean {
  const u = new URL(url)
  return HOSTS_LOCALES.has(u.hostname) || u.pathname.replace(/^\//, '').endsWith('_test')
}

/** Destino legible para imprimir antes de cargar, sin usuario ni contraseña. */
export function destino(url: string): string {
  const u = new URL(url)
  return `${u.hostname || 'socket local'}${u.port ? `:${u.port}` : ''}${u.pathname}`
}

export function planDeCarga(argv: string[], entorno: Entorno, url: string): Plan {
  const desconocidas = argv.filter((a) => !BANDERAS.has(a))
  if (desconocidas.length > 0) {
    throw new ErrorPlan(`Opción desconocida: ${desconocidas.join(' ')}. Válidas: ${[...BANDERAS].join(', ')}`)
  }
  const fixtures = argv.includes('--con-fixtures')
  const catalogo = argv.includes('--catalogo')
  const forzar = argv.includes('--forzar')
  if (forzar && !catalogo) throw new ErrorPlan('--forzar solo se usa con --catalogo.')
  if (catalogo && (fixtures || argv.includes('--verificar'))) {
    throw new ErrorPlan('--catalogo no se combina con --con-fixtures ni con --verificar.')
  }
  const modo = entorno !== 'production' && esBaseLocal(url) ? 'demostracion' : 'inicial'

  if (fixtures && modo === 'inicial') {
    throw new ErrorPlan(entorno === 'production'
      ? 'Las fixtures de prueba no se cargan en producción (CA-4).'
      : `Las fixtures de prueba solo se cargan en una base local o de pruebas, y el destino es ${destino(url)} (CA-4).`)
  }
  return { modo, fixtures, soloVerificar: argv.includes('--verificar'), catalogo, forzar }
}

export function passwordInicial(env: NodeJS.ProcessEnv): string {
  const password = env.SEMILLA_PASSWORD ?? ''
  if (password.length < LARGO_MINIMO_PASSWORD) {
    throw new ErrorPlan(`Define SEMILLA_PASSWORD (${LARGO_MINIMO_PASSWORD} caracteres o más). ` +
      'Es la contraseña inicial de las cuentas; no hay valor por defecto.')
  }
  return password
}

export interface AdminInicial {
  email: string
  nombre: string
  gerenciaClave: string
}

/** La cuenta de Administrador del modo inicial. Su unidad es la Coordinación General de su gerencia. */
export function adminInicial(env: NodeJS.ProcessEnv): AdminInicial {
  const email = env.SEMILLA_ADMIN_EMAIL?.trim() ?? ''
  const nombre = env.SEMILLA_ADMIN_NOMBRE?.trim() ?? ''
  if (email === '' || nombre === '') {
    throw new ErrorPlan('Para la carga inicial define SEMILLA_ADMIN_EMAIL y SEMILLA_ADMIN_NOMBRE ' +
      '(la cuenta de Administrador; no se usa ninguna persona del prototipo).')
  }
  return { email, nombre, gerenciaClave: env.SEMILLA_ADMIN_GERENCIA?.trim() || 'PLA' }
}
