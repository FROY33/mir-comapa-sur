-- Evidencia de TEC-02: la base rechaza duplicados, referencias inválidas y estados fuera de regla,
-- y cubre varias frecuencias, varios Enlaces por gerencia y periodos anteriores.
-- Corre dentro de una transacción que se revierte al final; no deja datos.
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f pruebas/restricciones.sql

\set VERBOSITY terse
\pset tuples_only on
\pset format unaligned

BEGIN;
\o /dev/null

CREATE TEMP TABLE _resultados (n serial, descripcion text);

-- La sentencia debe fallar con el SQLSTATE esperado
CREATE FUNCTION pg_temp.debe_fallar(descripcion text, sentencia text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  obtenido text;
  mensaje  text;
BEGIN
  BEGIN
    EXECUTE sentencia;
  EXCEPTION WHEN OTHERS THEN
    obtenido := SQLSTATE;
    mensaje  := SQLERRM;
  END;
  IF obtenido IS NULL THEN
    RAISE EXCEPTION 'FALLÓ «%»: la base aceptó la operación', descripcion;
  END IF;
  IF obtenido <> esperado THEN
    RAISE EXCEPTION 'FALLÓ «%»: se esperaba % y llegó % (%)', descripcion, esperado, obtenido, mensaje;
  END IF;
  INSERT INTO _resultados (descripcion) VALUES ('rechaza  ' || descripcion);
END;
$$;

-- La sentencia debe funcionar
CREATE FUNCTION pg_temp.debe_pasar(descripcion text, sentencia text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sentencia;
  INSERT INTO _resultados (descripcion) VALUES ('acepta   ' || descripcion);
END;
$$;

CREATE FUNCTION pg_temp.afirmar(descripcion text, condicion boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condicion IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLÓ «%»', descripcion;
  END IF;
  INSERT INTO _resultados (descripcion) VALUES ('cumple   ' || descripcion);
END;
$$;

-- ── Datos base ──────────────────────────────────────────────────────────────
-- Gerencias: a1 Comercial, a2 Técnica
-- Unidades:  b1 Coord. General Comercial, b2 Facturación (Comercial), b3 Coord. General Técnica
-- Usuarios:  c1 admin, c2 revisor, c3 y c4 enlaces de Comercial

INSERT INTO organizaciones (id, nombre) VALUES
  ('00000000-0000-0000-0000-000000000001', 'COMAPA Sur');

INSERT INTO gerencias (id, organizacion_id, clave, nombre) VALUES
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-000000000001', 'COM', 'Gerencia Comercial'),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-000000000001', 'TEC', 'Gerencia Técnica');

INSERT INTO unidades (id, gerencia_id, nombre, es_coord_general) VALUES
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001', 'Coordinación General Comercial', true),
  ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-0000000a0001', 'Facturación', false),
  ('00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-0000000a0002', 'Coordinación General Técnica', true);

INSERT INTO usuarios (id, gerencia_id, unidad_id, nombre, email, password_hash, rol) VALUES
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0001', 'Luis Sandoval',  'admin@comapasur.gob.mx',   'x', 'admin'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0001', 'Carlos Mendoza', 'revisor@comapasur.gob.mx', 'x', 'revisor'),
  ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0002', 'Ana Torres',     'enlace1@comapasur.gob.mx', 'x', 'enlace'),
  ('00000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0001', 'Pedro Sánchez',  'enlace2@comapasur.gob.mx', 'x', 'enlace');

-- Indicadores: d1 mensual, d2 trimestral sin unidad, d3 anual fracción, d4 descendente de Técnica
INSERT INTO indicadores (id, gerencia_id, unidad_id, codigo, nivel, nombre, unidad_medida, frecuencia,
                         tipo_calculo, denominador_fijo, acumulable, sentido_meta) VALUES
  ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0002',
   'COM-ACT-1',  'actividad',  'Facturas emitidas a tiempo', 'Porcentaje', 'mensual',    'fraccion', NULL, false, 'ascendente'),
  ('00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000a0001', NULL,
   'COM-COMP-1', 'componente', 'Cobranza efectiva',          'Porcentaje', 'trimestral', 'fraccion', NULL, true,  'ascendente'),
  ('00000000-0000-0000-0000-0000000d0003', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0001',
   'COM-ACT-2',  'actividad',  'Cobertura de medición',      'Porcentaje', 'anual',      'fraccion', 1200, false, 'ascendente'),
  ('00000000-0000-0000-0000-0000000d0004', '00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000b0003',
   'TEC-ACT-4',  'actividad',  'Rezago de reparaciones',     'Número',     'mensual',    'valor_directo', NULL, false, 'descendente');

INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia, activo) VALUES
  ('00000000-0000-0000-0000-0000000a0002', 'TEC-ACT-5', 'actividad', 'Indicador dado de baja', 'Número', 'mensual', false);

-- Periodos: e1 mayo-2026, e2 junio-2026, e3 T2-2026, e4 2025 (anual, se captura en enero 2026)
INSERT INTO periodos_reporte (id, frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite) VALUES
  ('00000000-0000-0000-0000-0000000e0001', 'mensual',    2026, 5, 'mayo-2026',  '2026-05-01', '2026-05-31', '2026-06-01', '2026-06-12'),
  ('00000000-0000-0000-0000-0000000e0002', 'mensual',    2026, 6, 'junio-2026', '2026-06-01', '2026-06-30', '2026-07-01', '2026-07-14'),
  ('00000000-0000-0000-0000-0000000e0003', 'trimestral', 2026, 2, 'T2-2026',    '2026-04-01', '2026-06-30', '2026-07-01', '2026-07-21'),
  ('00000000-0000-0000-0000-0000000e0004', 'anual',      2025, 1, '2025',       '2025-01-01', '2025-12-31', '2026-01-01', '2026-02-11');

INSERT INTO reportes (id, indicador_id, periodo_id) VALUES
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000e0001'),
  ('00000000-0000-0000-0000-0000000f0003', '00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000e0003'),
  ('00000000-0000-0000-0000-0000000f0004', '00000000-0000-0000-0000-0000000d0003', '00000000-0000-0000-0000-0000000e0004');

-- ── TEC-01 CA-2: organización, rol único, correo único, unidad dentro de la gerencia ──

SELECT pg_temp.debe_fallar('correo duplicado aunque cambien mayúsculas',
  $s$INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol)
     VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0002', 'Otra', 'ANA@x.mx', 'x', 'enlace'),
            ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0002', 'Otra', 'ana@X.MX', 'x', 'enlace')$s$,
  '23505');

SELECT pg_temp.debe_fallar('correo con formato inválido',
  $s$INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol)
     VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0002', 'Otra', 'sin-arroba', 'x', 'enlace')$s$,
  '23514');

SELECT pg_temp.debe_fallar('rol fuera del catálogo',
  $s$INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol)
     VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0002', 'Otra', 'otra@x.mx', 'x', 'superusuario')$s$,
  '23514');

SELECT pg_temp.debe_fallar('usuario sin unidad',
  $s$INSERT INTO usuarios (gerencia_id, nombre, email, password_hash, rol)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'Otra', 'otra@x.mx', 'x', 'enlace')$s$,
  '23502');

SELECT pg_temp.debe_fallar('usuario con unidad de otra gerencia',
  $s$INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol)
     VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0003', 'Otra', 'otra@x.mx', 'x', 'enlace')$s$,
  '23503');

SELECT pg_temp.debe_fallar('gerencia de una organización inexistente',
  $s$INSERT INTO gerencias (organizacion_id, clave, nombre)
     VALUES ('00000000-0000-0000-0000-000000000999', 'ADM', 'Gerencia Administrativa')$s$,
  '23503');

SELECT pg_temp.debe_fallar('clave de gerencia duplicada en la organización',
  $s$INSERT INTO gerencias (organizacion_id, clave, nombre)
     VALUES ('00000000-0000-0000-0000-000000000001', 'COM', 'Otra Comercial')$s$,
  '23505');

SELECT pg_temp.debe_fallar('unidad repetida en la misma gerencia',
  $s$INSERT INTO unidades (gerencia_id, nombre) VALUES ('00000000-0000-0000-0000-0000000a0001', 'Facturación')$s$,
  '23505');

SELECT pg_temp.debe_pasar('mismo nombre de unidad en otra gerencia',
  $s$INSERT INTO unidades (gerencia_id, nombre) VALUES ('00000000-0000-0000-0000-0000000a0002', 'Facturación')$s$);

SELECT pg_temp.debe_fallar('dos Coordinaciones Generales en una gerencia',
  $s$INSERT INTO unidades (gerencia_id, nombre, es_coord_general)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'Otra coordinación', true)$s$,
  '23505');

SELECT pg_temp.afirmar('varios Enlaces activos en la misma gerencia',
  (SELECT count(*) FROM usuarios
    WHERE gerencia_id = '00000000-0000-0000-0000-0000000a0001' AND rol = 'enlace' AND activo) = 2);

