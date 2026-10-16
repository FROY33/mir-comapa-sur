// db/permisos.sql: la aplicación funciona con el rol de permisos mínimos y ese rol no puede
// alterar la bitácora ni la estructura. Base y rol propios, que se borran al terminar.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import pg from 'pg'
import { crearApp } from '../src/app.js'
import { crearBD, type BD } from '../src/bd.js'
import { nombreBase } from '../src/config.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const base = `${nombreBase(configBD.url).replace(/_test$/, '')}_permisos_test`
const rol = `comapa_app_${randomUUID().slice(0, 8)}`
const urlDueño = new URL(configBD.url); urlDueño.pathname = `/${base}`
// Con contraseña: un servidor con autenticación scram (p. ej. Windows) rechaza un rol sin ella
const claveRol = randomUUID()
const urlApp = new URL(urlDueño.toString()); urlApp.username = rol; urlApp.password = claveRol

async function comoDueño(sql: string, bd = 'postgres') {
  const u = new URL(configBD.url); u.pathname = `/${bd}`
  const c = new pg.Client({ connectionString: u.toString() })
  await c.connect()
  try { return await c.query(sql) } finally { await c.end() }
}

let app: BD
let servidor: ReturnType<typeof createServer>
let url = ''
const PASSWORD = 'Contrasena-Permisos-2026'

