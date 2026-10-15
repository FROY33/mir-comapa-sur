-- migrate:up

-- Versiones de la configuración del indicador (CA-3: una edición futura no altera la definición
-- usada por reportes anteriores; y conservar asignaciones históricas). Decisión del 14/10/2026:
-- tabla de versiones a la que apunta cada reporte, en vez de ampliar la foto de REPORTES.
--
-- - `definicion` guarda la fila completa del indicador (salvo id, fechas y activo) en jsonb: un campo
--   nuevo de INDICADORES queda versionado sin tocar esta tabla.
-- - gerencia y unidad van además en columnas, para consultar la asignación histórica.
-- - Una versión se congela cuando un reporte la usa. Editar un indicador cuya versión vigente aún no
--   usa nadie la actualiza en su lugar; si ya la usa un reporte, crea la siguiente.
-- - La foto de S1 en REPORTES (frecuencia, rangos…) se queda: la usan el cierre y los tableros.

CREATE TABLE indicador_versiones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id   uuid NOT NULL REFERENCES indicadores(id) ON DELETE CASCADE,
  version        smallint NOT NULL CHECK (version > 0),
  gerencia_id    uuid NOT NULL REFERENCES gerencias(id),
  unidad_id      uuid,
  definicion     jsonb NOT NULL,
  vigente_desde  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indicador_id, version),
  UNIQUE (id, indicador_id),                    -- habilita la FK compuesta desde reportes
  FOREIGN KEY (unidad_id, gerencia_id) REFERENCES unidades(id, gerencia_id)
);

CREATE INDEX indicador_versiones_gerencia ON indicador_versiones (gerencia_id);

-- Lo que define al indicador, sin lo que no es configuración
CREATE FUNCTION indicador_definicion(i indicadores) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(i) - ARRAY['id', 'created_at', 'updated_at', 'activo']
$$;

-- Versión 1 de cada indicador existente, con su configuración actual. Los reportes de S1 la toman:
-- es la mejor aproximación disponible, y su foto de S1 sigue intacta.
INSERT INTO indicador_versiones (indicador_id, version, gerencia_id, unidad_id, definicion, vigente_desde)
SELECT i.id, 1, i.gerencia_id, i.unidad_id, indicador_definicion(i), i.created_at
  FROM indicadores i;

CREATE FUNCTION indicadores_versionar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  def    jsonb := indicador_definicion(NEW);
  actual indicador_versiones%ROWTYPE;
BEGIN
  SELECT * INTO actual FROM indicador_versiones
   WHERE indicador_id = NEW.id ORDER BY version DESC LIMIT 1;

  IF FOUND AND actual.definicion = def THEN
    RETURN NULL;
  END IF;

  IF FOUND AND NOT EXISTS (SELECT 1 FROM reportes WHERE indicador_version_id = actual.id) THEN
    UPDATE indicador_versiones
       SET definicion = def, gerencia_id = NEW.gerencia_id, unidad_id = NEW.unidad_id, vigente_desde = now()
     WHERE id = actual.id;
  ELSE
    INSERT INTO indicador_versiones (indicador_id, version, gerencia_id, unidad_id, definicion)
    VALUES (NEW.id, coalesce(actual.version, 0) + 1, NEW.gerencia_id, NEW.unidad_id, def);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER indicadores_version AFTER INSERT OR UPDATE ON indicadores
  FOR EACH ROW EXECUTE FUNCTION indicadores_versionar();

-- Una versión que usa un reporte no cambia ni se borra; ninguna cambia de indicador o de número
CREATE FUNCTION indicador_versiones_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reportes WHERE indicador_version_id = OLD.id) THEN
    RAISE EXCEPTION 'La versión % del indicador la usa un reporte; no se modifica', OLD.version
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.indicador_id, NEW.version) IS DISTINCT FROM (OLD.indicador_id, OLD.version) THEN
    RAISE EXCEPTION 'Una versión no cambia de indicador ni de número'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER indicador_versiones_proteccion BEFORE UPDATE OR DELETE ON indicador_versiones
  FOR EACH ROW EXECUTE FUNCTION indicador_versiones_proteger();

-- Cada reporte apunta a la versión con la que se creó
ALTER TABLE reportes ADD COLUMN indicador_version_id uuid;

-- Llenado de los reportes existentes. No es una edición del reporte: sin protección ni updated_at,
-- y sin subir lock_version (no invalida formularios abiertos).
ALTER TABLE reportes DISABLE TRIGGER reportes_proteccion;
ALTER TABLE reportes DISABLE TRIGGER reportes_updated_at;
UPDATE reportes r SET indicador_version_id = v.id
  FROM indicador_versiones v WHERE v.indicador_id = r.indicador_id AND v.version = 1;
ALTER TABLE reportes ENABLE TRIGGER reportes_proteccion;
ALTER TABLE reportes ENABLE TRIGGER reportes_updated_at;

ALTER TABLE reportes
  ALTER COLUMN indicador_version_id SET NOT NULL,
  ADD FOREIGN KEY (indicador_version_id, indicador_id) REFERENCES indicador_versiones(id, indicador_id);
CREATE INDEX reportes_indicador_version ON reportes (indicador_version_id);

-- La versión siempre sale del indicador, no del INSERT (igual que la foto de S1)
CREATE FUNCTION reportes_tomar_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.indicador_version_id := (SELECT id FROM indicador_versiones
                                WHERE indicador_id = NEW.indicador_id ORDER BY version DESC LIMIT 1);
  RETURN NEW;
END;
$$;

CREATE TRIGGER reportes_version BEFORE INSERT ON reportes
  FOR EACH ROW EXECUTE FUNCTION reportes_tomar_version();

-- Ni con reapertura autorizada: la versión con la que se creó un reporte es parte de su historia
CREATE FUNCTION reportes_fijar_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.indicador_version_id IS DISTINCT FROM OLD.indicador_version_id THEN
    RAISE EXCEPTION 'La versión del indicador en el reporte % no se puede modificar', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reportes_version_fija BEFORE UPDATE ON reportes
  FOR EACH ROW EXECUTE FUNCTION reportes_fijar_version();

-- migrate:down
-- PIERDE INFORMACIÓN: el historial de versiones de cada indicador y la versión de cada reporte.
-- La foto de S1 en reportes se conserva.

DROP TRIGGER reportes_version_fija ON reportes;
DROP TRIGGER reportes_version ON reportes;
DROP FUNCTION reportes_fijar_version();
DROP FUNCTION reportes_tomar_version();
ALTER TABLE reportes DROP COLUMN indicador_version_id;
DROP TRIGGER indicadores_version ON indicadores;
DROP FUNCTION indicadores_versionar();
DROP TABLE indicador_versiones;
DROP FUNCTION indicador_versiones_proteger();
DROP FUNCTION indicador_definicion(indicadores);
