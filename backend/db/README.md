# Base de datos — COMAPA MIR (S1)

PostgreSQL 14 o superior. Migraciones en SQL puro, versionadas en `migrations/`, en formato
[dbmate](https://github.com/amacneil/dbmate) (`-- migrate:up` / `-- migrate:down`).

| Documento | Contenido |
|---|---|
| [DICCIONARIO.md](DICCIONARIO.md) | Diagrama ER, tablas campo por campo, estados, índices y triggers (TEC-01) |
| [EXTENSION.md](EXTENSION.md) | Diseño de metas, observaciones, evidencias, versiones y validación (TEC-01 CA-4) |
| [DECISIONES.md](DECISIONES.md) | Qué está decidido, con fuente, y qué sigue abierto |

## Instalación en una base vacía

```bash
createdb comapa_mir
cd backend/db
./migrar.sh up                     # aplica las migraciones pendientes, cada una en su transacción
./migrar.sh status                 # qué está aplicado
```

Base destino: `DATABASE_URL` del entorno; si no está, la de `backend/.env`; si tampoco, `postgres:///comapa_mir`.
Desde `backend/` también sirve `npm run bd:migrar`. Otra base: `DATABASE_URL=postgres://usuario:clave@host:5432/base ./migrar.sh up`.

`migrar.sh` solo necesita `psql` y usa la misma tabla de control que dbmate (`schema_migrations`),
así que se puede cambiar a `dbmate up` en cualquier momento sin rehacer nada.

Para revertir la última migración: `./migrar.sh down`.

## Pruebas (evidencia de TEC-02)

```bash
./probar.sh
```

Crea una base desechable, aplica todo, corre `pruebas/restricciones.sql` (58 pruebas) y revierte
todas las migraciones. Después recrea la base de S1 (`MIGRAR_HASTA=$BASE_S1`), la llena con la semilla
y las fixtures, aplica las migraciones nuevas y falla si alguna tabla desaparece o pierde filas
(CA-1: «migraciones ejecutables en una base nueva y en la base del sprint 1»). Al final borra la base. Las pruebas intentan duplicados, referencias inválidas y
estados fuera de regla, y cubren varias frecuencias, varios Enlaces por gerencia y periodos anteriores.

## Reglas para migraciones nuevas

- **Una migración aplicada no se edita.** `migrar.sh` reconoce las migraciones por versión, sin checksum:
  en producción un cambio a un archivo ya aplicado se ignora sin aviso. Se corrige con otra migración.
- **Primero se agrega, después se quita.** `desplegar.sh` migra antes de reiniciar, así que la versión
  anterior de la API corre unos segundos sobre el esquema nuevo. Renombrar o borrar una columna que el
  código usa se hace en dos despliegues: agregar y migrar datos en uno, quitar lo viejo en el siguiente.
- **Cada tabla nueva lleva sus permisos** en `permisos.sql` y su prueba en `pruebas/permisos.test.ts`;
  sin eso, la app recibe «permission denied» después de desplegar.
- **Una migración de datos dice si su `down` pierde información**, y si es así lo deja escrito en el archivo.
- **`probar.sh` pasa completo**, incluido el paso 5 (actualización con datos).
- **Desplegar respalda primero:** `desplegar.sh` corre `respaldar.sh` antes de migrar y no migra si el
  respaldo falla. Cualquier script que toque la base del servidor fuera del despliegue respalda igual.

## Tablas de S1

| Tabla | Nombre en el RQM | Qué guarda |
|---|---|---|
| `organizaciones` | — | Organismo operador (hoy solo COMAPA Sur) |
| `gerencias` | GERENCIAS | Gerencias y su titular (firma de PDF) |
| `unidades` | UNIDADES | Coordinaciones; una Coordinación General por gerencia |
| `usuarios` | USUARIOS | Un rol, una gerencia y una unidad de adscripción por usuario |
| `frecuencias` | CONFIG_VENTANAS_CAPTURA | Las 6 frecuencias y su ventana de captura en días hábiles |
| `indicadores` | INDICADORES | Definición del indicador; sin estado ni metas |
| `periodos_reporte` | CICLOS | Un periodo por frecuencia: periodo medido y ventana de captura |
| `reportes` | REPORTES | Un reporte lógico por indicador y periodo; aquí vive el estado |
| `bitacora` | AUDIT_LOG | Registro de solo inserción |

## Reglas que hace cumplir la base

- **Correo único** sin distinguir mayúsculas (`citext`).
- **Unidad dentro de la gerencia**: FK compuesta `(unidad_id, gerencia_id)` en usuarios, indicadores y reportes.
- **Un reporte por indicador y periodo**, y el periodo debe ser de la misma frecuencia que el indicador.
- **Foto de la configuración**: al crear un reporte, un trigger copia del indicador gerencia, unidad,
  frecuencia, tipo de cálculo, acumulable, sentido de la meta y rangos del semáforo. Los cambios al
  indicador aplican solo hacia adelante (RQM HU-R4-11 CA_4). La foto no se puede modificar después.
- **Reportes cerrados o incumplidos no se editan.** El backend solo puede modificarlos (override o
  reapertura) activando la autorización dentro de la misma transacción:
  ```sql
  BEGIN;
  SET LOCAL app.reapertura = 'on';
  UPDATE reportes SET ... WHERE id = ...;
  INSERT INTO bitacora (...) VALUES (...);   -- registrar el override en la misma transacción
  COMMIT;
  ```
- **Nada se borra**: los reportes no se borran y un indicador con reportes no se puede borrar (se desactiva).
- **Bitácora inmutable**: UPDATE, DELETE y TRUNCATE se rechazan con trigger. En producción, además,
  el usuario de la app solo debe tener `INSERT` y `SELECT` sobre `bitacora`.
- **Vencido es una marca** (`vencido` + `vencido_at`), no un estado. El estado final de lo no
  aprobado al validar es `incumplido`.
- **`lock_version`** sube en cada UPDATE de un reporte. El backend lo usa para control optimista:
  `UPDATE ... WHERE id = $1 AND lock_version = $2`.

## Decisiones

Ver [DECISIONES.md](DECISIONES.md). Cambiar un catálogo de valores (roles, estados) es una migración
nueva que reemplaza el `CHECK`.

## Limitaciones conocidas de S1

Estas tablas quedan para las HU correspondientes; mientras tanto:

- **Sin METAS**: no se puede calcular el cumplimiento. Las columnas de cierre
  (`meta_periodo_aplicada`, `cumplimiento`, `semaforo`) existen, pero quedan vacías.
- **Sin EVIDENCIAS**: la base no puede exigir al menos un archivo para enviar.
- **Sin COMENTARIOS**: un reporte puede llegar a `observado` sin texto de observación.
- **Sin MEDIOS_VERIFICACION**: el medio de verificación va como texto en `indicadores`.
- **Sin VALIDACIONES_PERIODO**: la validación del Admin por gerencia y corte mensual no tiene tabla aún.
  El corte se obtiene del mes de `periodos_reporte.fin_periodo`.
- **Días hábiles**: no hay calendario de festivos; el backend cuenta lunes a viernes al calcular
  `fecha_limite`, que se guarda al crear el periodo y no se recalcula.
- **Número de periodo**: la base no valida que `numero` no exceda los periodos de la frecuencia
  (por ejemplo, 5 en trimestral); lo garantiza el job que crea los periodos.
