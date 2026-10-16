// Tickets 8 y 9, base compartida, en el navegador: planeacion-ciclo.js decide, según GET
// /api/planeacion/ciclo-vigente, si el Enlace ve «Planeación de metas» y el aviso del dashboard.
// Nada sale de localStorage: lo que se muestra viene del servidor.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador, RAIZ } from './apoyo-frontend.js'

const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)) }
const HOY = '2026-11-10'
const ciclo = (fase: string, c: Record<string, unknown> = {}) => ({
  ciclo: { ejercicio: 2027, fase, inicio_captura: '2026-11-01', fin_captura: '2026-11-15', inicio_revision: '2026-11-20', ...c },
  hoy: HOY,
})

async function cargar(respuesta: unknown, ejecutar: string) {
  const codigo = codigoSesion()
  const p = ejecutarEnNavegador(codigo, ['pintarNavPlaneacion', 'pintarAvisoCiclo'], {
    pagina: 'dashboard-enlace.html', respuestas: respuesta === undefined ? {} : { '/api/planeacion/ciclo-vigente': respuesta },
  })
  ;(p.api[ejecutar] as () => void)()
  await esperar()
  return p
}
const nav = (p: Awaited<ReturnType<typeof cargar>>) => p.documento.getElementById('navPlaneacionMetas')!

describe('ítem «Planeación de metas» del Enlace', () => {
  for (const fase of ['captura', 'fuera_de_plazo', 'revision']) {
    test(`se muestra en fase ${fase}`, async () => {
      assert.equal(nav(await cargar(ciclo(fase), 'pintarNavPlaneacion')).style.display, '')
    })
  }
  test('no se muestra en fase programado', async () => {
    assert.equal(nav(await cargar(ciclo('programado'), 'pintarNavPlaneacion')).style.display, 'none')
  })
  test('no se muestra sin ciclo', async () => {
    assert.equal(nav(await cargar({ ciclo: null, hoy: HOY }, 'pintarNavPlaneacion')).style.display, 'none')
  })
  test('no se muestra si la API falla', async () => {
    assert.equal(nav(await cargar(undefined, 'pintarNavPlaneacion')).style.display, 'none')
  })
})

describe('aviso de ciclo en el dashboard del Enlace', () => {
  test('captura: «Ciclo de planeación abierto» con el plazo y los días que quedan', async () => {
    const html = (await cargar(ciclo('captura'), 'pintarAvisoCiclo')).htmlPintado()
    assert.match(html, /Ciclo de planeación abierto/)
    assert.match(html, /15 nov\. 2026/)
    assert.match(html, /Quedan 5 días/)
    assert.match(html, /planeacion-metas-enlace\.html/)
  })
  test('programado: «Ciclo de planeación próximo» con la fecha de apertura y sin botón', async () => {
    const html = (await cargar(ciclo('programado', { inicio_captura: '2026-11-12' }), 'pintarAvisoCiclo')).htmlPintado()
    assert.match(html, /Ciclo de planeación próximo/)
    assert.match(html, /12 nov\. 2026/)
    assert.doesNotMatch(html, /planeacion-metas-enlace/)
  })
  test('sin ciclo, en revisión o con la API caída no hay aviso', async () => {
    for (const r of [{ ciclo: null, hoy: HOY }, ciclo('revision'), ciclo('fuera_de_plazo'), undefined]) {
      assert.doesNotMatch((await cargar(r, 'pintarAvisoCiclo')).htmlPintado(), /Ciclo de planeación/)
    }
  })
})

describe('las páginas', () => {
  const leer = (n: string) => readFileSync(`${RAIZ}/${n}`, 'utf8')
  const PAGINAS = ['dashboard-enlace.html', 'mis-actividades.html', 'mis-observaciones.html', 'detalle-actividad.html',
    'planeacion-enlace.html', 'planeacion-metas-enlace.html']

  test('cada página del Enlace trae el ítem oculto hacia planeacion-metas-enlace.html y llama a pintarNavPlaneacion', () => {
    for (const n of PAGINAS) {
      const h = leer(n)
      assert.match(h, /<a id="navPlaneacionMetas"[^>]*href="planeacion-metas-enlace\.html"[^>]*style="display:none"/, n)
      assert.match(h, /<script src="planeacion-ciclo\.js"><\/script>/, n)
      assert.match(h, /pintarNavPlaneacion\(\)/, n)
    }
  })
  test('el dashboard ya no lee el ciclo de localStorage', () => {
    const h = leer('dashboard-enlace.html')
    assert.doesNotMatch(h, /comapa-ciclo/)
    assert.match(h, /pintarAvisoCiclo\(\)/)
  })
})
