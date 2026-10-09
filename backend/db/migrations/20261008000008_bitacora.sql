-- migrate:up

-- AUDIT_LOG del RQM. Solo inserción: el trigger rechaza UPDATE, DELETE y TRUNCATE.
CREATE TABLE bitacora (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id      uuid REFERENCES usuarios(id),          -- NULL = acción del sistema
  rol             text CHECK (rol IN ('admin', 'revisor', 'enlace')),  -- rol al momento de la acción
  accion          text NOT NULL,                          -- 'enviado_revision', 'override_manual'...
  entidad         text NOT NULL,                          -- 'reporte', 'usuario', 'frecuencia'...
  entidad_id      text NOT NULL,                          -- texto: algunas llaves no son uuid
  indicador_id    uuid REFERENCES indicadores(id),        -- para el historial por indicador
  estado_anterior text,
  estado_nuevo    text,
  comentario      text,
  detalle         jsonb,                                  -- valores anteriores y nuevos, filtros, etc.
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((usuario_id IS NULL) = (rol IS NULL))
);

CREATE INDEX bitacora_indicador ON bitacora (indicador_id, created_at) WHERE indicador_id IS NOT NULL;
CREATE INDEX bitacora_entidad ON bitacora (entidad, entidad_id, created_at);
CREATE INDEX bitacora_usuario ON bitacora (usuario_id, created_at);

CREATE FUNCTION bitacora_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora es de solo inserción'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER bitacora_sin_cambios BEFORE UPDATE OR DELETE ON bitacora
  FOR EACH ROW EXECUTE FUNCTION bitacora_inmutable();
CREATE TRIGGER bitacora_sin_truncate BEFORE TRUNCATE ON bitacora
  FOR EACH STATEMENT EXECUTE FUNCTION bitacora_inmutable();

-- migrate:down

DROP TABLE bitacora;
DROP FUNCTION bitacora_inmutable();
