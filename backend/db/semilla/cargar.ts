#!/usr/bin/env node
// Carga inicial de datos y cuentas (TEC-04). Lee los CSV de datos/ y los inserta
// en la base, en orden de dependencias. Qué se carga depende del destino: ver plan.ts.
//
// Idempotente (CA-3): cada tabla hace ON CONFLICT sobre su clave natural, así que
// correrlo dos veces no duplica ni cambia conteos. El hash de contraseña solo se
// calcula para cuentas nuevas: una cuenta existente conserva el suyo.
//
//   tsx cargar.ts                  definición (+ usuarios de demostración si la base es local)
//   tsx cargar.ts --con-fixtures   agrega los reportes de prueba (solo base local o de pruebas, CA-4)
//   tsx cargar.ts --verificar      no escribe; solo reporta qué hay en la base
//   tsx cargar.ts --catalogo       solo el catálogo institucional sobre una base del sprint 1 (una vez; ver catalogo.ts)
//   tsx cargar.ts --catalogo --forzar   lo repite sin pisar lo que el Administrador editó desde la pantalla

import bcrypt from 'bcryptjs'
import { crearBD, type BD, type Ejecutor } from '../../src/bd.js'
import { cargarConfig } from '../../src/config.js'
import { crearLog } from '../../src/log.js'
import { cargarIndicadores, catalogoImportado, ErrorCatalogo, importarCatalogo } from './catalogo.js'
import { booleano, leerCsv, numeroONulo, vacioANulo } from './csv.js'
import { cargarGerencias, cargarOrganizacion, cargarUnidades } from './organizacion.js'
import { adminInicial, destino, ErrorPlan, passwordInicial, planDeCarga, type AdminInicial, type Plan } from './plan.js'

/** bcrypt con 12 rondas o más (DICCIONARIO.md, usuarios.password_hash). */
const RONDAS_BCRYPT = 12

// ── Carga ────────────────────────────────────────────────────────────────────
interface Resumen { tabla: string; filas: number; procesados: number }

interface Cuentas { password: string; admin?: AdminInicial }

