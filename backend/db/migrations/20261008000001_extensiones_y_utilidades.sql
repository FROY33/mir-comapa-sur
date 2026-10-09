-- migrate:up

-- Correos sin distinguir mayúsculas (usuarios.email)
CREATE EXTENSION IF NOT EXISTS citext;

-- Mantiene updated_at en cada UPDATE
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- migrate:down

DROP FUNCTION IF EXISTS set_updated_at();
DROP EXTENSION IF EXISTS citext;
