-- migrate:up

-- S2-TEC-03 (ticket 4): mantenimiento directo del catálogo de medios de verificación por el
-- Administrador (alta, edición, desactivación). Hasta aquí solo el trigger-dueño escribía
-- medios_verificacion (20261015000001, CA_1: «la app edita indicadores sin escribir esas tablas»);
-- esta ficha agrega una pantalla propia del catálogo, así que la app también necesita escribirla
-- directamente (DECISIONES.md, 15/10/2026).

-- La normalización (medio_normalizado) solo quitaba mayúsculas y espacios de más. El catálogo real
-- (CSV institucional, 123 MIR) trae un casi-duplicado que solo difiere en el punto final:
-- «programa operativo y reportes de seguimiento firmados» / «...firmados.». Antes de endurecer la
-- función hay que fusionar lo que ya choca con la regla nueva, o el índice único no se puede recrear.
-- El repointeo de medio_verificacion_id reactiva el trigger existente indicadores_alinear_medio, que
-- ya deja el texto heredado (indicadores.medio_verificacion) igual al nombre del medio canónico.
DO $$
DECLARE
  dup record;
BEGIN
  FOR dup IN
    SELECT (array_agg(id ORDER BY created_at, id))[1] AS canonico,
           (array_agg(id ORDER BY created_at, id))[2:] AS repetidos
      FROM medios_verificacion
     GROUP BY lower(btrim(regexp_replace(regexp_replace(btrim(nombre), '\s+', ' ', 'g'), '[.,;:]+$', '')))
    HAVING count(*) > 1
  LOOP
    UPDATE indicadores SET medio_verificacion_id = dup.canonico WHERE medio_verificacion_id = ANY (dup.repetidos);
    DELETE FROM medios_verificacion WHERE id = ANY (dup.repetidos);
  END LOOP;
END $$;

DROP INDEX medios_verificacion_nombre;

CREATE OR REPLACE FUNCTION medio_normalizado(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(regexp_replace(btrim(t), '\s+', ' ', 'g'), '[.,;:]+$', '')))
$$;

CREATE UNIQUE INDEX medios_verificacion_nombre ON medios_verificacion (medio_normalizado(nombre));

-- El texto heredado no se actualiza solo al editar el indicador (eso ya lo hace indicadores_alinear_medio);
-- un renombre hecho desde el catálogo también debe llegar a los indicadores que ya apuntan a ese medio,
-- o pendientes.ts (que todavía lee el texto) mostraría el nombre viejo (CA-3: no se pierden referencias).
CREATE FUNCTION medios_verificacion_propagar_nombre() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE indicadores SET medio_verificacion = NEW.nombre WHERE medio_verificacion_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER medios_verificacion_propagar AFTER UPDATE OF nombre ON medios_verificacion
  FOR EACH ROW WHEN (OLD.nombre IS DISTINCT FROM NEW.nombre)
  EXECUTE FUNCTION medios_verificacion_propagar_nombre();

-- migrate:down
-- Sin pérdida de información: se afloja la normalización y se quita el trigger de propagación. Los
-- medios que el paso de arriba fusionó no se pueden volver a separar (eran indistinguibles para el
-- catálogo bajo la regla nueva), pero ningún indicador pierde su medio_verificacion_id ni su texto.

DROP TRIGGER medios_verificacion_propagar ON medios_verificacion;
DROP FUNCTION medios_verificacion_propagar_nombre();

DROP INDEX medios_verificacion_nombre;

CREATE OR REPLACE FUNCTION medio_normalizado(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$;

CREATE UNIQUE INDEX medios_verificacion_nombre ON medios_verificacion (medio_normalizado(nombre));
