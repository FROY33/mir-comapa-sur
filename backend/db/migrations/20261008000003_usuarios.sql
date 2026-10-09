-- migrate:up

-- Un usuario: un rol, una gerencia y una unidad de adscripción (RQM HU-R7-07, HU-R7-03 RN_3).
-- Los indicadores son de la gerencia; la unidad es informativa y no limita el acceso (HU-R1-01 RN_1).
CREATE TABLE usuarios (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerencia_id           uuid NOT NULL REFERENCES gerencias(id),
  unidad_id             uuid NOT NULL,
  nombre                text NOT NULL,
  email                 citext NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  debe_cambiar_password boolean NOT NULL DEFAULT true,
  rol                   text NOT NULL CHECK (rol IN ('admin', 'revisor', 'enlace')),
  activo                boolean NOT NULL DEFAULT true,
  ultimo_acceso         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- la unidad debe pertenecer a la gerencia del usuario
  FOREIGN KEY (unidad_id, gerencia_id) REFERENCES unidades(id, gerencia_id)
);

CREATE INDEX usuarios_gerencia_rol ON usuarios (gerencia_id, rol) WHERE activo;

CREATE TRIGGER usuarios_updated_at BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE usuarios;
