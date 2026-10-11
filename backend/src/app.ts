// Rutas de la API. Autenticación y pendientes se agregan aquí en sus tickets.

import { login, logout, sesion } from './auth.js'
import { acceso, crearProtegida } from './autorizacion.js'
import type { BD } from './bd.js'
import { listarFrecuencias } from './datos/frecuencias.js'
import { crearManejador } from './http.js'
import { cambiarPassword } from './cuenta.js'
import * as indicadores from './indicadores.js'
import type { Log } from './log.js'
import type { Rol } from './rutas.js'
import * as usuarios from './usuarios.js'

const TODOS: Rol[] = ['admin', 'revisor', 'enlace']

export function crearApp(
  bd: BD,
  log: Log,
  opciones: { confiarProxy?: boolean; produccion?: boolean } = {},
) {
  const produccion = opciones.produccion === true
  // Toda ruta con datos va envuelta: 401 sin sesión, 403 si el rol no está (HU-R7-03 CA_4)
  const protegida = crearProtegida(bd, produccion)

  return crearManejador({
    // Autenticación: inicio de sesión (HU-R7-01) y cierre (HU-R7-04)
    'POST /api/auth/login': login(bd, produccion),
    'POST /api/auth/logout': logout(bd, produccion),
    'GET /api/auth/sesion': sesion(bd, produccion),
    // ¿Puede la sesión abrir esta página? (HU-R7-03 CA_1, CA_2, CA_6)
    'GET /api/auth/acceso': acceso(bd, produccion),
    // Cambio de la contraseña propia; la única ruta abierta con contraseña temporal (HU-R7-07 CA_3)
    'POST /api/auth/cambiar-password': cambiarPassword(bd, produccion),

    // Indicadores, filtrados por la gerencia de la sesión (HU-R7-03 CA_5, RN_2)
    'GET /api/indicadores': protegida(TODOS, indicadores.listar(bd)),
    'POST /api/indicadores/buscar': protegida(TODOS, indicadores.buscar(bd)),
    'GET /api/indicadores/:id': protegida(TODOS, indicadores.detalle(bd)),

    // Solo Administrador: todo lo que cuelga de /api/admin/ (HU-R7-03 CA_3, CA_6)
    'GET /api/admin/configuracion': protegida(['admin'], async () => ({
      status: 200, cuerpo: { frecuencias: await listarFrecuencias(bd) },
    })),
    // Gestión de usuarios (HU-R7-07)
    'GET /api/admin/catalogo': protegida(['admin'], usuarios.catalogo(bd)),
    'GET /api/admin/usuarios': protegida(['admin'], usuarios.listar(bd)),
    'POST /api/admin/usuarios': protegida(['admin'], usuarios.crear(bd)),
    'PUT /api/admin/usuarios/:id': protegida(['admin'], usuarios.editar(bd)),
    'POST /api/admin/usuarios/:id/desactivar': protegida(['admin'], usuarios.cambiarEstado(bd, false)),
    'POST /api/admin/usuarios/:id/reactivar': protegida(['admin'], usuarios.cambiarEstado(bd, true)),
    'POST /api/admin/usuarios/:id/restablecer': protegida(['admin'], usuarios.restablecer(bd)),
    'POST /api/admin/usuarios/:id/desbloquear': protegida(['admin'], usuarios.desbloquearCuenta(bd)),

    // 200 si la base responde; 503 si no (lo resuelve el manejo central de errores)
    'GET /api/salud': async () => ({
      status: 200,
      cuerpo: { estado: 'ok', bd: 'ok', esquema: await bd.versionEsquema() },
    }),

    // Catálogo público de frecuencias (TEC-03); su configuración está en /api/admin/configuracion
    'GET /api/frecuencias': async () => ({ status: 200, cuerpo: await listarFrecuencias(bd) }),
  }, log, opciones)
}
