-- migrate:up

-- CICLOS_PLANEACION: un ciclo de planeación de metas por ejercicio, con dos fases (HU-R4-01).
-- La fase (captura, revisión, cerrado) se calcula de las fechas y de cerrado_manual; no se guarda.
CREATE TABLE ciclos_planeacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejercicio        smallint NOT NULL UNIQUE CHECK (ejercicio BETWEEN 2000 AND 2100),   -- HU-R4-01 RN_1
  inicio_captura   date NOT NULL,
  fin_captura      date NOT NULL,
  inicio_revision  date NOT NULL,
  cerrado_manual   boolean NOT NULL DEFAULT false,                                      -- HU-R4-05 RN_4
  abierto_por      uuid REFERENCES usuarios(id),
  abierto_at       timestamptz NOT NULL DEFAULT now(),
  cerrado_por      uuid REFERENCES usuarios(id),
  cerrado_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (fin_captura > inicio_captura),                                                -- HU-R4-01 CA_3
  CHECK (inicio_revision >= fin_captura),
  CHECK (cerrado_manual = (cerrado_at IS NOT NULL))
);

CREATE TRIGGER ciclos_planeacion_updated_at BEFORE UPDATE ON ciclos_planeacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down
-- Sin datos que perder mientras no exista METAS_PLANEACION (que depende de esta tabla).

DROP TABLE ciclos_planeacion;
