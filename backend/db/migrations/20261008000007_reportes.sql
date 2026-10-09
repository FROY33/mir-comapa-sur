-- migrate:up

-- Un reporte lógico por indicador y periodo (TEC-01 CA-3). El estado vive aquí, no en INDICADORES.
-- Los intentos y versiones se guardan aparte (REPORTE_VERSIONES, fuera de S1).
CREATE TABLE reportes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id          uuid NOT NULL REFERENCES indicadores(id),
  periodo_id            uuid NOT NULL,

  -- Foto de la configuración del indicador al crear el reporte (la llena el trigger).
  -- Los cambios al indicador aplican hacia adelante (HU-R4-11 CA_4).
  gerencia_id           uuid NOT NULL REFERENCES gerencias(id),
  unidad_id             uuid,
  frecuencia            text NOT NULL,
  tipo_calculo          text NOT NULL,
  acumulable            boolean NOT NULL,
  sentido_meta          text NOT NULL,
  rango_verde_min       numeric NOT NULL,
  rango_amarillo_min    numeric NOT NULL,

  estado                text NOT NULL DEFAULT 'pendiente_carga' CHECK (estado IN (
                          'pendiente_carga', 'borrador', 'enviado_revision', 'observado', 'corregido',
                          'aprobado_revisor', 'regresado_correccion', 'cerrado', 'incumplido')),
  intento               smallint NOT NULL DEFAULT 0 CHECK (intento >= 0),

  -- Marca de entrega tardía: no es estado y no se quita al enviar (HU-R1-08 RN_5)
  vencido               boolean NOT NULL DEFAULT false,
  vencido_at            timestamptz,

  numerador             numeric CHECK (numerador >= 0),
  denominador           numeric CHECK (denominador > 0),
  avance                numeric CHECK (avance >= 0),

  enviado_por           uuid REFERENCES usuarios(id),
  enviado_at            timestamptz,

  -- Congelado al cerrar (HU-R3-03 CA_4, HU-R4-12 CA_4)
  meta_periodo_aplicada numeric,
  cumplimiento          numeric,
  semaforo              text CHECK (semaforo IN ('verde', 'amarillo', 'rojo', 'na')),
  cerrado_por           uuid REFERENCES usuarios(id),
  cerrado_at            timestamptz,

  lock_version          integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (indicador_id, periodo_id),
  -- el periodo debe ser de la misma frecuencia que el indicador
  FOREIGN KEY (periodo_id, frecuencia) REFERENCES periodos_reporte(id, frecuencia),
  FOREIGN KEY (unidad_id, gerencia_id) REFERENCES unidades(id, gerencia_id),
  CHECK (vencido = (vencido_at IS NOT NULL)),
  CHECK ((estado IN ('cerrado', 'incumplido')) = (cerrado_at IS NOT NULL)),
  CHECK (cerrado_at IS NOT NULL OR (meta_periodo_aplicada IS NULL AND cumplimiento IS NULL AND semaforo IS NULL)),
  CHECK (estado NOT IN ('enviado_revision', 'observado', 'corregido', 'aprobado_revisor', 'regresado_correccion')
         OR enviado_at IS NOT NULL)
);

-- Bandejas y tableros: por periodo/gerencia/estado
CREATE INDEX reportes_periodo_gerencia_estado ON reportes (periodo_id, gerencia_id, estado);
CREATE INDEX reportes_gerencia_estado ON reportes (gerencia_id, estado);

-- Copia la configuración vigente del indicador. Siempre la toma del catálogo, no del INSERT.
CREATE FUNCTION reportes_tomar_foto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ind indicadores%ROWTYPE;
BEGIN
  SELECT * INTO ind FROM indicadores WHERE id = NEW.indicador_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El indicador % no existe', NEW.indicador_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT ind.activo THEN
    RAISE EXCEPTION 'El indicador % está inactivo y no genera reportes', ind.codigo
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.gerencia_id        := ind.gerencia_id;
  NEW.unidad_id          := ind.unidad_id;
  NEW.frecuencia         := ind.frecuencia;
  NEW.tipo_calculo       := ind.tipo_calculo;
  NEW.acumulable         := ind.acumulable;
  NEW.sentido_meta       := ind.sentido_meta;
  NEW.rango_verde_min    := ind.rango_verde_min;
  NEW.rango_amarillo_min := ind.rango_amarillo_min;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reportes_foto BEFORE INSERT ON reportes
  FOR EACH ROW EXECUTE FUNCTION reportes_tomar_foto();

-- Nada se borra; la foto no cambia; un reporte cerrado o incumplido solo se modifica
-- si el backend lo autoriza en la misma transacción (override o reapertura):
--   SET LOCAL app.reapertura = 'on';
CREATE FUNCTION reportes_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los reportes no se borran'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.indicador_id, NEW.periodo_id, NEW.gerencia_id, NEW.unidad_id, NEW.frecuencia,
      NEW.tipo_calculo, NEW.acumulable, NEW.sentido_meta, NEW.rango_verde_min, NEW.rango_amarillo_min)
     IS DISTINCT FROM
     (OLD.indicador_id, OLD.periodo_id, OLD.gerencia_id, OLD.unidad_id, OLD.frecuencia,
      OLD.tipo_calculo, OLD.acumulable, OLD.sentido_meta, OLD.rango_verde_min, OLD.rango_amarillo_min) THEN
    RAISE EXCEPTION 'La foto del indicador en el reporte % no se puede modificar', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.estado IN ('cerrado', 'incumplido')
     AND coalesce(current_setting('app.reapertura', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El reporte % está cerrado; solo se modifica con override o reapertura', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.lock_version := OLD.lock_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reportes_proteccion BEFORE UPDATE OR DELETE ON reportes
  FOR EACH ROW EXECUTE FUNCTION reportes_proteger();
CREATE TRIGGER reportes_updated_at BEFORE UPDATE ON reportes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE reportes;
DROP FUNCTION reportes_proteger();
DROP FUNCTION reportes_tomar_foto();
