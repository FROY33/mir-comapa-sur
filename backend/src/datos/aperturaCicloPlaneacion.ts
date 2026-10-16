// Apertura del ciclo de planeación de metas (ticket 8, HU-R4-01).
//
// En la transacción `tx` de quien abre: aplica los cambios programados vencidos (sin filtro, antes de
// generar las metas, para que cada meta nazca con la gerencia y la versión ya vigentes), crea el ciclo,
// genera una meta pendiente por cada indicador activo, MIR o gerencial, y deja el evento en la bitácora.
// Si cualquier paso falla, `tx` se revierte completa: ni ciclo, ni metas, ni cambios aplicados, ni evento.

import type { Ejecutor } from '../bd.js'
import { registrarEvento } from './bitacora.js'
import { aplicarCambiosProgramados, type CambioAplicado } from './cambiosProgramados.js'
import { faseCiclo, type FaseCiclo } from './cicloPlaneacion.js'

export interface DatosApertura {
  ejercicio: number
  inicioCaptura: string       // 'AAAA-MM-DD'
  finCaptura: string
  inicioRevision: string
  autor: string               // id del usuario que abre
  ip?: string
  hoy: string                 // hoy en la hora de la base
}

export interface CicloAbierto {
  id: string
  ejercicio: number
  inicio_captura: string
  fin_captura: string
  inicio_revision: string
  fase: FaseCiclo
  abierto_por: string
  abierto_at: string
}

export interface MetasPorGerencia { gerencia: string; nombre: string; total: number }

export interface ResultadoApertura {
  ciclo: CicloAbierto
  metas_creadas: { total: number; por_gerencia: MetasPorGerencia[] }
  cambios_aplicados: CambioAplicado[]
}

/** Ya hay un ciclo para ese ejercicio (RN_1, un ciclo por ejercicio para siempre). */
export class CicloExistente extends Error {
  constructor(readonly ejercicio: number) { super(`Ya existe un ciclo de planeación para el ejercicio ${ejercicio}`) }
}

export async function abrirCicloPlaneacion(tx: Ejecutor, d: DatosApertura): Promise<ResultadoApertura> {
  const [existente] = await tx.consultar('SELECT 1 FROM ciclos_planeacion WHERE ejercicio = $1', [d.ejercicio])
  if (existente) throw new CicloExistente(d.ejercicio)

  const cambios = await aplicarCambiosProgramados(tx, d.hoy)

  // ON CONFLICT cubre a la solicitud simultánea que llega después de la comprobación anterior
  const [ciclo] = await tx.consultar<{ id: string; abierto_at: string }>(
    `INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision, abierto_por)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ejercicio) DO NOTHING RETURNING id, abierto_at`,
    [d.ejercicio, d.inicioCaptura, d.finCaptura, d.inicioRevision, d.autor])
  if (!ciclo) throw new CicloExistente(d.ejercicio)

  // La versión del indicador la toma el trigger de la meta; ON CONFLICT hace seguro un reintento
  await tx.consultar(
    `INSERT INTO metas_planeacion (indicador_id, ciclo_id)
     SELECT i.id, $1 FROM indicadores i WHERE i.activo
     ON CONFLICT (indicador_id, ciclo_id) WHERE vigente DO NOTHING`, [ciclo.id])
  const porGerencia = await tx.consultar<{ gerencia: string; nombre: string; total: number }>(
    `SELECT g.clave AS gerencia, g.nombre, count(*)::int AS total
       FROM metas_planeacion m
       JOIN indicador_versiones v ON v.id = m.indicador_version_id
       JOIN gerencias g ON g.id = v.gerencia_id
      WHERE m.ciclo_id = $1 GROUP BY g.clave, g.nombre ORDER BY g.clave`, [ciclo.id])
  const total = porGerencia.reduce((n, g) => n + g.total, 0)

  const resultado: ResultadoApertura = {
    ciclo: {
      id: ciclo.id, ejercicio: d.ejercicio, inicio_captura: d.inicioCaptura, fin_captura: d.finCaptura,
      inicio_revision: d.inicioRevision, fase: faseCiclo({
        inicio_captura: d.inicioCaptura, fin_captura: d.finCaptura, inicio_revision: d.inicioRevision, cerrado_manual: false,
      }, d.hoy),
      abierto_por: d.autor, abierto_at: ciclo.abierto_at,
    },
    metas_creadas: { total, por_gerencia: porGerencia },
    cambios_aplicados: cambios,
  }
  await registrarEvento(tx, {
    usuarioId: d.autor, rol: 'admin', accion: 'ciclo_planeacion_abierto', entidad: 'ciclo_planeacion', entidadId: ciclo.id,
    ip: d.ip,
    detalle: {
      ejercicio: d.ejercicio, inicio_captura: d.inicioCaptura, fin_captura: d.finCaptura, inicio_revision: d.inicioRevision,
      metas_total: total, metas_por_gerencia: porGerencia.map((g) => ({ gerencia: g.gerencia, total: g.total })),
      cambios_aplicados: cambios.map((c) => ({ indicador_id: c.indicador_id, codigo: c.codigo, vigente_desde: c.vigente_desde })),
    },
  })
  return resultado
}
