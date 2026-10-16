// S2-TEC-02: el catálogo institucional se carga sobre una base del sprint 1 (`sembrar.sh --catalogo`):
// renombra sin duplicar, desactiva sin borrar, queda en bitácora y no se repite sin --forzar.
// Base propia, que se borra al terminar. La «base del sprint 1» se arma sembrando y devolviendo cada
// MIR a su código del prototipo según datos/equivalencias_prototipo.csv.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { nombreBase } from '../src/config.js'
import { ErrorPlan, planDeCarga } from '../db/semilla/plan.js'
import { leerCsv } from '../db/semilla/csv.js'
import { configBD } from './apoyo.js'

const base = `${nombreBase(configBD.url).replace(/_test$/, '')}_catalogo_test`
const urlBase = new URL(configBD.url); urlBase.pathname = `/${base}`
const entorno = { ...process.env, DATABASE_URL: urlBase.toString(), SEMILLA_PASSWORD: 'semilla-de-pruebas-2026' }

async function consultar(sql: string, valores: unknown[] = [], bd = base) {
  const u = new URL(configBD.url); u.pathname = `/${bd}`
  const c = new pg.Client({ connectionString: u.toString() })
  await c.connect()
  try { return await c.query(sql, valores) } finally { await c.end() }
}
const uno = async (sql: string, valores: unknown[] = []) => Object.values((await consultar(sql, valores)).rows[0] ?? {})[0]

// Por bash y no directo: en Windows no se puede ejecutar un .sh con execFileSync
const correr = (script: 'migrar' | 'sembrar', ...args: string[]) =>
  spawnSync('bash', [`db/${script}.sh`, ...args], { encoding: 'utf8', env: entorno })
const sembrar = (...args: string[]) => {
  const r = correr('sembrar', ...args)
  assert.equal(r.status, 0, `sembrar ${args.join(' ')} falló: ${r.stderr}${r.stdout}`)
  return r.stdout
}

const equivalencias = leerCsv('equivalencias_prototipo.csv')
const catalogo = leerCsv('indicadores.csv')
const HUELLA = `SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY codigo)) FROM indicadores i`
const HUELLA_SIN_FECHAS = `SELECT md5(string_agg((to_jsonb(i) - 'updated_at')::text, ',' ORDER BY codigo)) FROM indicadores i`

describe('plan de carga: --catalogo y --forzar', () => {
  const LOCAL = 'postgres://localhost/comapa_mir'
  const REMOTA = 'postgres://app:secreta@bd.comapa.mx:5432/comapa_mir'

  test('--catalogo es válido en cualquier destino; sin él, --forzar no tiene sentido', () => {
    assert.equal(planDeCarga(['--catalogo'], 'development', LOCAL).catalogo, true)
    assert.equal(planDeCarga(['--catalogo', '--forzar'], 'production', REMOTA).forzar, true)
    assert.equal(planDeCarga([], 'development', LOCAL).catalogo, false)
    assert.throws(() => planDeCarga(['--forzar'], 'development', LOCAL), /--forzar solo se usa con --catalogo/)
  })

  test('--catalogo no se mezcla con las fixtures ni con --verificar', () => {
    assert.throws(() => planDeCarga(['--catalogo', '--con-fixtures'], 'development', LOCAL), ErrorPlan)
    assert.throws(() => planDeCarga(['--catalogo', '--verificar'], 'development', LOCAL), ErrorPlan)
  })
})

