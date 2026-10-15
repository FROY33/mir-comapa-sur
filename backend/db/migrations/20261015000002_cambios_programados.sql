-- migrate:up

-- Cambios del indicador con vigencia futura (HU-R4-11 CA_4; S2-TEC-01). Decisión de Arquitectura
-- (14/10/2026, DECISIONES.md): tabla aparte y no `vigente_desde_periodo` en INDICADORES, porque la
-- columna dice cuándo aplica un cambio pero no qué valores trae.
-- Gerencia, frecuencia, tipo de cálculo y acumulable de un indicador con reportes o metas no se
-- escriben en `indicadores` al editar: se guardan aquí y se aplican al abrir el periodo siguiente.
CREATE TABLE indicador_cambios_programados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id   uuid NOT NULL REFERENCES indicadores(id),
  -- Solo los valores nuevos, con el nombre de la columna: gerencia_id (con su unidad_id, que debe
  -- pertenecer a la gerencia nueva), frecuencia, tipo_calculo, acumulable
  valores        jsonb NOT NULL,
  vigente_desde  date NOT NULL,                        -- apertura del siguiente periodo, al programarlo
  creado_por     uuid REFERENCES usuarios(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  aplicado_at    timestamptz,
  cancelado_at   timestamptz,
  cancelado_por  uuid REFERENCES usuarios(id),
  CHECK (jsonb_typeof(valores) = 'object' AND valores <> '{}'::jsonb),
  CHECK ((valores - ARRAY['gerencia_id', 'unidad_id', 'frecuencia', 'tipo_calculo', 'acumulable']) = '{}'::jsonb),
  CHECK (aplicado_at IS NULL OR cancelado_at IS NULL),            -- o se aplicó o se canceló
  CHECK (cancelado_por IS NULL OR cancelado_at IS NOT NULL)
);

-- Un cambio pendiente por indicador; los aplicados y cancelados quedan como historia
CREATE UNIQUE INDEX indicador_cambios_pendiente ON indicador_cambios_programados (indicador_id)
  WHERE aplicado_at IS NULL AND cancelado_at IS NULL;
-- Qué toca aplicar al abrir un periodo
CREATE INDEX indicador_cambios_por_vigencia ON indicador_cambios_programados (vigente_desde)
  WHERE aplicado_at IS NULL AND cancelado_at IS NULL;

-- Nada se borra. Un cambio solo puede pasar de pendiente a aplicado o a cancelado, una vez.
CREATE FUNCTION cambios_programados_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los cambios programados no se borran'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.indicador_id, NEW.valores, NEW.vigente_desde, NEW.creado_por, NEW.created_at)
     IS DISTINCT FROM
     (OLD.indicador_id, OLD.valores, OLD.vigente_desde, OLD.creado_por, OLD.created_at) THEN
    RAISE EXCEPTION 'Un cambio programado no se modifica: se cancela y se programa otro'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.aplicado_at IS NOT NULL OR OLD.cancelado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El cambio programado % ya no está pendiente', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cambios_programados_proteccion BEFORE UPDATE OR DELETE ON indicador_cambios_programados
  FOR EACH ROW EXECUTE FUNCTION cambios_programados_proteger();

-- migrate:down

-- Pierde los cambios programados aún no aplicados y la historia de los aplicados o cancelados
DROP TABLE indicador_cambios_programados;
DROP FUNCTION cambios_programados_proteger();