async function cargar(bd: BD, plan: Plan, cuentas: Cuentas): Promise<Resumen[]> {
  const resumen: Resumen[] = []

  return bd.transaccion(async (tx) => {
    // 1-3. Organización, gerencias y unidades
    const organizacionId = await cargarOrganizacion(tx)
    const { idGerencia, filas: nGerencias } = await cargarGerencias(tx, organizacionId)
    resumen.push({ tabla: 'gerencias', filas: nGerencias, procesados: nGerencias })
    const { idUnidad, filas: nUnidades } = await cargarUnidades(tx, idGerencia)
    // Una unidad renombrada en el CSV deja la vieja sin uso: se desactiva, no se borra
    // (puede tener usuarios o indicadores). Solo en demostración, donde el CSV manda.
    if (plan.modo === 'demostracion') {
      await tx.consultar(
        `UPDATE unidades u SET activo = false
          WHERE u.activo AND u.gerencia_id = ANY($1::uuid[]) AND NOT (u.id = ANY($2::uuid[]))`,
        [[...idGerencia.values()], [...idUnidad.values()]])
    }
    resumen.push({ tabla: 'unidades', filas: nUnidades, procesados: nUnidades })

    // 4. Usuarios. En demostración: los del prototipo más los de prueba, y una fila de
    //    usuarios_prueba.csv corrige a la del mismo correo en usuarios.csv. En la carga
    //    inicial: solo la cuenta de Administrador de las variables de entorno.
    const porEmail = new Map<string, Record<string, string>>()
    if (plan.modo === 'demostracion') {
      for (const u of [...leerCsv('usuarios.csv'), ...leerCsv('usuarios_prueba.csv')]) porEmail.set(u.email!.toLowerCase(), u)
    } else {
      const admin = cuentas.admin!
      const [coord] = leerCsv('unidades.csv')
        .filter((u) => u.gerencia_clave === admin.gerenciaClave && booleano(u.es_coord_general))
      if (coord === undefined) throw new Error(`SEMILLA_ADMIN_GERENCIA=${admin.gerenciaClave} no tiene Coordinación General`)
      porEmail.set(admin.email.toLowerCase(), {
        email: admin.email, nombre: admin.nombre, rol: 'admin',
        gerencia_clave: admin.gerenciaClave, unidad_nombre: coord.nombre!,
      })
    }
    const usuarios = [...porEmail.values()]
    const existentes = new Set((await tx.consultar<{ email: string }>(
      'SELECT lower(email::text) AS email FROM usuarios WHERE email = ANY($1::citext[])',
      [usuarios.map((u) => u.email)])).map((u) => u.email))

    const idUsuarioPorEmail = new Map<string, string>()
    for (const u of usuarios) {
      const gerenciaId = idGerencia.get(u.gerencia_clave!)
      const unidadId = idUnidad.get(`${u.gerencia_clave}||${u.unidad_nombre}`)
      if (gerenciaId === undefined) throw new Error(`${u.email}: gerencia ${u.gerencia_clave} desconocida`)
      if (unidadId === undefined) throw new Error(`${u.email}: unidad "${u.unidad_nombre}" no existe en ${u.gerencia_clave}`)
      // Un hash por usuario nuevo: bcrypt genera su propia sal en cada llamada. Una cuenta
      // existente conserva su hash, y con él la contraseña que ya haya cambiado.
      const hash = existentes.has(u.email!.toLowerCase()) ? '' : await bcrypt.hash(cuentas.password, RONDAS_BCRYPT)
      const [fila] = await tx.consultar<{ id: string }>(
        `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password, activo)
         VALUES ($1, $2, $3, $4, $5, $6, true, true)
         ON CONFLICT (email) DO UPDATE
           SET gerencia_id = EXCLUDED.gerencia_id, unidad_id = EXCLUDED.unidad_id,
               nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
         RETURNING id`,
        [gerenciaId, unidadId, u.nombre, u.email, hash, u.rol])
      if (fila === undefined) throw new Error(`Usuario ${u.email}: sin id`)
      idUsuarioPorEmail.set(u.email!.toLowerCase(), fila.id)
    }
    resumen.push({ tabla: 'usuarios', filas: usuarios.length, procesados: usuarios.length })

    // 5. Indicadores. Una vez importado el catálogo (--catalogo) se mantienen desde la pantalla
    //    del catálogo: la carga completa ya no los toca, para no revertir lo que se editó.
    if (await catalogoImportado(tx)) {
      resumen.push({ tabla: 'indicadores (ya importados)', filas: 0, procesados: 0 })
    } else {
      const { filas } = await cargarIndicadores(tx, idGerencia, idUnidad)
      resumen.push({ tabla: 'indicadores', filas, procesados: filas })
    }

    // 6. Periodos de reporte
    const periodos = leerCsv('periodos.csv')
    const idPeriodo = new Map<string, string>()
    for (const p of periodos) {
      const [fila] = await tx.consultar<{ id: string }>(
        `INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta,
           inicio_periodo, fin_periodo, abre_captura, fecha_limite, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (frecuencia, ejercicio, numero) DO UPDATE
           SET etiqueta = EXCLUDED.etiqueta, inicio_periodo = EXCLUDED.inicio_periodo,
               fin_periodo = EXCLUDED.fin_periodo, abre_captura = EXCLUDED.abre_captura,
               fecha_limite = EXCLUDED.fecha_limite
         RETURNING id`,
        [p.frecuencia, Number(p.ejercicio), Number(p.numero), p.etiqueta,
         p.inicio_periodo, p.fin_periodo, p.abre_captura, p.fecha_limite, p.estado])
      if (fila === undefined) throw new Error(`Periodo ${p.frecuencia} ${p.numero}: sin id`)
      idPeriodo.set(`${p.frecuencia}||${p.numero}`, fila.id)
    }
    resumen.push({ tabla: 'periodos_reporte', filas: periodos.length, procesados: periodos.length })

    // 7. Fixtures de reporte — solo con --con-fixtures (CA-4)
    if (!plan.fixtures) {
      resumen.push({ tabla: 'reportes (omitido)', filas: 0, procesados: 0 })
      return resumen
    }

    const idIndicador = new Map((await tx.consultar<{ codigo: string; id: string }>(
      'SELECT codigo, id FROM indicadores')).map((i) => [i.codigo, i.id]))
    // fixtures_sinteticas.csv: datos de prueba para gerencias sin reportes en el prototipo (Gerencia
    // General, activa desde el ticket 2). El importador del catálogo no la reescribe (TEC-04 CA-5).
    const fixtures = [...leerCsv('fixtures_reportes.csv'), ...leerCsv('fixtures_sinteticas.csv')]
    let procesados = 0
    for (const f of fixtures) {
      const indicadorId = idIndicador.get(f.indicador_codigo!)
      if (indicadorId === undefined) throw new Error(`Fixture: el indicador ${f.indicador_codigo} no existe`)
      const periodoId = idPeriodo.get(`${f.periodo_frecuencia}||${f.periodo_numero}`)
      if (periodoId === undefined) throw new Error(`${f.indicador_codigo}: periodo ${f.periodo_frecuencia} ${f.periodo_numero} desconocido`)
      const enviadoPor = f.enviado_por_email ? idUsuarioPorEmail.get(f.enviado_por_email.toLowerCase()) : undefined
      if (f.enviado_por_email && enviadoPor === undefined) {
        throw new Error(`${f.indicador_codigo}: quien envió (${f.enviado_por_email}) no tiene cuenta`)
      }
      // Un reporte cerrado no se puede editar sin autorización de reapertura, así
      // que si la fixture ya existe se deja intacta en vez de actualizarla.
      const filas = await tx.consultar<{ id: string }>(
        `INSERT INTO reportes (indicador_id, periodo_id, estado, numerador, denominador, avance,
                               enviado_por, enviado_at, cerrado_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
         ON CONFLICT (indicador_id, periodo_id) DO NOTHING
         RETURNING id`,
        [indicadorId, periodoId, f.estado, numeroONulo(f.numerador), numeroONulo(f.denominador),
         numeroONulo(f.avance), enviadoPor ?? null, vacioANulo(f.enviado_at), vacioANulo(f.cerrado_at)])
      procesados += filas.length
    }
    resumen.push({ tabla: 'reportes', filas: fixtures.length, procesados })
    return resumen
  })
}

