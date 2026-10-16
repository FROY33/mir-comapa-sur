// HU-R8-01: Consulta MIR. Dos gerencias propias, indicadores MIR de los cuatro niveles, un gerencial,
// un inactivo, periodos abiertos y cerrados, y una meta validada para el cumplimiento.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD, levantar } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
let app: Awaited<ReturnType<typeof levantar>>
const s = randomUUID().slice(0, 6)
let ejercicio = 0
const cookie: Record<string, string> = {}
const G: Record<string, string> = {}
const U: Record<string, string> = {}
const I: Record<string, string> = {}

async function usuario(nombre: string, rol: string, clave: string) {
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'x', $5, false) RETURNING id`,
    [G[clave], U[clave], nombre, `${nombre}-${s}@comapasur.gob.mx`, rol])
  cookie[nombre] = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
}

async function indicador(clave: string, codigo: string, c: { nivel?: string | null; tipo?: string; frecuencia?: string } = {}) {
  const [i] = await bd.consultar<{ id: string }>(
    `INSERT INTO indicadores (gerencia_id, unidad_id, codigo, tipo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ($1, $2, $3, $4, $5, $6, 'Porcentaje', $7) RETURNING id`,
    [G[clave], U[clave], `${codigo}-${s}`, c.tipo ?? 'mir', c.nivel === undefined ? 'actividad' : c.nivel,
      `Indicador ${codigo}`, c.frecuencia ?? 'mensual'])
  I[codigo] = i!.id
  return i!.id
}

/** Periodo `numero` de la frecuencia en el ejercicio de la prueba; `fin` ordena cuál es el más reciente. */
async function periodo(frecuencia: string, numero: number, estado: 'abierto' | 'cerrado') {
  const fin = `${ejercicio}-${String(numero).padStart(2, '0')}-28`
  const [p] = await bd.consultar<{ id: string }>(
    `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite, estado, cerrado_at)
     VALUES ($1, $2, $3, $4, $5::date - 20, $5::date, $5::date, $5::date + 10, $6, $7) RETURNING id`,
    [frecuencia, ejercicio, numero, `${frecuencia}-${numero}-${s}`, fin, estado, estado === 'cerrado' ? new Date() : null])
  return p!.id
}

async function reporte(indicadorId: string, periodoId: string, estado: string, avance: number | null = null) {
  const enviado = !['pendiente_carga', 'borrador'].includes(estado)
  const cerrado = ['cerrado', 'incumplido'].includes(estado)
  await bd.consultar(
    `INSERT INTO reportes (indicador_id, periodo_id, estado, avance, enviado_at, cerrado_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [indicadorId, periodoId, estado, avance, enviado && estado !== 'incumplido' ? new Date() : null, cerrado ? new Date() : null])
}

async function meta(indicadorId: string, anual: number, porPeriodo: number[], estado = 'meta_validada') {
  const [c] = await bd.consultar<{ id: string }>(
    `INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision, cerrado_manual, cerrado_at)
     VALUES ($1, '2000-01-01', '2000-01-31', '2000-02-15', true, now())
     ON CONFLICT (ejercicio) DO UPDATE SET ejercicio = EXCLUDED.ejercicio RETURNING id`, [ejercicio])
  const [m] = await bd.consultar<{ id: string }>(
    `INSERT INTO metas_planeacion (indicador_id, ciclo_id, estado, meta_anual, linea_base, enviada_at, validada_at)
     VALUES ($1, $2, $3, $4, 0, now(), CASE WHEN $3 = 'meta_validada' THEN now() END) RETURNING id`,
    [indicadorId, c!.id, estado, anual])
  for (const [i, v] of porPeriodo.entries()) {
    await bd.consultar('INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ($1, $2, $3)', [m!.id, i + 1, v])
  }
}

async function pedir(ruta: string, quien?: string) {
  const r = await fetch(app.url + ruta, { headers: quien ? { cookie: cookie[quien]! } : {} })
  const texto = await r.text()
  return { status: r.status, bytes: texto.length, cuerpo: JSON.parse(texto) as any }
}
/** Solo las filas de esta prueba, por código sin sufijo. */
const propias = (lista: any[]) => Object.fromEntries(lista
  .filter((r) => r.codigo.endsWith(`-${s}`))
  .map((r) => [r.codigo.replace(`-${s}`, ''), r]))

