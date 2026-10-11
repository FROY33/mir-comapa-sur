// TEC-04: la carga inicial es repetible (CA-3) y deja datos suficientes para
// probar aislamiento entre gerencias y los estados del flujo (CA-5).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { crearBD } from '../src/bd.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

/** Contraseña inicial solo para las pruebas; no es de ninguna cuenta real. */
const PASSWORD_PRUEBAS = 'semilla-de-pruebas-2026'

/** Corre la carga contra la base de pruebas. */
function sembrar(...args: string[]) {
  execFileSync('db/sembrar.sh', args, {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: configBD.url, SEMILLA_PASSWORD: PASSWORD_PRUEBAS },
  })
}

// bloqueo.test.ts crea su propia organización con usuarios de prueba en la misma
// base, así que todo lo que se verifique aquí se limita a la de la semilla.
const ORG = `(SELECT id FROM organizaciones WHERE nombre = 'COMAPA Sur')`
const USUARIOS_SEMILLA = `
  SELECT u.* FROM usuarios u JOIN gerencias g ON g.id = u.gerencia_id
  WHERE g.organizacion_id = ${ORG}`

const uno = async <T>(sql: string): Promise<T> => {
  const [fila] = await bd.consultar<Record<string, T>>(sql)
  return Object.values(fila ?? {})[0] as T
}

const conteos = () => uno<string>(`
  SELECT (SELECT count(*) FROM gerencias WHERE organizacion_id = ${ORG})     || '/' ||
         (SELECT count(*) FROM unidades u JOIN gerencias g ON g.id = u.gerencia_id
            WHERE g.organizacion_id = ${ORG})                                || '/' ||
         (SELECT count(*) FROM (${USUARIOS_SEMILLA}) s)                      || '/' ||
         (SELECT count(*) FROM indicadores)                                  || '/' ||
         (SELECT count(*) FROM indicadores WHERE parent_id IS NOT NULL)      || '/' ||
         (SELECT count(*) FROM periodos_reporte)                             || '/' ||
         (SELECT count(*) FROM reportes)`)

const huellaHashes = () => uno<string>(
  `SELECT md5(string_agg(password_hash, ',' ORDER BY email)) FROM (${USUARIOS_SEMILLA}) s`)

// La base de pruebas la recrea preparar.ts, así que la primera carga arranca vacía:
// se aprovecha para comprobar CA-4 antes de meter las fixtures.
let reportesSinFixtures = -1
let indicadoresSinFixtures = -1