before(async () => {
  await comoDueño(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
  await comoDueño(`CREATE DATABASE ${base}`)
  // Por bash y no directo: en Windows no se puede ejecutar un .sh con execFileSync
  execFileSync('bash', ['db/migrar.sh', 'up'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: urlDueño.toString() } })
  await comoDueño(`CREATE ROLE ${rol} LOGIN PASSWORD '${claveRol}'`)
  execFileSync('psql', [urlDueño.toString(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `app=${rol}`, '-f', 'db/permisos.sql'], { stdio: 'pipe' })
  // Datos mínimos, como los dejaría la carga inicial (con el dueño)
  const hash = await bcrypt.hash(PASSWORD, 12)
  await comoDueño(`
    WITH o AS (INSERT INTO organizaciones (nombre) VALUES ('COMAPA') RETURNING id),
         g AS (INSERT INTO gerencias (organizacion_id, clave, nombre) SELECT id, 'G', 'Gerencia' FROM o RETURNING id),
         u AS (INSERT INTO unidades (gerencia_id, nombre, es_coord_general) SELECT id, 'Coordinación', true FROM g RETURNING id, gerencia_id),
         i AS (INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
               SELECT gerencia_id, 'IND-1', 'actividad', 'Indicador', 'Porcentaje', 'mensual' FROM u)
    INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
    SELECT gerencia_id, id, 'Admin', 'admin@permisos.mx', '${hash}', 'admin', false FROM u`, base)

  app = crearBD({ ...configBD, url: urlApp.toString() }, crearLog(() => {}))
  servidor = createServer(crearApp(app, crearLog(() => {})))
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})

after(async () => {
  servidor?.closeAllConnections()
  await new Promise((ok) => servidor?.close(ok))
  await app?.cerrar()
  await comoDueño(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
  await comoDueño(`DROP ROLE IF EXISTS ${rol}`)
})

describe('la app funciona con el rol de permisos mínimos', () => {
  let cookie = ''
  const pedir = async (metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(url + ruta, {
      method: metodo, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    return { status: r.status, cuerpo: await r.json() as any, setCookie: r.headers.getSetCookie() }
  }

  test('login fallido, login correcto, consultas, gestión de usuarios, ventanas, ciclos y logout', async () => {
    assert.equal((await pedir('POST', '/api/auth/login', { email: 'admin@permisos.mx', password: 'mala' })).status, 401)
    const l = await pedir('POST', '/api/auth/login', { email: 'admin@permisos.mx', password: PASSWORD })
    assert.equal(l.status, 200)
    cookie = l.setCookie.find((c) => c.startsWith('comapa_sesion='))!.split(';')[0]!
    assert.equal((await pedir('GET', '/api/indicadores')).status, 200)
    assert.equal((await pedir('GET', '/api/pendientes')).status, 200)
    const gerencia = (await pedir('GET', '/api/admin/catalogo')).cuerpo.gerencias[0]
    const alta = await pedir('POST', '/api/admin/usuarios',
      { nombre: 'Enlace', email: 'enlace@permisos.mx', gerencia_id: gerencia.id, unidad_id: gerencia.unidades[0].id, rol: 'enlace' })
    assert.equal(alta.status, 201)
    assert.equal((await pedir('POST', `/api/admin/usuarios/${alta.cuerpo.usuario.id}/desactivar`)).status, 200)
    assert.equal((await pedir('PUT', '/api/admin/ventanas', { dias: { mensual: 9 } })).status, 200)
    assert.equal((await pedir('POST', '/api/admin/ciclos/abrir')).status, 200)
    // Catálogo de indicadores (HU-R4-11): el rol escribe en indicadores
    const id = (await pedir('GET', '/api/admin/indicadores')).cuerpo.indicadores[0].id
    assert.equal((await pedir('POST', `/api/admin/indicadores/${id}/desactivar`)).status, 200)
    assert.equal((await pedir('POST', `/api/admin/indicadores/${id}/reactivar`)).status, 200)
    // Catálogo de medios de verificación (S2-TEC-03): el rol escribe medios_verificacion directamente
    const alta2 = await pedir('POST', '/api/admin/medios-verificacion', { nombre: 'Medio de prueba permisos' })
    assert.equal(alta2.status, 201)
    const medioId = alta2.cuerpo.medio_verificacion.id
    assert.equal((await pedir('PUT', `/api/admin/medios-verificacion/${medioId}`, { nombre: 'Medio de prueba permisos editado' })).status, 200)
    assert.equal((await pedir('POST', `/api/admin/medios-verificacion/${medioId}/desactivar`)).status, 200)
    assert.equal((await pedir('POST', `/api/admin/medios-verificacion/${medioId}/reactivar`)).status, 200)
    assert.equal((await pedir('POST', '/api/auth/logout')).status, 200)
  })
})

describe('con el modelo de versiones y metas', () => {
  test('genera un reporte (el trigger toma la versión del indicador) y lee versiones y medios', async () => {
    await comoDueño(`INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
                     VALUES ('mensual', 2020, 1, 'enero-2020', '2020-01-01', '2020-01-31', '2020-02-01', '2020-02-14')`, base)
    const r = await app.consultar<{ version: number }>(
      `WITH n AS (INSERT INTO reportes (indicador_id, periodo_id)
                  SELECT i.id, p.id FROM indicadores i, periodos_reporte p WHERE p.etiqueta = 'enero-2020'
                  RETURNING indicador_version_id)
       SELECT v.version FROM n JOIN indicador_versiones v ON v.id = n.indicador_version_id`)
    assert.equal(r[0]?.version, 1)
    await app.consultar('SELECT count(*) FROM medios_verificacion')
  })

  test('no escribe versiones; lee metas y ciclos (HU-R4-11 CA_4 y RN_3)', async () => {
    const intentar = (sql: string) => assert.rejects(app.consultar(sql), Error, `el rol pudo: ${sql}`)
    await intentar(`UPDATE indicador_versiones SET definicion = '{}'`)
    await app.consultar('SELECT count(*) FROM metas_planeacion')
    await app.consultar('SELECT count(*) FROM metas_periodo')
    await app.consultar('SELECT count(*) FROM ciclos_planeacion')
    await intentar('DELETE FROM metas_periodo')
  })

  test('abre ciclos y genera y actualiza metas, pero nunca las borra; una meta histórica no se modifica (tickets 8 y 9)', async () => {
    const intentar = (sql: string) => assert.rejects(app.consultar(sql), Error, `el rol pudo: ${sql}`)
    const [c] = await app.consultar<{ id: string }>(
      `INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision)
       VALUES (2099, '2098-11-01', '2098-11-20', '2098-11-25') RETURNING id`)
    const [m] = await app.consultar<{ id: string }>(
      `INSERT INTO metas_planeacion (indicador_id, ciclo_id) SELECT id, $1 FROM indicadores WHERE codigo = 'IND-1' RETURNING id`, [c!.id])
    await app.consultar(`UPDATE metas_planeacion SET vencida = true, vencida_at = now() WHERE id = $1`, [m!.id])
    await intentar('DELETE FROM metas_planeacion')
    await intentar('DELETE FROM ciclos_planeacion')
    await intentar(`UPDATE ciclos_planeacion SET ejercicio = 2098`)
    await comoDueño(`UPDATE metas_planeacion SET vigente = false WHERE id = '${m!.id}'`, base)
    await intentar(`UPDATE metas_planeacion SET estado = 'borrador_meta' WHERE id = '${m!.id}'`)
  })

  test('al editar un indicador, los triggers versionan y dan de alta el medio aunque la app no escriba esas tablas (HU-R4-11 CA_1)', async () => {
    const [antes] = await app.consultar<{ n: number }>(`SELECT count(*)::int AS n FROM indicador_versiones v
      JOIN indicadores i ON i.id = v.indicador_id WHERE i.codigo = 'IND-1'`)
    await app.consultar(`UPDATE indicadores SET frecuencia = 'trimestral', medio_verificacion = 'Medio nuevo de permisos'
                          WHERE codigo = 'IND-1'`)
    const [despues] = await app.consultar<{ n: number; medio: string | null }>(`SELECT count(*)::int AS n,
      max(m.nombre) AS medio FROM indicador_versiones v JOIN indicadores i ON i.id = v.indicador_id
      LEFT JOIN medios_verificacion m ON m.id = i.medio_verificacion_id WHERE i.codigo = 'IND-1'`)
    assert.equal(despues!.n, antes!.n + 1, 'la versión usada por el reporte quedó congelada y se creó otra')
    assert.equal(despues!.medio, 'Medio nuevo de permisos')
  })

  test('administra medios_verificacion directamente (alta, renombre, activo) pero nunca la borra (S2-TEC-03)', async () => {
    const [m] = await app.consultar<{ id: string }>(
      `INSERT INTO medios_verificacion (nombre) VALUES ('Medio de permisos directo') RETURNING id`)
    await app.consultar(`UPDATE medios_verificacion SET nombre = 'Medio de permisos renombrado', activo = false WHERE id = $1`, [m!.id])
    await assert.rejects(app.consultar(`DELETE FROM medios_verificacion WHERE id = $1`, [m!.id]), Error)
  })
})

describe('programa, aplica y cancela cambios del indicador (HU-R4-11 CA_4)', () => {
  test('lee e inserta cambios programados y los marca aplicados o cancelados, sin poder borrarlos', async () => {
    const [ind] = await app.consultar<{ id: string }>(`SELECT id FROM indicadores WHERE codigo = 'IND-1'`)
    await app.consultar(`INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde)
                         VALUES ($1, '{"acumulable": true}', '2090-01-01')`, [ind!.id])
    await app.consultar('SELECT * FROM indicador_cambios_programados')
    await app.consultar(`UPDATE indicador_cambios_programados SET aplicado_at = now() WHERE indicador_id = $1`, [ind!.id])
    await assert.rejects(app.consultar('DELETE FROM indicador_cambios_programados'), Error)
    await assert.rejects(app.consultar('TRUNCATE indicador_cambios_programados'), Error)
    await assert.rejects(app.consultar('ALTER TABLE indicador_cambios_programados DISABLE TRIGGER ALL'), Error)
  })
})

describe('y no puede alterar la bitácora ni la estructura', () => {
  const intentar = (sql: string) => assert.rejects(app.consultar(sql), Error, `el rol pudo: ${sql}`)

  test('no borra, no vacía ni modifica la bitácora, ni desactiva su trigger', async () => {
    await intentar('DELETE FROM bitacora')
    await intentar('TRUNCATE bitacora')
    await intentar(`UPDATE bitacora SET accion = 'x'`)
    await intentar('ALTER TABLE bitacora DISABLE TRIGGER ALL')
    await intentar('DROP TABLE bitacora')
  })

  test('no borra usuarios ni reportes, ni toca triggers o estructura', async () => {
    await intentar('DELETE FROM usuarios')
    await intentar('DELETE FROM reportes')
    await intentar('ALTER TABLE reportes DISABLE TRIGGER ALL')
    await intentar('CREATE TABLE intrusa (id int)')
  })
})
