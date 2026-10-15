-- Datos base compartidos por las pruebas SQL (se incluyen con \ir después de apoyo.sql).

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
