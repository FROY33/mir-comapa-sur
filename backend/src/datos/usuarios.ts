// Usuarios para la gestión del Administrador (HU-R7-07). Un usuario tiene un rol, una
// gerencia y una unidad de esa gerencia (RN_2); con historial no se borra, se desactiva (RN_3).

import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Ejecutor } from '../bd.js'
import type { Rol } from '../rutas.js'

export const ROLES: Rol[] = ['admin', 'revisor', 'enlace']
export const RONDAS_BCRYPT = 12

export interface Usuario {
  id: string
  nombre: string
  email: string
  rol: Rol
  activo: boolean
  debe_cambiar_password: boolean
  ultimo_acceso: Date | null
  created_at: Date
  gerencia: { id: string; clave: string; nombre: string }
  unidad: { id: string; nombre: string }
  bloqueado: boolean
}

interface Fila {
  id: string; nombre: string; email: string; rol: Rol; activo: boolean; debe_cambiar_password: boolean
  ultimo_acceso: Date | null; created_at: Date; gerencia_id: string; gerencia_clave: string
  gerencia_nombre: string; unidad_id: string; unidad_nombre: string; bloqueado: boolean
}

const SELECT = `
  SELECT u.id, u.nombre, u.email::text AS email, u.rol, u.activo, u.debe_cambiar_password,
         u.ultimo_acceso, u.created_at, g.id AS gerencia_id, g.clave AS gerencia_clave,
         g.nombre AS gerencia_nombre, n.id AS unidad_id, n.nombre AS unidad_nombre,
         coalesce(li.bloqueado_hasta > now(), false) AS bloqueado
    FROM usuarios u
    JOIN gerencias g ON g.id = u.gerencia_id
    JOIN unidades n ON n.id = u.unidad_id
    LEFT JOIN login_intentos li ON li.email = u.email`

const aUsuario = (f: Fila): Usuario => ({
  id: f.id, nombre: f.nombre, email: f.email, rol: f.rol, activo: f.activo,
  debe_cambiar_password: f.debe_cambiar_password, ultimo_acceso: f.ultimo_acceso, created_at: f.created_at,
  gerencia: { id: f.gerencia_id, clave: f.gerencia_clave, nombre: f.gerencia_nombre },
  unidad: { id: f.unidad_id, nombre: f.unidad_nombre }, bloqueado: f.bloqueado,
})

export interface Filtros { rol?: string; gerenciaId?: string; activo?: boolean; texto?: string }

/** Listado con filtros por rol, gerencia, estado y texto en nombre o correo (checklist de R7-07). */
export async function listarUsuarios(bd: Ejecutor, f: Filtros = {}): Promise<Usuario[]> {
  const filas = await bd.consultar<Fila>(
    `${SELECT}
      WHERE ($1::text IS NULL OR u.rol = $1)
        AND ($2::uuid IS NULL OR u.gerencia_id = $2)
        AND ($3::boolean IS NULL OR u.activo = $3)
        AND ($4 = '' OR (u.nombre || ' ' || u.email) ILIKE '%' || $4 || '%')
      ORDER BY u.activo DESC, u.nombre`,
    [f.rol ?? null, f.gerenciaId ?? null, f.activo ?? null, (f.texto ?? '').trim()],
  )
  return filas.map(aUsuario)
}

export async function obtenerUsuario(bd: Ejecutor, id: string): Promise<Usuario | undefined> {
  const [fila] = await bd.consultar<Fila>(`${SELECT} WHERE u.id = $1`, [id])
  return fila && aUsuario(fila)
}

export interface DatosUsuario { nombre: string; email: string; gerenciaId: string; unidadId: string; rol: Rol }

/** Alta con contraseña temporal; el usuario debe cambiarla al entrar (CA_3). Devuelve el id. */
export async function crearUsuario(bd: Ejecutor, d: DatosUsuario, passwordTemporal: string): Promise<string> {
  const [fila] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (nombre, email, gerencia_id, unidad_id, rol, password_hash, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
    [d.nombre, d.email, d.gerenciaId, d.unidadId, d.rol, await bcrypt.hash(passwordTemporal, RONDAS_BCRYPT)],
  )
  return fila!.id
}

