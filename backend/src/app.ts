// Rutas de la API. Autenticación y pendientes se agregan aquí en sus tickets.

import { login, logout, sesion } from './auth.js'
import { acceso, crearProtegida } from './autorizacion.js'
import * as ciclos from './ciclos.js'
import * as consultaMir from './consultaMir.js'
import type { BD } from './bd.js'
import { listarFrecuencias } from './datos/frecuencias.js'
import { crearManejador } from './http.js'
import { cambiarPassword } from './cuenta.js'
import * as indicadores from './indicadores.js'
import * as indicadoresAdmin from './indicadoresAdmin.js'
import * as indicadoresCambios from './indicadoresCambios.js'
import * as mediosVerificacion from './mediosVerificacion.js'
import * as pendientes from './pendientes.js'
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
    'GET /api/indicadores/:id/ficha': protegida(TODOS, indicadores.ficha(bd)),   // HU-R8-03
    // Consulta MIR: Revisor y Administrador (HU-R8-01)
    'GET /api/consulta-mir': protegida(['admin', 'revisor'], consultaMir.listar(bd)),

    // Periodos abiertos y su fecha límite, para los tres dashboards (HU-R3-01 CA_6)
    'GET /api/periodos/abiertos': protegida(TODOS, ciclos.abiertos(bd)),

    // Reportes del periodo abierto de la gerencia, con los pendientes del Enlace (HU-R1-01)
    'GET /api/pendientes': protegida(TODOS, pendientes.listar(bd)),

    // Solo Administrador: todo lo que cuelga de /api/admin/ (HU-R7-03 CA_3, CA_6)
    'GET /api/admin/configuracion': protegida(['admin'], async () => ({
      status: 200, cuerpo: { frecuencias: await listarFrecuencias(bd) },
    })),
    // Ventanas de captura y apertura de ciclos (HU-R3-01)
    'GET /api/admin/ventanas': protegida(['admin'], ciclos.ventanas(bd)),
    'PUT /api/admin/ventanas': protegida(['admin'], ciclos.guardarVentanas(bd)),
    'POST /api/admin/ciclos/abrir': protegida(['admin'], ciclos.abrirAhora(bd)),
    // Gestión de indicadores — catálogo administrable (HU-R4-11)
    'GET /api/admin/indicadores': protegida(['admin'], indicadoresAdmin.listar(bd)),
    'GET /api/admin/indicadores/catalogo': protegida(['admin'], indicadoresAdmin.catalogo(bd)),
    'GET /api/admin/indicadores/:id': protegida(['admin'], indicadoresAdmin.detalle(bd)),
    'POST /api/admin/indicadores': protegida(['admin'], indicadoresAdmin.crear(bd)),
    'PUT /api/admin/indicadores/:id': protegida(['admin'], indicadoresAdmin.editar(bd)),
    'POST /api/admin/indicadores/:id/desactivar': protegida(['admin'], indicadoresAdmin.desactivar(bd)),
    'POST /api/admin/indicadores/:id/reactivar': protegida(['admin'], indicadoresAdmin.reactivar(bd)),
    'POST /api/admin/cambios-programados/:id/cancelar': protegida(['admin'], indicadoresCambios.cancelar(bd)),
    // Catálogo de medios de verificación (S2-TEC-03, ticket 4)
    'GET /api/admin/medios-verificacion': protegida(['admin'], mediosVerificacion.listar(bd)),
    'GET /api/admin/medios-verificacion/:id': protegida(['admin'], mediosVerificacion.detalle(bd)),
    'POST /api/admin/medios-verificacion': protegida(['admin'], mediosVerificacion.crear(bd)),
    'PUT /api/admin/medios-verificacion/:id': protegida(['admin'], mediosVerificacion.editar(bd)),
    'POST /api/admin/medios-verificacion/:id/desactivar': protegida(['admin'], mediosVerificacion.desactivar(bd)),
    'POST /api/admin/medios-verificacion/:id/reactivar': protegida(['admin'], mediosVerificacion.reactivar(bd)),
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
