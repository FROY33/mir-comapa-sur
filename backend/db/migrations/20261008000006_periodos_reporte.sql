-- migrate:up

-- CICLOS del RQM: un periodo de reporte por frecuencia (T2-2026, junio-2026...).
-- Separa el periodo medido (inicio/fin) de la ventana de captura (abre/fecha_limite),
-- porque la captura puede ocurrir después del periodo (anual: del 1 al 30 de enero siguiente).
-- El corte mensual de validación de la gerencia es el mes de fin_periodo.
CREATE TABLE periodos_reporte (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frecuencia     text NOT NULL REFERENCES frecuencias(clave),
  ejercicio      smallint NOT NULL CHECK (ejercicio BETWEEN 2020 AND 2100),
  numero         smallint NOT NULL CHECK (numero BETWEEN 1 AND 12),
  etiqueta       text NOT NULL,               -- 'T2-2026'
  inicio_periodo date NOT NULL,
  fin_periodo    date NOT NULL,
  abre_captura   date NOT NULL,
  fecha_limite   date NOT NULL,               -- calculada al crear el periodo; no se recalcula
  estado         text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  cerrado_por    uuid REFERENCES usuarios(id),
  cerrado_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (frecuencia, ejercicio, numero),
  UNIQUE (frecuencia, etiqueta),
  UNIQUE (id, frecuencia),                    -- habilita FK compuesta desde reportes
  CHECK (inicio_periodo <= fin_periodo),
  CHECK (abre_captura <= fecha_limite),
  CHECK ((estado = 'cerrado') = (cerrado_at IS NOT NULL))
);

-- Consulta por corte mensual y por periodos abiertos
CREATE INDEX periodos_reporte_fin ON periodos_reporte (fin_periodo);
CREATE INDEX periodos_reporte_abiertos ON periodos_reporte (frecuencia) WHERE estado = 'abierto';

-- migrate:down

DROP TABLE periodos_reporte;