export async function actualizarUsuario(bd: Ejecutor, id: string, d: DatosUsuario): Promise<void> {
  await bd.consultar(
    `UPDATE usuarios SET nombre = $2, email = $3, gerencia_id = $4, unidad_id = $5, rol = $6 WHERE id = $1`,
    [id, d.nombre, d.email, d.gerenciaId, d.unidadId, d.rol],
  )
}

export async function cambiarActivo(bd: Ejecutor, id: string, activo: boolean): Promise<void> {
  await bd.consultar('UPDATE usuarios SET activo = $2 WHERE id = $1', [id, activo])
}

/** Nueva contraseña temporal; el usuario debe cambiarla en su siguiente acceso. */
export async function restablecerPassword(bd: Ejecutor, id: string, passwordTemporal: string): Promise<void> {
  await bd.consultar(
    'UPDATE usuarios SET password_hash = $2, debe_cambiar_password = true WHERE id = $1',
    [id, await bcrypt.hash(passwordTemporal, RONDAS_BCRYPT)],
  )
}

/** ¿La unidad pertenece a la gerencia? La FK compuesta también lo exige; esto da un mensaje claro. */
export async function unidadEsDeGerencia(bd: Ejecutor, unidadId: string, gerenciaId: string): Promise<boolean> {
  const [fila] = await bd.consultar('SELECT 1 FROM unidades WHERE id = $1 AND gerencia_id = $2 AND activo', [unidadId, gerenciaId])
  return fila !== undefined
}

/** Administradores activos distintos de `excepto`: para no dejar el sistema sin ninguno. */
export async function otrosAdminsActivos(bd: Ejecutor, excepto: string): Promise<number> {
  const [fila] = await bd.consultar<{ n: number }>(
    `SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo AND id <> $1`, [excepto])
  return fila!.n
}

/** RN_4: gerencias con indicadores activos que se quedaron sin Enlace o sin Revisor activo. */
export async function gerenciasSinCobertura(bd: Ejecutor): Promise<{ clave: string; nombre: string; faltan: Rol[] }[]> {
  return bd.consultar(
    `SELECT g.clave, g.nombre, array_agg(r.rol ORDER BY r.rol) AS faltan
       FROM gerencias g
      CROSS JOIN (VALUES ('enlace'), ('revisor')) AS r(rol)
      WHERE g.activo
        AND EXISTS (SELECT 1 FROM indicadores i WHERE i.gerencia_id = g.id AND i.activo)
        AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.gerencia_id = g.id AND u.rol = r.rol AND u.activo)
      GROUP BY g.clave, g.nombre
      ORDER BY g.clave`)
}

/** Gerencias activas con sus unidades activas, para el formulario (las unidades se filtran por gerencia). */
export async function catalogoGerencias(bd: Ejecutor) {
  return bd.consultar<{ id: string; clave: string; nombre: string; unidades: { id: string; nombre: string }[] }>(
    `SELECT g.id, g.clave, g.nombre,
            coalesce(json_agg(json_build_object('id', n.id, 'nombre', n.nombre) ORDER BY n.es_coord_general DESC, n.nombre)
                     FILTER (WHERE n.id IS NOT NULL), '[]') AS unidades
       FROM gerencias g
       LEFT JOIN unidades n ON n.gerencia_id = g.id AND n.activo
      WHERE g.activo
      GROUP BY g.id
      ORDER BY g.nombre`)
}

/**
 * Contraseña temporal (CA_3): 14 caracteres sin los que se confunden al dictarlos
 * (0/O, 1/l/I). Se muestra una sola vez al Administrador y no se guarda en claro.
 */
export function generarPasswordTemporal(): string {
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length: 14 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
}
