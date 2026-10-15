#!/usr/bin/env node
/**
 * TEC-04 — Importa el catálogo institucional de indicadores MIR desde el CSV
 * unificado (2026.09.14-MIR-COMAPA_UNIFICADA.csv) y genera:
 *
 *   1. datos/indicadores.csv        — reemplaza los MIR del prototipo; conserva gerenciales
 *   2. datos/fixtures_reportes.csv  — reasigna las fixtures a los códigos nuevos
 *   3. datos/equivalencias_prototipo.csv — a qué código institucional pasa cada MIR del prototipo
 *                                      (o ninguno: se desactiva al cargar con --catalogo)
 *   4. CONCILIACION.md              — reporte de discrepancias para revisión de la PO
 *   5. datos/gerencias.csv (conteos) y manifest.json (conteos y sha256)
 *
 * Si se vuelve a correr extraer.ts (que escribe los códigos del prototipo), hay que
 * correr este script después.
 *
 * Repetible: misma entrada → mismos bytes. Idempotente vía ON CONFLICT en cargar.ts.
 *
 * Uso:  npx tsx db/semilla/importar-csv-unificada.ts [ruta-csv]
 *       (desde backend/; si no se pasa ruta, busca en la raíz del repo y en la carpeta COMAPA)
 *
 * Esto solo genera los CSV de datos/. Cargarlos sobre una base del sprint 1 (renombrar,
 * upsert, desactivar y registrar en bitácora) lo hace `cargar.ts --catalogo`.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { NIVELES, FRECUENCIAS, TIPOS_INDICADOR, claveGerencia } from './mapeos.js'
import { indicadoresMir as mirPrototipo } from './extraer/indicadores.js'
import { periodoDeCorte, sinPeriodoConcluido } from './extraer/reportes.js'
import { generarConciliacion, type Discrepancia, type Equivalencia, type Reasignacion } from './conciliacion-catalogo.js'

const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const DATOS = path.join(AQUI, 'datos')
const RAIZ = path.resolve(AQUI, '../../..')

// ── Lectura del CSV ─────────────────────────────────────────────────────────

function parseCsv(texto: string): Record<string, string>[] {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const encabezados = parseCsvLinea(lineas[0]!)
  const filas: Record<string, string>[] = []
  for (let i = 1; i < lineas.length; i++) {
    const l = lineas[i]!.trim()
    if (!l) continue
    const valores = parseCsvLinea(l)
    const fila: Record<string, string> = {}
    for (let j = 0; j < encabezados.length; j++) {
      fila[encabezados[j]!] = valores[j] ?? ''
    }
    filas.push(fila)
  }
  return filas
}

function parseCsvLinea(linea: string): string[] {
  const resultado: string[] = []
  let actual = ''
  let enComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!
    if (enComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++ }
        else enComillas = false
      } else {
        actual += c
      }
    } else {
      if (c === '"') enComillas = true
      else if (c === ',') { resultado.push(actual.trim()); actual = '' }
      else actual += c
    }
  }
  resultado.push(actual.trim())
  return resultado
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function escribirCsv(nombre: string, filas: Record<string, unknown>[]) {
  const primera = filas[0]
  if (!primera) throw new Error(`${nombre}: no hay filas`)
  const columnas = Object.keys(primera)
  const texto = [columnas.join(','), ...filas.map(f => columnas.map(c => celda(f[c])).join(','))].join('\n') + '\n'
  fs.writeFileSync(path.join(DATOS, nombre), texto, 'utf8')
  return { filas: filas.length, sha256: crypto.createHash('sha256').update(texto, 'utf8').digest('hex') }
}

const colar = (a: string, b: string) => a.localeCompare(b, 'es')

// ── Mapeo de campos ─────────────────────────────────────────────────────────

function mapearNivel(valor: string): string {
  const limpio = valor.trim()
  const mapeado = NIVELES[limpio]
  if (mapeado) return mapeado
  // Intentar variantes de acentuación
  if (limpio.toLowerCase().startsWith('prop')) return 'proposito'
  return ''
}

function mapearFrecuencia(valor: string): string {
  return FRECUENCIAS[valor.trim()] ?? ''
}

// Valores que el CSV trae vacíos o inválidos resueltos en DECISIONES.md (Froy, 14/10/2026). Clave: Id del CSV.
// Solo se aplican si el CSV sigue sin un valor válido; si la fuente se corrige, manda la fuente.
const TIPO_INDICADOR_PO: Record<string, string> = {
  '26': 'gestion',  // vacío en el CSV
  '36': 'gestion',  // «Porcentaje» en el CSV (la unidad de medida, no un tipo)
}

function mapearTipoIndicador(valor: string): string {
  const limpio = valor.trim()
  if (!limpio) return ''
  const mapeado = TIPOS_INDICADOR[limpio]
  if (mapeado) return mapeado
  // Variantes comunes
  if (limpio.toLowerCase() === 'gestión' || limpio.toLowerCase() === 'gestion') return 'gestion'
  if (limpio.toLowerCase() === 'estratégico' || limpio.toLowerCase() === 'estrategico') return 'estrategico'
  return ''
}

function generarCodigo(gerClave: string, nivel: string, numero: string): string {
  if (numero === '-' || !numero.trim()) {
    if (nivel === 'fin') return `${gerClave}-FIN`
    if (nivel === 'proposito') return `${gerClave}-PROP`
    return `${gerClave}-${nivel.toUpperCase()}`
  }
  return `${gerClave}-${numero.trim()}`
}

function codigoDelPadre(gerClave: string, nivel: string, numero: string): string {
  if (nivel !== 'actividad' || !numero || numero === '-') return ''
  const partes = numero.split('.')
  if (partes.length < 2) return ''
  // Actividad X.Y.Z → padre es Componente X (misma gerencia)
  return `${gerClave}-${partes[0]}`
}

// ── Transformación principal ────────────────────────────────────────────────

function transformar(csvPath: string) {
  const texto = fs.readFileSync(csvPath, 'utf8')
  const filas = parseCsv(texto)

  const discrepancias: Discrepancia[] = []
  const correcciones: Discrepancia[] = []
  const advertencias: string[] = []
  const indicadoresMir: Record<string, unknown>[] = []

  const codigosVistos = new Set<string>()

  for (const fila of filas) {
    const id = fila['Id'] ?? ''
    const gerNombre = fila['Gerencia'] ?? ''
    const gerClave = claveGerencia(gerNombre)
    const unidadResp = fila['Unidad Responsable'] ?? ''
    const iso = (fila['ISO'] ?? '').trim()
    const numIndicador = (fila['Número indicador'] ?? fila['Número indicador'] ?? '').trim()
    const nivelRaw = fila['Nivel'] ?? ''
    const resumen = fila['Resumen narrativo'] ?? ''
    const nombre = fila['Nombre indicador'] ?? ''
    const tipoIndRaw = fila['Tipo indicador'] ?? ''
    const unidadMedida = fila['Unidad de medida'] ?? ''
    const frecRaw = fila['Frecuencia de medición'] ?? fila['Frecuencia de medición'] ?? ''
    const numeradorX = fila['Numerador X'] ?? ''
    const denominadorY = fila['Denominador Y'] ?? ''
    const medioVerif = fila['Medio de verificación'] ?? fila['Medio de verificación'] ?? ''
    const lineaBase = (fila['Linea base'] ?? '').trim()
    const meta = (fila['Meta'] ?? '').trim()
    const observaciones = (fila['Observaciones'] ?? '').trim()

    // Validar gerencia
    if (!gerClave) {
      discrepancias.push({ id, campo: 'Gerencia', valor: gerNombre, detalle: 'No se pudo mapear a una clave de gerencia conocida' })
      continue
    }

    // Mapear nivel
    const nivel = mapearNivel(nivelRaw)
    if (!nivel) {
      discrepancias.push({ id, campo: 'Nivel', valor: nivelRaw, detalle: 'Nivel no reconocido' })
      continue
    }

    // Mapear frecuencia
    const frecuencia = mapearFrecuencia(frecRaw)
    if (!frecuencia) {
      discrepancias.push({ id, campo: 'Frecuencia', valor: frecRaw, detalle: 'Frecuencia no reconocida' })
      continue
    }

    // Mapear tipo indicador
    let tipoIndicador = mapearTipoIndicador(tipoIndRaw)
    const tipoPo = TIPO_INDICADOR_PO[id]
    if (!tipoIndicador && tipoPo) {
      correcciones.push({ id, campo: 'Tipo indicador', valor: tipoIndRaw.trim() || '(vacío)', detalle: `«${nombre}» → ${tipoPo}` })
      tipoIndicador = tipoPo
    } else if (!tipoIndRaw.trim()) {
      discrepancias.push({ id, campo: 'Tipo indicador', valor: '(vacío)', detalle: `Indicador "${nombre}" sin tipo. Requiere resolución con PO.` })
    } else if (!tipoIndicador) {
      discrepancias.push({ id, campo: 'Tipo indicador', valor: tipoIndRaw, detalle: `Valor "${tipoIndRaw}" no reconocido. Requiere resolución con PO.` })
    }

    // Generar código
    const codigo = generarCodigo(gerClave, nivel, numIndicador)
    if (codigosVistos.has(codigo)) {
      discrepancias.push({ id, campo: 'Código generado', valor: codigo, detalle: 'Código duplicado — conflicto de Número indicador' })
    }
    codigosVistos.add(codigo)

    // Determinar tipo de cálculo
    const tieneDenom = Boolean(denominadorY.trim())
    const tipoCalculo = tieneDenom ? 'fraccion' : 'valor_directo'

    // Parent
    const parentCodigo = codigoDelPadre(gerClave, nivel, numIndicador)

    indicadoresMir.push({
      codigo,
      tipo: 'mir',
      gerencia_clave: gerClave,
      unidad_nombre: unidadResp.trim(),
      parent_codigo: parentCodigo,
      nivel,
      numero: numIndicador === '-' ? '' : numIndicador,
      nombre: nombre.trim(),
      resumen_narrativo: resumen.trim(),
      tipo_indicador: tipoIndicador,
      unidad_medida: unidadMedida.trim(),
      frecuencia,
      tipo_calculo: tipoCalculo,
      formula: '',
      numerador_desc: numeradorX.trim(),
      denominador_desc: denominadorY.trim(),
      denominador_fijo: '',
      acumulable: false,
      sentido_meta: 'ascendente',
      medio_verificacion: medioVerif.trim(),
      origen_mv: '',
      supuestos: '',
      es_iso: iso === 'X',
      iso_codigo: '',
      observaciones_mir: observaciones,
      activo: true,
      meta_anual_prototipo: meta,
      linea_base_prototipo: lineaBase,
    })
  }

  // Validar que todos los parent_codigo apunten a un código existente
  for (const ind of indicadoresMir) {
    const pc = ind.parent_codigo as string
    if (pc && !codigosVistos.has(pc)) {
      advertencias.push(`Indicador ${ind.codigo}: parent_codigo "${pc}" no encontrado en el catálogo`)
      ind.parent_codigo = ''
    }
  }

  // Validar campos obligatorios del esquema
  for (const ind of indicadoresMir) {
    if (!ind.nombre) discrepancias.push({ id: ind.codigo as string, campo: 'nombre', valor: '(vacío)', detalle: 'Campo obligatorio vacío' })
    if (!ind.unidad_medida) discrepancias.push({ id: ind.codigo as string, campo: 'unidad_medida', valor: '(vacío)', detalle: 'Campo obligatorio vacío' })
    if (!ind.frecuencia) discrepancias.push({ id: ind.codigo as string, campo: 'frecuencia', valor: '(vacío)', detalle: 'Campo obligatorio vacío' })
  }

  return { indicadoresMir, discrepancias, correcciones, advertencias }
}

// ── Conservar gerenciales del CSV existente ─────────────────────────────────

function leerGerencialesExistentes(): Record<string, unknown>[] {
  const csvPath = path.join(DATOS, 'indicadores.csv')
  if (!fs.existsSync(csvPath)) return []
  const texto = fs.readFileSync(csvPath, 'utf8')
  const filas = parseCsv(texto)
  return filas.filter(f => f['tipo'] === 'gerencial')
}

// ── Fixtures de reporte ─────────────────────────────────────────────────────
// extraer.ts escribe las fixtures con los códigos del prototipo (ADM-ACT-42…). Cada
// una se reasigna al indicador del catálogo nuevo que corresponde al mismo indicador
// del prototipo, conservando gerencia, frecuencia (y con ella el periodo) y estado.
// La columna indicador_codigo_prototipo deja el rastro y hace repetible la reasignación.

function reasignarFixtures(catalogo: Record<string, unknown>[]): Reasignacion {
  const csvPath = path.join(DATOS, 'fixtures_reportes.csv')
  const filas = parseCsv(fs.readFileSync(csvPath, 'utf8'))
  const prototipo = new Map(mirPrototipo.map(p => [p.codigo, p]))
  const porCodigo = new Map(catalogo.filter(i => i.tipo === 'mir').map(i => [i.codigo as string, i]))
  const usados = new Set<string>()
  const asignado = new Map<Record<string, string>, string>()

  const origenDe = (f: Record<string, string>) => {
    const codigo = f['indicador_codigo_prototipo'] || f['indicador_codigo']!
    const p = prototipo.get(codigo)
    if (!p) throw new Error(`Fixture: ${codigo} no es un indicador MIR del prototipo`)
    return p
  }
  const libre = (i: Record<string, unknown> | undefined, frecuencia: string) =>
    i !== undefined && i.frecuencia === frecuencia && !usados.has(i.codigo as string)

  // 1ª pasada: mismo número de indicador (así se generan los códigos nuevos)
  let porNumero = 0
  for (const f of filas) {
    const p = origenDe(f)
    const candidato = p.numero ? porCodigo.get(`${p.gerencia_clave}-${p.numero}`) : undefined
    if (!libre(candidato, p.frecuencia)) continue
    asignado.set(f, candidato!.codigo as string)
    usados.add(candidato!.codigo as string)
    porNumero++
  }

  // 2ª pasada: otro indicador libre de la misma gerencia. Son datos de prueba: lo que
  // importa conservar es gerencia y estado del flujo, y la frecuencia mientras se pueda.
  // Preferencias, en orden: misma frecuencia, MIR, mismo nombre, misma unidad, mismo tipo
  // de cálculo (para que numerador y denominador sigan teniendo sentido).
  let porNombre = 0
  const sustituidas: string[] = []
  const descartadas: string[] = []
  for (const f of filas) {
    if (asignado.has(f)) continue
    const p = origenDe(f)
    const nombre = String(p.nombre ?? '').trim()
    const frecuencia = p.frecuencia                       // la del prototipo: repetible aunque ya se haya cambiado
    const puntos = (i: Record<string, unknown>) =>
      32 * Number(i.frecuencia === frecuencia) + 16 * Number(i.tipo === 'mir') + 4 * Number(i.nombre === nombre)
      + 2 * Number(i.unidad_nombre === p.unidad_nombre) + Number(i.tipo_calculo === p.tipo_calculo)
    const elegido = catalogo
      .filter(i => i.gerencia_clave === p.gerencia_clave && !usados.has(i.codigo as string)
        && periodoDeCorte.has(i.frecuencia as string)
        // Un borrador necesita un periodo ya concluido al corte (ver extraer/reportes.ts)
        && (f['estado'] !== 'borrador' || i.frecuencia === frecuencia
          || !sinPeriodoConcluido.includes(i.frecuencia as string)))
      .sort((a, b) => puntos(b) - puntos(a) || colar(a.codigo as string, b.codigo as string))[0]
    if (!elegido) {
      // Un borrador descartado rompería CA-5 (un borrador por gerencia activa)
      if (f['estado'] === 'borrador') {
        throw new Error(`Fixture: el borrador de ${p.codigo} no tiene indicador libre en ${p.gerencia_clave}`)
      }
      descartadas.push(`${p.codigo} (${p.gerencia_clave}, ${frecuencia}, ${f['estado']}): no queda indicador libre en la gerencia`)
      continue
    }
    const codigo = elegido.codigo as string
    asignado.set(f, codigo)
    usados.add(codigo)
    if (elegido.frecuencia !== frecuencia) {
      // Cambia la frecuencia: el periodo se elige con la misma regla que extraer.ts
      const periodo = periodoDeCorte.get(elegido.frecuencia as string)!
      f['periodo_frecuencia'] = periodo.frecuencia
      f['periodo_numero'] = String(periodo.numero)
      f['periodo_etiqueta'] = periodo.etiqueta
    }
    if (elegido.frecuencia === frecuencia && elegido.nombre === nombre) { porNombre++; continue }
    sustituidas.push(`${p.codigo} → ${codigo} (${f['estado']}): «${nombre}» ${frecuencia} → «${elegido.nombre}» ${elegido.frecuencia}`)
  }

  const fixtures = filas
    .filter(f => asignado.has(f))
    .map(f => {
      const { indicador_codigo: _, indicador_codigo_prototipo: __, ...resto } = f
      return { indicador_codigo: asignado.get(f)!, indicador_codigo_prototipo: origenDe(f).codigo, ...resto }
    })
    .sort((a, b) => colar(a.indicador_codigo, b.indicador_codigo))

  return { fixtures, porNumero, porNombre, sustituidas, descartadas }
}

// ── Equivalencias del prototipo ─────────────────────────────────────────────
// Una base del sprint 1 tiene los MIR con los códigos del prototipo (ADM-ACT-42…). Para que
// `cargar.ts --catalogo` los renombre sin perder sus reportes, cada MIR del prototipo se liga
// al del catálogo institucional con la misma gerencia y el mismo «Número indicador» (la misma
// regla con que se generan los códigos nuevos). Sin pareja o con la pareja ya tomada: sin
// equivalente, y el cargador lo desactiva sin borrarlo.

function calcularEquivalencias(catalogo: Record<string, unknown>[]): Equivalencia[] {
  const mir = new Set(catalogo.filter(i => i.tipo === 'mir').map(i => i.codigo as string))
  const tomados = new Set<string>()
  return [...mirPrototipo].sort((a, b) => colar(a.codigo, b.codigo)).map((p): Equivalencia => {
    const candidato = p.numero ? `${p.gerencia_clave}-${p.numero}` : ''
    const hay = candidato !== '' && mir.has(candidato) && !tomados.has(candidato)
    if (hay) tomados.add(candidato)
    return {
      codigo_prototipo: p.codigo, codigo: hay ? candidato : '', gerencia_clave: p.gerencia_clave,
      nivel: String(p.nivel ?? ''), nombre: String(p.nombre ?? '').trim(),
      estado: hay ? 'renombrado' : 'sin_equivalente',
    }
  })
}

// ── Conteos de gerencias.csv y manifest.json ────────────────────────────────

const sha = (ruta: string) => crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex')

/** Conteos de indicadores por gerencia y por unidad en gerencias.csv y unidades.csv. */
function actualizarGerencias(todos: Record<string, unknown>[]) {
  const ruta = path.join(DATOS, 'gerencias.csv')
  const filas = parseCsv(fs.readFileSync(ruta, 'utf8'))
  for (const g of filas) {
    const propios = todos.filter(i => i.gerencia_clave === g['clave'])
    g['indicadores_mir'] = String(propios.filter(i => i.tipo === 'mir').length)
    g['indicadores_gerenciales'] = String(propios.filter(i => i.tipo === 'gerencial').length)
  }
  escribirCsv('gerencias.csv', filas)
}

