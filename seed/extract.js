#!/usr/bin/env node
/**
 * TEC-04 — Extractor del dataset de origen desde los archivos del prototipo.
 *
 * Lee los archivos de datos del prototipo (que son la única fuente de verdad
 * actual del proyecto) y emite un dataset de origen versionado, independiente
 * del esquema de base de datos que defina TEC-02.
 *
 * Determinista: misma entrada -> mismos bytes de salida. Las filas se ordenan
 * por clave natural y el manifest registra sha256 por archivo, de modo que
 * dos ejecuciones son comparables (soporte para CA-3, idempotencia).
 *
 * Uso:  node seed/extract.js          (desde la raíz del repo)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT_CSV = path.join(__dirname, 'csv');
const OUT_JSON = path.join(__dirname, 'json');

// ─────────────────────────────────────────────────────────────────────────────
// Carga de los archivos del prototipo
//
// Los archivos de datos son scripts de navegador, no módulos. Se evalúan en un
// scope aislado con stubs de window/document/localStorage para extraer la
// variable global que declaran, sin ejecutar lógica de UI.
// ─────────────────────────────────────────────────────────────────────────────
function cargar(archivoRelativo, nombreVariable) {
  const code = fs.readFileSync(path.join(ROOT, archivoRelativo), 'utf8');
  const noop = () => {};
  const almacen = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
  const ventana = { location: { href: '' }, addEventListener: noop, localStorage: almacen };
  const documento = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] };
  const fn = new Function(
    'window', 'document', 'localStorage', 'location',
    `${code}\n; return typeof ${nombreVariable} !== "undefined" ? ${nombreVariable} : (window.${nombreVariable} || null);`
  );
  const valor = fn(ventana, documento, almacen, ventana.location);
  if (!valor) throw new Error(`No se pudo extraer ${nombreVariable} de ${archivoRelativo}`);
  return valor;
}

const FUENTES = {
  indicadoresOperativos: ['mir-actividades-data.js', 'ACTIVIDADES_ENLACE'],
  indicadoresGerenciales: ['mir-gerencial-data.js', 'ACTIVIDADES_GERENCIA'],
  catalogoGerencias:      ['mir-gerencias-data.js', 'GERENCIAS_MIR'],
  catalogoMir:            ['data/mir-comapa-sur.js', 'MIR_DATA'],
  usuarios:               ['session.js', 'MOCK_USERS'],
};

const src = {};
for (const [clave, [archivo, variable]] of Object.entries(FUENTES)) {
  src[clave] = cargar(archivo, variable);
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de gerencias
//
// Las fuentes escriben el nombre de la gerencia de tres formas distintas
// ("Técnica", "Gerencia Técnica", "Gerencia de Planeación Estratégica").
// Se resuelven todas a una clave natural estable.
// ─────────────────────────────────────────────────────────────────────────────
const GERENCIAS = [
  { clave: 'planeacion',     nombreOficial: 'Gerencia de Planeación Estratégica', alias: ['Planeación Estratégica', 'Gerencia de Planeación Estratégica', 'Gerencia Planeación Estratégica'] },
  { clave: 'comercial',      nombreOficial: 'Gerencia Comercial',                 alias: ['Comercial', 'Gerencia Comercial'] },
  { clave: 'administrativa', nombreOficial: 'Gerencia Administrativa',            alias: ['Administrativa', 'Gerencia Administrativa'] },
  { clave: 'tecnica',        nombreOficial: 'Gerencia Técnica',                   alias: ['Técnica', 'Gerencia Técnica'] },
  { clave: 'general',        nombreOficial: 'Gerencia General',                   alias: ['General', 'Gerencia General'] },
];

const ALIAS_A_CLAVE = new Map();
for (const g of GERENCIAS) for (const a of g.alias) ALIAS_A_CLAVE.set(a.trim(), g.clave);

const sinResolver = new Set();
function claveGerencia(texto) {
  if (!texto) return '';
  const k = ALIAS_A_CLAVE.get(String(texto).trim());
  if (!k) sinResolver.add(String(texto).trim());
  return k || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
const NIVEL_POR_PREFIJO = { FIN: 'Fin', PROP: 'Propósito', COMP: 'Componente', ACT: 'Actividad' };

function nivelSegunId(id) {
  const partes = String(id || '').split('-');
  return NIVEL_POR_PREFIJO[partes[1]] || '';
}

function celdaCsv(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escribirCsv(nombre, columnas, filas) {
  const lineas = [columnas.join(',')];
  for (const fila of filas) lineas.push(columnas.map(c => celdaCsv(fila[c])).join(','));
  const contenido = lineas.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_CSV, nombre), contenido, 'utf8');
  return { archivo: `csv/${nombre}`, filas: filas.length, sha256: sha(contenido) };
}

function escribirJson(nombre, datos) {
  const contenido = JSON.stringify(datos, null, 2) + '\n';
  fs.writeFileSync(path.join(OUT_JSON, nombre), contenido, 'utf8');
  return { archivo: `json/${nombre}`, sha256: sha(contenido) };
}

const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const porClave = campo => (a, b) => String(a[campo]).localeCompare(String(b[campo]), 'es');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Gerencias
// ─────────────────────────────────────────────────────────────────────────────
const catGerenciaPorClave = new Map(src.catalogoGerencias.map(g => [claveGerencia(g.gerenciaName || g.nombre), g]));

const cuentaPor = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const opPorGerencia  = cuentaPor(src.indicadoresOperativos,  x => claveGerencia(x.gerencia));
const gerPorGerencia = cuentaPor(src.indicadoresGerenciales, x => claveGerencia(x.gerencia));
const mirPorGerencia = cuentaPor(src.catalogoMir,            x => claveGerencia(x.gerencia));

const filasGerencias = GERENCIAS.map(g => {
  const cat = catGerenciaPorClave.get(g.clave);
  return {
    gerencia_clave: g.clave,                                  // ← CLAVE NATURAL
    nombre_oficial: g.nombreOficial,
    nombre_corto: cat ? cat.nombre : '',
    descripcion: cat ? cat.descripcion : '',
    frecuencias: cat && cat.frecuencias ? cat.frecuencias.join('|') : '',
    en_catalogo_gerencias: Boolean(cat),
    indicadores_operativos: opPorGerencia[g.clave] || 0,
    indicadores_gerenciales: gerPorGerencia[g.clave] || 0,
    indicadores_catalogo_mir: mirPorGerencia[g.clave] || 0,
    confirmacion_institucional: 'PENDIENTE',                   // ← requisito CA-1
  };
}).sort(porClave('gerencia_clave'));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Unidades responsables
//
// No existen como catálogo en ninguna fuente: se derivan de los indicadores.
// Por eso ninguna queda confirmada institucionalmente (ver INCONSISTENCIAS.md).
// ─────────────────────────────────────────────────────────────────────────────
const unidades = new Map();
function registrarUnidad(gerencia, nombre, origen) {
  if (!nombre) return;
  const gclave = claveGerencia(gerencia);
  const llave = `${gclave}||${nombre}`;
  if (!unidades.has(llave)) {
    unidades.set(llave, { gerencia_clave: gclave, unidad_nombre: nombre, indicadores_operativos: 0, indicadores_gerenciales: 0, origen: new Set() });
  }
  const u = unidades.get(llave);
  u[origen === 'operativo' ? 'indicadores_operativos' : 'indicadores_gerenciales']++;
  u.origen.add(origen === 'operativo' ? 'mir-actividades-data.js' : 'mir-gerencial-data.js');
}

src.indicadoresOperativos.forEach(x => registrarUnidad(x.gerencia, x.unidadResponsable, 'operativo'));
src.indicadoresGerenciales.forEach(x => registrarUnidad(x.gerencia, x.area, 'gerencial'));

const filasUnidades = [...unidades.values()].map(u => ({
  gerencia_clave: u.gerencia_clave,                            // ← CLAVE NATURAL (compuesta)
  unidad_nombre: u.unidad_nombre,                              // ← CLAVE NATURAL (compuesta)
  indicadores_operativos: u.indicadores_operativos,
  indicadores_gerenciales: u.indicadores_gerenciales,
  derivada_de: [...u.origen].sort().join('|'),
  confirmacion_institucional: 'PENDIENTE',                      // ← requisito CA-1
})).sort((a, b) => a.gerencia_clave.localeCompare(b.gerencia_clave, 'es') || a.unidad_nombre.localeCompare(b.unidad_nombre, 'es'));

// ─────────────────────────────────────────────────────────────────────────────
// 3. Usuarios
//
// La contraseña del prototipo NO se exporta. El dataset de origen define
// identidad y asignación; el hash lo genera el procedimiento de carga (CA-2).
// ─────────────────────────────────────────────────────────────────────────────
const filasUsuarios = src.usuarios.map(u => ({
  email: u.email,                                              // ← CLAVE NATURAL
  nombre: u.nombre,
  iniciales: u.iniciales,
  rol: u.rol,
  gerencia_clave: claveGerencia(u.gerencia),
  gerencia_texto_origen: u.gerencia || '',
  gerencia_resuelta: Boolean(claveGerencia(u.gerencia)),
  unidad_responsable: u.unidadResponsable || '',
  id_prototipo: u.id,
  password_exportada: false,                                   // nunca true: ver CA-2
})).sort(porClave('email'));

// ─────────────────────────────────────────────────────────────────────────────
// 4. Indicadores operativos (definición MIR, sin estado de flujo)
// ─────────────────────────────────────────────────────────────────────────────
const filasIndicadores = src.indicadoresOperativos.map(x => {
  const nivelId = nivelSegunId(x.id);
  return {
    indicador_id: x.id,                                        // ← CLAVE NATURAL (candidata)
    gerencia_clave: claveGerencia(x.gerencia),
    unidad_nombre: x.unidadResponsable || '',
    no: x.no,
    numero_indicador: x.numeroIndicador,
    nivel_declarado: x.nivel,
    nivel_segun_prefijo_id: nivelId,
    nivel_coincide: nivelId ? nivelId === x.nivel : '',         // ← ver INCONSISTENCIAS.md §3
    iso: x.iso,
    nombre_indicador: x.nombreIndicador,
    resumen_narrativo: x.resumenNarrativo,
    tipo_indicador: x.tipoIndicador,
    unidad_medida: x.unidadMedida,
    frecuencia_medicion: x.frecuenciaMedicion,
    numerador: x.numerador,
    denominador: x.denominador,
    denominador_fijo: x.denominadorFijo,
    denominador_fijo_valor: x.denomFijoVal,
    medio_verificacion: x.medioVerificacion,
    supuestos: x.supuestos,
    linea_base: x.lineaBase,
    meta_anual: x.metaAnual,
    observaciones_mir: x.observacionesMIR,
  };
}).sort(porClave('indicador_id'));

// ─────────────────────────────────────────────────────────────────────────────
// 5. Indicadores gerenciales
// ─────────────────────────────────────────────────────────────────────────────
const filasGerenciales = src.indicadoresGerenciales.map(x => ({
  indicador_id: x.id,                                          // ← CLAVE NATURAL
  gerencia_clave: claveGerencia(x.gerencia),
  unidad_nombre: x.area || '',
  nombre_indicador: x.nombreIndicador,
  unidad_medida: x.unidadMedida,
  frecuencia_medicion: x.frecuenciaMedicion,
  tiene_denominador: x.tieneDenominador,
  numerador: x.numerador,
  denominador: x.denominador,
  nivel_declarado: '',                                          // la fuente no trae nivel: §4
})).sort(porClave('indicador_id'));

// ─────────────────────────────────────────────────────────────────────────────
// 6. Catálogo MIR completo (193 registros, esquema distinto, no empalma)
// ─────────────────────────────────────────────────────────────────────────────
const filasCatalogoMir = src.catalogoMir.map(x => ({
  indicador_id: x.id,                                          // ← CLAVE NATURAL (espacio de IDs propio)
  gerencia_clave: claveGerencia(x.gerencia),
  orden: x.orden,
  nivel: x.nivel,
  nivel_codigo: x.nivelCodigo,
  clave_componente: x.claveComponente,
  clave_actividad: x.claveActividad,
  denominacion_indicador: x.denominacionIndicador,
  objetivo: x.objetivo,
  metodo_calculo: x.metodoCalculo,
  numerador: x.numerador,
  denominador: x.denominador,
  tiene_denominador: x.tieneDenominador,
  unidad_medida: x.unidadMedida,
  frecuencia_medicion: x.frecuenciaMedicion,
  medio_verificacion_tipo: x.medioVerificacionTipo,
  medio_verificacion_nombre: x.medioVerificacionNombre,
  medio_verificacion_fuente: x.medioVerificacionFuente,
  linea_base: x.lineaBase,
  meta_anual: x.metaAnual,
  supuestos: x.supuestos,
}))
  .sort(porClave('indicador_id'));

// ─────────────────────────────────────────────────────────────────────────────
// 7. Fixtures de reporte — SEPARADAS de la definición (requisito CA-4)
// ─────────────────────────────────────────────────────────────────────────────
const filasFixtures = src.indicadoresOperativos.map(x => ({
  indicador_id: x.id,                                          // ← CLAVE NATURAL (compuesta)
  periodo: x.periodo || '',                                    // ← CLAVE NATURAL (compuesta)
  estado: x.estado || '',
  fecha_limite: x.fechaLimite || '',
  responsable_enlace: x.responsableEnlace || '',
  responsable_revisor: x.responsableRevisor || '',
  avance_periodo: x.avancePeriodo || '',
  numerador_valor: x.numeradorVal || '',
  denominador_valor: x.denominadorVal || '',
  ultima_actualizacion: x.ultimaActualizacion || '',
  archivos_evidencia: (x.archivosEvidencia || []).length,
  observaciones: (x.observaciones || []).length,
  eventos_historial: (x.historial || []).length,
})).sort((a, b) => a.indicador_id.localeCompare(b.indicador_id, 'es') || a.periodo.localeCompare(b.periodo, 'es'));

// ─────────────────────────────────────────────────────────────────────────────
// Escritura
// ─────────────────────────────────────────────────────────────────────────────
const CLAVES_NATURALES = {
  'gerencias':               ['gerencia_clave'],
  'unidades':                ['gerencia_clave', 'unidad_nombre'],
  'usuarios':                ['email'],
  'indicadores_operativos':  ['indicador_id'],
  'indicadores_gerenciales': ['indicador_id'],
  'catalogo_mir_193':        ['indicador_id'],
  'fixtures_reportes':       ['indicador_id', 'periodo'],
};

const salidas = [
  escribirCsv('gerencias.csv', Object.keys(filasGerencias[0]), filasGerencias),
  escribirCsv('unidades.csv', Object.keys(filasUnidades[0]), filasUnidades),
  escribirCsv('usuarios.csv', Object.keys(filasUsuarios[0]), filasUsuarios),
  escribirCsv('indicadores_operativos.csv', Object.keys(filasIndicadores[0]), filasIndicadores),
  escribirCsv('indicadores_gerenciales.csv', Object.keys(filasGerenciales[0]), filasGerenciales),
  escribirCsv('catalogo_mir_193.csv', Object.keys(filasCatalogoMir[0]), filasCatalogoMir),
  escribirCsv('fixtures_reportes.csv', Object.keys(filasFixtures[0]), filasFixtures),
];

salidas.push(escribirJson('seed.json', {
  _meta: {
    descripcion: 'Dataset de origen TEC-04, extraído de los archivos del prototipo. Independiente del esquema de BD.',
    generadoPor: 'seed/extract.js',
    clavesNaturales: CLAVES_NATURALES,
    advertencia: 'Las gerencias y unidades están marcadas confirmacion_institucional=PENDIENTE. No cargar en un entorno de demostración formal antes de resolver INCONSISTENCIAS.md §1 y §2.',
  },
  gerencias: filasGerencias,
  unidades: filasUnidades,
  usuarios: filasUsuarios,
  indicadores_operativos: filasIndicadores,
  indicadores_gerenciales: filasGerenciales,
  catalogo_mir_193: filasCatalogoMir,
  fixtures_reportes: filasFixtures,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Verificación automática — las cifras que sustentan INCONSISTENCIAS.md
// ─────────────────────────────────────────────────────────────────────────────
const nivelDesalineado = filasIndicadores.filter(x => x.nivel_coincide === false);
const usuariosSinGerencia = filasUsuarios.filter(x => !x.gerencia_resuelta);
const rolesPorGerencia = {};
for (const u of filasUsuarios) {
  const k = u.gerencia_clave || '(sin resolver)';
  (rolesPorGerencia[k] = rolesPorGerencia[k] || {})[u.rol] = (rolesPorGerencia[k][u.rol] || 0) + 1;
}
const gerenciasSinRevisor = Object.entries(rolesPorGerencia)
  .filter(([, r]) => !r.Revisor)
  .map(([g]) => g);

// Los responsables se citan por nombre (texto libre), no por clave de usuario.
// Se verifica que cada nombre citado tenga cuenta en el padrón.
const nombresConCuenta = new Set(filasUsuarios.map(u => u.nombre));
const citados = campo => [...new Set(filasFixtures.map(f => f[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const huerfanos = campo => citados(campo).filter(n => !nombresConCuenta.has(n));

const verificacion = {
  generado: new Date().toISOString().slice(0, 10),
  conteos: {
    gerencias: filasGerencias.length,
    unidades: filasUnidades.length,
    usuarios: filasUsuarios.length,
    indicadores_operativos: filasIndicadores.length,
    indicadores_gerenciales: filasGerenciales.length,
    catalogo_mir_193: filasCatalogoMir.length,
    fixtures_reportes: filasFixtures.length,
  },
  hallazgos: {
    nivel_prefijo_id_desalineado: nivelDesalineado.length,
    ids_compartidos_operativos_vs_catalogo_mir:
      filasIndicadores.filter(x => filasCatalogoMir.some(m => m.indicador_id === x.indicador_id)).length,
    gerencias_sin_indicadores_operativos: filasGerencias.filter(g => g.indicadores_operativos === 0).map(g => g.gerencia_clave),
    usuarios_con_gerencia_sin_resolver: usuariosSinGerencia.map(u => u.email),
    gerencias_sin_revisor: gerenciasSinRevisor,
    usuarios_por_rol: cuentaPor(filasUsuarios, u => u.rol),
    estados_en_fixtures: cuentaPor(filasFixtures, f => f.estado),
    nombres_gerencia_sin_alias: [...sinResolver].sort(),
    responsables_enlace_citados: citados('responsable_enlace'),
    responsables_enlace_sin_cuenta: huerfanos('responsable_enlace'),
    responsables_revisor_citados: citados('responsable_revisor'),
    responsables_revisor_sin_cuenta: huerfanos('responsable_revisor'),
    niveles_operativos: cuentaPor(filasIndicadores, x => x.nivel_declarado),
    niveles_catalogo_mir: cuentaPor(filasCatalogoMir, x => x.nivel),
  },
  archivos: salidas,
};

fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(verificacion, null, 2) + '\n', 'utf8');

console.log('Dataset de origen generado en seed/\n');
console.log('Conteos:', JSON.stringify(verificacion.conteos, null, 2));
console.log('\nHallazgos:', JSON.stringify(verificacion.hallazgos, null, 2));