-- ── Catálogos: frecuencias e indicadores ──

SELECT pg_temp.afirmar('las seis frecuencias existen, incluidas bimestral y cuatrimestral',
  (SELECT count(*) FROM frecuencias) = 6
  AND EXISTS (SELECT 1 FROM frecuencias WHERE clave = 'bimestral')
  AND EXISTS (SELECT 1 FROM frecuencias WHERE clave = 'cuatrimestral'));

SELECT pg_temp.debe_fallar('ventana de captura más larga que el periodo',
  $s$UPDATE frecuencias SET dias_habiles = 40 WHERE clave = 'mensual'$s$,
  '23514');

SELECT pg_temp.debe_fallar('ventana de captura en cero días',
  $s$UPDATE frecuencias SET dias_habiles = 0 WHERE clave = 'anual'$s$,
  '23514');

SELECT pg_temp.debe_fallar('código de indicador duplicado',
  $s$INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'COM-ACT-1', 'actividad', 'Copia', 'Número', 'mensual')$s$,
  '23505');

SELECT pg_temp.debe_fallar('indicador con frecuencia inexistente',
  $s$INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'COM-ACT-9', 'actividad', 'X', 'Número', 'quincenal')$s$,
  '23503');

SELECT pg_temp.debe_fallar('indicador con unidad de otra gerencia',
  $s$INSERT INTO indicadores (gerencia_id, unidad_id, codigo, nivel, nombre, unidad_medida, frecuencia)
     VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000b0003', 'COM-ACT-9', 'actividad', 'X', 'Número', 'mensual')$s$,
  '23503');

SELECT pg_temp.debe_fallar('indicador MIR sin nivel',
  $s$INSERT INTO indicadores (gerencia_id, codigo, nombre, unidad_medida, frecuencia)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'COM-ACT-9', 'X', 'Número', 'mensual')$s$,
  '23514');

SELECT pg_temp.debe_pasar('indicador gerencial sin nivel',
  $s$INSERT INTO indicadores (gerencia_id, codigo, tipo, nombre, unidad_medida, frecuencia)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'GER-COM-1', 'gerencial', 'Recaudación', 'MXN', 'mensual')$s$);

SELECT pg_temp.debe_fallar('denominador fijo en un indicador de valor directo',
  $s$INSERT INTO indicadores (gerencia_id, codigo, nivel, nombre, unidad_medida, frecuencia, denominador_fijo)
     VALUES ('00000000-0000-0000-0000-0000000a0001', 'COM-ACT-9', 'actividad', 'X', 'Número', 'mensual', 10)$s$,
  '23514');

SELECT pg_temp.debe_fallar('rangos del semáforo invertidos',
  $s$UPDATE indicadores SET rango_verde_min = 70, rango_amarillo_min = 90 WHERE codigo = 'COM-ACT-1'$s$,
  '23514');

-- ── Periodos de reporte (CICLOS) ──

SELECT pg_temp.debe_fallar('periodo duplicado por frecuencia, ejercicio y número',
  $s$INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
     VALUES ('mensual', 2026, 5, 'mayo-2026-bis', '2026-05-01', '2026-05-31', '2026-06-01', '2026-06-12')$s$,
  '23505');

SELECT pg_temp.debe_fallar('periodo con fechas invertidas',
  $s$INSERT INTO periodos_reporte (frecuencia, ejercicio, numero, etiqueta, inicio_periodo, fin_periodo, abre_captura, fecha_limite)
     VALUES ('mensual', 2026, 7, 'julio-2026', '2026-07-31', '2026-07-01', '2026-08-01', '2026-08-14')$s$,
  '23514');

SELECT pg_temp.debe_fallar('periodo cerrado sin fecha de cierre',
  $s$UPDATE periodos_reporte SET estado = 'cerrado' WHERE etiqueta = 'mayo-2026'$s$,
  '23514');

SELECT pg_temp.afirmar('pueden estar abiertos a la vez periodos de distintas frecuencias',
  (SELECT count(DISTINCT frecuencia) FROM periodos_reporte WHERE estado = 'abierto') >= 3);

-- ── TEC-01 CA-3 / TEC-02 CA-2 y CA-3: reporte lógico único y referencias válidas ──

SELECT pg_temp.debe_fallar('reporte duplicado para el mismo indicador y periodo',
  $s$INSERT INTO reportes (indicador_id, periodo_id)
     VALUES ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000e0001')$s$,
  '23505');

