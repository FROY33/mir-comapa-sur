-- Evidencia del catálogo administrable (HU-R4-11, ticket 3) sobre el modelo de S2-TEC-01:
-- la meta apunta a su versión del indicador (RN_3, CA_4), los triggers del modelo corren como dueño
-- (CA_1) y los cambios con vigencia futura (CA_4).
-- Corre dentro de una transacción que se revierte al final; no deja datos.
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f pruebas/catalogo-admin.sql

\ir apoyo.sql
\ir datos-base.sql

-- ── La meta apunta a la versión del indicador con que se creó (migración 20261015000001) ──
-- d4: mensual, de Técnica, sin reportes

INSERT INTO ciclos_planeacion (id, ejercicio, inicio_captura, fin_captura, inicio_revision) VALUES
  ('00000000-0000-0000-0000-0000000a9001', 2026, '2025-11-03', '2025-11-28', '2025-12-01');

SELECT pg_temp.debe_pasar('meta de un indicador sin reportes',
  $s$INSERT INTO metas_planeacion (id, indicador_id, ciclo_id, indicador_version_id)
     VALUES ('00000000-0000-0000-0000-0000000a9101', '00000000-0000-0000-0000-0000000d0004',
             '00000000-0000-0000-0000-0000000a9001', gen_random_uuid())$s$);

SELECT pg_temp.afirmar('la versión de la meta sale del indicador, no del INSERT',
  (SELECT m.indicador_version_id = v.id FROM metas_planeacion m
     JOIN indicador_versiones v ON v.indicador_id = m.indicador_id AND v.version = 1
    WHERE m.id = '00000000-0000-0000-0000-0000000a9101'));

SELECT pg_temp.debe_fallar('cambiar la versión de una meta existente',
  $s$UPDATE metas_planeacion SET indicador_version_id = gen_random_uuid() WHERE id = '00000000-0000-0000-0000-0000000a9101'$s$,
  '23001');

SELECT pg_temp.debe_fallar('editar una versión que usa una meta',
  $s$UPDATE indicador_versiones SET definicion = '{}'
      WHERE id = (SELECT indicador_version_id FROM metas_planeacion WHERE id = '00000000-0000-0000-0000-0000000a9101')$s$,
  '23001');

-- El indicador pasa a trimestral: su versión 1 la usa la meta, así que nace la 2
UPDATE indicadores SET frecuencia = 'trimestral' WHERE id = '00000000-0000-0000-0000-0000000d0004';

SELECT pg_temp.afirmar('editar un indicador con meta (sin reportes) crea otra versión y deja la de la meta intacta',
  (SELECT count(*) = 2 FROM indicador_versiones WHERE indicador_id = '00000000-0000-0000-0000-0000000d0004')
  AND (SELECT v.definicion->>'frecuencia' = 'mensual' FROM metas_planeacion m
         JOIN indicador_versiones v ON v.id = m.indicador_version_id WHERE m.id = '00000000-0000-0000-0000-0000000a9101'));

SELECT pg_temp.debe_pasar('los periodos de la meta siguen la frecuencia de su versión (12 en mensual)',
  $s$INSERT INTO metas_periodo (meta_id, numero, meta_periodo)
     SELECT '00000000-0000-0000-0000-0000000a9101', n, 10 FROM generate_series(1, 12) AS n$s$);

SELECT pg_temp.debe_fallar('periodo 13 en la meta mensual',
  $s$INSERT INTO metas_periodo (meta_id, numero, meta_periodo) VALUES ('00000000-0000-0000-0000-0000000a9101', 13, 10)$s$,
  '23514');

SELECT pg_temp.afirmar('versionar y alinear el medio corren como dueño (la app edita indicadores sin escribir esas tablas)',
  (SELECT bool_and(prosecdef) FROM pg_proc
    WHERE proname IN ('indicadores_versionar', 'indicadores_alinear_medio') AND pronamespace = 'public'::regnamespace));

-- ── Cambios programados del indicador (HU-R4-11 CA_4) ──

SELECT pg_temp.debe_pasar('programar un cambio de frecuencia para el siguiente periodo',
  $s$INSERT INTO indicador_cambios_programados (id, indicador_id, valores, vigente_desde, creado_por)
     VALUES ('00000000-0000-0000-0000-0000000a3001', '00000000-0000-0000-0000-0000000d0001',
             '{"frecuencia": "trimestral", "acumulable": true}', '2090-04-01', '00000000-0000-0000-0000-0000000c0001')$s$);

SELECT pg_temp.debe_fallar('dos cambios pendientes para el mismo indicador',
  $s$INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde)
     VALUES ('00000000-0000-0000-0000-0000000d0001', '{"acumulable": false}', '2090-05-01')$s$,
  '23505');

SELECT pg_temp.debe_fallar('cambio programado de un indicador inexistente',
  $s$INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde)
     VALUES (gen_random_uuid(), '{"acumulable": false}', '2090-05-01')$s$,
  '23503');

SELECT pg_temp.debe_fallar('cambio programado sin valores',
  $s$INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde)
     VALUES ('00000000-0000-0000-0000-0000000d0002', '{}', '2090-05-01')$s$,
  '23514');

SELECT pg_temp.debe_fallar('cambio programado de un campo que no tiene vigencia futura',
  $s$INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde)
     VALUES ('00000000-0000-0000-0000-0000000d0002', '{"nombre": "x"}', '2090-05-01')$s$,
  '23514');

SELECT pg_temp.debe_fallar('cambio programado aplicado y cancelado a la vez',
  $s$INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde, aplicado_at, cancelado_at)
     VALUES ('00000000-0000-0000-0000-0000000d0002', '{"acumulable": false}', '2090-05-01', now(), now())$s$,
  '23514');

SELECT pg_temp.debe_fallar('borrar un cambio programado',
  $s$DELETE FROM indicador_cambios_programados$s$, '23001');

SELECT pg_temp.debe_fallar('cambiar los valores de un cambio programado',
  $s$UPDATE indicador_cambios_programados SET valores = '{"acumulable": false}'$s$, '23001');

SELECT pg_temp.debe_pasar('cancelar un cambio pendiente',
  $s$UPDATE indicador_cambios_programados SET cancelado_at = now(), cancelado_por = '00000000-0000-0000-0000-0000000c0001'
      WHERE id = '00000000-0000-0000-0000-0000000a3001'$s$);

SELECT pg_temp.debe_fallar('aplicar un cambio ya cancelado',
  $s$UPDATE indicador_cambios_programados SET aplicado_at = now()
      WHERE id = '00000000-0000-0000-0000-0000000a3001'$s$, '23001');

SELECT pg_temp.debe_pasar('programar otro cambio cuando el anterior ya no está pendiente',
  $s$INSERT INTO indicador_cambios_programados (indicador_id, valores, vigente_desde)
     VALUES ('00000000-0000-0000-0000-0000000d0001', '{"acumulable": false}', '2090-05-01')$s$);


\ir resultado.sql
