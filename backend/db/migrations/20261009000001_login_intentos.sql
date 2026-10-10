-- migrate:up

-- Intentos fallidos de inicio de sesión por correo (HU-R7-06). Sin FK a usuarios: un correo que no
-- existe también se cuenta y se bloquea, así el login no revela qué correos están registrados.
CREATE TABLE login_intentos (
  email             citext PRIMARY KEY,
  intentos          smallint NOT NULL DEFAULT 0 CHECK (intentos >= 0),  -- fallos consecutivos
  ultimo_intento_at timestamptz NOT NULL DEFAULT now(),
  bloqueado_hasta   timestamptz                                         -- NULL = sin bloqueo
);

-- migrate:down

DROP TABLE login_intentos;
