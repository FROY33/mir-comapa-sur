-- Evidencia de la ficha de modelo de indicadores y metas: medios de verificación, versiones del
-- indicador (CA-3), ciclos de planeación y metas por ejercicio (CA-2).
-- Corre dentro de una transacción que se revierte al final; no deja datos.
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f pruebas/modelo-metas.sql

\ir apoyo.sql
\ir datos-base.sql

-- Atajos: d1 mensual (COM-ACT-1, con reporte f1), d2 trimestral (con reporte f3), d3 anual (con f4),
-- d4 mensual de Técnica sin reportes.
CREATE FUNCTION pg_temp.version_de(reporte uuid) RETURNS smallint
LANGUAGE sql AS $$
  SELECT v.version FROM reportes r JOIN indicador_versiones v ON v.id = r.indicador_version_id WHERE r.id = reporte
$$;
CREATE FUNCTION pg_temp.versiones(indicador uuid) RETURNS bigint
LANGUAGE sql AS $$ SELECT count(*) FROM indicador_versiones WHERE indicador_id = indicador $$;

-- ── Medios de verificación: un medio por indicador ──

UPDATE indicadores SET medio_verificacion = '  Reporte de facturación   mensual ' WHERE codigo = 'COM-ACT-1';

SELECT pg_temp.afirmar('el texto del medio crea su entrada en el catálogo y el indicador apunta a ella',
  (SELECT m.nombre = 'Reporte de facturación mensual'
     FROM indicadores i JOIN medios_verificacion m ON m.id = i.medio_verificacion_id WHERE i.codigo = 'COM-ACT-1'));

UPDATE indicadores SET medio_verificacion = 'reporte de facturación mensual' WHERE codigo = 'COM-ACT-2';

SELECT pg_temp.afirmar('el mismo medio escrito distinto (mayúsculas, espacios) es una sola entrada',
  (SELECT count(DISTINCT medio_verificacion_id) = 1 AND count(*) = 2
     FROM indicadores WHERE codigo IN ('COM-ACT-1', 'COM-ACT-2'))
  AND (SELECT count(*) = 1 FROM medios_verificacion));

SELECT pg_temp.debe_fallar('medio repetido en el catálogo',
  $s$INSERT INTO medios_verificacion (nombre) VALUES ('REPORTE DE FACTURACIÓN MENSUAL')$s$, '23505');

SELECT pg_temp.debe_fallar('medio vacío',
  $s$INSERT INTO medios_verificacion (nombre) VALUES ('   ')$s$, '23514');

UPDATE indicadores SET medio_verificacion = NULL WHERE codigo = 'COM-ACT-2';

SELECT pg_temp.afirmar('quitar el texto deja al indicador sin medio',
  (SELECT medio_verificacion_id IS NULL FROM indicadores WHERE codigo = 'COM-ACT-2'));

UPDATE indicadores SET medio_verificacion_id = (SELECT id FROM medios_verificacion)
 WHERE codigo = 'TEC-ACT-4';

SELECT pg_temp.afirmar('elegir el medio por catálogo también llena el texto',
  (SELECT medio_verificacion = 'Reporte de facturación mensual' FROM indicadores WHERE codigo = 'TEC-ACT-4'));

-- ── CA-3: una edición futura no altera la definición usada por reportes anteriores ──

SELECT pg_temp.afirmar('el reporte creado antes de la edición conserva la versión 1, sin el medio nuevo',
  pg_temp.version_de('00000000-0000-0000-0000-0000000f0001') = 1
  AND (SELECT v.definicion->>'medio_verificacion' IS NULL
         FROM reportes r JOIN indicador_versiones v ON v.id = r.indicador_version_id
        WHERE r.id = '00000000-0000-0000-0000-0000000f0001'));

SELECT pg_temp.afirmar('editar un indicador con reportes crea la versión 2 con la definición nueva',
  pg_temp.versiones('00000000-0000-0000-0000-0000000d0001') = 2
  AND (SELECT definicion->>'medio_verificacion' = 'Reporte de facturación mensual'
         FROM indicador_versiones WHERE indicador_id = '00000000-0000-0000-0000-0000000d0001' AND version = 2));

SELECT pg_temp.afirmar('editar un indicador sin reportes actualiza su versión en uso, no crea otra',
  pg_temp.versiones('00000000-0000-0000-0000-0000000d0004') = 1
  AND (SELECT definicion->>'medio_verificacion' = 'Reporte de facturación mensual'
         FROM indicador_versiones WHERE indicador_id = '00000000-0000-0000-0000-0000000d0004'));

UPDATE indicadores SET nombre = nombre, updated_at = now() WHERE codigo = 'COM-ACT-1';