describe('carga del catálogo sobre la base del sprint 1', () => {
  let reportes: Record<string, string> = {}    // reporte → indicador, antes de la carga

  before(async () => {
    await consultar(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`, [], 'postgres')
    await consultar(`CREATE DATABASE ${base}`, [], 'postgres')
    const m = correr('migrar', 'up')
    assert.equal(m.status, 0, m.stderr)
    sembrar('--con-fixtures')

    // Devuelve la base al estado del sprint 1: códigos del prototipo y un nombre viejo
    for (const e of equivalencias.filter((f) => f.codigo)) {
      await consultar('UPDATE indicadores SET codigo = $1 WHERE codigo = $2', [e.codigo_prototipo, e.codigo])
    }
    await consultar(`UPDATE indicadores SET nombre = 'Nombre del prototipo' WHERE codigo = $1`, [equivalencias[0]!.codigo_prototipo])
    for (const e of equivalencias.filter((f) => !f.codigo)) {
      await consultar(
        `INSERT INTO indicadores (gerencia_id, codigo, tipo, nivel, nombre, unidad_medida, frecuencia)
         SELECT id, $2, 'mir', $3, $4, 'Porcentaje', 'trimestral' FROM gerencias WHERE clave = $1`,
        [e.gerencia_clave, e.codigo_prototipo, e.nivel, e.nombre])
    }
    // El prototipo no tenía Gerencia General: se quitan sus indicadores y antes su reporte de prueba
    // (fixtures_sinteticas.csv), con la protección de reportes apagada solo para este arreglo
    await consultar('ALTER TABLE reportes DISABLE TRIGGER reportes_proteccion')
    await consultar(`DELETE FROM reportes WHERE indicador_id IN (SELECT id FROM indicadores WHERE codigo LIKE 'GEN-%')`)
    await consultar('ALTER TABLE reportes ENABLE TRIGGER reportes_proteccion')
    await consultar(`DELETE FROM indicadores WHERE codigo LIKE 'GEN-%'`)
    reportes = Object.fromEntries((await consultar('SELECT id, indicador_id FROM reportes')).rows.map((r) => [r.id, r.indicador_id]))
  })

  after(() => consultar(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`, [], 'postgres'))

  test('la base de partida trae códigos del prototipo y reportes', async () => {
    assert.equal(await uno(`SELECT count(*) FROM indicadores WHERE codigo = 'ADM-ACT-42'`), '1')
    assert.ok(Object.keys(reportes).length > 100)
  })

  test('renombra sin duplicar, conserva los reportes y desactiva sin equivalente (CA-1, CA-2)', async () => {
    const salida = sembrar('--catalogo')
    assert.match(salida, /renombrados\s+121/)

    const sinEquivalente = equivalencias.filter((f) => !f.codigo).map((f) => f.codigo_prototipo)
    assert.equal(await uno('SELECT count(*) FROM indicadores'), String(catalogo.length + sinEquivalente.length), 'duplicó o perdió filas')
    assert.equal(await uno(`SELECT count(*) FROM indicadores WHERE codigo = ANY($1)`, [equivalencias.filter((f) => f.codigo).map((f) => f.codigo_prototipo)]), '0')

    const ahora = Object.fromEntries((await consultar('SELECT id, indicador_id FROM reportes')).rows.map((r) => [r.id, r.indicador_id]))
    assert.deepEqual(ahora, reportes, 'los reportes cambiaron de indicador')
    const [e0] = equivalencias
    assert.equal(await uno('SELECT nombre FROM indicadores WHERE codigo = $1', [e0!.codigo]), catalogo.find((c) => c.codigo === e0!.codigo)!.nombre)

    const desactivados = (await consultar(`SELECT codigo FROM indicadores WHERE NOT activo ORDER BY codigo`)).rows.map((r) => r.codigo)
    assert.deepEqual(desactivados, sinEquivalente.sort(), 'solo los del prototipo sin equivalente quedan desactivados')
  })

  test('los conteos por gerencia coinciden con gerencias.csv; ningún MIR queda incompleto (CA-3)', async () => {
    for (const g of leerCsv('gerencias.csv')) {
      const n = await uno(`SELECT count(*) FROM indicadores i JOIN gerencias g ON g.id = i.gerencia_id
                            WHERE g.clave = $1 AND i.tipo = 'mir' AND i.activo`, [g.clave])
      assert.equal(n, g.indicadores_mir, `MIR activos de ${g.clave}`)
    }
    assert.equal(await uno(`SELECT count(*) FROM indicadores WHERE tipo = 'mir' AND activo
      AND (coalesce(nombre,'') = '' OR coalesce(unidad_medida,'') = '' OR frecuencia IS NULL OR tipo_calculo IS NULL)`), '0')
  })

  test('cada indicador con texto de medio queda ligado al medio del catálogo con ese nombre (HU-R4-11 CA_2)', async () => {
    assert.ok(Number(await uno('SELECT count(*) FROM medios_verificacion')) > 0, 'la carga no creó medios')
    assert.equal(await uno(`SELECT count(*) FROM indicadores i
      LEFT JOIN medios_verificacion m ON m.id = i.medio_verificacion_id
      WHERE btrim(coalesce(i.medio_verificacion, '')) <> ''
        AND m.nombre IS DISTINCT FROM i.medio_verificacion`), '0')   // el trigger de S2-TEC-01 deja el texto igual al nombre del medio
    assert.equal(await uno(`SELECT count(*) FROM indicadores WHERE tipo = 'mir' AND activo AND medio_verificacion_id IS NULL`), '0',
      'un MIR sin medio no se podría editar desde la pantalla')
  })

  test('los ids 26 y 36 del CSV se cargan como gestión (decisión de la PO)', async () => {
    assert.equal(await uno(`SELECT count(*) FROM indicadores WHERE tipo = 'mir' AND activo AND tipo_indicador IS NULL`), '0')
    for (const nombre of ['Porcentaje de cambios de tarifa', 'Atención a la Industria y el Comercio']) {
      assert.equal(await uno('SELECT tipo_indicador FROM indicadores WHERE nombre = $1', [nombre]), 'gestion', nombre)
    }
  })

  test('queda un catalogo_importado con conteos y el sha256 del CSV fuente', async () => {
    const { rows } = await consultar(`SELECT usuario_id, detalle FROM bitacora WHERE accion = 'catalogo_importado'`)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].usuario_id, null)
    const d = rows[0].detalle
    assert.equal(d.sha256, createHash('sha256').update(readFileSync('db/semilla/datos/indicadores.csv')).digest('hex'))
    assert.equal(d.conteos.renombrados, 121)
    assert.equal(d.conteos.desactivados, 2)
    assert.equal(d.conteos.csv, catalogo.length)
    assert.equal(d.conteos.insertados, 2, 'solo los dos de Gerencia General son nuevos')
    assert.equal(d.conteos.actualizados, catalogo.length - 2)
  })

  test('HU-R4-11 RN_4: sin --forzar se niega y no toca ninguna fila', async () => {
    const antes = [await uno('SELECT count(*) FROM indicadores'), await uno(HUELLA)]
    const eventos = await uno('SELECT count(*) FROM bitacora')
    const r = correr('sembrar', '--catalogo')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /catálogo ya se importó/)
    assert.match(r.stderr, /--forzar/)
    assert.deepEqual([await uno('SELECT count(*) FROM indicadores'), await uno(HUELLA)], antes)
    assert.equal(await uno('SELECT count(*) FROM bitacora'), eventos, 'escribió en la bitácora')
  })

  test('--forzar conserva lo que el Administrador editó y lo lista; repetirlo no cambia nada (CA-2)', async () => {
    const [editado, intacto] = catalogo.filter((c) => c.tipo === 'mir')
    const original = editado!.nombre
    // Lo mismo que hace la API: el cambio y el evento con antes y después
    await consultar(`UPDATE indicadores SET nombre = 'Nombre editado en pantalla' WHERE codigo = $1`, [editado!.codigo])
    await consultar(
      `INSERT INTO bitacora (accion, entidad, entidad_id, indicador_id, detalle)
       SELECT 'indicador_editado', 'indicador', id::text, id, $2::jsonb FROM indicadores WHERE codigo = $1`,
      [editado!.codigo, JSON.stringify({ antes: { nombre: original }, despues: { nombre: 'Nombre editado en pantalla' } })])
    // Y uno que nadie editó desde la pantalla: la recarga sí lo corrige
    await consultar(`UPDATE indicadores SET nombre = 'Cambio por fuera' WHERE codigo = $1`, [intacto!.codigo])

    const salida = sembrar('--catalogo', '--forzar')

    assert.equal(await uno('SELECT nombre FROM indicadores WHERE codigo = $1', [editado!.codigo]), 'Nombre editado en pantalla')
    assert.equal(await uno('SELECT nombre FROM indicadores WHERE codigo = $1', [intacto!.codigo]), intacto!.nombre)
    assert.match(salida, new RegExp(`no sobrescrito.*${editado!.codigo}.*nombre`, 's'))
    const { rows } = await consultar(`SELECT detalle FROM bitacora WHERE accion = 'catalogo_importado' ORDER BY id DESC LIMIT 1`)
    assert.deepEqual(rows[0].detalle.no_sobrescritos, [{ codigo: editado!.codigo, campos: ['nombre'] }])
    assert.equal(rows[0].detalle.forzar, true)

    const despues = await uno(HUELLA_SIN_FECHAS)
    sembrar('--catalogo', '--forzar')
    assert.equal(await uno(HUELLA_SIN_FECHAS), despues, 'la segunda recarga cambió datos')
    assert.equal(await uno('SELECT count(*) FROM indicadores'), String(catalogo.length + 2))
  })

  test('--forzar tampoco pisa un cambio programado que ya se aplicó (HU-R4-11 CA_4)', async () => {
    const codigo = catalogo.filter((c) => c.tipo === 'mir')[2]!.codigo
    await consultar(`UPDATE indicadores SET acumulable = NOT acumulable WHERE codigo = $1`, [codigo])
    const acumulable = await uno('SELECT acumulable FROM indicadores WHERE codigo = $1', [codigo])
    await consultar(
      `INSERT INTO bitacora (accion, entidad, entidad_id, indicador_id, detalle)
       SELECT 'cambio_programado_aplicado', 'indicador', id::text, id, $2::jsonb FROM indicadores WHERE codigo = $1`,
      [codigo, JSON.stringify({ antes: { acumulable: !acumulable }, despues: { acumulable }, vigente_desde: '2026-11-01' })])

    sembrar('--catalogo', '--forzar')

    assert.equal(await uno('SELECT acumulable FROM indicadores WHERE codigo = $1', [codigo]), acumulable)
  })

  test('el sembrado normal ya no pisa el catálogo una vez importado', async () => {
    await consultar(`UPDATE indicadores SET nombre = 'Editado después' WHERE codigo = $1`, [catalogo[0]!.codigo])
    sembrar()
    assert.equal(await uno('SELECT nombre FROM indicadores WHERE codigo = $1', [catalogo[0]!.codigo]), 'Editado después')
  })
})