before(async () => {
  app = await levantar()
  // Un ejercicio sin periodos ni ciclo: otras pruebas (y corridas previas sobre la misma base) usan los suyos
  const [e] = await bd.consultar<{ y: number }>(
    `SELECT y FROM generate_series(2030, 2099) y
      WHERE NOT EXISTS (SELECT 1 FROM periodos_reporte WHERE ejercicio = y)
        AND NOT EXISTS (SELECT 1 FROM ciclos_planeacion WHERE ejercicio = y)
      ORDER BY random() LIMIT 1`)
  ejercicio = e!.y
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org R8-01 ${s}`])
  for (const clave of ['MA', 'MB']) {
    const [g] = await bd.consultar<{ id: string }>('INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id',
      [org!.id, `${clave}${s}`, `Gerencia ${clave} ${s}`])
    G[clave] = g!.id
    const [u] = await bd.consultar<{ id: string }>('INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id',
      [g!.id, `Unidad ${clave} ${s}`])
    U[clave] = u!.id
  }
  await usuario('admin', 'admin', 'MA')
  await usuario('revisorA', 'revisor', 'MA')
  await usuario('enlaceA', 'enlace', 'MA')

  await indicador('MA', 'FIN', { nivel: 'fin', frecuencia: 'anual' })
  await indicador('MA', 'PROP', { nivel: 'proposito', frecuencia: 'semestral' })
  await indicador('MA', 'COMP', { nivel: 'componente', frecuencia: 'trimestral' })
  await indicador('MA', 'ACT', { nivel: 'actividad', frecuencia: 'mensual' })
  await indicador('MA', 'BORR', { frecuencia: 'mensual' })
  await indicador('MA', 'SINREP', { frecuencia: 'bimestral' })
  await indicador('MA', 'GER', { tipo: 'gerencial', nivel: null })
  await indicador('MA', 'INACT', { frecuencia: 'cuatrimestral' })
  await indicador('MB', 'OTRA', { nivel: 'actividad' })

  // Mensual: el 1 cerrado y el 2 abierto. Trimestral: solo cerrados (1 y 2). Cuatrimestral: el 1 cerrado.
  const m1 = await periodo('mensual', 1, 'cerrado')
  const m2 = await periodo('mensual', 2, 'abierto')
  const t1 = await periodo('trimestral', 1, 'cerrado')
  const t2 = await periodo('trimestral', 2, 'cerrado')
  const c1 = await periodo('cuatrimestral', 1, 'cerrado')

  await reporte(I.ACT!, m1, 'cerrado', 40)
  await reporte(I.ACT!, m2, 'aprobado_revisor', 30)
  await meta(I.ACT!, 120, [10, 20, 30])
  await reporte(I.BORR!, m2, 'borrador', 99)
  await meta(I.BORR!, 50, [5, 5])
  await reporte(I.COMP!, t1, 'cerrado', 10)
  await reporte(I.COMP!, t2, 'incumplido')
  await reporte(I.OTRA!, m2, 'enviado_revision', 5)
  await reporte(I.INACT!, c1, 'cerrado', 7)
  await bd.consultar('UPDATE indicadores SET activo = false WHERE id = $1', [I.INACT])
})

after(async () => {
  await app.cerrar()
  await bd.cerrar()
})

describe('HU-R8-01 acceso', () => {
  test('sin sesión responde 401', async () => {
    assert.equal((await pedir('/api/consulta-mir')).status, 401)
  })

  test('el Enlace no entra: 403 (la vista es de Revisor y Administrador)', async () => {
    assert.equal((await pedir('/api/consulta-mir', 'enlaceA')).status, 403)
  })
})

describe('HU-R8-01 catálogo', () => {
  test('CA_6: el Revisor solo ve su gerencia, aunque pida otra por URL', async () => {
    for (const ruta of ['/api/consulta-mir', `/api/consulta-mir?gerencia_id=${G.MB}`]) {
      const r = await pedir(ruta, 'revisorA')
      assert.equal(r.status, 200)
      assert.ok(r.cuerpo.length > 0)
      assert.ok(r.cuerpo.every((f: any) => f.gerencia.clave === `MA${s}`), `${ruta} devolvió otra gerencia`)
    }
  })

  test('CA_1: el Administrador ve todos los MIR de todas las gerencias, sin paginar', async () => {
    const [{ total }] = await bd.consultar<{ total: string }>("SELECT count(*) AS total FROM indicadores WHERE tipo = 'mir'") as any
    const r = await pedir('/api/consulta-mir', 'admin')
    assert.equal(r.status, 200)
    assert.ok(r.cuerpo.length >= Number(total), `devolvió ${r.cuerpo.length} de ${total}`)
    const p = propias(r.cuerpo)
    assert.ok(p.ACT && p.OTRA, 'faltan indicadores de alguna gerencia')
  })

  test('RN_3: incluye los cuatro niveles MIR y deja fuera los gerenciales', async () => {
    const p = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo)
    assert.deepEqual(['FIN', 'PROP', 'COMP', 'ACT'].map((c) => p[c]?.nivel), ['fin', 'proposito', 'componente', 'actividad'])
    assert.equal(p.GER, undefined)
  })

  test('HU-R4-11 CA_5: el desactivado sigue en Consulta MIR, marcado inactivo', async () => {
    const p = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo)
    assert.equal(p.INACT?.activo, false)
    assert.equal(p.ACT?.activo, true)
  })

  test('flujo paso 2: cada fila trae código, nombre, gerencia, unidad, nivel, frecuencia, estado, meta anual y cumplimiento', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).ACT
    assert.equal(f.nombre, 'Indicador ACT')
    assert.equal(f.gerencia.nombre, `Gerencia MA ${s}`)
    assert.equal(f.unidad, `Unidad MA ${s}`)
    assert.equal(f.frecuencia, 'mensual')
    for (const campo of ['id', 'estado', 'periodo', 'meta_anual', 'cumplimiento']) assert.ok(campo in f, `falta ${campo}`)
  })
})

describe('HU-R8-01 estado y cumplimiento', () => {
  test('CA_2: con periodo abierto muestra el estado de ese periodo, no el del cerrado anterior', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).ACT
    assert.equal(f.estado, 'aprobado_revisor')
    assert.deepEqual(f.periodo, { etiqueta: `mensual-2-${s}`, estado: 'abierto' })
  })

  test('CA_2: sin periodo abierto muestra el del último cerrado', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).COMP
    assert.equal(f.estado, 'incumplido')
    assert.deepEqual(f.periodo, { etiqueta: `trimestral-2-${s}`, estado: 'cerrado' })
  })

  test('sin ningún reporte: estado y periodo nulos (la pantalla dice «Sin reporte»)', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).SINREP
    assert.equal(f.estado, null)
    assert.equal(f.periodo, null)
    assert.equal(f.cumplimiento, null)
  })

  test('CA_4: con reporte en el periodo activo calcula avance / meta del periodo × 100', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).ACT
    assert.equal(f.cumplimiento, 150)    // 30 / 20 × 100
  })

  test('CA_4: un periodo cerrado (sin periodo activo) muestra N/A', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).COMP
    assert.equal(f.cumplimiento, null)
  })

  test('CA_4: un borrador no se cuenta como reporte: N/A y su avance no sale', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo).BORR
    assert.equal(f.estado, 'borrador')
    assert.equal(f.cumplimiento, null)
    assert.ok(!Object.values(f).includes(99), 'el avance del borrador no debe salir')
  })

  test('CA_4: sin meta validada, N/A (no se fabrica un porcentaje)', async () => {
    const f = propias((await pedir('/api/consulta-mir', 'admin')).cuerpo).OTRA
    assert.equal(f.estado, 'enviado_revision')
    assert.equal(f.cumplimiento, null)
  })

  test('meta anual: la de la meta validada del ejercicio; sin meta validada, nula', async () => {
    const p = propias((await pedir('/api/consulta-mir', 'revisorA')).cuerpo)
    assert.equal(p.ACT.meta_anual, 120)
    assert.equal(p.FIN.meta_anual, null)
  })
})

describe('HU-R8-01 CA_5: rendimiento', () => {
  test('el catálogo completo del Administrador responde en menos de 2 s y pesa menos de 1 MB', async () => {
    const inicio = performance.now()
    const r = await pedir('/api/consulta-mir', 'admin')
    const ms = performance.now() - inicio
    assert.equal(r.status, 200)
    assert.ok(ms < 2000, `tardó ${Math.round(ms)} ms`)
    // 10 Mbps son 1.25 MB/s: con menos de 1 MB la descarga cabe en el segundo restante
    assert.ok(r.bytes < 1_000_000, `pesa ${r.bytes} bytes`)
  })
})
