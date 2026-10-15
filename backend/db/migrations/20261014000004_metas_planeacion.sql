-- migrate:up

-- METAS_PLANEACION y METAS_PERIODO: metas por indicador y ejercicio, versionadas (HU-R4-01 a R4-12).
-- CA-2: un indicador tiene metas de distintos ejercicios sin sobrescribirlas. Una meta lógica por
-- indicador y ejercicio: solo una versión vigente; un cambio autorizado (HU-R4-12 RN_3) marca la
-- vigente como histórica y crea la siguiente. Las históricas no cambian ni se borran.

CREATE TABLE metas_planeacion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id   uuid NOT NULL REFERENCES indicadores(id),
  ciclo_id       uuid NOT NULL REFERENCES ciclos_planeacion(id),
  version        smallint NOT NULL DEFAULT 1 CHECK (version > 0),
  vigente        boolean NOT NULL DEFAULT true,
  -- fijada / cambio_en_revision se agregan según la pregunta 22 de DECISIONES.md
  estado         text NOT NULL DEFAULT 'meta_pendiente' CHECK (estado IN (
                   'meta_pendiente', 'borrador_meta', 'meta_enviada', 'meta_observada',
                   'meta_corregida', 'meta_validada')),
  intento        smallint NOT NULL DEFAULT 0 CHECK (intento >= 0),
  -- Envío fuera de la fase de captura: marca, no estado (HU-R4-02 RN_2)
  vencida        boolean NOT NULL DEFAULT false,
  vencida_at     timestamptz,
  meta_anual     numeric CHECK (meta_anual >= 0),
  linea_base     numeric CHECK (linea_base >= 0),
  justificacion  text,
  enviada_por    uuid REFERENCES usuarios(id),
  enviada_at     timestamptz,
  validada_por   uuid REFERENCES usuarios(id),
  validada_at    timestamptz,
  lock_version   integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indicador_id, ciclo_id, version),
  CHECK (vencida = (vencida_at IS NOT NULL)),
  -- enviada: con fecha de envío y con meta anual y línea base (HU-R4-04 CA_1)
  CHECK (estado IN ('meta_pendiente', 'borrador_meta')
         OR (enviada_at IS NOT NULL AND meta_anual IS NOT NULL AND linea_base IS NOT NULL)),
  CHECK ((estado = 'meta_validada') = (validada_at IS NOT NULL))
);

-- Una meta lógica por indicador y ejercicio
CREATE UNIQUE INDEX metas_planeacion_vigente ON metas_planeacion (indicador_id, ciclo_id) WHERE vigente;
CREATE INDEX metas_planeacion_ciclo_estado ON metas_planeacion (ciclo_id, estado) WHERE vigente;

CREATE TABLE metas_periodo (
  meta_id       uuid NOT NULL REFERENCES metas_planeacion(id),
  numero        smallint NOT NULL CHECK (numero BETWEEN 1 AND 12),   -- número, no texto ("T1-2026")
  meta_periodo  numeric NOT NULL CHECK (meta_periodo >= 0),
  PRIMARY KEY (meta_id, numero)                                      -- periodos únicos dentro de su versión
);

-- Nada se borra; una versión histórica no cambia. Pasar de vigente a histórica sí se permite.
CREATE FUNCTION metas_planeacion_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las metas no se borran; se versionan'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT OLD.vigente THEN
    RAISE EXCEPTION 'La versión % de la meta es histórica; no se modifica', OLD.version
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.indicador_id, NEW.ciclo_id, NEW.version) IS DISTINCT FROM (OLD.indicador_id, OLD.ciclo_id, OLD.version) THEN
    RAISE EXCEPTION 'Una meta no cambia de indicador, ejercicio ni versión'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.lock_version := OLD.lock_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER metas_planeacion_proteccion BEFORE UPDATE OR DELETE ON metas_planeacion
  FOR EACH ROW EXECUTE FUNCTION metas_planeacion_proteger();
CREATE TRIGGER metas_planeacion_updated_at BEFORE UPDATE ON metas_planeacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- El número de periodo cabe en la frecuencia del indicador (5 no existe en trimestral) y los
-- periodos de una versión histórica no cambian.
CREATE FUNCTION metas_periodo_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  meta metas_planeacion%ROWTYPE;
  periodos smallint;
BEGIN
  SELECT * INTO meta FROM metas_planeacion WHERE id = CASE TG_OP WHEN 'DELETE' THEN OLD.meta_id ELSE NEW.meta_id END;
  IF FOUND AND NOT meta.vigente THEN
    RAISE EXCEPTION 'Los periodos de una meta histórica no se modifican'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT 12 / f.meses INTO periodos
    FROM indicadores i JOIN frecuencias f ON f.clave = i.frecuencia
   WHERE i.id = meta.indicador_id;
  IF NEW.numero > periodos THEN
    RAISE EXCEPTION 'El periodo % no existe en un indicador de % periodos por año', NEW.numero, periodos
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER metas_periodo_validacion BEFORE INSERT OR UPDATE OR DELETE ON metas_periodo
  FOR EACH ROW EXECUTE FUNCTION metas_periodo_validar();

-- migrate:down
-- PIERDE INFORMACIÓN: todas las metas capturadas y su historial.

DROP TABLE metas_periodo;
DROP TABLE metas_planeacion;
DROP FUNCTION metas_periodo_validar();
DROP FUNCTION metas_planeacion_proteger();
