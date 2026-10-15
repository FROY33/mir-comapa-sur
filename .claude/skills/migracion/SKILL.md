---
name: migracion
description: Crear o cambiar el esquema o los datos de la base de COMAPA MIR de forma segura — migración SQL nueva en formato dbmate, pruebas de restricciones primero, permisos del rol de la app, diccionario al día y probar.sh completo (incluida la actualización sobre datos de S1). Usar al agregar o cambiar tablas, columnas, índices, CHECK, triggers o al migrar datos.
---

# Migración de base

Contexto: `backend/db/README.md` (reglas), `DICCIONARIO.md` (lo que existe), `EXTENSION.md` (lo diseñado
y aún no migrado), `DECISIONES.md`. Los nombres de tabla siguen el RQM.

## Reglas que no se rompen

1. **Nunca edites una migración ya en `main`.** `migrar.sh` las reconoce por versión, sin checksum: en
   producción el cambio se ignora sin aviso. Se corrige con otra migración.
2. **Primero se agrega, después se quita.** El despliegue migra antes de reiniciar, así que la API anterior
   corre unos segundos sobre el esquema nuevo. Renombrar o borrar algo que el código usa = dos despliegues.
3. **Cada tabla nueva lleva permisos** en `db/permisos.sql` (solo lo que el código hace) y su caso en
   `pruebas/permisos.test.ts`. Sin eso: «permission denied» en producción.
4. **Catálogos de valores con `text` + `CHECK`**, no enums. Estados en la tabla del proceso, no en INDICADORES.
5. **Nada se borra** en tablas de historia (reportes, bitácora, versiones): se marca o se versiona.
6. **Migración de datos:** el `down` dice explícitamente si pierde información.
7. **Nunca pruebes contra la base del servidor.** Allí solo llega por `desplegar.sh`, que respalda antes.

## Pasos

1. **Prueba primero** en `db/pruebas/restricciones.sql` con `pg_temp.debe_fallar(descripción, sentencia, sqlstate)`
   para lo que la base debe rechazar (duplicado `23505`, FK `23503`, CHECK `23514`). Si el cambio toca datos
   existentes, agrega también en `db/probar.sh` (paso 5) la comprobación específica (p. ej. «los 193
   indicadores conservan su medio de verificación»).
2. **Archivo nuevo** `db/migrations/<aaaammdd><nnnnnn>_<tema>.sql`, versión mayor que la última:
   ```sql
   -- migrate:up
   -- Por qué existe, con la ficha (TEC-06 CA-2).
   CREATE TABLE ...;

   -- migrate:down
   DROP TABLE ...;
   ```
   Cada archivo corre en una transacción; no pongas `BEGIN/COMMIT`.
3. **Corre** `db/probar.sh`. Debe pasar los 5 pasos: migraciones en base vacía, restricciones, reversión
   completa y **actualización sobre la base de S1 con semilla y fixtures** sin perder filas. Luego `npm test`.
4. **Documenta:** tabla/campos en `DICCIONARIO.md`; si salió de `EXTENSION.md`, quítala de allí; decisiones
   nuevas en `DECISIONES.md` con fuente y fecha; si cambian los datos iniciales, `db/semilla/`.
5. **Commit** con la ficha: `feat: metas por ejercicio (TEC-06)`; el cuerpo dice si el despliegue requiere
   algo especial (dos fases, carga de datos).

Al cerrar un sprint, sube `BASE_S1` en `db/probar.sh` a su última migración.
