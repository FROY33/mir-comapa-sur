// Mantenimiento del catálogo de medios de verificación — solo Administrador (S2-TEC-03, ticket 4).
// Todas las rutas van bajo /api/admin/medios-verificacion y se registran con protegida(['admin']).
// Cada alta, renombre y cambio de activo se guarda en la bitácora en la misma transacción (CA-4).

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD, Ejecutor } from './bd.js'
import { registrarEvento } from './datos/bitacora.js'
import {
  cambiarActivoMedio, crearMedio, indicadoresQueUsanMedio, listarMedios,
  nombreNormalizadoExiste, obtenerMedio, renombrarMedio,
} from './datos/mediosVerificacion.js'
import type { Respuesta } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const error = (status: number, codigo: string, mensaje: string, campo?: string): Respuesta =>
  ({ status, cuerpo: campo ? { error: codigo, mensaje, campo, errores: { [campo]: mensaje } } : { error: codigo, mensaje } })
const NO_ENCONTRADO = error(404, 'no_encontrado', 'Medio de verificación no encontrado')

function auditar(tx: Ejecutor, s: SolicitudConSesion, accion: string, medioId: string, detalle: unknown) {
  return registrarEvento(tx, {
    usuarioId: s.sesion.usuarioId, rol: 'admin', accion,
    entidad: 'medio_verificacion', entidadId: medioId, ip: s.ip, detalle,
  })
}

// CA_2 del catálogo: nombre obligatorio y sin casi-duplicados (mayúsculas, espacios, puntuación final).
async function validarNombre(bd: Ejecutor, cuerpo: Record<string, unknown>, editandoId?: string): Promise<string | Respuesta> {
  const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
  if (!nombre) return error(422, 'datos_incompletos', 'Falta el nombre', 'nombre')
  if (await nombreNormalizadoExiste(bd, nombre, editandoId)) {
    return error(409, 'nombre_duplicado', `Ya existe un medio de verificación equivalente a "${nombre}"`, 'nombre')
  }
  return nombre
}

/** GET /api/admin/medios-verificacion?estado=activo|inactivo&texto= */
export const listar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const q = s.url.searchParams
  const estado = q.get('estado')
  const medios = await listarMedios(bd, {
    activo: estado === 'activo' ? true : estado === 'inactivo' ? false : undefined,
    texto: q.get('texto') ?? '',
  })
  return { status: 200, cuerpo: { medios_verificacion: medios } }
}

/** GET /api/admin/medios-verificacion/:id — con los indicadores que lo usan hoy. */
export const detalle = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const medio = UUID.test(id) ? await obtenerMedio(bd, id) : undefined
  if (!medio) return NO_ENCONTRADO
  return { status: 200, cuerpo: { medio_verificacion: medio, indicadores: await indicadoresQueUsanMedio(bd, id) } }
}

/** POST /api/admin/medios-verificacion — alta (CA-1). */
export const crear = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const nombre = await validarNombre(bd, await s.json())
  if (typeof nombre !== 'string') return nombre

  const id = await bd.transaccion(async (tx) => {
    const id = await crearMedio(tx, nombre)
    await auditar(tx, s, 'medio_verificacion_creado', id, { despues: { nombre, activo: true } })
    return id
  })
  return { status: 201, cuerpo: { medio_verificacion: await obtenerMedio(bd, id) } }
}

/** PUT /api/admin/medios-verificacion/:id — renombrar (CA-3: un trigger propaga el nombre a quien ya lo usa). */
export const editar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const antes = UUID.test(id) ? await obtenerMedio(bd, id) : undefined
  if (!antes) return NO_ENCONTRADO

  const nombre = await validarNombre(bd, await s.json(), id)
  if (typeof nombre !== 'string') return nombre

  await bd.transaccion(async (tx) => {
    await renombrarMedio(tx, id, nombre)
    await auditar(tx, s, 'medio_verificacion_editado', id, { antes: { nombre: antes.nombre }, despues: { nombre } })
  })
  return { status: 200, cuerpo: { medio_verificacion: await obtenerMedio(bd, id) } }
}

/** POST /api/admin/medios-verificacion/:id/desactivar — CA-3: no borra la referencia de quien ya lo usa. */
export const desactivar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const medio = UUID.test(id) ? await obtenerMedio(bd, id) : undefined
  if (!medio) return NO_ENCONTRADO
  if (!medio.activo) return { status: 200, cuerpo: { medio_verificacion: medio } }

  await bd.transaccion(async (tx) => {
    await cambiarActivoMedio(tx, id, false)
    await auditar(tx, s, 'medio_verificacion_desactivado', id, { antes: { activo: true }, despues: { activo: false } })
  })
  return { status: 200, cuerpo: { medio_verificacion: await obtenerMedio(bd, id) } }
}

/** POST /api/admin/medios-verificacion/:id/reactivar */
export const reactivar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const medio = UUID.test(id) ? await obtenerMedio(bd, id) : undefined
  if (!medio) return NO_ENCONTRADO
  if (medio.activo) return { status: 200, cuerpo: { medio_verificacion: medio } }

  await bd.transaccion(async (tx) => {
    await cambiarActivoMedio(tx, id, true)
    await auditar(tx, s, 'medio_verificacion_reactivado', id, { antes: { activo: false }, despues: { activo: true } })
  })
  return { status: 200, cuerpo: { medio_verificacion: await obtenerMedio(bd, id) } }
}
