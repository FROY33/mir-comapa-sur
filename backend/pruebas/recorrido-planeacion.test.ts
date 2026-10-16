// Recorrido de la planeación de metas de punta a punta (tickets 8 y 9: HU-R4-01, HU-R4-02).
// Levanta el backend y el sitio reales sobre una base propia (el «ciclo vigente» es global y un ciclo
// abierto en la base compartida cambiaría el catálogo en otras pruebas) y recorre, con cookies y por
// el origen del sitio como un navegador: el Administrador abre el ciclo (HU-R4-01) y cada Enlace ve
// solo las metas pendientes de su gerencia (HU-R4-02).
//
// El ítem de navegación se pinta en el cliente (planeacion-ciclo.js): aquí «lo ve» significa que
// `ciclo-vigente`, por el origen del sitio, le entrega un ciclo en una fase visible para el Enlace
// (captura, fuera_de_plazo o revisión) y que su página está permitida por /api/auth/acceso. El
// pintado en el DOM lo cubre planeacion-ciclo-frontend.test.ts.

import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import type { ChildProcess } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import { arrancar, navegador as navegadorEn, PASSWORD, puertoLibre } from './apoyo-e2e.js'
import { crearGerencia, crearIndicador, prepararBase, type BasePlaneacion, type Gerencia } from './apoyo-planeacion.js'

const FASES_ENLACE = ['captura', 'fuera_de_plazo', 'revision']
const PAGINA_ENLACE = 'planeacion-metas-enlace.html'

let base: BasePlaneacion
let sitio = ''
const procesos: ChildProcess[] = []
const navegador = () => navegadorEn(sitio)
let com: Gerencia, tec: Gerencia
const correo = { admin: '', revisor: '', enlaceCom: '', enlaceTec: '' }

async function usuario(g: Gerencia, rol: 'admin' | 'revisor' | 'enlace', nombre: string) {
  const email = `rp-${nombre}@comapasur.gob.mx`
  await base.bd.consultar(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, $5, $6, false)`,
    [g.id, g.unidadId, nombre, email, await bcrypt.hash(PASSWORD, 4), rol])
  return email
}

/** Un navegador con sesión iniciada por el login real del sitio. */
async function sesion(email: string) {
  const nav = navegador()
  assert.equal((await nav.entrar(email)).status, 200)
  return nav
}

const json = (texto: string) => JSON.parse(texto) as any

before(async () => {
  base = await prepararBase('recorrido_planeacion')
  com = await crearGerencia(base.bd, 'COM')
  tec = await crearGerencia(base.bd, 'TEC')
  correo.admin = await usuario(com, 'admin', 'admin')
  correo.revisor = await usuario(com, 'revisor', 'revisor')
  correo.enlaceCom = await usuario(com, 'enlace', 'enlace-com')
  correo.enlaceTec = await usuario(tec, 'enlace', 'enlace-tec')
  // Dos indicadores activos por gerencia (uno MIR y uno gerencial), con códigos propios de este archivo
  await crearIndicador(base.bd, { gerencia: com, codigo: 'RP-COM-1', nivel: 'componente' })
  await crearIndicador(base.bd, { gerencia: com, codigo: 'RP-COM-2', tipo: 'gerencial' })
  await crearIndicador(base.bd, { gerencia: tec, codigo: 'RP-TEC-1', nivel: 'actividad' })
  await crearIndicador(base.bd, { gerencia: tec, codigo: 'RP-TEC-2', tipo: 'gerencial' })

  const [puertoApi, puertoSitio] = [await puertoLibre(), await puertoLibre()]
  const api = arrancar('src/servidor.ts', { PORT: String(puertoApi), DATABASE_URL: base.url }, 'Conectado a la BD')
  procesos.push(api.proceso)
  await api.listo
  const web = arrancar('src/sitio.ts', {
    PUERTO_SITIO: String(puertoSitio), BACKEND_URL: `http://127.0.0.1:${puertoApi}`,
  }, 'Prototipo en')
  procesos.push(web.proceso)
  await web.listo
  sitio = `http://127.0.0.1:${puertoSitio}`
})

after(async () => {
  // Esperar a que salgan: la base no se puede soltar mientras el backend tenga conexiones vivas
  await Promise.all(procesos.map((p) => new Promise<void>((ok) => {
    if (p.exitCode !== null || p.signalCode !== null) return ok()
    p.once('exit', () => ok())
    p.kill('SIGTERM')
  })))
  await base.soltar()
})