/** Qué hay en la base, para --verificar y para el reporte final. */
export async function contar(tx: Ejecutor) {
  const [fila] = await tx.consultar<Record<string, string>>(
    `SELECT (SELECT count(*) FROM organizaciones)    AS organizaciones,
            (SELECT count(*) FROM gerencias)         AS gerencias,
            (SELECT count(*) FROM unidades)          AS unidades,
            (SELECT count(*) FROM usuarios)          AS usuarios,
            (SELECT count(*) FROM indicadores)       AS indicadores,
            (SELECT count(*) FROM indicadores WHERE parent_id IS NOT NULL) AS indicadores_con_padre,
            (SELECT count(*) FROM periodos_reporte)  AS periodos_reporte,
            (SELECT count(*) FROM reportes)          AS reportes`)
  return fila ?? {}
}

// ── Punto de entrada ─────────────────────────────────────────────────────────
// cargarConfig() lee .env (o .env.test): las variables SEMILLA_* se leen DESPUÉS, para
// que también valgan desde ese archivo.
const config = cargarConfig()
let plan: Plan
let cuentas: Cuentas
try {
  plan = planDeCarga(process.argv.slice(2), config.entorno, config.bd.url)
  cuentas = plan.soloVerificar || plan.catalogo ? { password: '' } : {
    password: passwordInicial(process.env),
    admin: plan.modo === 'inicial' ? adminInicial(process.env) : undefined,
  }
} catch (err) {
  if (!(err instanceof ErrorPlan)) throw err
  console.error(`✗ ${err.message}`)
  process.exit(1)
}

const bd = crearBD(config.bd, crearLog(() => {}))
console.log(`Destino: ${destino(config.bd.url)} · modo ${plan.catalogo ? 'catálogo' + (plan.forzar ? ' forzado' : '') : plan.modo}${plan.fixtures ? ' con fixtures' : ''}`)

try {
  const yaCargada = Number((await contar(bd)).usuarios) > 0
  if (plan.catalogo) {
    const r = await importarCatalogo(bd, plan.forzar)
    for (const [concepto, n] of Object.entries(r.conteos)) console.log(`  ${concepto.replace(/_/g, ' ').padEnd(20)} ${String(n).padStart(4)}`)
    console.log(`  sha256 de indicadores.csv ${r.sha256}`)
    for (const d of r.desactivados) console.log(`  desactivado: ${d.codigo} (${d.reportes} reportes conservados)`)
    for (const n of r.no_sobrescritos) console.log(`  no sobrescrito: ${n.codigo} (${n.campos.join(', ')}), lo editó el Administrador`)
    console.log()
  } else if (plan.soloVerificar) {
    // solo reporta
  } else if (plan.modo === 'inicial' && yaCargada) {
    console.log('La base ya tiene usuarios: la carga inicial no se repite (no se cambió nada).')
  } else {
    const resumen = await cargar(bd, plan, cuentas)
    for (const r of resumen) console.log(`  ${r.tabla.padEnd(20)} ${String(r.procesados).padStart(4)} de ${r.filas}`)
    console.log()
  }
  console.log('Estado de la base:')
  for (const [tabla, n] of Object.entries(await contar(bd))) {
    console.log(`  ${tabla.padEnd(22)} ${String(n).padStart(4)}`)
  }
} catch (err) {
  if (!(err instanceof ErrorCatalogo)) throw err
  console.error(`✗ ${err.message}`)
  process.exitCode = 1
} finally {
  await bd.cerrar()
}
