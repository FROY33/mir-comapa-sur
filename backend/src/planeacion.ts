// Planeación de metas (PRD0_1).
//   GET /api/planeacion/ciclo-vigente   los tres roles: el ciclo no cerrado más reciente y su fase.
//   GET /api/planeacion/pendientes      solo Enlace: sus metas por configurar en el ciclo vigente (ticket 9).
//   POST /api/admin/planeacion/ciclos   solo Administrador: abre el ciclo de un ejercicio (ticket 8).
//   Lo usan la navegación y el dashboard del Enlace, y la sección de Configuración.

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD } from './bd.js'
import { abrirCicloPlaneacion, CicloExistente } from './datos/aperturaCicloPlaneacion.js'
import { cicloVigente, FASES_ABIERTAS, hoyEnBase } from './datos/cicloPlaneacion.js'
import { ESTADOS_META_PENDIENTE, listarMetasPendientes, NIVELES_MIR, resumirMetas } from './datos/metasPendientes.js'
import type { Respuesta } from './http.js'

export const vigente = (bd: BD) => async (): Promise<Respuesta> => {
  const hoy = await hoyEnBase(bd)
  const c = await cicloVigente(bd, hoy)
  return {
    status: 200,
    cuerpo: {
      ciclo: c && {
        ejercicio: c.ejercicio, fase: c.fase,
        inicio_captura: c.inicio_captura, fin_captura: c.fin_captura, inicio_revision: c.inicio_revision,
      },
      hoy,
    },
  }
}

// ── Metas pendientes (ticket 9): GET /api/planeacion/pendientes, solo Enlace ─────────────────────

/** La gerencia sale siempre de la sesión: la ruta no acepta parámetro de gerencia (RN_3). */
export const pendientes = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const hoy = await hoyEnBase(bd)
  const c = await cicloVigente(bd, hoy)
  if (!c || !FASES_ABIERTAS.includes(c.fase)) return { status: 200, cuerpo: { ciclo: null, hoy, metas: [] } }
  const q = s.url.searchParams
  const estado = q.get('estado') ?? '', nivel = q.get('nivel') ?? ''
  const metas = await listarMetasPendientes(bd, c.id, s.sesion.gerenciaId, {
    estado: (ESTADOS_META_PENDIENTE as readonly string[]).includes(estado) ? estado : undefined,
    nivel: (NIVELES_MIR as readonly string[]).includes(nivel) ? nivel : undefined,
  })
  return {
    status: 200,
    cuerpo: {
      ciclo: {
        ejercicio: c.ejercicio, fase: c.fase,
        inicio_captura: c.inicio_captura, fin_captura: c.fin_captura, inicio_revision: c.inicio_revision,
      },
      hoy, metas, resumen: resumirMetas(metas),
    },
  }
}

// ── Apertura del ciclo (ticket 8): POST /api/admin/planeacion/ciclos, solo Administrador ──────────

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const error = (status: number, codigo: string, mensaje: string, campo?: string): Respuesta =>
  ({ status, cuerpo: campo ? { error: codigo, mensaje, campo, errores: { [campo]: mensaje } } : { error: codigo, mensaje } })
const invalido = (campo: string, mensaje: string) => error(422, 'datos_invalidos', mensaje, campo)

/** Una fecha 'AAAA-MM-DD' que existe en el calendario (no el 31 de febrero). */
const fechaReal = (v: unknown): v is string =>
  typeof v === 'string' && FECHA.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** Valida el cuerpo; devuelve los datos limpios o el primer error con su campo (PRD0_1, «Validación»). */
function validarApertura(c: Record<string, unknown>, hoy: string): { ejercicio: number; inicio: string; fin: string; revision: string } | Respuesta {
  const anio = Number(hoy.slice(0, 4))
  if (c.ejercicio === undefined || c.ejercicio === null || c.ejercicio === '') return invalido('ejercicio', 'Falta el ejercicio')
  const ejercicio = typeof c.ejercicio === 'number' ? c.ejercicio : Number(c.ejercicio)
  if (!Number.isInteger(ejercicio)) return invalido('ejercicio', 'El ejercicio debe ser un año')
  if (ejercicio !== anio && ejercicio !== anio + 1) return invalido('ejercicio', `El ejercicio debe ser ${anio} o ${anio + 1}`)
  const fechas: [string, string, unknown][] = [
    ['inicio_captura', 'el inicio de captura', c.inicio_captura], ['fin_captura', 'el fin de captura', c.fin_captura],
    ['inicio_revision', 'el inicio de revisión', c.inicio_revision],
  ]
  for (const [campo, etiqueta, v] of fechas) {
    if (v === undefined || v === null || v === '') return invalido(campo, `Falta ${etiqueta}`)
    if (!fechaReal(v)) return invalido(campo, `Fecha inválida en ${etiqueta}; usa AAAA-MM-DD`)
  }
  const [inicio, fin, revision] = fechas.map((f) => f[2] as string) as [string, string, string]
  if (fin <= inicio) return invalido('fin_captura', 'El fin de captura debe ser posterior al inicio de captura')
  if (revision < fin) return invalido('inicio_revision', 'La revisión no puede empezar antes de que termine la captura')
  return { ejercicio, inicio, fin, revision }
}

export const abrir = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const hoy = await hoyEnBase(bd)
  const v = validarApertura(await s.json(), hoy)
  if ('status' in v) return v
  try {
    const r = await bd.transaccion((tx) => abrirCicloPlaneacion(tx, {
      ejercicio: v.ejercicio, inicioCaptura: v.inicio, finCaptura: v.fin, inicioRevision: v.revision,
      autor: s.sesion.usuarioId, ip: s.ip, hoy,
    }))
    const { id: _id, ...ciclo } = r.ciclo
    return { status: 201, cuerpo: { ...r, ciclo } }
  } catch (e) {
    if (e instanceof CicloExistente) return error(409, 'ciclo_existente', `Ya existe un ciclo de planeación para el ejercicio ${e.ejercicio}`, 'ejercicio')
    throw e
  }
}
