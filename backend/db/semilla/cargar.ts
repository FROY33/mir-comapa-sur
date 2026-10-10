#!/usr/bin/env node
// Carga inicial de datos y cuentas (TEC-04). Lee los CSV de datos/ y los inserta
// en la base, en orden de dependencias.
//
// Idempotente (CA-3): cada tabla hace ON CONFLICT sobre su clave natural, así que
// correrlo dos veces no duplica ni cambia conteos. El hash de contraseña NO se
// regenera en la segunda corrida: bcrypt da un hash distinto cada vez y eso haría
// que la carga no fuera comparable.
//
//   tsx cargar.ts                  solo definición (gerencias, unidades, usuarios, indicadores, periodos)
//   tsx cargar.ts --con-fixtures   agrega los reportes de prueba (nunca en producción, CA-4)
//   tsx cargar.ts --verificar      no escribe; solo reporta qué hay en la base

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { crearBD, type BD, type Ejecutor } from '../../src/bd.js'
import { cargarConfig } from '../../src/config.js'
import { crearLog } from '../../src/log.js'

const DATOS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'datos')

/** La organización es una sola en S1; existe para no migrar de forma destructiva después. */
const ORGANIZACION = 'COMAPA Sur'

/** bcrypt con 12 rondas o más (DICCIONARIO.md, usuarios.password_hash). */
const RONDAS_BCRYPT = 12

/**
 * Contraseña inicial de todas las cuentas. No es un secreto: todos los usuarios
 * salen con debe_cambiar_password = true y la cambian al primer acceso. Se puede
 * sobrescribir con SEMILLA_PASSWORD para no usar un valor conocido.
 */
const PASSWORD_INICIAL = process.env.SEMILLA_PASSWORD ?? 'CambiarAlIngresar2026'

// ── Lectura de CSV ───────────────────────────────────────────────────────────
// Los CSV son el artefacto de revisión (Planeación confirma gerencias y unidades
// sobre ellos), así que son también la fuente de la carga: lo que se revisa es lo
// que se carga. Parser mínimo con comillas dobles, sin dependencias.
function leerCsv(nombre: string): Record<string, string>[] {
  const texto = readFileSync(path.join(DATOS, nombre), 'utf8')
  const filas: string[][] = []
  let campo = ''
  let fila: string[] = []
  let enComillas = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') enComillas = false
      else campo += c
    } else if (c === '"') enComillas = true
    else if (c === ',') { fila.push(campo); campo = '' }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila) }

  const [encabezado, ...resto] = filas
  if (encabezado === undefined) throw new Error(`${nombre} está vacío`)
  return resto
    .filter((f) => f.some((v) => v !== ''))
    .map((f) => Object.fromEntries(encabezado.map((col, n) => [col, f[n] ?? ''])))
}

const vacioANulo = (v: string | undefined) => (v === undefined || v === '' ? null : v)
const numeroONulo = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v))
const booleano = (v: string | undefined) => v === 'true'

// ── Carga ────────────────────────────────────────────────────────────────────
interface Resumen { tabla: string; filas: number; procesados: number }

