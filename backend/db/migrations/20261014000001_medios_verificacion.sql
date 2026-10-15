-- migrate:up

-- MEDIOS_VERIFICACION: catálogo de medios de verificación. Un indicador tiene un solo medio
-- (decisión del 14/10/2026), así que basta una FK en INDICADORES.
--
-- Primer paso de dos: indicadores.medio_verificacion (texto) se queda mientras el código lo lea
-- (src/datos/pendientes.ts) y la carga inicial lo escriba. Un trigger mantiene texto y FK alineados
-- en ambos sentidos; una migración posterior quita el texto cuando nadie lo use.

-- Misma forma de comparar en el índice único, en la carga y en el trigger
CREATE FUNCTION medio_normalizado(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$;

CREATE TABLE medios_verificacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL CHECK (btrim(nombre) <> ''),
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Sin duplicados que solo difieren en mayúsculas o espacios
CREATE UNIQUE INDEX medios_verificacion_nombre ON medios_verificacion (medio_normalizado(nombre));

CREATE TRIGGER medios_verificacion_updated_at BEFORE UPDATE ON medios_verificacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE indicadores ADD COLUMN medio_verificacion_id uuid REFERENCES medios_verificacion(id);
CREATE INDEX indicadores_medio ON indicadores (medio_verificacion_id);

-- Datos: un medio por texto distinto; el nombre guardado es el texto sin espacios de más, y el
-- texto del indicador pasa a ser ese nombre
INSERT INTO medios_verificacion (nombre)
SELECT DISTINCT ON (medio_normalizado(medio_verificacion)) regexp_replace(btrim(medio_verificacion), '\s+', ' ', 'g')
  FROM indicadores
 WHERE btrim(coalesce(medio_verificacion, '')) <> ''
 ORDER BY medio_normalizado(medio_verificacion), medio_verificacion;

UPDATE indicadores i
   SET medio_verificacion_id = m.id, medio_verificacion = m.nombre
  FROM medios_verificacion m
 WHERE medio_normalizado(i.medio_verificacion) = medio_normalizado(m.nombre);

-- Texto y FK alineados: quien escribe el texto obtiene la FK (creando el medio si hace falta) y el
-- texto queda como lo escribe el catálogo; quien elige la FK obtiene el texto del catálogo.
CREATE FUNCTION indicadores_alinear_medio() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  texto text := regexp_replace(btrim(coalesce(NEW.medio_verificacion, '')), '\s+', ' ', 'g');
BEGIN
  IF TG_OP = 'INSERT' OR NEW.medio_verificacion IS DISTINCT FROM OLD.medio_verificacion THEN
    IF texto = '' THEN
      NEW.medio_verificacion_id := NULL;
      NEW.medio_verificacion := NULL;
    ELSE
      INSERT INTO medios_verificacion (nombre) VALUES (texto)
        ON CONFLICT (medio_normalizado(nombre)) DO NOTHING;
      SELECT id, nombre INTO NEW.medio_verificacion_id, NEW.medio_verificacion
        FROM medios_verificacion WHERE medio_normalizado(nombre) = medio_normalizado(texto);
    END IF;
  ELSIF NEW.medio_verificacion_id IS DISTINCT FROM OLD.medio_verificacion_id THEN
    NEW.medio_verificacion := (SELECT nombre FROM medios_verificacion WHERE id = NEW.medio_verificacion_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER indicadores_medio BEFORE INSERT OR UPDATE OF medio_verificacion, medio_verificacion_id
  ON indicadores FOR EACH ROW EXECUTE FUNCTION indicadores_alinear_medio();

-- migrate:down
-- No pierde información: el texto del medio sigue en indicadores.medio_verificacion.

DROP TRIGGER indicadores_medio ON indicadores;
DROP FUNCTION indicadores_alinear_medio();
ALTER TABLE indicadores DROP COLUMN medio_verificacion_id;
DROP TABLE medios_verificacion;
DROP FUNCTION medio_normalizado(text);