SELECT pg_temp.afirmar('guardar sin cambios de definición no crea versión',
  pg_temp.versiones('00000000-0000-0000-0000-0000000d0001') = 2);

INSERT INTO reportes (id, indicador_id, periodo_id) VALUES
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000e0002');

SELECT pg_temp.afirmar('el reporte siguiente toma la versión vigente',
  pg_temp.version_de('00000000-0000-0000-0000-0000000f0002') = 2);

UPDATE indicadores SET unidad_id = '00000000-0000-0000-0000-0000000b0001' WHERE codigo = 'COM-ACT-1';

SELECT pg_temp.afirmar('las versiones conservan la asignación histórica (unidad por versión)',
  (SELECT array_agg(unidad_id ORDER BY version) = ARRAY['00000000-0000-0000-0000-0000000b0002',
                                                        '00000000-0000-0000-0000-0000000b0002',
                                                        '00000000-0000-0000-0000-0000000b0001']::uuid[]
     FROM indicador_versiones WHERE indicador_id = '00000000-0000-0000-0000-0000000d0001'));

SELECT pg_temp.debe_pasar('INSERT de reporte que trae una versión de otro indicador',
  $s$INSERT INTO reportes (id, indicador_id, periodo_id, indicador_version_id)
     VALUES ('00000000-0000-0000-0000-0000000f0005', '00000000-0000-0000-0000-0000000d0004',
             '00000000-0000-0000-0000-0000000e0002',
             (SELECT id FROM indicador_versiones WHERE indicador_id = '00000000-0000-0000-0000-0000000d0001' LIMIT 1))$s$);

SELECT pg_temp.afirmar('la versión del reporte siempre sale del indicador, no del INSERT',
  (SELECT v.indicador_id = '00000000-0000-0000-0000-0000000d0004'
     FROM reportes r JOIN indicador_versiones v ON v.id = r.indicador_version_id
    WHERE r.id = '00000000-0000-0000-0000-0000000f0005'));

SELECT pg_temp.debe_fallar('cambiar la versión de un reporte existente',
  $s$UPDATE reportes SET indicador_version_id = (SELECT id FROM indicador_versiones
       WHERE indicador_id = '00000000-0000-0000-0000-0000000d0001' AND version = 3)
      WHERE id = '00000000-0000-0000-0000-0000000f0001'$s$, '23001');

SELECT pg_temp.debe_fallar('editar una versión que usa un reporte',
  $s$UPDATE indicador_versiones SET definicion = '{}'
      WHERE indicador_id = '00000000-0000-0000-0000-0000000d0001' AND version = 1$s$, '23001');

SELECT pg_temp.debe_fallar('borrar una versión que usa un reporte',
  $s$DELETE FROM indicador_versiones
      WHERE indicador_id = '00000000-0000-0000-0000-0000000d0001' AND version = 1$s$, '23001');

SELECT pg_temp.debe_fallar('número de versión repetido',
  $s$INSERT INTO indicador_versiones (indicador_id, version, gerencia_id, definicion)
     VALUES ('00000000-0000-0000-0000-0000000d0001', 1, '00000000-0000-0000-0000-0000000a0001', '{}')$s$, '23505');

-- ── Ciclos de planeación: uno por ejercicio ──

INSERT INTO ciclos_planeacion (id, ejercicio, inicio_captura, fin_captura, inicio_revision) VALUES
  ('00000000-0000-0000-0000-0000001a2026', 2026, '2025-11-03', '2025-11-28', '2025-12-01'),
  ('00000000-0000-0000-0000-0000001a2027', 2027, '2026-11-02', '2026-11-27', '2026-11-30');

SELECT pg_temp.debe_fallar('dos ciclos para el mismo ejercicio',
  $s$INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision)
     VALUES (2026, '2025-10-01', '2025-10-31', '2025-11-03')$s$, '23505');

SELECT pg_temp.debe_fallar('fin de captura antes del inicio',
  $s$INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision)
     VALUES (2028, '2027-11-30', '2027-11-01', '2027-12-01')$s$, '23514');

SELECT pg_temp.debe_fallar('revisión que empieza antes de cerrar la captura',
  $s$INSERT INTO ciclos_planeacion (ejercicio, inicio_captura, fin_captura, inicio_revision)
     VALUES (2028, '2027-11-01', '2027-11-30', '2027-11-15')$s$, '23514');

SELECT pg_temp.debe_fallar('cierre manual sin fecha de cierre',
  $s$UPDATE ciclos_planeacion SET cerrado_manual = true WHERE ejercicio = 2027$s$, '23514');

