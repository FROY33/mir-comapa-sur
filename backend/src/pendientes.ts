// GET /api/pendientes — los reportes del periodo abierto de la gerencia de la sesión
// (HU-R1-01). Con ?solo_pendientes=1 solo los que piden acción del Enlace.
//
// El `resumen.pendientes` es el número que muestra el KPI del dashboard y sale de la misma
// consulta que la lista: no pueden diferir (CA_5).

import type { SolicitudConSesion } from './autorizacion.js'
import type { BD } from './bd.js'
import { listarDelPeriodo } from './datos/pendientes.js'
import type { Respuesta } from './http.js'

const NIVELES = ['fin', 'proposito', 'componente', 'actividad']
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export const listar = (bd: BD) => async (s: SolicitudConSesion): Promise<Respuesta> => {
  const q = s.url.searchParams
  const nivel = q.get('nivel') ?? ''
  const hasta = q.get('hasta') ?? ''
  const reportes = await listarDelPeriodo(bd, s.sesion.rol === 'admin' ? null : s.sesion.gerenciaId, {
    estado: q.get('estado') || undefined,
    nivel: NIVELES.includes(nivel) ? nivel : undefined,
    hasta: FECHA.test(hasta) ? hasta : undefined,
    soloPendientes: q.get('solo_pendientes') === '1',
  })
  const pendientes = reportes.filter((r) => r.pendiente)
  return {
    status: 200,
    cuerpo: {
      reportes,
      resumen: {
        total: reportes.length,
        pendientes: pendientes.length,
        observados: pendientes.filter((r) => r.estado === 'observado').length,
        borradores: pendientes.filter((r) => r.estado === 'borrador').length,
        vencidos: pendientes.filter((r) => r.vencido).length,
        urgentes: pendientes.filter((r) => r.urgente).length,
      },
    },
  }
}
