-- migrate:up

-- Hoy solo COMAPA Sur; existe para no migrar de forma destructiva si se suman organismos (RNF Escalabilidad)
CREATE TABLE organizaciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gerencias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES organizaciones(id),
  clave           text NOT NULL,              -- 'PLA', 'COM', 'ADM', 'TEC'
  nombre          text NOT NULL,
  titular_nombre  text,                       -- firma de los PDF
  titular_cargo   text,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizacion_id, clave),
  UNIQUE (organizacion_id, nombre)
);

CREATE TABLE unidades (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerencia_id      uuid NOT NULL REFERENCES gerencias(id),
  nombre           text NOT NULL,
  es_coord_general boolean NOT NULL DEFAULT false,
  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gerencia_id, nombre),               -- hay nombres repetidos entre gerencias
  UNIQUE (id, gerencia_id)                    -- habilita FK compuestas (unidad, gerencia)
);

-- Máximo una Coordinación General por gerencia
CREATE UNIQUE INDEX unidades_una_coord_general
  ON unidades (gerencia_id) WHERE es_coord_general;

CREATE TRIGGER gerencias_updated_at BEFORE UPDATE ON gerencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER unidades_updated_at BEFORE UPDATE ON unidades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE unidades;
DROP TABLE gerencias;
DROP TABLE organizaciones;
