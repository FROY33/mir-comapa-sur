// TEC-04: la carga en producción (modo inicial) y las reglas de qué se carga dónde.
// Hallazgos de la auditoría del 10/10/2026: contraseña por defecto en el repositorio,
// usuarios de prueba en producción, fixtures desde una laptop y recargas que revertían
// cambios hechos desde la app.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import pg from 'pg'
import { crearBD, type BD } from '../src/bd.js'
import { nombreBase } from '../src/config.js'
import { crearLog } from '../src/log.js'
import { adminInicial, ErrorPlan, esBaseLocal, passwordInicial, planDeCarga } from '../db/semilla/plan.js'
import { configBD } from './apoyo.js'

describe('plan de carga', () => {
  const LOCAL = 'postgres://localhost/comapa_mir'
  const REMOTA = 'postgres://app:secreta@bd.comapa.mx:5432/comapa_mir'

  test('base local fuera de producción: demostración', () => {
    assert.equal(planDeCarga([], 'development', LOCAL).modo, 'demostracion')
    assert.equal(planDeCarga([], 'development', 'postgres:///comapa_mir').modo, 'demostracion')
  })

  test('producción o base remota: carga inicial, sin usuarios de demostración', () => {
    assert.equal(planDeCarga([], 'production', LOCAL).modo, 'inicial')
    assert.equal(planDeCarga([], 'development', REMOTA).modo, 'inicial')
  })

  test('CA-4: fixtures rechazadas en producción y contra una base remota aunque NODE_ENV no lo diga', () => {
    assert.throws(() => planDeCarga(['--con-fixtures'], 'production', LOCAL), ErrorPlan)
    assert.throws(() => planDeCarga(['--con-fixtures'], 'development', REMOTA), /bd\.comapa\.mx:5432\/comapa_mir/)
    assert.equal(planDeCarga(['--con-fixtures'], 'development', LOCAL).fixtures, true)
  })

  test('el mensaje de destino no muestra usuario ni contraseña', () => {
    assert.throws(() => planDeCarga(['--con-fixtures'], 'development', REMOTA),
      (e: Error) => !e.message.includes('secreta') && !e.message.includes('app:'))
  })

  test('una opción mal escrita no se ignora', () => {
    assert.throws(() => planDeCarga(['--verify'], 'development', LOCAL), /Opción desconocida: --verify/)
  })

  test('una base _test cuenta como local', () => {
    assert.equal(esBaseLocal('postgres://ci.interno/comapa_mir_test'), true)
  })

  test('sin SEMILLA_PASSWORD, o con una corta, no hay carga: no existe valor por defecto', () => {
    assert.throws(() => passwordInicial({}), ErrorPlan)
    assert.throws(() => passwordInicial({ SEMILLA_PASSWORD: 'corta' }), ErrorPlan)
    assert.equal(passwordInicial({ SEMILLA_PASSWORD: 'una-de-doce-o-mas' }), 'una-de-doce-o-mas')
  })

  test('la carga inicial exige correo y nombre del Administrador', () => {
    assert.throws(() => adminInicial({ SEMILLA_ADMIN_EMAIL: 'a@b.mx' }), ErrorPlan)
    assert.deepEqual(adminInicial({ SEMILLA_ADMIN_EMAIL: 'a@b.mx', SEMILLA_ADMIN_NOMBRE: 'Admin' }),
      { email: 'a@b.mx', nombre: 'Admin', gerenciaClave: 'PLA' })
  })
})

describe('carga inicial en producción', () => {
  // Base propia y vacía: la de pruebas ya tiene la carga de demostración
  const url = new URL(configBD.url)
  url.pathname = `/${nombreBase(configBD.url).replace(/_test$/, '')}_inicial_test`
  const ADMIN = 'admin.inicial@comapasur.gob.mx'
  const PASSWORD = 'contrasena-inicial-de-prueba'
  let bd: BD

  const sembrar = (...args: string[]) => spawnSync('db/sembrar.sh', args, {
    encoding: 'utf8',
    env: {
      ...process.env, NODE_ENV: 'production', DATABASE_URL: url.toString(),
      SEMILLA_PASSWORD: PASSWORD, SEMILLA_ADMIN_EMAIL: ADMIN, SEMILLA_ADMIN_NOMBRE: 'Administración COMAPA',
    },
  })

  const administrar = async (sql: string) => {
    const mantenimiento = new URL(configBD.url)
    mantenimiento.pathname = '/postgres'
    const c = new pg.Client({ connectionString: mantenimiento.toString() })
    await c.connect()
    try { await c.query(sql) } finally { await c.end() }
  }

  before(async () => {
    const base = url.pathname.slice(1)
    await administrar(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
    await administrar(`CREATE DATABASE ${base}`)
    execFileSync('db/migrar.sh', ['up'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url.toString() } })
    bd = crearBD({ ...configBD, url: url.toString() }, crearLog(() => {}))
  })
  after(async () => {
    await bd?.cerrar()
    await administrar(`DROP DATABASE IF EXISTS ${url.pathname.slice(1)} WITH (FORCE)`)
  })

  test('crea el catálogo y una sola cuenta: el Administrador de las variables, con su contraseña', async () => {
    const r = sembrar()
    assert.equal(r.status, 0, r.stderr)
    const usuarios = await bd.consultar<{ email: string; rol: string; password_hash: string }>(
      'SELECT email::text, rol, password_hash FROM usuarios')
    assert.deepEqual(usuarios.map((u) => [u.email, u.rol]), [[ADMIN, 'admin']])
    assert.equal(await bcrypt.compare(PASSWORD, usuarios[0]!.password_hash), true)
    const [conteo] = await bd.consultar<{ indicadores: number; reportes: number }>(
      'SELECT (SELECT count(*)::int FROM indicadores) AS indicadores, (SELECT count(*)::int FROM reportes) AS reportes')
    assert.ok(conteo!.indicadores > 0)
    assert.equal(conteo!.reportes, 0)
  })

  test('una segunda corrida no cambia nada, ni lo que se modificó desde la app', async () => {
    await bd.consultar(`UPDATE indicadores SET activo = false WHERE codigo = (SELECT min(codigo) FROM indicadores)`)
    const r = sembrar()
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /no se repite/)
    const [{ inactivos }] = await bd.consultar<{ inactivos: number }>(
      'SELECT count(*)::int AS inactivos FROM indicadores WHERE NOT activo') as [{ inactivos: number }]
    assert.equal(inactivos, 1)
  })

  test('CA-4: con --con-fixtures sale con error y no escribe', async () => {
    const r = sembrar('--con-fixtures')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no se cargan en producción/)
  })

  test('sin SEMILLA_PASSWORD sale con error', () => {
    const r = spawnSync('db/sembrar.sh', [], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: url.toString(), SEMILLA_PASSWORD: '' },
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /SEMILLA_PASSWORD/)
  })
})