async function cargar(bd: BD, opciones: { fixtures: boolean }): Promise<Resumen[]> {
  const resumen: Resumen[] = []

  return bd.transaccion(async (tx) => {
    // 1. Organización
    const [org] = await tx.consultar<{ id: string }>(
      `INSERT INTO organizaciones (nombre) VALUES ($1)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`, [ORGANIZACION])
    if (org === undefined) throw new Error('No se pudo registrar la organización')
    const organizacionId = org.id

    // 2. Gerencias
    const gerencias = leerCsv('gerencias.csv')
    const idGerencia = new Map<string, string>()
    for (const g of gerencias) {
      const [fila] = await tx.consultar<{ id: string }>(
        `INSERT INTO gerencias (organizacion_id, clave, nombre, titular_nombre, titular_cargo, activo)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organizacion_id, clave) DO UPDATE
           SET nombre = EXCLUDED.nombre, titular_nombre = EXCLUDED.titular_nombre,
               titular_cargo = EXCLUDED.titular_cargo, activo = EXCLUDED.activo
         RETURNING id`,
        [organizacionId, g.clave, g.nombre, vacioANulo(g.titular_nombre), vacioANulo(g.titular_cargo), booleano(g.activo)])
      if (fila === undefined) throw new Error(`Gerencia ${g.clave}: sin id`)
      idGerencia.set(g.clave!, fila.id)
    }
    resumen.push({ tabla: 'gerencias', filas: gerencias.length, procesados: gerencias.length })

    // 3. Unidades
    const unidades = leerCsv('unidades.csv')
    const idUnidad = new Map<string, string>()
    for (const u of unidades) {
      const gerenciaId = idGerencia.get(u.gerencia_clave!)
      if (gerenciaId === undefined) throw new Error(`Unidad "${u.nombre}": gerencia ${u.gerencia_clave} desconocida`)
      const [fila] = await tx.consultar<{ id: string }>(
        `INSERT INTO unidades (gerencia_id, nombre, es_coord_general, activo)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (gerencia_id, nombre) DO UPDATE
           SET es_coord_general = EXCLUDED.es_coord_general, activo = EXCLUDED.activo
         RETURNING id`,
        [gerenciaId, u.nombre, booleano(u.es_coord_general), booleano(u.activo)])
      if (fila === undefined) throw new Error(`Unidad ${u.nombre}: sin id`)
      idUnidad.set(`${u.gerencia_clave}||${u.nombre}`, fila.id)
    }
    resumen.push({ tabla: 'unidades', filas: unidades.length, procesados: unidades.length })

    // 4. Usuarios — del prototipo y los de prueba que las fixtures necesitan
    const usuarios = [...leerCsv('usuarios.csv'), ...leerCsv('usuarios_prueba.csv')]
    const idUsuario = new Map<string, string>()
    for (const u of usuarios) {
      const gerenciaId = idGerencia.get(u.gerencia_clave!)
      const unidadId = idUnidad.get(`${u.gerencia_clave}||${u.unidad_nombre}`)
      if (gerenciaId === undefined) throw new Error(`${u.email}: gerencia ${u.gerencia_clave} desconocida`)
      if (unidadId === undefined) throw new Error(`${u.email}: unidad "${u.unidad_nombre}" no existe en ${u.gerencia_clave}`)
      // Un hash por usuario: bcrypt genera su propia sal en cada llamada. Hashear
      // una vez y reutilizar dejaría a las 39 cuentas con el mismo hash.
      const hash = await bcrypt.hash(PASSWORD_INICIAL, RONDAS_BCRYPT)
      const [fila] = await tx.consultar<{ id: string }>(
        // password_hash solo se escribe al insertar: en una segunda corrida se
        // conserva el existente, para que la carga sea comparable (CA-3).
        `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password, activo)
         VALUES ($1, $2, $3, $4, $5, $6, true, true)
         ON CONFLICT (email) DO UPDATE
           SET gerencia_id = EXCLUDED.gerencia_id, unidad_id = EXCLUDED.unidad_id,
               nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
         RETURNING id`,
        [gerenciaId, unidadId, u.nombre, u.email, hash, u.rol])
      if (fila === undefined) throw new Error(`Usuario ${u.email}: sin id`)
      // Por gerencia y nombre: hay un nombre repetido en dos gerencias (INCONSISTENCIAS.md §9)
      idUsuario.set(`${u.gerencia_clave}||${u.nombre}`, fila.id)
    }
    resumen.push({ tabla: 'usuarios', filas: usuarios.length, procesados: usuarios.length })

    // 5. Indicadores. parent_id se resuelve en una segunda pasada porque un padre
    //    puede venir después que su hijo en el archivo.
    const indicadores = leerCsv('indicadores.csv')
    for (const i of indicadores) {
      const gerenciaId = idGerencia.get(i.gerencia_clave!)
      if (gerenciaId === undefined) throw new Error(`${i.codigo}: gerencia ${i.gerencia_clave} desconocida`)
      const unidadId = i.unidad_nombre ? idUnidad.get(`${i.gerencia_clave}||${i.unidad_nombre}`) ?? null : null
      await tx.consultar(
        `INSERT INTO indicadores (
           gerencia_id, unidad_id, codigo, tipo, nivel, numero, nombre, resumen_narrativo,
           tipo_indicador, unidad_medida, frecuencia, tipo_calculo, formula, numerador_desc,
           denominador_desc, denominador_fijo, acumulable, sentido_meta, medio_verificacion,
           origen_mv, supuestos, es_iso, observaciones_mir, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (codigo) DO UPDATE SET
           gerencia_id = EXCLUDED.gerencia_id, unidad_id = EXCLUDED.unidad_id,
           tipo = EXCLUDED.tipo, nivel = EXCLUDED.nivel, numero = EXCLUDED.numero,
           nombre = EXCLUDED.nombre, resumen_narrativo = EXCLUDED.resumen_narrativo,
           tipo_indicador = EXCLUDED.tipo_indicador, unidad_medida = EXCLUDED.unidad_medida,
           frecuencia = EXCLUDED.frecuencia, tipo_calculo = EXCLUDED.tipo_calculo,
           formula = EXCLUDED.formula, numerador_desc = EXCLUDED.numerador_desc,
           denominador_desc = EXCLUDED.denominador_desc, denominador_fijo = EXCLUDED.denominador_fijo,
           medio_verificacion = EXCLUDED.medio_verificacion, origen_mv = EXCLUDED.origen_mv,
           supuestos = EXCLUDED.supuestos, es_iso = EXCLUDED.es_iso,
           observaciones_mir = EXCLUDED.observaciones_mir, activo = EXCLUDED.activo`,
        [gerenciaId, unidadId, i.codigo, i.tipo, vacioANulo(i.nivel), vacioANulo(i.numero),
         i.nombre, vacioANulo(i.resumen_narrativo), vacioANulo(i.tipo_indicador), i.unidad_medida,
         i.frecuencia, i.tipo_calculo, vacioANulo(i.formula), vacioANulo(i.numerador_desc),
         vacioANulo(i.denominador_desc), numeroONulo(i.denominador_fijo), booleano(i.acumulable),
         i.sentido_meta, vacioANulo(i.medio_verificacion), vacioANulo(i.origen_mv),
         vacioANulo(i.supuestos), booleano(i.es_iso), vacioANulo(i.observaciones_mir), booleano(i.activo)])
    }
    for (const i of indicadores.filter((x) => x.parent_codigo)) {
      await tx.consultar(
        `UPDATE indicadores SET parent_id = padre.id
         FROM indicadores padre
         WHERE indicadores.codigo = $1 AND padre.codigo = $2`, [i.codigo, i.parent_codigo])
    }
    resumen.push({ tabla: 'indicadores', filas: indicadores.length, procesados: indicadores.length })

    const gerenciaDeIndicador = new Map(indicadores.map((i) => [i.codigo!, i.gerencia_clave!]))

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
    if (!opciones.fixtures) {
      resumen.push({ tabla: 'reportes (omitido)', filas: 0, procesados: 0 })
      return resumen
    }

    const fixtures = leerCsv('fixtures_reportes.csv')
    let procesados = 0
    for (const f of fixtures) {
      const periodoId = idPeriodo.get(`${f.periodo_frecuencia}||${f.periodo_numero}`)
      if (periodoId === undefined) throw new Error(`${f.indicador_codigo}: periodo ${f.periodo_frecuencia} ${f.periodo_numero} desconocido`)
      // Un reporte cerrado no se puede editar sin autorización de reapertura, así
      // que si la fixture ya existe se deja intacta en vez de actualizarla.
      const filas = await tx.consultar<{ id: string }>(
        `INSERT INTO reportes (indicador_id, periodo_id, estado, numerador, denominador, avance,
                               enviado_por, enviado_at, cerrado_at)
         SELECT i.id, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz
         FROM indicadores i WHERE i.codigo = $1
         ON CONFLICT (indicador_id, periodo_id) DO NOTHING
         RETURNING id`,
        [f.indicador_codigo, periodoId, f.estado, numeroONulo(f.numerador), numeroONulo(f.denominador),
         numeroONulo(f.avance),
         idUsuario.get(`${gerenciaDeIndicador.get(f.indicador_codigo!)}||${f.responsable_enlace_prototipo}`) ?? null,
         vacioANulo(f.enviado_at), vacioANulo(f.cerrado_at)])
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
const config = cargarConfig()
const bd = crearBD(config.bd, crearLog(() => {}))
const fixtures = process.argv.includes('--con-fixtures')
const soloVerificar = process.argv.includes('--verificar')

// CA-4: las fixtures no se cargan en producción, ni pidiéndolo
if (fixtures && config.entorno === 'production') {
  console.error('Las fixtures de prueba no se cargan en producción (CA-4).')
  process.exit(1)
}

try {
  if (!soloVerificar) {
    const resumen = await cargar(bd, { fixtures })
    for (const r of resumen) console.log(`  ${r.tabla.padEnd(20)} ${String(r.procesados).padStart(4)} de ${r.filas}`)
    console.log()
  }
  console.log('Estado de la base:')
  for (const [tabla, n] of Object.entries(await contar(bd))) {
    console.log(`  ${tabla.padEnd(22)} ${String(n).padStart(4)}`)
  }
} finally {
  await bd.cerrar()
}