// El importador solo genera los CSV; correrlo dos veces deja los mismos bytes (S2-TEC-02 CA-2).
// El CSV institucional vive fuera del repositorio: sin él la prueba se omite.
const FUENTE = ['../../2026.09.14-MIR-COMAPA_UNIFICADA.csv', '../2026.09.14-MIR-COMAPA_UNIFICADA.csv']
  .find((r) => existsSync(r))

describe('importador del CSV institucional', () => {
  const huella = () => ['db/semilla/manifest.json', 'db/semilla/CONCILIACION.md',
    ...readdirSync('db/semilla/datos').filter((n) => n.endsWith('.csv')).map((n) => `db/semilla/datos/${n}`)]
    .map((r) => createHash('sha256').update(readFileSync(r)).digest('hex')).join(' ')

  test('correrlo dos veces produce los mismos bytes', { skip: FUENTE === undefined && 'falta el CSV institucional' }, () => {
    const correrImportador = () => execFileSync(process.execPath, ['--import', 'tsx', 'db/semilla/importar-csv-unificada.ts', FUENTE!], { stdio: 'pipe' })
    correrImportador()
    const primera = huella()
    correrImportador()
    assert.equal(huella(), primera)
  })

  test('manifest.json y todos los CSV que lista coinciden en conteos y sha256', () => {
    const m = JSON.parse(readFileSync('db/semilla/manifest.json', 'utf8'))
    for (const a of m.archivos as { archivo: string; filas: number; sha256: string }[]) {
      const ruta = `db/semilla/${a.archivo}`
      assert.equal(createHash('sha256').update(readFileSync(ruta)).digest('hex'), a.sha256, a.archivo)
      assert.equal(leerCsv(a.archivo.replace('datos/', '')).length, a.filas, a.archivo)
    }
    assert.equal(m.conteos.indicadores_mir, catalogo.filter((c) => c.tipo === 'mir').length)
  })
})

describe('CA-4a: la pantalla del catálogo lee de la base', () => {
  test('estructura-indicadores.html no carga los arreglos del prototipo y pide los datos a la API', () => {
    const html = readFileSync('../estructura-indicadores.html', 'utf8')
    assert.doesNotMatch(html, /mir-actividades-data\.js|mir-gerencias-data\.js|ACTIVIDADES_ENLACE|GERENCIAS_MIR/)
    assert.match(html, /<script src="indicadores-admin\.js"><\/script>/)
    assert.match(readFileSync('../indicadores-admin.js', 'utf8'), /api\('GET', '\/api\/admin\/indicadores'\)/)
  })
})