/** Conteos y sha256 del manifest al día con los CSV; el resto lo escribe extraer.ts. */
function actualizarManifest(todos: Record<string, unknown>[], tipoVacio: string[], fuenteSha: string) {
  const ruta = path.join(AQUI, 'manifest.json')
  if (!fs.existsSync(ruta)) return
  const m = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  const contar = (n: string) => parseCsv(fs.readFileSync(path.join(DATOS, n), 'utf8')).length
  m.conteos.indicadores = todos.length
  m.conteos.indicadores_mir = todos.filter(i => i.tipo === 'mir').length
  m.conteos.indicadores_gerenciales = todos.filter(i => i.tipo === 'gerencial').length
  m.conteos.fixtures_reportes = contar('fixtures_reportes.csv')
  m.conteos.equivalencias_prototipo = contar('equivalencias_prototipo.csv')
  m.pendientes.tipo_indicador_vacio = tipoVacio
  m.pendientes.jerarquia_con_padre = todos.filter(i => i.parent_codigo).length
  m.catalogo_fuente_sha256 = fuenteSha
  const archivos = new Map((m.archivos as { archivo: string; filas: number; sha256: string }[]).map(a => [a.archivo, a]))
  for (const n of ['gerencias.csv', 'unidades.csv', 'indicadores.csv', 'fixtures_reportes.csv', 'equivalencias_prototipo.csv']) {
    archivos.set(`datos/${n}`, { archivo: `datos/${n}`, filas: contar(n), sha256: sha(path.join(DATOS, n)) })
  }
  m.archivos = [...archivos.values()]
  fs.writeFileSync(ruta, JSON.stringify(m, null, 2) + '\n', 'utf8')
}