describe('carga inicial', () => {
  before(async () => {
    sembrar()
    reportesSinFixtures = Number(await uno<string>('SELECT count(*) FROM reportes'))
    indicadoresSinFixtures = Number(await uno<string>('SELECT count(*) FROM indicadores'))
    sembrar('--con-fixtures')
  })

  test('CA-3: la segunda carga no duplica ni cambia los hashes', async () => {
    const antes = await conteos()
    const hashesAntes = await huellaHashes()

    sembrar('--con-fixtures')

    assert.equal(await conteos(), antes, 'los conteos cambiaron en la segunda carga')
    assert.equal(await huellaHashes(), hashesAntes, 'se regeneraron los hashes de contraseña')
  })

  test('CA-2: las contraseñas son bcrypt de 12 rondas o más, una sal por usuario', async () => {
    const malas = await bd.consultar<{ email: string; prefijo: string }>(
      `SELECT email, substring(password_hash, 1, 7) AS prefijo FROM (${USUARIOS_SEMILLA}) s
       WHERE password_hash !~ '^\\$2[aby]\\$(1[2-9]|[2-9][0-9])\\$'`)
    assert.deepEqual(malas, [], 'hay hashes que no son bcrypt de 12+ rondas')

    const distintos = await uno<string>(
      `SELECT count(DISTINCT password_hash) || '/' || count(*) FROM (${USUARIOS_SEMILLA}) s`)
    const [unicos, total] = distintos.split('/')
    assert.equal(unicos, total, 'hay usuarios compartiendo el mismo hash')
  })

  test('todas las cuentas deben cambiar su contraseña al primer acceso', async () => {
    assert.equal(await uno<string>(
      `SELECT count(*) FROM (${USUARIOS_SEMILLA}) s WHERE NOT debe_cambiar_password`), '0')
  })

  test('CA-5: cada gerencia activa con indicadores tiene Revisor y Enlace', async () => {
    const huecos = await bd.consultar<{ clave: string; faltan: string }>(
      `SELECT g.clave,
              string_agg(r.rol, ', ') FILTER (WHERE u.id IS NULL) AS faltan
       FROM gerencias g
       CROSS JOIN (VALUES ('revisor'), ('enlace')) AS r(rol)
       LEFT JOIN usuarios u ON u.gerencia_id = g.id AND u.rol = r.rol AND u.activo
       WHERE g.organizacion_id = ${ORG} AND g.activo
         AND EXISTS (SELECT 1 FROM indicadores i WHERE i.gerencia_id = g.id)
       GROUP BY g.clave HAVING count(*) FILTER (WHERE u.id IS NULL) > 0`)
    assert.deepEqual(huecos, [], 'hay gerencias sin Revisor o sin Enlace')
  })

  test('CA-5: cada reporte pertenece a la gerencia de su indicador', async () => {
    // Para probar aislamiento, un reporte no puede quedar en otra gerencia que su indicador
    assert.equal(await uno<string>(
      `SELECT count(*) FROM reportes r JOIN indicadores i ON i.id = r.indicador_id
       WHERE r.gerencia_id <> i.gerencia_id`), '0')
    assert.ok(Number(await uno<string>(
      `SELECT count(DISTINCT gerencia_id) FROM reportes`)) >= 2, 'los reportes no cubren dos gerencias')
  })

  test('hay al menos un Administrador activo', async () => {
    assert.ok(Number(await uno<string>(
      `SELECT count(*) FROM (${USUARIOS_SEMILLA}) s WHERE rol = 'admin' AND activo`)) >= 1)
  })

  test('la contraseña inicial es la de SEMILLA_PASSWORD, no un valor del repositorio', async () => {
    const [u] = await bd.consultar<{ password_hash: string }>(
      `SELECT password_hash FROM (${USUARIOS_SEMILLA}) s WHERE rol = 'admin' LIMIT 1`)
    assert.equal(await bcrypt.compare(PASSWORD_PRUEBAS, u!.password_hash), true)
  })

  test('recargar corrige lo que se desvió del CSV: padre, acumulable y unidades que ya no están', async () => {
    // Solo indicadores de la semilla: otras pruebas crean los suyos en la misma base
    const DE_LA_SEMILLA = `gerencia_id IN (SELECT id FROM gerencias WHERE organizacion_id = ${ORG})`
    const [raiz] = await bd.consultar<{ id: string; acumulable: boolean }>(
      `SELECT id, acumulable FROM indicadores WHERE parent_id IS NULL AND tipo = 'mir' AND ${DE_LA_SEMILLA} LIMIT 1`)
    const [otro] = await bd.consultar<{ id: string }>(
      `SELECT id FROM indicadores WHERE id <> $1 AND parent_id IS NULL AND ${DE_LA_SEMILLA} LIMIT 1`, [raiz!.id])
    await bd.consultar('UPDATE indicadores SET parent_id = $2, acumulable = NOT acumulable WHERE id = $1',
      [raiz!.id, otro!.id])
    const [vieja] = await bd.consultar<{ id: string }>(
      `INSERT INTO unidades (gerencia_id, nombre) SELECT id, 'Unidad renombrada ' || gen_random_uuid() FROM gerencias
        WHERE organizacion_id = ${ORG} AND clave = 'TEC' RETURNING id`)

    sembrar()

    const [despues] = await bd.consultar<{ parent_id: string | null; acumulable: boolean }>(
      'SELECT parent_id, acumulable FROM indicadores WHERE id = $1', [raiz!.id])
    assert.equal(despues!.parent_id, null)
    assert.equal(despues!.acumulable, raiz!.acumulable)
    assert.equal(await uno<boolean>(`SELECT activo FROM unidades WHERE id = '${vieja!.id}'`), false)
  })

  test('CA-5: hay reportes en los estados del flujo que se van a probar', async () => {
    const porEstado = await bd.consultar<{ estado: string; n: string }>(
      `SELECT estado, count(*)::text AS n FROM reportes GROUP BY estado ORDER BY estado`)
    const estados = new Map(porEstado.map((e) => [e.estado, Number(e.n)]))
    // CA-5 nombra pendiente, borrador y observado
    for (const esperado of ['pendiente_carga', 'borrador', 'observado', 'enviado_revision']) {
      assert.ok((estados.get(esperado) ?? 0) > 0, `no hay ningún reporte en estado ${esperado}`)
    }
  })

  test('CA-5: hay un borrador en cada gerencia activa, para probar aislamiento', async () => {
    const sinBorrador = await bd.consultar<{ clave: string }>(
      `SELECT g.clave FROM gerencias g
       WHERE g.organizacion_id = ${ORG} AND g.activo
         AND EXISTS (SELECT 1 FROM indicadores i WHERE i.gerencia_id = g.id)
         AND NOT EXISTS (
           SELECT 1 FROM reportes r WHERE r.gerencia_id = g.id AND r.estado = 'borrador')`)
    assert.deepEqual(sinBorrador, [], 'hay gerencias activas sin ningún reporte en borrador')
  })

  test('un borrador no tiene fecha de envío ni de cierre', async () => {
    assert.equal(await uno<string>(
      `SELECT count(*) FROM reportes
       WHERE estado = 'borrador' AND (enviado_at IS NOT NULL OR cerrado_at IS NOT NULL)`), '0')
  })

  test('cada indicador MIR tiene nivel y los gerenciales no', async () => {
    assert.equal(await uno<string>(
      `SELECT count(*) FROM indicadores WHERE tipo = 'mir' AND nivel IS NULL`), '0')
    assert.equal(await uno<string>(
      `SELECT count(*) FROM indicadores WHERE tipo = 'gerencial' AND nivel IS NOT NULL`), '0')
  })

  test('la jerarquía de indicadores no tiene ciclos ni cuelga de otra gerencia', async () => {
    assert.equal(await uno<string>(
      `SELECT count(*) FROM indicadores h JOIN indicadores p ON p.id = h.parent_id
       WHERE p.gerencia_id <> h.gerencia_id`), '0')
    // Se sube por los padres; si un indicador vuelve a aparecer en su propio camino, hay ciclo
    assert.equal(await uno<string>(
      `WITH RECURSIVE camino(origen, actual, visitados, ciclo) AS (
         SELECT id, parent_id, ARRAY[id], false FROM indicadores WHERE parent_id IS NOT NULL
         UNION ALL
         SELECT c.origen, i.parent_id, c.visitados || i.id, i.id = ANY(c.visitados)
           FROM camino c JOIN indicadores i ON i.id = c.actual WHERE NOT c.ciclo)
       SELECT count(*) FROM camino WHERE ciclo`), '0')
    assert.ok(Number(await uno<string>(
      `SELECT count(*) FROM indicadores WHERE parent_id IS NOT NULL`)) > 0,
      'no se cargó ninguna relación padre-hijo')
  })

  test('cada reporte está en un periodo de la frecuencia de su indicador', async () => {
    assert.equal(await uno<string>(
      `SELECT count(*) FROM reportes r
       JOIN indicadores i ON i.id = r.indicador_id
       JOIN periodos_reporte p ON p.id = r.periodo_id
       WHERE p.frecuencia <> i.frecuencia`), '0')
  })

  test('CA-4: sin --con-fixtures se carga la definición pero ningún reporte', () => {
    assert.equal(reportesSinFixtures, 0, 'se cargaron reportes sin pedir fixtures')
    assert.ok(indicadoresSinFixtures > 0, 'la definición sí debe cargarse sin fixtures')
  })
})