-- ── CA-2: metas por ejercicio sin sobrescribirse; una meta lógica por indicador y ejercicio ──

INSERT INTO metas_planeacion (id, indicador_id, ciclo_id, version, meta_anual, linea_base) VALUES
  ('00000000-0000-0000-0000-0000001b0001', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000001a2026', 1, 90, 80),
  ('00000000-0000-0000-0000-0000001b0002', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000001a2027', 1, 95, 90);

SELECT pg_temp.afirmar('el mismo indicador tiene metas de dos ejercicios con sus propios valores',
  (SELECT array_agg(meta_anual ORDER BY c.ejercicio) = ARRAY[90, 95]::numeric[]
     FROM metas_planeacion m JOIN ciclos_planeacion c ON c.id = m.ciclo_id
    WHERE m.indicador_id = '00000000-0000-0000-0000-0000000d0001'));

SELECT pg_temp.debe_fallar('segunda meta vigente para el mismo indicador y ejercicio',
  $s$INSERT INTO metas_planeacion (indicador_id, ciclo_id, version)
     VALUES ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000001a2026', 2)$s$, '23505');

SELECT pg_temp.debe_fallar('número de versión de meta repetido',
  $s$INSERT INTO metas_planeacion (indicador_id, ciclo_id, version, vigente)
     VALUES ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000001a2026', 1, false)$s$, '23505');

SELECT pg_temp.debe_fallar('meta enviada sin meta anual ni línea base',
  $s$INSERT INTO metas_planeacion (indicador_id, ciclo_id, version, estado, enviada_at)
     VALUES ('00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000001a2026', 1, 'meta_enviada', now())$s$, '23514');

SELECT pg_temp.debe_fallar('meta de un indicador que no existe',
  $s$INSERT INTO metas_planeacion (indicador_id, ciclo_id, version)
     VALUES ('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000001a2026', 1)$s$, '23503');

-- Metas por periodo: 12 para el mensual
INSERT INTO metas_periodo (meta_id, numero, meta_periodo)
SELECT '00000000-0000-0000-0000-0000001b0001', n, 90 FROM generate_series(1, 12) n;

SELECT pg_temp.debe_fallar('periodo repetido dentro de la misma versión de meta',
  $s$INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ('00000000-0000-0000-0000-0000001b0001', 3, 1)$s$, '23505');

SELECT pg_temp.debe_fallar('meta por periodo negativa',
  $s$INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ('00000000-0000-0000-0000-0000001b0002', 1, -1)$s$, '23514');

INSERT INTO metas_planeacion (id, indicador_id, ciclo_id, version) VALUES
  ('00000000-0000-0000-0000-0000001b0003', '00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000001a2026', 1);

SELECT pg_temp.debe_fallar('periodo 5 en un indicador trimestral',
  $s$INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ('00000000-0000-0000-0000-0000001b0003', 5, 10)$s$, '23514');

-- Cambio de meta autorizado: la versión anterior queda como histórico
UPDATE metas_planeacion SET vigente = false WHERE id = '00000000-0000-0000-0000-0000001b0001';
INSERT INTO metas_planeacion (id, indicador_id, ciclo_id, version, meta_anual, linea_base) VALUES
  ('00000000-0000-0000-0000-0000001b0004', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000001a2026', 2, 92, 80);

SELECT pg_temp.afirmar('la versión anterior de la meta conserva sus valores y sus 12 periodos',
  (SELECT meta_anual = 90 AND NOT vigente FROM metas_planeacion WHERE id = '00000000-0000-0000-0000-0000001b0001')
  AND (SELECT count(*) = 12 FROM metas_periodo WHERE meta_id = '00000000-0000-0000-0000-0000001b0001'));

SELECT pg_temp.debe_pasar('los mismos números de periodo en la versión nueva',
  $s$INSERT INTO metas_periodo (meta_id, numero, meta_periodo)
     SELECT '00000000-0000-0000-0000-0000001b0004', n, 92 FROM generate_series(1, 12) n$s$);

SELECT pg_temp.debe_fallar('editar una meta histórica',
  $s$UPDATE metas_planeacion SET meta_anual = 1 WHERE id = '00000000-0000-0000-0000-0000001b0001'$s$, '23001');

SELECT pg_temp.debe_fallar('editar los periodos de una meta histórica',
  $s$UPDATE metas_periodo SET meta_periodo = 1 WHERE meta_id = '00000000-0000-0000-0000-0000001b0001'$s$, '23001');

SELECT pg_temp.debe_fallar('borrar una meta',
  $s$DELETE FROM metas_planeacion WHERE id = '00000000-0000-0000-0000-0000001b0004'$s$, '23001');

\ir resultado.sql
