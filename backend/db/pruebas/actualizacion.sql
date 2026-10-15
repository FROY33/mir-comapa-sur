-- Comprobaciones del paso 5 de probar.sh: después de aplicar las migraciones nuevas sobre la base de
-- S1 con semilla y fixtures, los datos existentes siguen completos y coherentes. Falla con el motivo.

\set VERBOSITY terse
\pset tuples_only on

DO $$
DECLARE
  n bigint;
BEGIN
  -- Medios de verificación (20261014000001): ningún texto se quedó sin medio, y el medio es el mismo texto
  SELECT count(*) INTO n FROM indicadores i LEFT JOIN medios_verificacion m ON m.id = i.medio_verificacion_id
   WHERE btrim(coalesce(i.medio_verificacion, '')) <> ''
     AND (m.id IS NULL OR medio_normalizado(m.nombre) <> medio_normalizado(i.medio_verificacion));
  IF n > 0 THEN RAISE EXCEPTION '% indicadores perdieron su medio de verificación', n; END IF;

  SELECT count(*) - (SELECT count(DISTINCT medio_normalizado(medio_verificacion)) FROM indicadores
                      WHERE btrim(coalesce(medio_verificacion, '')) <> '')
    INTO n FROM medios_verificacion;
  IF n <> 0 THEN RAISE EXCEPTION 'El catálogo de medios no coincide con los textos (diferencia %)', n; END IF;

  -- Versiones (20261014000002): cada indicador tiene versión y cada reporte apunta a una de su indicador
  SELECT count(*) INTO n FROM indicadores i
   WHERE NOT EXISTS (SELECT 1 FROM indicador_versiones v WHERE v.indicador_id = i.id);
  IF n > 0 THEN RAISE EXCEPTION '% indicadores sin versión', n; END IF;

  SELECT count(*) INTO n FROM reportes r JOIN indicador_versiones v ON v.id = r.indicador_version_id
   WHERE v.indicador_id <> r.indicador_id OR v.version <> 1;
  IF n > 0 THEN RAISE EXCEPTION '% reportes de S1 no apuntan a la versión 1 de su indicador', n; END IF;

  SELECT count(*) INTO n FROM indicador_versiones v JOIN indicadores i ON i.id = v.indicador_id
   WHERE v.definicion <> indicador_definicion(i);
  IF n > 0 THEN RAISE EXCEPTION '% versiones no reflejan la configuración actual del indicador', n; END IF;
END;
$$;

SELECT '  ✓ Medios: ' || (SELECT count(*) FROM medios_verificacion) || ' en catálogo para '
    || (SELECT count(*) FROM indicadores WHERE medio_verificacion_id IS NOT NULL) || ' indicadores; '
    || 'versiones: ' || (SELECT count(*) FROM indicador_versiones) || '; reportes con versión: '
    || (SELECT count(*) FROM reportes);
