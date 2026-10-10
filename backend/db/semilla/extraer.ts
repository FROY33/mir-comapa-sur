#!/usr/bin/env node
/**
 * TEC-04 — Extrae el dataset de origen de los archivos del prototipo y lo deja
 * listo para el esquema de TEC-02.
 *
 * Emite CSV (revisión humana), un bundle JSON (consumo del cargador) y un
 * manifest con conteos, sha256 y verificaciones. Determinista: misma entrada,
 * mismos bytes. Las filas se ordenan por clave natural (soporte de CA-3).
 *
 * Uso:  node backend/db/semilla/extraer.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  GERENCIAS, ROLES, NIVELES, FRECUENCIAS, TIPOS_INDICADOR, ESTADOS_REPORTE,
  MESES_POR_FRECUENCIA, DIAS_HABILES_POR_FRECUENCIA,
  claveGerencia, gerenciasSinAlias, traducir,
} from './mapeos.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '../../..');     // raíz del repo: ahí viven los archivos del prototipo
const DATOS = path.join(AQUI, 'datos')

/** Ejercicio y corte de referencia del prototipo (los datos son de Q3 2026). */
const EJERCICIO = 2026
const CORTE = '2026-09-30'

// ── Carga de los archivos del prototipo ──────────────────────────────────────
// Son scripts de navegador, no módulos: se evalúan en un scope aislado con stubs
// de window/document/localStorage para extraer la variable global que declaran.
function cargar<T>(archivoRelativo: string, nombreVariable: string): T[] {
  const code = fs.readFileSync(path.join(RAIZ, archivoRelativo), 'utf8')
  const noop = () => {}
  const almacen = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop }
  const ventana: Record<string, unknown> = { location: { href: '' }, addEventListener: noop, localStorage: almacen }
  const documento = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] }
  const fn = new Function('window', 'document', 'localStorage', 'location',
    `${code}\n; return typeof ${nombreVariable} !== "undefined" ? ${nombreVariable} : (window.${nombreVariable} || null);`)
  const valor = fn(ventana, documento, almacen, ventana.location) as T[] | null
  if (!valor) throw new Error(`No se pudo extraer ${nombreVariable} de ${archivoRelativo}`)
  return valor
}

const src = {
  operativos:  cargar<any>('mir-actividades-data.js', 'ACTIVIDADES_ENLACE'),
  gerenciales: cargar<any>('mir-gerencial-data.js', 'ACTIVIDADES_GERENCIA'),
  catGerencias: cargar<any>('mir-gerencias-data.js', 'GERENCIAS_MIR'),
  catalogoMir: cargar<any>('data/mir-comapa-sur.js', 'MIR_DATA'),
  usuarios:    cargar<any>('session.js', 'MOCK_USERS'),
}

