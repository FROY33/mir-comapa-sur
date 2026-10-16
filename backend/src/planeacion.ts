// Planeación de metas (PRD0_1).
//   GET /api/planeacion/ciclo-vigente   los tres roles: el ciclo no cerrado más reciente y su fase.
//   Lo usan la navegación y el dashboard del Enlace, y la sección de Configuración.

import type { BD } from './bd.js'
import { cicloVigente, hoyEnBase } from './datos/cicloPlaneacion.js'
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
