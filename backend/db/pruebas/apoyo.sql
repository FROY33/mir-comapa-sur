-- Arranque común de las pruebas SQL: transacción que se revierte al final y funciones de aserción.
-- Se incluye con \ir apoyo.sql; el archivo que lo incluye termina con \ir resultado.sql.

\set VERBOSITY terse
\pset tuples_only on
\pset format unaligned

BEGIN;
\o /dev/null

CREATE TEMP TABLE _resultados (n serial, descripcion text);

-- La sentencia debe fallar con el SQLSTATE esperado
CREATE FUNCTION pg_temp.debe_fallar(descripcion text, sentencia text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  obtenido text;
  mensaje  text;
BEGIN
  BEGIN
    EXECUTE sentencia;
  EXCEPTION WHEN OTHERS THEN
    obtenido := SQLSTATE;
    mensaje  := SQLERRM;
  END;
  IF obtenido IS NULL THEN
    RAISE EXCEPTION 'FALLÓ «%»: la base aceptó la operación', descripcion;
  END IF;
  IF obtenido <> esperado THEN
    RAISE EXCEPTION 'FALLÓ «%»: se esperaba % y llegó % (%)', descripcion, esperado, obtenido, mensaje;
  END IF;
  INSERT INTO _resultados (descripcion) VALUES ('rechaza  ' || descripcion);
END;
$$;

-- La sentencia debe funcionar
CREATE FUNCTION pg_temp.debe_pasar(descripcion text, sentencia text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sentencia;
  INSERT INTO _resultados (descripcion) VALUES ('acepta   ' || descripcion);
END;
$$;

CREATE FUNCTION pg_temp.afirmar(descripcion text, condicion boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condicion IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLÓ «%»', descripcion;
  END IF;
  INSERT INTO _resultados (descripcion) VALUES ('cumple   ' || descripcion);
END;
$$;
