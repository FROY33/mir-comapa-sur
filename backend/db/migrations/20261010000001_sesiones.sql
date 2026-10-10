-- migrate:up

-- SESIONES (EXTENSION.md §6, esbozada para HU-R7-04; la necesita el login de R7-01).
--
-- Sesiones en servidor, no JWT: HU-R7-01 RN_2 pide expiración por inactividad que se
-- renueva en cada petición, y el ticket pide revocación. Con JWT ambas cosas obligan a
-- una lista de revocados en base — estado en servidor igual, pero sin poder cortar una
-- sesión al instante.
--
-- El id de la fila NO es el token: el token va hasheado (sha256), así que un volcado de
-- esta tabla no permite suplantar a nadie.
CREATE TABLE sesiones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuarios(id),
  token_hash    text NOT NULL UNIQUE,        -- sha256 del token que viaja en la cookie
  expira_at     timestamptz NOT NULL,        -- se corre hacia adelante en cada petición (RN_2)
  revocada_at   timestamptz,                 -- cierre de sesión o revocación por el Admin
  ip            inet,
  user_agent    text,
  ultimo_uso_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Validar una cookie es buscar por token_hash entre las vigentes
CREATE INDEX sesiones_vigentes ON sesiones (token_hash) WHERE revocada_at IS NULL;
-- Revocar todas las de un usuario (restablecimiento de contraseña, baja de cuenta)
CREATE INDEX sesiones_usuario ON sesiones (usuario_id, expira_at) WHERE revocada_at IS NULL;

-- migrate:down

DROP TABLE sesiones;
