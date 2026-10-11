// Gestión de usuarios del Administrador (HU-R7-07). Todas las rutas van bajo /api/admin/ y
// se registran con protegida(['admin']) (CA_1). Cada cambio y su evento en la bitácora se
// guardan en la misma transacción (CA_6).

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD, Ejecutor } from './bd.js'
import { registrarEvento } from './datos/bitacora.js'
import { desbloquear } from './datos/loginIntentos.js'
import { revocarTodas } from './datos/sesiones.js'
import {
  actualizarUsuario, cambiarActivo, catalogoGerencias, crearUsuario, gerenciasSinCobertura, generarPasswordTemporal,
  listarUsuarios, obtenerUsuario, otrosAdminsActivos, restablecerPassword, ROLES, unidadEsDeGerencia,
  type DatosUsuario, type Usuario,
} from './datos/usuarios.js'
import type { Respuesta } from './http.js'
import type { Rol } from './rutas.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const error = (status: number, codigo: string, mensaje: string): Respuesta =>
  ({ status, cuerpo: { error: codigo, mensaje } })
const NO_ENCONTRADO = error(404, 'no_encontrado', 'Usuario no encontrado')

/** Lo que se guarda en la bitácora sobre un usuario: nunca contraseñas ni hashes. */
const foto = (u: Usuario) => ({ nombre: u.nombre, email: u.email, rol: u.rol, gerencia: u.gerencia.clave, unidad: u.unidad.nombre, activo: u.activo })

function auditar(tx: Ejecutor, s: SolicitudConSesion, accion: string, usuarioId: string, detalle: unknown) {
  return registrarEvento(tx, {
    usuarioId: s.sesion.usuarioId, rol: 'admin', accion, entidad: 'usuario', entidadId: usuarioId, ip: s.ip, detalle,
  })
}

/** CA_2: nombre, correo, gerencia, unidad y rol obligatorios; la unidad debe ser de la gerencia. */
async function validar(bd: Ejecutor, cuerpo: Record<string, unknown>): Promise<DatosUsuario | Respuesta> {
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const d = {
    nombre: texto(cuerpo.nombre), email: texto(cuerpo.email).toLowerCase(),
    gerenciaId: texto(cuerpo.gerencia_id), unidadId: texto(cuerpo.unidad_id), rol: texto(cuerpo.rol) as Rol,
  }
  const faltan = [
    d.nombre === '' && 'nombre', !EMAIL.test(d.email) && 'correo', !UUID.test(d.gerenciaId) && 'gerencia',
    !UUID.test(d.unidadId) && 'unidad', !ROLES.includes(d.rol) && 'rol',
  ].filter(Boolean)
  if (faltan.length > 0) return error(422, 'datos_incompletos', `Revisa: ${faltan.join(', ')}`)
  if (!(await unidadEsDeGerencia(bd, d.unidadId, d.gerenciaId))) {
    return error(422, 'unidad_de_otra_gerencia', 'La unidad no pertenece a la gerencia elegida')
  }
  return d
}

async function correoOcupado(bd: Ejecutor, email: string, excepto?: string) {
  const [fila] = await bd.consultar('SELECT 1 FROM usuarios WHERE email = $1 AND ($2::uuid IS NULL OR id <> $2)', [email, excepto ?? null])
  return fila !== undefined
}

/** Respuesta de cualquier cambio: el usuario como quedó y las advertencias de cobertura (RN_4). */
async function resultado(bd: BD, id: string, status = 200, extra: Record<string, unknown> = {}): Promise<Respuesta> {
  return { status, cuerpo: { usuario: await obtenerUsuario(bd, id), advertencias: await gerenciasSinCobertura(bd), ...extra } }
}

/** El Administrador no puede quitarse a sí mismo el acceso ni dejar el sistema sin Administradores. */
async function protegeAdmins(bd: Ejecutor, s: SolicitudConSesion, u: Usuario, nuevoRol: Rol, activo: boolean): Promise<Respuesta | null> {
  const pierdeAdmin = u.rol === 'admin' && u.activo && (nuevoRol !== 'admin' || !activo)
  if (!pierdeAdmin) return null
  if (u.id === s.sesion.usuarioId) return error(409, 'propia_cuenta', 'No puedes quitarte el rol de Administrador ni desactivar tu propia cuenta')
  if ((await otrosAdminsActivos(bd, u.id)) === 0) return error(409, 'ultimo_admin', 'Debe quedar al menos un Administrador activo')
  return null
}

