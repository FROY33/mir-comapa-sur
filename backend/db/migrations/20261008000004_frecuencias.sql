-- migrate:up

-- Catálogo fijo de frecuencias + ventana de captura (antes CONFIG_VENTANAS_CAPTURA).
-- meses = duración del periodo; de ahí salen los periodos por año (12 / meses) y los meses de corte.
CREATE TABLE frecuencias (
  clave        text PRIMARY KEY
               CHECK (clave IN ('mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual')),
  nombre       text NOT NULL UNIQUE,
  meses        smallint NOT NULL UNIQUE CHECK (meses IN (1, 2, 3, 4, 6, 12)),
  dias_habiles smallint NOT NULL,
  updated_por  uuid REFERENCES usuarios(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- la ventana no puede ser más larga que el periodo (HU-R3-01 CA_2)
  CHECK (dias_habiles > 0 AND dias_habiles <= meses * 23)
);

-- Valores por defecto de la pantalla de Configuración
INSERT INTO frecuencias (clave, nombre, meses, dias_habiles) VALUES
  ('mensual',       'Mensual',        1, 10),
  ('bimestral',     'Bimestral',      2, 12),
  ('trimestral',    'Trimestral',     3, 15),
  ('cuatrimestral', 'Cuatrimestral',  4, 18),
  ('semestral',     'Semestral',      6, 20),
  ('anual',         'Anual',         12, 30);

CREATE TRIGGER frecuencias_updated_at BEFORE UPDATE ON frecuencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE frecuencias;
