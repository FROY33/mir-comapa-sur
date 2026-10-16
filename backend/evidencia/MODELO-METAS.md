# Evidencia — Tarea técnica: modelo de indicadores, medios de verificación, ciclos y metas

**Fecha:** 14/10/2026 · **Entorno:** Ubuntu 24.04 (icarus), Node 22.21.1, PostgreSQL 16 (Docker)
**Ficha:** tarea técnica transversal, sin HU en el RQM (sin clave asignada todavía).

## Qué se entrega

| Pieza | Ruta |
|---|---|
| MEDIOS_VERIFICACION + FK en indicadores, con migración de los textos existentes | `db/migrations/20261014000001_medios_verificacion.sql` |
| Versiones del indicador y versión fija en cada reporte | `db/migrations/20261014000002_indicador_versiones.sql` |
| CICLOS_PLANEACION | `db/migrations/20261014000003_ciclos_planeacion.sql` |
| METAS_PLANEACION y METAS_PERIODO | `db/migrations/20261014000004_metas_planeacion.sql` |
| Diccionario | `db/DICCIONARIO-PLANEACION.md`; referencias en `DICCIONARIO.md`, `EXTENSION.md`, `DECISIONES.md`, `README.md` |
| Pruebas SQL | `db/pruebas/modelo-metas.sql` (35); comprobaciones de actualización `db/pruebas/actualizacion.sql` |
| Permisos del rol de la app | `db/permisos.sql` (SELECT en versiones y medios; INSERT de ciclos e INSERT/UPDATE de metas) y pruebas en `pruebas/permisos.test.ts` |

## Decisiones aprobadas (14/10/2026)

- Versionado con tabla `indicador_versiones` a la que apunta cada reporte (opción A), no ampliando la foto.
- Un medio de verificación por indicador.

## Tareas

| Tarea | Estado | Dónde |
|---|---|---|
| Claves, campos y relaciones; definición del indicador separada de las metas por ejercicio | Cumplido | `indicadores` sin metas (S1); metas en `metas_planeacion` por `ciclo_id` |
| Versionar la configuración y conservar asignaciones históricas | Cumplido | `indicador_versiones` (definición completa en jsonb + gerencia y unidad por versión) |
| Migraciones e índices; meta lógica única por indicador/ejercicio; periodos únicos en su versión | Cumplido | Índice único parcial `metas_planeacion_vigente`; PK (meta_id, numero) |

## Criterios

| CA | Estado | Evidencia |
|---|---|---|
| **CA-1** migraciones en base nueva y en la del sprint 1 | Cumplido | `db/probar.sh`: paso 2 (base vacía, 14 migraciones), paso 4 (reversión completa) y paso 5 (base de S1 con semilla y 123 reportes de prueba: ninguna tabla pierde filas; 98 medios para 123 indicadores, 155 versiones, 123 reportes con su versión) |
| **CA-2** metas de distintos ejercicios sin sobrescribirse | Cumplido | Pruebas: metas 2026 y 2027 del mismo indicador con valores propios; segunda meta vigente rechazada; la versión anterior conserva valores y periodos |
| **CA-3** una edición futura no altera la definición usada por reportes anteriores | Cumplido | Pruebas: el reporte previo conserva la versión 1 sin el medio nuevo; la edición crea la versión 2; el reporte siguiente toma la 2; versión en uso no se edita ni se borra; la versión de un reporte no cambia |

## Pruebas mínimas de la ficha

| Prueba | Resultado |
|---|---|
| Recorrido esperado | Medio → versión → ciclo → meta → metas por periodo → cambio de meta (modelo-metas.sql) |
| Datos incompletos | Rechaza medio vacío, meta enviada sin meta anual ni línea base, fechas de ciclo invertidas, cierre sin fecha, periodo inexistente para la frecuencia, meta por periodo negativa |
| Permisos de los tres roles / intento de otra gerencia | **No aplica a esta ficha:** no agrega rutas. El rol de base de la app solo lee versiones y medios, y no puede escribirlos ni tocar ciclos o metas (permisos.test.ts) |
| Persistencia tras reinicio | Base en PostgreSQL con volumen; el despliegue reinicia los servicios y `/api/salud` reporta el esquema nuevo |

```
npm test                → 330 pruebas, 0 fallas
db/probar.sh            → 5 pasos en orden (35 + 58 pruebas SQL)
```

## Límites y notas

- **El criterio de aceptación pegado al final de la ficha es de autenticación (R7)**, no de este modelo. Ya
  está cumplido en HU-R7-01/03/06 (ver sus evidencias); conviene corregir la ficha.
- **Medio de verificación en dos pasos:** el texto `indicadores.medio_verificacion` sigue mientras
  `src/datos/pendientes.ts` y la carga inicial lo usen; un trigger lo alinea con el catálogo. Quitarlo es
  una migración posterior, después de cambiar ese código.
- **Versión 1 de los reportes de S1:** se armó con la configuración del indicador al migrar; la historia
  previa no existía. La foto de S1 de esos reportes sigue intacta.
- **Ciclos y metas:** el rol de la app lee ambos, abre ciclos (`INSERT`) y genera y actualiza metas (`INSERT`/`UPDATE`), sin `DELETE` (tickets 8 y 9). Una meta histórica sigue sin poder modificarse por el trigger.