describe('recorrido de la planeación de metas', () => {
  test('HU-R4-02 CA_5: sin ciclo abierto, el Enlace no recibe ciclo (no hay ítem) ni metas', async () => {
    const enlace = await sesion(correo.enlaceCom)
    assert.equal(json((await enlace.ir('/api/planeacion/ciclo-vigente')).texto).ciclo, null)
    const p = json((await enlace.ir('/api/planeacion/pendientes')).texto)
    assert.equal(p.ciclo, null)
    assert.deepEqual(p.metas, [])
  })

  test('HU-R4-01 CA_2 y CA_6: el Administrador abre el ciclo hoy, queda en captura con una meta por indicador y su evento en la bitácora', async () => {
    const [f] = await base.bd.consultar<{ hoy: string; fin: string; revision: string }>(
      `SELECT current_date::text AS hoy, (current_date + 10)::text AS fin, (current_date + 15)::text AS revision`)
    const admin = await sesion(correo.admin)
    const r = await admin.ir('/api/admin/planeacion/ciclos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ejercicio: Number(f!.hoy.slice(0, 4)), inicio_captura: f!.hoy, fin_captura: f!.fin, inicio_revision: f!.revision,
      }),
    })
    assert.equal(r.status, 201, r.texto)
    const abierto = json(r.texto)
    assert.equal(abierto.ciclo.fase, 'captura', 'abierto hoy debe estar ya en captura')
    assert.equal(abierto.metas_creadas.total, 4)

    const [e] = await base.bd.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM bitacora
        WHERE accion = 'ciclo_planeacion_abierto' AND rol = 'admin' AND ip IS NOT NULL
          AND entidad_id = (SELECT id::text FROM ciclos_planeacion)`)
    assert.equal(e!.n, '1', 'la apertura debe quedar en la bitácora una vez, con IP')
  })

  test('HU-R4-01 CA_4: el Enlace de COM ve el ítem de navegación (ciclo en fase visible) y puede abrir su página', async () => {
    const enlace = await sesion(correo.enlaceCom)
    const v = json((await enlace.ir('/api/planeacion/ciclo-vigente')).texto)
    assert.ok(v.ciclo, 'debería recibir el ciclo vigente')
    assert.ok(FASES_ENLACE.includes(v.ciclo.fase), `la fase ${v.ciclo.fase} debe hacer visible el ítem`)
    assert.equal((await enlace.ir('/' + PAGINA_ENLACE)).status, 200)
    assert.equal((await enlace.ir('/api/auth/acceso?pagina=' + PAGINA_ENLACE)).status, 200)
  })

  test('HU-R4-02 CA_1: el Enlace de COM ve solo las metas pendientes de COM', async () => {
    const p = json((await (await sesion(correo.enlaceCom)).ir('/api/planeacion/pendientes')).texto)
    assert.deepEqual(p.metas.map((m: any) => m.codigo).sort(), ['RP-COM-1', 'RP-COM-2'])
    assert.ok(p.metas.every((m: any) => m.estado === 'meta_pendiente'))
    assert.equal(p.resumen.total, 2)
  })

  test('HU-R4-02 CA_1: el Enlace de otra gerencia ve solo las suyas', async () => {
    const enlace = await sesion(correo.enlaceTec)
    assert.ok(FASES_ENLACE.includes(json((await enlace.ir('/api/planeacion/ciclo-vigente')).texto).ciclo.fase))
    const p = json((await enlace.ir('/api/planeacion/pendientes')).texto)
    assert.deepEqual(p.metas.map((m: any) => m.codigo).sort(), ['RP-TEC-1', 'RP-TEC-2'])
  })

  test('HU-R4-02 RN_3: la gerencia sale de la sesión, no de la petición; el Revisor recibe 403', async () => {
    const enlace = await sesion(correo.enlaceCom)
    const p = json((await enlace.ir(`/api/planeacion/pendientes?gerencia_id=${tec.id}`)).texto)
    assert.deepEqual(p.metas.map((m: any) => m.codigo).sort(), ['RP-COM-1', 'RP-COM-2'])
    assert.equal((await (await sesion(correo.revisor)).ir('/api/planeacion/pendientes')).status, 403)
    assert.equal((await navegador().ir('/api/planeacion/pendientes')).status, 401)
  })
})