SELECT pg_temp.debe_fallar('reporte de un indicador mensual en un periodo trimestral',
  $s$INSERT INTO reportes (indicador_id, periodo_id)
     VALUES ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000e0003')$s$,
  '23503');

SELECT pg_temp.debe_fallar('reporte de un indicador inexistente',
  $s$INSERT INTO reportes (indicador_id, periodo_id)
     VALUES ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-0000000e0001')$s$,
  '23503');

SELECT pg_temp.debe_fallar('reporte de un periodo inexistente',
  $s$INSERT INTO reportes (indicador_id, periodo_id)
     VALUES ('00000000-0000-0000-0000-0000000d0004', '00000000-0000-0000-0000-000000000999')$s$,
  '23503');

SELECT pg_temp.debe_fallar('reporte de un indicador inactivo',
  $s$INSERT INTO reportes (indicador_id, periodo_id)
     SELECT id, '00000000-0000-0000-0000-0000000e0001' FROM indicadores WHERE codigo = 'TEC-ACT-5'$s$,
  '23514');

SELECT pg_temp.debe_fallar('envío con usuario inexistente',
  $s$UPDATE reportes SET estado = 'enviado_revision', enviado_at = now(),
            enviado_por = '00000000-0000-0000-0000-000000000999'
      WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23503');

-- ── TEC-02 CA-4: el estado vive en REPORTES, no en INDICADORES ──

SELECT pg_temp.afirmar('INDICADORES no tiene columna de estado ni de meta',
  NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'indicadores'
                 AND column_name IN ('estado', 'meta_anual', 'linea_base')));