// ── Main ────────────────────────────────────────────────────────────────────

const csvArg = process.argv[2]
const REPO = path.resolve(RAIZ, '..')  // un nivel arriba de mir-comapa-sur
const csvPath = csvArg
  ? path.resolve(csvArg)
  : fs.existsSync(path.join(RAIZ, '2026.09.14-MIR-COMAPA_UNIFICADA.csv'))
    ? path.join(RAIZ, '2026.09.14-MIR-COMAPA_UNIFICADA.csv')
    : fs.existsSync(path.join(REPO, '2026.09.14-MIR-COMAPA_UNIFICADA.csv'))
      ? path.join(REPO, '2026.09.14-MIR-COMAPA_UNIFICADA.csv')
      : path.join(REPO, '..', '2026.09.14-MIR-COMAPA_UNIFICADA.csv')

if (!fs.existsSync(csvPath)) {
  console.error(`No se encontró el CSV: ${csvPath}`)
  process.exit(1)
}

console.log(`Leyendo: ${csvPath}`)
const { indicadoresMir, discrepancias, correcciones, advertencias } = transformar(csvPath)
console.log(`  MIR transformados: ${indicadoresMir.length}`)

const gerenciales = leerGerencialesExistentes()
console.log(`  Gerenciales conservados: ${gerenciales.length}`)