/** GET /api/admin/usuarios?rol=&gerencia_id=&estado=activo|inactivo&texto= */
export const listar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const q = s.url.searchParams
  const estado = q.get('estado')
  const gerencia = q.get('gerencia_id') ?? ''
  const usuarios = await listarUsuarios(bd, {
    rol: ROLES.includes(q.get('rol') as Rol) ? q.get('rol')! : undefined,
    gerenciaId: UUID.test(gerencia) ? gerencia : undefined,
    activo: estado === 'activo' ? true : estado === 'inactivo' ? false : undefined,
    texto: q.get('texto') ?? '',
  })
  return { status: 200, cuerpo: { usuarios, advertencias: await gerenciasSinCobertura(bd) } }
}

/** GET /api/admin/catalogo — gerencias con sus unidades, para el formulario. */
export const catalogo = (bd: BD) => async (): Promise<Respuesta> =>
  ({ status: 200, cuerpo: { gerencias: await catalogoGerencias(bd), roles: ROLES } })

/** POST /api/admin/usuarios — alta con contraseña temporal, que se devuelve una sola vez. */
export const crear = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const d = await validar(bd, await s.json())
  if ('status' in d) return d
  if (await correoOcupado(bd, d.email)) return error(409, 'correo_duplicado', 'Ya existe un usuario con ese correo')
  const password = generarPasswordTemporal()
  const id = await bd.transaccion(async (tx) => {
    const id = await crearUsuario(tx, d, password)
    await auditar(tx, s, 'usuario_alta', id, { despues: foto((await obtenerUsuario(tx, id))!) })
    return id
  })
  return resultado(bd, id, 201, { passwordTemporal: password })
}

/** PUT /api/admin/usuarios/:id — edición; cambiar rol o gerencia cierra sus sesiones (CA_5). */
export const editar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const antes = UUID.test(id) ? await obtenerUsuario(bd, id) : undefined
  if (!antes) return NO_ENCONTRADO
  const d = await validar(bd, await s.json())
  if ('status' in d) return d
  if (await correoOcupado(bd, d.email, id)) return error(409, 'correo_duplicado', 'Ya existe un usuario con ese correo')
  const bloqueo = await protegeAdmins(bd, s, antes, d.rol, antes.activo)
  if (bloqueo) return bloqueo

  const cambiaAcceso = d.rol !== antes.rol || d.gerenciaId !== antes.gerencia.id
  const revocadas = await bd.transaccion(async (tx) => {
    await actualizarUsuario(tx, id, d)
    const revocadas = cambiaAcceso ? await revocarTodas(tx, id) : 0
    await auditar(tx, s, 'usuario_edicion', id, { antes: foto(antes), despues: foto((await obtenerUsuario(tx, id))!), sesiones_revocadas: revocadas })
    return revocadas
  })
  return resultado(bd, id, 200, { sesionesRevocadas: revocadas })
}

/** POST /api/admin/usuarios/:id/desactivar y /reactivar (CA_4, RN_3: no se borra). */
export const cambiarEstado = (bd: BD, activo: boolean) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const u = UUID.test(id) ? await obtenerUsuario(bd, id) : undefined
  if (!u) return NO_ENCONTRADO
  if (u.activo === activo) return resultado(bd, id)
  const bloqueo = await protegeAdmins(bd, s, u, u.rol, activo)
  if (bloqueo) return bloqueo
  await bd.transaccion(async (tx) => {
    await cambiarActivo(tx, id, activo)
    const revocadas = activo ? 0 : await revocarTodas(tx, id)
    await auditar(tx, s, activo ? 'usuario_reactivado' : 'usuario_desactivado', id, { sesiones_revocadas: revocadas })
  })
  return resultado(bd, id)
}

/** POST /api/admin/usuarios/:id/restablecer — nueva contraseña temporal y cierre de sus sesiones. */
export const restablecer = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const u = UUID.test(id) ? await obtenerUsuario(bd, id) : undefined
  if (!u) return NO_ENCONTRADO
  const password = generarPasswordTemporal()
  await bd.transaccion(async (tx) => {
    await restablecerPassword(tx, id, password)
    const revocadas = await revocarTodas(tx, id)
    await auditar(tx, s, 'password_restablecida', id, { sesiones_revocadas: revocadas })
  })
  return resultado(bd, id, 200, { passwordTemporal: password })
}

/** POST /api/admin/usuarios/:id/desbloquear — HU-R7-06 CA_4, sin esperar los 15 minutos. */
export const desbloquearCuenta = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const id = s.params.id ?? ''
  const u = UUID.test(id) ? await obtenerUsuario(bd, id) : undefined
  if (!u) return NO_ENCONTRADO
  const desbloqueado = await desbloquear(bd, u.email, { usuarioId: s.sesion.usuarioId }, s.ip)
  return resultado(bd, id, 200, { desbloqueado })
}
