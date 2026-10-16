-- Evidencia de S2-TEC-03 (ticket 4): mantenimiento directo del catálogo de medios de verificación
-- (alta, edición y desactivación) y la normalización más estricta que también ignora la puntuación
-- final, para fusionar el casi-duplicado real del CSV institucional (migración 20261015000003).
-- Corre dentro de una transacción que se revierte al final; no deja datos.
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f pruebas/medios-verificacion.sql

\ir apoyo.sql
\ir datos-base.sql

-- ── Normalización: mayúsculas, espacios y ahora también la puntuación final ──

INSERT INTO medios_verificacion (id, nombre) VALUES
  ('00000000-0000-0000-0000-0000000f9001', 'Programa operativo y reportes de seguimiento firmados');

SELECT pg_temp.debe_fallar('medio que solo difiere del existente por el punto final',
  $s$INSERT INTO medios_verificacion (nombre) VALUES ('programa operativo y reportes de seguimiento firmados.')$s$,
  '23505');

SELECT pg_temp.debe_fallar('medio que solo difiere por mayúsculas, espacios de más y una coma final',
  $s$INSERT INTO medios_verificacion (nombre) VALUES ('  PROGRAMA OPERATIVO  Y REPORTES DE SEGUIMIENTO FIRMADOS ,')$s$,
  '23505');

-- ── Alta, edición y desactivación directas (S2-TEC-03: ya no solo el trigger-dueño escribe esta tabla) ──

SELECT pg_temp.debe_pasar('dar de alta un medio nuevo directamente en el catálogo',
  $s$INSERT INTO medios_verificacion (id, nombre) VALUES ('00000000-0000-0000-0000-0000000f9002', 'Bitácora de pruebas S2-TEC-03')$s$);

SELECT pg_temp.debe_fallar('medio sin nombre',
  $s$INSERT INTO medios_verificacion (id, nombre) VALUES ('00000000-0000-0000-0000-0000000f9003', '   ')$s$,
  '23514');

-- d0001: indicador de la base común, sin medio todavía
UPDATE indicadores SET medio_verificacion_id = '00000000-0000-0000-0000-0000000f9002'
  WHERE id = '00000000-0000-0000-0000-0000000d0001';

SELECT pg_temp.debe_pasar('renombrar un medio ya usado por un indicador',
  $s$UPDATE medios_verificacion SET nombre = 'Bitácora de pruebas, renombrada' WHERE id = '00000000-0000-0000-0000-0000000f9002'$s$);

SELECT pg_temp.afirmar('CA-3: el renombre del catálogo llega al texto heredado del indicador que ya lo usaba',
  (SELECT medio_verificacion = 'Bitácora de pruebas, renombrada' FROM indicadores
    WHERE id = '00000000-0000-0000-0000-0000000d0001'));

SELECT pg_temp.debe_pasar('desactivar un medio ya usado',
  $s$UPDATE medios_verificacion SET activo = false WHERE id = '00000000-0000-0000-0000-0000000f9002'$s$);

SELECT pg_temp.afirmar('CA-3: desactivar un medio no borra la referencia del indicador que ya lo usaba',
  (SELECT medio_verificacion_id = '00000000-0000-0000-0000-0000000f9002' FROM indicadores
    WHERE id = '00000000-0000-0000-0000-0000000d0001'));

SELECT pg_temp.debe_fallar('borrar un medio de verificación ya referenciado por un indicador',
  $s$DELETE FROM medios_verificacion WHERE id = '00000000-0000-0000-0000-0000000f9002'$s$, '23503');

\ir resultado.sql
