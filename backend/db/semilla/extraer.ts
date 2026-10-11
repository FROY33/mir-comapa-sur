#!/usr/bin/env node
/**
 * TEC-04 — Extrae el dataset de origen de los archivos del prototipo y lo deja
 * listo para el esquema de TEC-02.
 *
 * Emite CSV (revisión humana y fuente del cargador) y un manifest con conteos,
 * sha256 y verificaciones. Determinista: misma entrada,
 * mismos bytes. Las filas se ordenan por clave natural (soporte de CA-3).
 *
 * Uso:  npx tsx db/semilla/extraer.ts   (desde backend/)
 */
//
// Las etapas viven en extraer/: base, organizacion, indicadores y reportes. Este archivo
// escribe los CSV y el manifest con sus verificaciones.

import fs from 'node:fs'
import path from 'node:path'
import { gerenciasSinAlias } from './mapeos.js'
import { AQUI, DATOS, EJERCICIO, CORTE, cuenta, salidas, escribirCsv } from './extraer/base.js'
import { filasGerencias, unidades, filasUnidades, rolesSinTraduccion, filasUsuarios } from './extraer/organizacion.js'
import { nivelesSinTraduccion, frecuenciasSinTraduccion, tiposSinTraduccion, indicadoresMir, indicadoresGerenciales, numerosAmbiguos, huerfanosJerarquia, filasIndicadores, filasCatalogo193 } from './extraer/indicadores.js'
import { filasPeriodos, sinPeriodoConcluido, BORRADORES_CA5, estadosFueraCatalogo, nombresConCuenta, borradoresNoAplicados, filasFixtures } from './extraer/reportes.js'

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
    borradores_sinteticos_ca5: Object.keys(BORRADORES_CA5),
    borradores_no_aplicados: borradoresNoAplicados,
    remapeo_de_periodo: Object.entries(cuenta(
      filasFixtures.filter(f => f.periodo_prototipo && f.periodo_prototipo !== f.periodo_etiqueta),
      f => `${f.periodo_prototipo} -> ${f.periodo_etiqueta}`)),
  },
  archivos: salidas,
}

fs.writeFileSync(path.join(AQUI, 'manifest.json'), JSON.stringify(verificacion, null, 2) + '\n', 'utf8')
console.log('Dataset generado en backend/db/semilla/\n')
console.log(JSON.stringify({ conteos: verificacion.conteos, integridad: verificacion.integridad, mapeos_sin_traduccion: verificacion.mapeos_sin_traduccion }, null, 2))