const todos = [...indicadoresMir, ...gerenciales].sort((a, b) =>
  colar(a.codigo as string, b.codigo as string))

const info = escribirCsv('indicadores.csv', todos)
console.log(`  Escritos en datos/indicadores.csv: ${info.filas} filas (sha256: ${info.sha256.slice(0, 12)}…)`)

const reasignacion = reasignarFixtures(todos)
const infoFixtures = escribirCsv('fixtures_reportes.csv', reasignacion.fixtures)
console.log(`  Escritos en datos/fixtures_reportes.csv: ${infoFixtures.filas} filas (${reasignacion.descartadas.length} descartadas)`)

const equivalencias = calcularEquivalencias(todos)
escribirCsv('equivalencias_prototipo.csv', equivalencias as unknown as Record<string, unknown>[])
console.log(`  Escritos en datos/equivalencias_prototipo.csv: ${equivalencias.length} filas (${equivalencias.filter(e => !e.codigo).length} sin equivalente)`)

actualizarGerencias(todos)
const fuenteSha = sha(csvPath)
actualizarManifest(todos, indicadoresMir.filter(i => !i.tipo_indicador).map(i => i.codigo as string), fuenteSha)
console.log('  Conteos de gerencias.csv y manifest.json al día')

const conciliacion = generarConciliacion(csvPath, indicadoresMir, gerenciales, discrepancias, correcciones, advertencias, reasignacion, equivalencias, fuenteSha)
fs.writeFileSync(path.join(AQUI, 'CONCILIACION.md'), conciliacion, 'utf8')
console.log(`  Reporte: db/semilla/CONCILIACION.md`)

if (discrepancias.length > 0) {
  console.log(`\n⚠  ${discrepancias.length} discrepancia(s):`)
  for (const d of discrepancias) console.log(`   Id=${d.id} ${d.campo}: ${d.detalle}`)
}

if (advertencias.length > 0) {
  console.log(`\n⚠  ${advertencias.length} advertencia(s):`)
  for (const a of advertencias) console.log(`   ${a}`)
}

console.log(`\nSiguiente paso: db/sembrar.sh --catalogo   (sobre una base del sprint 1)`)
