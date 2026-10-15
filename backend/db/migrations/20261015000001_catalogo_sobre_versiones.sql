-- migrate:up

-- Ajustes al modelo de S2-TEC-01 (20261014000001-04) que necesita el catálogo administrable (HU-R4-11).
--
-- 1. La app edita indicadores (CA_1). Al hacerlo, los triggers de S2-TEC-01 escriben en
--    indicador_versiones (nueva versión) y en medios_verificacion (medio nuevo escrito como texto),
--    donde el rol de la app solo lee. Corren como el dueño de las tablas (SECURITY DEFINER): la app
--    sigue sin poder escribir esas tablas directamente.
-- 2. Cada meta apunta a la versión del indicador con la que se creó, como cada reporte. Así el
--    cumplimiento (RN_3) y los periodos de la meta usan la frecuencia con que se planeó, aunque
--    después se aplique un cambio programado de frecuencia (CA_4).
-- 3. Una versión que usa una meta también queda congelada (antes solo las de los reportes).

ALTER TABLE metas_planeacion ADD COLUMN indicador_version_id uuid;

-- Llenado de las metas existentes con la versión más reciente de su indicador. No es una edición de la
-- meta: sin protección ni updated_at, y sin subir lock_version.
ALTER TABLE metas_planeacion DISABLE TRIGGER metas_planeacion_proteccion;
ALTER TABLE metas_planeacion DISABLE TRIGGER metas_planeacion_updated_at;
UPDATE metas_planeacion m SET indicador_version_id = (
  SELECT v.id FROM indicador_versiones v WHERE v.indicador_id = m.indicador_id ORDER BY v.version DESC LIMIT 1);
ALTER TABLE metas_planeacion ENABLE TRIGGER metas_planeacion_proteccion;
ALTER TABLE metas_planeacion ENABLE TRIGGER metas_planeacion_updated_at;

ALTER TABLE metas_planeacion
  ALTER COLUMN indicador_version_id SET NOT NULL,
  ADD FOREIGN KEY (indicador_version_id, indicador_id) REFERENCES indicador_versiones(id, indicador_id);
CREATE INDEX metas_planeacion_indicador_version ON metas_planeacion (indicador_version_id);

-- La versión sale del indicador, no del INSERT, y no cambia después
CREATE FUNCTION metas_planeacion_tomar_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.indicador_version_id := (SELECT id FROM indicador_versiones
                                  WHERE indicador_id = NEW.indicador_id ORDER BY version DESC LIMIT 1);
    IF NEW.indicador_version_id IS NULL THEN   -- sin versión = el indicador no existe: el mismo error que su FK
      RAISE EXCEPTION 'El indicador % no existe', NEW.indicador_id USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSIF NEW.indicador_version_id IS DISTINCT FROM OLD.indicador_version_id THEN
    RAISE EXCEPTION 'La versión del indicador en la meta % no se puede modificar', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER metas_planeacion_version BEFORE INSERT OR UPDATE ON metas_planeacion
  FOR EACH ROW EXECUTE FUNCTION metas_planeacion_tomar_version();

-- Versión usada por un reporte o por una meta: congelada
CREATE FUNCTION indicador_version_en_uso(version_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM reportes WHERE indicador_version_id = version_id)
      OR EXISTS (SELECT 1 FROM metas_planeacion WHERE indicador_version_id = version_id)
$$;

CREATE OR REPLACE FUNCTION indicadores_versionar() RETURNS trigger
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

  IF FOUND AND NOT indicador_version_en_uso(actual.id) THEN
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

CREATE OR REPLACE FUNCTION indicador_versiones_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF indicador_version_en_uso(OLD.id) THEN
    RAISE EXCEPTION 'La versión % del indicador la usa un reporte o una meta; no se modifica', OLD.version
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.indicador_id, NEW.version) IS DISTINCT FROM (OLD.indicador_id, OLD.version) THEN
    RAISE EXCEPTION 'Una versión no cambia de indicador ni de número'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Va después de los CREATE OR REPLACE: reemplazar una función le quita SECURITY DEFINER
ALTER FUNCTION indicadores_versionar() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION indicadores_alinear_medio() SECURITY DEFINER SET search_path = public, pg_temp;

-- Los periodos de la meta caben en la frecuencia de SU versión del indicador, no en la vigente
CREATE OR REPLACE FUNCTION metas_periodo_validar() RETURNS trigger
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
    FROM indicador_versiones v JOIN frecuencias f ON f.clave = v.definicion->>'frecuencia'
   WHERE v.id = meta.indicador_version_id;
  IF NEW.numero > periodos THEN
    RAISE EXCEPTION 'El periodo % no existe en un indicador de % periodos por año', NEW.numero, periodos
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:down

-- Pierde la versión de cada meta; las metas y sus periodos se conservan.

CREATE OR REPLACE FUNCTION metas_periodo_validar() RETURNS trigger
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

CREATE OR REPLACE FUNCTION indicador_versiones_proteger() RETURNS trigger
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

CREATE OR REPLACE FUNCTION indicadores_versionar() RETURNS trigger
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

DROP FUNCTION indicador_version_en_uso(uuid);
DROP TRIGGER metas_planeacion_version ON metas_planeacion;
DROP FUNCTION metas_planeacion_tomar_version();
DROP INDEX metas_planeacion_indicador_version;
ALTER TABLE metas_planeacion DROP COLUMN indicador_version_id;

ALTER FUNCTION indicadores_alinear_medio() SECURITY INVOKER RESET search_path;
ALTER FUNCTION indicadores_versionar() SECURITY INVOKER RESET search_path;
