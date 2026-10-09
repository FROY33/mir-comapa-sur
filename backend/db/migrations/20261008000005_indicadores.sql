-- migrate:up

-- Solo la definición del indicador: sin estado ni metas (TEC-02 CA-4; metas por ejercicio van en METAS).
CREATE TABLE indicadores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerencia_id         uuid NOT NULL REFERENCES gerencias(id),
  unidad_id           uuid,                   -- unidad responsable, informativa
  parent_id           uuid REFERENCES indicadores(id),
  codigo              text NOT NULL UNIQUE,   -- editable; no se genera con contadores
  tipo                text NOT NULL DEFAULT 'mir' CHECK (tipo IN ('mir', 'gerencial')),
  nivel               text CHECK (nivel IN ('fin', 'proposito', 'componente', 'actividad')),
  numero              text,                   -- '1', '1.2', '1.2.3'
  nombre              text NOT NULL,
  resumen_narrativo   text,
  tipo_indicador      text CHECK (tipo_indicador IN ('estrategico', 'gestion')),
  unidad_medida       text NOT NULL,
  frecuencia          text NOT NULL REFERENCES frecuencias(clave),
  tipo_calculo        text NOT NULL DEFAULT 'valor_directo'
                      CHECK (tipo_calculo IN ('valor_directo', 'fraccion')),
  formula             text,
  numerador_desc      text,
  denominador_desc    text,
  denominador_fijo    numeric CHECK (denominador_fijo > 0),
  acumulable          boolean NOT NULL DEFAULT false,
  sentido_meta        text NOT NULL DEFAULT 'ascendente'
                      CHECK (sentido_meta IN ('ascendente', 'descendente')),
  medio_verificacion  text,                   -- texto en S1; FK a MEDIOS_VERIFICACION después
  origen_mv           text CHECK (origen_mv IN ('interno', 'externo', 'mixto')),
  supuestos           text,
  es_iso              boolean NOT NULL DEFAULT false,
  observaciones_mir   text,                   -- notas del Excel, no observaciones del Revisor
  rango_verde_min     numeric NOT NULL DEFAULT 95,
  rango_amarillo_min  numeric NOT NULL DEFAULT 80,
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- la unidad debe pertenecer a la gerencia del indicador
  FOREIGN KEY (unidad_id, gerencia_id) REFERENCES unidades(id, gerencia_id),
  -- los indicadores MIR llevan nivel; los gerenciales no
  CHECK (tipo = 'gerencial' OR nivel IS NOT NULL),
  -- el denominador fijo solo aplica a fracciones
  CHECK (tipo_calculo = 'fraccion' OR denominador_fijo IS NULL),
  CHECK (parent_id <> id),
  CHECK (rango_amarillo_min > 0 AND rango_amarillo_min < rango_verde_min AND rango_verde_min <= 100)
);

CREATE INDEX indicadores_gerencia ON indicadores (gerencia_id) WHERE activo;
CREATE INDEX indicadores_frecuencia ON indicadores (frecuencia) WHERE activo;

CREATE TRIGGER indicadores_updated_at BEFORE UPDATE ON indicadores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE indicadores;