// ── Utilidades ───────────────────────────────────────────────────────────────
const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const cuenta = <T>(a: T[], f: (x: T) => string) =>
  a.reduce<Record<string, number>>((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {})
const colar = (a: string, b: string) => a.localeCompare(b, 'es')

function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const salidas: { archivo: string; filas?: number; sha256: string }[] = []

function escribirCsv(nombre: string, filas: Record<string, unknown>[]) {
  const primera = filas[0]
  if (primera === undefined) throw new Error(`${nombre}: no hay filas que escribir`)
  const columnas = Object.keys(primera)
  const texto = [columnas.join(','), ...filas.map(f => columnas.map(c => celda(f[c])).join(','))].join('\n') + '\n'
  fs.writeFileSync(path.join(DATOS, nombre), texto, 'utf8')
  salidas.push({ archivo: `datos/${nombre}`, filas: filas.length, sha256: sha(texto) })
}

// ── Fechas (sin dependencias; todo en UTC para que no dependa del huso) ──────
const iso = (d: Date) => d.toISOString().slice(0, 10)
const finDeMes = (anio: number, mes1: number) => new Date(Date.UTC(anio, mes1, 0))
const masDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
const esHabil = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

/** El n-ésimo día hábil contando desde `desde` inclusive. */
function diaHabil(desde: Date, n: number): Date {
  let d = new Date(desde), vistos = esHabil(d) ? 1 : 0
  while (vistos < n) { d = masDias(d, 1); if (esHabil(d)) vistos++; }
  return d
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Etiqueta del periodo. Sigue las formas documentadas en estructura-datos-flujo.md. */
function etiqueta(frecuencia: string, numero: number, inicio: Date): string {
  switch (frecuencia) {
    case 'mensual':       return `${MESES_ES[inicio.getUTCMonth()]}-${EJERCICIO}`
    case 'bimestral':     return `B${numero}-${EJERCICIO}`
    case 'trimestral':    return `T${numero}-${EJERCICIO}`
    case 'cuatrimestral': return `C${numero}-${EJERCICIO}`
    case 'semestral':     return `S${numero}-${EJERCICIO}`
    default:              return String(EJERCICIO)
  }
}

// ── 1. Gerencias ─────────────────────────────────────────────────────────────
const porGerenciaOp  = cuenta(src.operativos,  x => claveGerencia(x.gerencia))
const porGerenciaGer = cuenta(src.gerenciales, x => claveGerencia(x.gerencia))
const porGerenciaMir = cuenta(src.catalogoMir, x => claveGerencia(x.gerencia))
const catPorClave = new Map(src.catGerencias.map(g => [claveGerencia(g.gerenciaName || g.nombre), g]))

const filasGerencias = GERENCIAS.map(g => {
  const cat = catPorClave.get(g.clave)
  return {
    clave: g.clave,                                       // ← CLAVE NATURAL · gerencias.clave
    nombre: g.nombre,                                     // gerencias.nombre
    titular_nombre: '',                                   // gerencias.titular_nombre — firma de PDF, no está en el prototipo
    titular_cargo: '',
    activo: g.activo,                                     // gerencias.activo
    indicadores_mir: porGerenciaOp[g.clave] || 0,         // ↓ columnas de revisión, no van a la tabla
    indicadores_gerenciales: porGerenciaGer[g.clave] || 0,
    indicadores_catalogo_193: porGerenciaMir[g.clave] || 0,
    confirmacion_institucional: 'PENDIENTE',               // ← requisito CA-1
  }
}).sort((a, b) => colar(a.clave, b.clave))

// ── 2. Unidades ──────────────────────────────────────────────────────────────
// No existen como catálogo en ninguna fuente: se derivan del texto libre de los
// indicadores. Ver INCONSISTENCIAS.md §6.
interface Unidad { gerencia_clave: string; nombre: string; op: number; ger: number; usr: number; }
const unidades = new Map<string, Unidad>()

function registrarUnidad(gerencia: unknown, nombre: unknown, origen: 'op' | 'ger' | 'usr') {
  if (!nombre) return
  const gc = claveGerencia(gerencia)
  const n = String(nombre).trim()
  const llave = `${gc}||${n}`
  if (!unidades.has(llave)) unidades.set(llave, { gerencia_clave: gc, nombre: n, op: 0, ger: 0, usr: 0 })
  unidades.get(llave)![origen]++
}
src.operativos.forEach(x => registrarUnidad(x.gerencia, x.unidadResponsable, 'op'))
src.gerenciales.forEach(x => registrarUnidad(x.gerencia, x.area, 'ger'))
// Una unidad citada por un usuario también es una unidad real, aunque ningún
// indicador la referencie (es el caso de Gerencia General).
src.usuarios.forEach(x => registrarUnidad(x.gerencia, x.unidadResponsable, 'usr'))

// unidades.es_coord_general: índice único parcial, máximo una por gerencia
const esCoordGeneral = (n: string) => /^Coordinaci[oó]n General\b/i.test(n)

const filasUnidades = [...unidades.values()].map(u => ({
  gerencia_clave: u.gerencia_clave,                       // ← CLAVE NATURAL (compuesta) · FK a gerencias
  nombre: u.nombre,                                       // ← CLAVE NATURAL (compuesta) · UNIQUE (gerencia_id, nombre)
  es_coord_general: esCoordGeneral(u.nombre),             // unidades.es_coord_general
  activo: true,
  indicadores_mir: u.op,                                  // ↓ columnas de revisión
  indicadores_gerenciales: u.ger,
  solo_citada_por_usuarios: u.op === 0 && u.ger === 0,
  confirmacion_institucional: 'PENDIENTE',                // ← requisito CA-1
})).sort((a, b) => colar(a.gerencia_clave, b.gerencia_clave) || colar(a.nombre, b.nombre))

/** Coordinación General de cada gerencia, para los usuarios sin unidad asignada. */
const coordGeneralDe = new Map<string, string>()
for (const u of filasUnidades) if (u.es_coord_general) coordGeneralDe.set(u.gerencia_clave, u.nombre)

// ── 3. Usuarios ──────────────────────────────────────────────────────────────
// usuarios.unidad_id es NOT NULL con FK compuesta (unidad_id, gerencia_id): todo
// usuario necesita una unidad de su propia gerencia. 6 del prototipo no la traen
// se les asigna la Coordinación General y queda marcado. Ver INCONSISTENCIAS.md §12.
const rolesSinTraduccion = new Set<string>()

const filasUsuarios = src.usuarios.map(u => {
  const gc = claveGerencia(u.gerencia)
  const propia = u.unidadResponsable ? String(u.unidadResponsable).trim() : ''
  const porDefecto = !propia
  const unidad = propia || coordGeneralDe.get(gc) || ''
  return {
    email: String(u.email).toLowerCase(),                 // ← CLAVE NATURAL · usuarios.email (citext UNIQUE)
    nombre: u.nombre,
    rol: traducir(ROLES, u.rol, rolesSinTraduccion),      // usuarios.rol
    gerencia_clave: gc,                                   // FK a gerencias
    unidad_nombre: unidad,                                // FK compuesta con gerencia_clave
    unidad_por_defecto: porDefecto,                       // ← marca de auditoría: la unidad la puso el extractor
    debe_cambiar_password: true,                          // usuarios.debe_cambiar_password
    activo: true,
    iniciales: u.iniciales || '',
    id_prototipo: u.id,
    gerencia_texto_origen: u.gerencia || '',
    // La contraseña NO se exporta: el hash bcrypt (≥12 rondas) lo genera el cargador. CA-2.
  }
}).sort((a, b) => colar(a.email, b.email))

// ── 4. Indicadores (MIR + gerenciales en una sola tabla, como el esquema) ────
const nivelesSinTraduccion = new Set<string>()
const frecuenciasSinTraduccion = new Set<string>()
const tiposSinTraduccion = new Set<string>()

interface FilaIndicador extends Record<string, unknown> {
  codigo: string; gerencia_clave: string; numero: string; frecuencia: string
}

const indicadoresMir: FilaIndicador[] = src.operativos.map(x => {
  const tieneDenominador = Boolean(x.denominador)
  return {
    codigo: String(x.id),                                 // ← CLAVE NATURAL · indicadores.codigo (UNIQUE)
    tipo: 'mir',                                          // indicadores.tipo
    gerencia_clave: claveGerencia(x.gerencia),
    unidad_nombre: x.unidadResponsable ? String(x.unidadResponsable).trim() : '',
    parent_codigo: '',                                    // se calcula abajo
    nivel: traducir(NIVELES, x.nivel, nivelesSinTraduccion),
    numero: x.numeroIndicador ? String(x.numeroIndicador) : '',
    nombre: x.nombreIndicador,
    resumen_narrativo: x.resumenNarrativo,
    tipo_indicador: traducir(TIPOS_INDICADOR, x.tipoIndicador, tiposSinTraduccion),
    unidad_medida: x.unidadMedida,
    frecuencia: traducir(FRECUENCIAS, x.frecuenciaMedicion, frecuenciasSinTraduccion),
    tipo_calculo: tieneDenominador ? 'fraccion' : 'valor_directo',
    formula: '',                                          // metodoCalculo solo existe en el catálogo de 193
    numerador_desc: x.numerador,
    denominador_desc: x.denominador,
    denominador_fijo: x.denominadorFijo ? x.denomFijoVal : '',
    acumulable: false,                                    // no está en el prototipo; default del esquema
    sentido_meta: 'ascendente',                           // idem; DECISIONES.md pregunta 24e
    medio_verificacion: x.medioVerificacion,
    origen_mv: '',                                        // solo existe en el catálogo de 193
    supuestos: x.supuestos,
    es_iso: Boolean(x.iso),                               // indicadores.es_iso
    iso_codigo: x.iso || '',                              // ← el esquema no lo guarda. Ver INCONSISTENCIAS.md §13
    observaciones_mir: x.observacionesMIR,
    activo: true,
    meta_anual_prototipo: x.metaAnual ?? '',              // METAS está fuera de S1; se conserva como insumo
    linea_base_prototipo: x.lineaBase ?? '',
  }
})

const indicadoresGerenciales: FilaIndicador[] = src.gerenciales.map(x => ({
  codigo: String(x.id),                                   // ← CLAVE NATURAL
  tipo: 'gerencial',
  gerencia_clave: claveGerencia(x.gerencia),
  unidad_nombre: x.area ? String(x.area).trim() : '',
  parent_codigo: '',
  nivel: '',                                              // CHECK (tipo = 'gerencial' OR nivel IS NOT NULL)
  numero: '',
  nombre: x.nombreIndicador,
  resumen_narrativo: '',
  tipo_indicador: '',
  unidad_medida: x.unidadMedida,
  frecuencia: traducir(FRECUENCIAS, x.frecuenciaMedicion, frecuenciasSinTraduccion),
  tipo_calculo: x.tieneDenominador ? 'fraccion' : 'valor_directo',
  formula: '', numerador_desc: x.numerador, denominador_desc: x.denominador ?? '',
  denominador_fijo: '', acumulable: false, sentido_meta: 'ascendente',
  medio_verificacion: '', origen_mv: '', supuestos: '',
  es_iso: false, iso_codigo: '', observaciones_mir: '', activo: true,
  meta_anual_prototipo: '', linea_base_prototipo: '',
}))

// indicadores.parent_id — jerarquía por numeroIndicador ('1.1.1' cuelga de '1.1')
// dentro de la misma gerencia. El esquema la modela; el prototipo no la trae explícita.
const porNumero = new Map<string, string[]>()
for (const i of indicadoresMir) {
  if (!i.numero) continue
  const llave = `${i.gerencia_clave}||${i.numero}`
  if (!porNumero.has(llave)) porNumero.set(llave, [])
  porNumero.get(llave)!.push(i.codigo)
}
const numerosAmbiguos = [...porNumero.entries()].filter(([, c]) => c.length > 1)
const huerfanosJerarquia: string[] = []

// La jerarquía NO es «quitar el último segmento»: el prototipo numera el Propósito
// como '1', el Componente como '1.2.1' y sus Actividades como '1.2.2', '1.2.3'…
// — las actividades son hermanas del componente, no sus hijas por prefijo.
//   actividad  a.b.c  -> componente a.b.1
//   componente a.b.1  -> propósito   a
// Regla inferida de la estructura observada, no confirmada por el RQM.
// Ver INCONSISTENCIAS.md §15.
function numeroDelPadre(nivel: string, numero: string): string | null {
  const [a, b] = numero.split('.')
  const segmentos = numero.split('.').length
  if (a === undefined) return null
  if (nivel === 'actividad' && segmentos === 3 && b !== undefined) return `${a}.${b}.1`
  if (nivel === 'componente' && segmentos === 3) return a
  return null;                                            // propósito, fin, o numeración fuera de patrón
}

for (const i of indicadoresMir) {
  if (!i.numero) continue
  const padre = numeroDelPadre(String(i.nivel), String(i.numero))
  if (padre === null) continue
  if (padre === i.numero) continue;                       // un componente a.b.1 no es su propio padre
  const candidatos = porNumero.get(`${i.gerencia_clave}||${padre}`)
  const unico = candidatos?.length === 1 ? candidatos[0] : undefined
  if (unico !== undefined) i.parent_codigo = unico
  else huerfanosJerarquia.push(`${i.codigo} nivel=${i.nivel} numero=${i.numero} (busca ${i.gerencia_clave} ${padre})`)
}

const filasIndicadores = [...indicadoresMir, ...indicadoresGerenciales]
  .sort((a, b) => colar(a.codigo, b.codigo))

// ── 5. Catálogo MIR de 193 (esquema propio, no empalma; §3) ─────────────────
const filasCatalogo193 = src.catalogoMir.map(x => ({
  codigo: String(x.id),                                   // ← CLAVE NATURAL (espacio de IDs propio)
  gerencia_clave: claveGerencia(x.gerencia),
  orden: x.orden,
  nivel: traducir(NIVELES, x.nivel, nivelesSinTraduccion),
  nombre: x.denominacionIndicador,
  objetivo: x.objetivo,
  formula: x.metodoCalculo,
  numerador_desc: x.numerador,
  denominador_desc: x.denominador,
  tipo_calculo: x.tieneDenominador ? 'fraccion' : 'valor_directo',
  unidad_medida: x.unidadMedida,
  frecuencia: traducir(FRECUENCIAS, x.frecuenciaMedicion, frecuenciasSinTraduccion),
  origen_mv: x.medioVerificacionTipo ? String(x.medioVerificacionTipo).toLowerCase() : '',
  medio_verificacion: x.medioVerificacionNombre,
  medio_verificacion_fuente: x.medioVerificacionFuente,
  supuestos: x.supuestos,
}))
  .sort((a, b) => colar(a.codigo, b.codigo))

// ── 6. Periodos de reporte (los «ciclos» del checklist de TEC-04) ───────────
// reportes tiene FK compuesta (periodo_id, frecuencia): un reporte solo cabe en un
// periodo de la misma frecuencia que su indicador. Hacen falta los periodos de las
// seis frecuencias, no solo T3-2026. Ver INCONSISTENCIAS.md §14.
const frecuenciasUsadas = [...new Set(filasIndicadores.map(i => i.frecuencia).filter(Boolean))]

const filasPeriodos = Object.keys(MESES_POR_FRECUENCIA)
  .filter(f => frecuenciasUsadas.includes(f))
  .flatMap(frecuencia => {
    const meses = MESES_POR_FRECUENCIA[frecuencia] ?? 1
    const dias = DIAS_HABILES_POR_FRECUENCIA[frecuencia] ?? 10
    return Array.from({ length: 12 / meses }, (_, k) => {
      const numero = k + 1
      const inicio = new Date(Date.UTC(EJERCICIO, (numero - 1) * meses, 1))
      const fin = finDeMes(EJERCICIO, numero * meses)
      const abre = masDias(fin, 1)
      return {
        frecuencia,                                       // ← CLAVE NATURAL (compuesta) · FK a frecuencias
        ejercicio: EJERCICIO,                             // ← CLAVE NATURAL (compuesta)
        numero,                                           // ← CLAVE NATURAL (compuesta) · UNIQUE (frecuencia, ejercicio, numero)
        etiqueta: etiqueta(frecuencia, numero, inicio),
        inicio_periodo: iso(inicio),
        fin_periodo: iso(fin),
        abre_captura: iso(abre),
        // fecha_limite: días hábiles de la frecuencia contados de lunes a viernes,
        // sin calendario de festivos (limitación conocida de S1).
        fecha_limite: iso(diaHabil(abre, dias)),
        estado: iso(fin) <= CORTE ? 'abierto' : 'abierto', // S1 los crea abiertos; el cierre es acción del Admin
      }
    })
  })
  .sort((a, b) => colar(a.frecuencia, b.frecuencia) || a.numero - b.numero)

/** Último periodo de cada frecuencia que ya concluyó al corte. */
const periodoDeCorte = new Map<string, typeof filasPeriodos[number]>()
for (const p of filasPeriodos) {
  if (p.fin_periodo > CORTE) continue
  const previo = periodoDeCorte.get(p.frecuencia)
  if (!previo || p.fin_periodo > previo.fin_periodo) periodoDeCorte.set(p.frecuencia, p)
}
// Frecuencias cuyo primer periodo no concluye al corte (anual): se usa el primero.
const sinPeriodoConcluido: string[] = []
for (const f of frecuenciasUsadas) {
  if (periodoDeCorte.has(f)) continue
  sinPeriodoConcluido.push(f)
  periodoDeCorte.set(f, filasPeriodos.find(p => p.frecuencia === f)!)
}

// ── 7. Fixtures de reporte — SOLO PRUEBAS (CA-4) ────────────────────────────
const estadosFueraCatalogo = new Set<string>()
const nombresConCuenta = new Map(filasUsuarios.map(u => [u.nombre, u.email]))

const filasFixtures = src.operativos.map(x => {
  const i = indicadoresMir.find(m => m.codigo === String(x.id))!
  const periodo = periodoDeCorte.get(i.frecuencia)
  const estado = String(x.estado || 'pendiente_carga')
  if (!ESTADOS_REPORTE.has(estado)) estadosFueraCatalogo.add(estado)
  const cerrado = estado === 'cerrado' || estado === 'incumplido'
  const enviado = ['enviado_revision', 'observado', 'corregido', 'aprobado_revisor', 'regresado_correccion'].includes(estado)
  const fecha = x.ultimaActualizacion || CORTE
  return {
    indicador_codigo: String(x.id),                       // ← CLAVE NATURAL (compuesta) · UNIQUE (indicador_id, periodo_id)
    periodo_frecuencia: i.frecuencia,                     // ← CLAVE NATURAL (compuesta), resuelve periodo_id
    periodo_numero: periodo ? periodo.numero : '',
    periodo_etiqueta: periodo ? periodo.etiqueta : '',
    periodo_prototipo: x.periodo || '',                   // lo que decía el prototipo, para auditar el remapeo
    estado,
    // Los CHECK de reportes exigen estas marcas según el estado.
    enviado_at: enviado || cerrado ? `${fecha} 12:00:00-06` : '',
    enviado_por_email: nombresConCuenta.get(x.responsableEnlace) || '',
    cerrado_at: cerrado ? `${fecha} 12:00:00-06` : '',
    cerrado_por_email: '',                                // cierra el Admin; se resuelve en el cargador
    vencido: false,
    vencido_at: '',
    numerador: x.numeradorVal ?? '',
    denominador: x.denominadorVal ?? '',
    avance: x.avancePeriodo ?? '',
    responsable_enlace_prototipo: x.responsableEnlace || '',
    responsable_revisor_prototipo: x.responsableRevisor || '',
    archivos_evidencia: (x.archivosEvidencia || []).length,
    observaciones: (x.observaciones || []).length,
    eventos_historial: (x.historial || []).length,
  }
}).sort((a, b) => colar(a.indicador_codigo, b.indicador_codigo))

// ── Escritura ────────────────────────────────────────────────────────────────
escribirCsv('gerencias.csv', filasGerencias)
escribirCsv('unidades.csv', filasUnidades)
escribirCsv('usuarios.csv', filasUsuarios)
escribirCsv('indicadores.csv', filasIndicadores)
escribirCsv('periodos.csv', filasPeriodos)
escribirCsv('catalogo_mir_193.csv', filasCatalogo193)
escribirCsv('fixtures_reportes.csv', filasFixtures)

for (const obsoleto of ['indicadores_operativos.csv', 'indicadores_gerenciales.csv']) {
  const p = path.join(DATOS, obsoleto)
  if (fs.existsSync(p)) fs.unlinkSync(p);                 // ahora van juntos en indicadores.csv
}

const CLAVES_NATURALES = {
  gerencias: ['clave'],
  unidades: ['gerencia_clave', 'nombre'],
  usuarios: ['email'],
  indicadores: ['codigo'],
  periodos: ['frecuencia', 'ejercicio', 'numero'],
  catalogo_mir_193: ['codigo'],
  fixtures_reportes: ['indicador_codigo', 'periodo_frecuencia', 'periodo_numero'],
}

const bundle = {
  _meta: {
    descripcion: 'Dataset de origen TEC-04, extraído del prototipo y mapeado al esquema de TEC-02.',
    generadoPor: 'backend/db/semilla/extraer.ts',
    ejercicio: EJERCICIO,
    corte: CORTE,
    clavesNaturales: CLAVES_NATURALES,
    advertencia: 'gerencias y unidades están en confirmacion_institucional=PENDIENTE: CA-1 no se cumple hasta que Planeación Estratégica las confirme. fixtures_reportes es solo para pruebas (CA-4).',
  },
  gerencias: filasGerencias, unidades: filasUnidades, usuarios: filasUsuarios,
  indicadores: filasIndicadores, periodos: filasPeriodos,
  catalogo_mir_193: filasCatalogo193, fixtures_reportes: filasFixtures,
}
const textoJson = JSON.stringify(bundle, null, 2) + '\n'
fs.writeFileSync(path.join(AQUI, 'semilla.json'), textoJson, 'utf8')
salidas.push({ archivo: 'semilla.json', sha256: sha(textoJson) })

// ── Verificación ─────────────────────────────────────────────────────────────
const clavesGerencia = new Set(filasGerencias.map(g => g.clave))
const clavesUnidad = new Set(filasUnidades.map(u => `${u.gerencia_clave}||${u.nombre}`))
const codigos = new Set(filasIndicadores.map(i => i.codigo))

const verificacion = {
  generado: new Date().toISOString().slice(0, 10),
  ejercicio: EJERCICIO,
  corte: CORTE,
  conteos: {
    gerencias: filasGerencias.length, unidades: filasUnidades.length,
    usuarios: filasUsuarios.length, indicadores: filasIndicadores.length,
    indicadores_mir: indicadoresMir.length, indicadores_gerenciales: indicadoresGerenciales.length,
    periodos: filasPeriodos.length, catalogo_mir_193: filasCatalogo193.length,
    fixtures_reportes: filasFixtures.length,
  },
  integridad: {
    gerencias_desconocidas: [...new Set(
      [...filasUnidades, ...filasUsuarios, ...filasIndicadores]
        .map(r => r.gerencia_clave as string).filter(g => !clavesGerencia.has(g)))],
    unidades_desconocidas: [...new Set(
      [...filasUsuarios.map(u => `${u.gerencia_clave}||${u.unidad_nombre}`),
       ...filasIndicadores.map(i => `${i.gerencia_clave}||${i.unidad_nombre}`)]
        .filter(k => !k.endsWith('||') && !clavesUnidad.has(k)))],
    fixtures_sin_indicador: filasFixtures.filter(f => !codigos.has(f.indicador_codigo)).map(f => f.indicador_codigo),
    parent_codigo_desconocido: filasIndicadores.filter(i => i.parent_codigo && !codigos.has(i.parent_codigo as string)).map(i => i.codigo),
    codigos_duplicados: Object.entries(cuenta(filasIndicadores, i => i.codigo)).filter(([, n]) => n > 1),
    emails_duplicados: Object.entries(cuenta(filasUsuarios, u => u.email)).filter(([, n]) => n > 1),
  },
  mapeos_sin_traduccion: {
    gerencias: [...gerenciasSinAlias].sort(),
    roles: [...rolesSinTraduccion].sort(),
    niveles: [...nivelesSinTraduccion].sort(),
    frecuencias: [...frecuenciasSinTraduccion].sort(),
    tipos_indicador: [...tiposSinTraduccion].sort(),
    estados_reporte: [...estadosFueraCatalogo].sort(),
  },
  pendientes: {
    usuarios_por_rol: cuenta(filasUsuarios, u => u.rol),
    gerencias_activas_sin_revisor: filasGerencias
      .filter(g => g.activo && !filasUsuarios.some(u => u.rol === 'revisor' && u.gerencia_clave === g.clave))
      .map(g => g.clave),
    usuarios_con_unidad_por_defecto: filasUsuarios.filter(u => u.unidad_por_defecto).map(u => u.email),
    responsables_revisor_sin_cuenta: [...new Set(filasFixtures
      .map(f => f.responsable_revisor_prototipo).filter(n => n && !nombresConCuenta.has(n)))].sort(),
    responsables_enlace_sin_cuenta: [...new Set(filasFixtures
      .map(f => f.responsable_enlace_prototipo).filter(n => n && !nombresConCuenta.has(n)))].sort(),
    fixtures_sin_enviado_por: filasFixtures.filter(f => f.enviado_at && !f.enviado_por_email).length,
    jerarquia_con_padre: filasIndicadores.filter(i => i.parent_codigo).length,
    jerarquia_sin_padre: huerfanosJerarquia,
    numeros_ambiguos: numerosAmbiguos.map(([k, c]) => `${k} -> ${c.join(', ')}`),
    frecuencias_sin_periodo_concluido: sinPeriodoConcluido,
    indicadores_sin_unidad: filasIndicadores.filter(i => !i.unidad_nombre).length,
    unidades_solo_citadas_por_usuarios: filasUnidades
      .filter(u => u.solo_citada_por_usuarios).map(u => `${u.gerencia_clave}||${u.nombre}`),
    tipo_indicador_vacio: filasIndicadores.filter(i => i.tipo === 'mir' && !i.tipo_indicador).map(i => i.codigo),
    remapeo_de_periodo: Object.entries(cuenta(
      filasFixtures.filter(f => f.periodo_prototipo && f.periodo_prototipo !== f.periodo_etiqueta),
      f => `${f.periodo_prototipo} -> ${f.periodo_etiqueta}`)),
  },
  archivos: salidas,
}

fs.writeFileSync(path.join(AQUI, 'manifest.json'), JSON.stringify(verificacion, null, 2) + '\n', 'utf8')
console.log('Dataset generado en backend/db/semilla/\n')
console.log(JSON.stringify({ conteos: verificacion.conteos, integridad: verificacion.integridad, mapeos_sin_traduccion: verificacion.mapeos_sin_traduccion }, null, 2))
