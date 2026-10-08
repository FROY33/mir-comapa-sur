# Dataset de origen — TEC-04

Dataset de origen para la carga inicial de datos y cuentas, extraído de los archivos del
prototipo. **Es independiente del esquema de base de datos**: define *qué* se carga, no *cómo*.
El mecanismo de carga (idempotencia, bcrypt, gating de entornos) depende de TEC-02 y TEC-03 y
no forma parte de este directorio.

## Regenerar

```sh
node seed/extract.js      # desde la raíz del repo; sin dependencias
```

El extractor es determinista: misma entrada produce los mismos bytes. Las filas se ordenan
por clave natural y `manifest.json` registra `sha256` por archivo, de modo que dos corridas
son comparables byte a byte. Verificación:

```sh
shasum -a 256 seed/csv/*.csv > /tmp/h1 && node seed/extract.js >/dev/null \
  && shasum -a 256 seed/csv/*.csv | diff /tmp/h1 - && echo "determinista"
```

## Formatos

Se emiten los dos, desde la misma extracción:

- **CSV** (`seed/csv/`) — formato de revisión. `gerencias.csv` y `unidades.csv` están hechos
  para imprimirse y que Planeación Estratégica confirme renglón por renglón (requisito CA-1).
- **JSON** (`seed/json/seed.json`) — bundle para que lo consuma el cargador, con las claves
  naturales declaradas en `_meta.clavesNaturales`.

## Entidades y claves naturales

| Archivo | Filas | Clave natural | Notas |
|---|---|---|---|
| `gerencias.csv` | 5 | `gerencia_clave` | Clave estable (`planeacion`, `comercial`, `administrativa`, `tecnica`, `general`), no el nombre. Ver inconsistencia 1: ¿son 4 o 5? |
| `unidades.csv` | 33 | `gerencia_clave` + `unidad_nombre` | **Derivadas**, no hay catálogo de origen. Ver inconsistencia 6. |
| `usuarios.csv` | 35 | `email` | Sin contraseñas: `password_exportada` siempre `false`. Ver inconsistencia 11. |
| `indicadores_operativos.csv` | 123 | `indicador_id` | Definición MIR, sin estado de flujo. ID opaco, no semántico: ver inconsistencia 4. |
| `indicadores_gerenciales.csv` | 32 | `indicador_id` | Esquema propio (`GER-*`), sin nivel. Ver inconsistencia 10. |
| `catalogo_mir_193.csv` | 193 | `indicador_id` | Catálogo de abril, espacio de IDs disjunto del operativo. Ver inconsistencia 3. |
| `fixtures_reportes.csv` | 123 | `indicador_id` + `periodo` | **Solo pruebas.** Separado de la definición a propósito, para que CA-4 pueda excluirlo por archivo. |

Por qué clave natural y no el ID del prototipo en todos los casos: el nombre de gerencia se
escribe de tres formas distintas entre fuentes (inconsistencia 7) y el prefijo del ID de
indicador contradice el nivel en 27% de los registros (inconsistencia 4). La clave natural es
lo que permite que la carga sea repetible sin duplicar (CA-3); elegirla mal es lo que la
rompe.

## Separación definición / fixtures (CA-4)

Las seis primeras tablas son datos de definición: gerencias, unidades, padrón e indicadores.
`fixtures_reportes.csv` es lo único que contiene estado de flujo simulado (estados, avances,
conteos de evidencia y observaciones del periodo T3-2026). Un cargador que respete CA-4 carga
las seis y excluye la séptima salvo petición explícita.

## Antes de cargar

`gerencias.csv` y `unidades.csv` traen la columna `confirmacion_institucional` en `PENDIENTE`
en todos sus renglones. **CA-1 no se cumple mientras esa columna siga en PENDIENTE**: exige
que los datos provengan de fuentes institucionales confirmadas o estén identificados como
pruebas. La confirmación es decisión de Planeación Estratégica, no del extractor.

Ver `INCONSISTENCIAS.md` para los 11 hallazgos, cuál criterio de aceptación bloquea cada uno
y quién decide.

## Lo que falta para cerrar TEC-04

| Pendiente | Depende de |
|---|---|
| Confirmar gerencias y unidades (quitar `PENDIENTE`) | Dueño funcional |
| Dar de alta un Revisor por gerencia | Propio — ver inconsistencia 8 |
| Resolver responsables sin cuenta | Propio — ver inconsistencia 9 |
| Cargador idempotente sobre estas claves | TEC-02 (esquema, restricciones únicas) |
| Procedimiento controlado de la cuenta Administrador | TEC-03 (stack, manejo de secretos) |
| Hash bcrypt ≥ 12 rounds | TEC-03 (librería, entorno) |
| Gating de fixtures por entorno | TEC-03 (manejo de entornos) |