SELECT pg_temp.debe_fallar('estado de reporte fuera del catálogo («vencido» es marca, no estado)',
  $s$UPDATE reportes SET estado = 'vencido' WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23514');

SELECT pg_temp.debe_fallar('enviado a revisión sin fecha de envío',
  $s$UPDATE reportes SET estado = 'enviado_revision' WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23514');

SELECT pg_temp.debe_fallar('marca de vencido sin fecha',
  $s$UPDATE reportes SET vencido = true WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23514');

SELECT pg_temp.debe_fallar('cerrado sin fecha de cierre',
  $s$UPDATE reportes SET estado = 'cerrado' WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23514');

SELECT pg_temp.debe_fallar('avance negativo',
  $s$UPDATE reportes SET avance = -1 WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23514');

SELECT pg_temp.debe_fallar('denominador en cero',
  $s$UPDATE reportes SET denominador = 0 WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23514');

-- ── Configuración histórica: la foto del indicador en periodos anteriores ──

SELECT pg_temp.afirmar('el reporte guarda la foto del indicador al crearse',
  (SELECT unidad_id = '00000000-0000-0000-0000-0000000b0002' AND frecuencia = 'mensual' AND rango_verde_min = 95
     FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0001'));

UPDATE indicadores
   SET unidad_id = '00000000-0000-0000-0000-0000000b0001', rango_verde_min = 90, acumulable = true
 WHERE codigo = 'COM-ACT-1';

INSERT INTO reportes (id, indicador_id, periodo_id) VALUES
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000e0002');

SELECT pg_temp.afirmar('un cambio al indicador no altera el reporte del periodo anterior',
  (SELECT unidad_id = '00000000-0000-0000-0000-0000000b0002' AND rango_verde_min = 95 AND NOT acumulable
     FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0001'));

SELECT pg_temp.afirmar('el reporte del periodo siguiente toma la configuración nueva',
  (SELECT unidad_id = '00000000-0000-0000-0000-0000000b0001' AND rango_verde_min = 90 AND acumulable
     FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0002'));

SELECT pg_temp.debe_pasar('INSERT que intenta poner otra gerencia en la foto',
  $s$INSERT INTO reportes (id, indicador_id, periodo_id, gerencia_id, rango_verde_min)
     VALUES ('00000000-0000-0000-0000-0000000f0005', '00000000-0000-0000-0000-0000000d0004',
             '00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000a0001', 50)$s$);

SELECT pg_temp.afirmar('la foto siempre sale del catálogo, no del INSERT',
  (SELECT gerencia_id = '00000000-0000-0000-0000-0000000a0002' AND rango_verde_min = 95 AND sentido_meta = 'descendente'
     FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0005'));

SELECT pg_temp.debe_fallar('modificar la foto de un reporte existente',
  $s$UPDATE reportes SET unidad_id = '00000000-0000-0000-0000-0000000b0001'
      WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23001');

SELECT pg_temp.debe_fallar('borrar un indicador con reportes',
  $s$DELETE FROM indicadores WHERE codigo = 'COM-ACT-1'$s$,
  '23503');

-- ── Cierre: congelado, bloqueo y reapertura autorizada ──

SELECT pg_temp.debe_pasar('flujo hasta cerrado con valores congelados',
  $s$UPDATE reportes
        SET numerador = 90, denominador = 100, avance = 90,
            estado = 'enviado_revision', enviado_por = '00000000-0000-0000-0000-0000000c0003', enviado_at = now()
      WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$);

UPDATE reportes SET estado = 'aprobado_revisor' WHERE id = '00000000-0000-0000-0000-0000000f0001';
UPDATE reportes
   SET estado = 'cerrado', cerrado_por = '00000000-0000-0000-0000-0000000c0001', cerrado_at = now(),
       meta_periodo_aplicada = 95, cumplimiento = 94.74, semaforo = 'amarillo'
 WHERE id = '00000000-0000-0000-0000-0000000f0001';

SELECT pg_temp.afirmar('lock_version sube en cada cambio',
  (SELECT lock_version = 3 FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0001'));

SELECT pg_temp.debe_fallar('editar un reporte cerrado sin autorización',
  $s$UPDATE reportes SET avance = 100 WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$,
  '23001');

SELECT set_config('app.reapertura', 'on', true);
UPDATE reportes
   SET estado = 'regresado_correccion', cerrado_por = NULL, cerrado_at = NULL,
       meta_periodo_aplicada = NULL, cumplimiento = NULL, semaforo = NULL
 WHERE id = '00000000-0000-0000-0000-0000000f0001';
SELECT set_config('app.reapertura', 'off', true);

SELECT pg_temp.afirmar('reabrir un reporte cerrado con autorización del backend',
  (SELECT estado = 'regresado_correccion' FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0001'));

SELECT pg_temp.debe_pasar('cerrar como incumplido un reporte nunca enviado',
  $s$UPDATE reportes SET estado = 'incumplido', vencido = true, vencido_at = now(),
            cerrado_por = '00000000-0000-0000-0000-0000000c0001', cerrado_at = now(), semaforo = 'na'
      WHERE id = '00000000-0000-0000-0000-0000000f0003'$s$);

SELECT pg_temp.debe_fallar('editar un reporte incumplido sin autorización',
  $s$UPDATE reportes SET avance = 50 WHERE id = '00000000-0000-0000-0000-0000000f0003'$s$,
  '23001');

SELECT pg_temp.debe_fallar('borrar un reporte',
  $s$DELETE FROM reportes WHERE id = '00000000-0000-0000-0000-0000000f0002'$s$,
  '23001');

-- ── Bitácora de solo inserción ──

SELECT pg_temp.debe_pasar('registrar una acción del sistema (sin usuario)',
  $s$INSERT INTO bitacora (accion, entidad, entidad_id, indicador_id, estado_anterior, estado_nuevo)
     VALUES ('marcado_vencido', 'reporte', '00000000-0000-0000-0000-0000000f0003',
             '00000000-0000-0000-0000-0000000d0002', 'pendiente_carga', 'pendiente_carga')$s$);

SELECT pg_temp.debe_pasar('registrar una acción de usuario con su rol',
  $s$INSERT INTO bitacora (usuario_id, rol, accion, entidad, entidad_id)
     VALUES ('00000000-0000-0000-0000-0000000c0001', 'admin', 'ventana_captura_actualizada', 'frecuencia', 'mensual')$s$);

SELECT pg_temp.debe_fallar('acción de usuario sin rol',
  $s$INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id)
     VALUES ('00000000-0000-0000-0000-0000000c0001', 'x', 'reporte', '1')$s$,
  '23514');

SELECT pg_temp.debe_fallar('editar la bitácora',  $s$UPDATE bitacora SET comentario = 'cambio'$s$, '23001');
SELECT pg_temp.debe_fallar('borrar la bitácora',  $s$DELETE FROM bitacora$s$,                     '23001');
SELECT pg_temp.debe_fallar('vaciar la bitácora',  $s$TRUNCATE bitacora$s$,                        '23001');

-- ── Resultado ──

\o
SELECT '  ✓ ' || descripcion FROM _resultados ORDER BY n;
SELECT '';
SELECT '  ' || count(*) || ' pruebas pasaron' FROM _resultados;

ROLLBACK;
