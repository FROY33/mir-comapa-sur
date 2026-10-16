# Evidencia — S2-TEC-03: Medios de verificación (catálogo de consulta y mantenimiento)

**Fecha:** 15/10/2026 · **Entorno:** macOS 26.5, Node 22, PostgreSQL 14+ (local)
**Ficha:** Tarea técnica propuesta (no es HU del RQM), épica R4 — soporte de HU-R4-11. Ticket 4 del sprint 2
(ya referenciado como pendiente en `src/datos/indicadoresAdmin.ts` desde el ticket 3).

## Decisiones tomadas con el equipo antes de implementar

- **Alcance confirmado:** mantenimiento del catálogo (alta, renombre, desactivación) como pantalla propia,
  no solo como efecto colateral de editar un indicador. Rutas propias (`mediosVerificacion.ts`), no dentro
  de `indicadoresAdmin.ts`.
- **Mantenimiento exclusivo del Administrador** (igual que el catálogo de indicadores, ticket 3).
- **Choque con lo decidido en el ticket 3** (`DECISIONES.md`, 14/10/2026: «la app edita indicadores sin
  escribir `medios_verificacion`; solo el trigger-dueño lo hace»): se amplía esa decisión — ver la fila
  nueva en `DECISIONES.md` del 15/10/2026. `permisos.test.ts` ya no exige que el `INSERT` directo falle.
- **Ajuste adicional, a partir de analizar el CSV institucional real** (`db/semilla/datos/indicadores.csv`):
  de 123 MIR con medio, solo 99 valores son distintos y solo 7 se repiten; el catálogo es, en la práctica,
  casi texto libre por indicador. Se encontró un casi-duplicado real que la normalización existente no
  atrapaba («…firmados» / «…firmados.», solo el punto final los distingue). Se confirmó endurecer
  `medio_normalizado()` para ignorar también la puntuación final, no solo mayúsculas y espacios.

## Qué se entrega

| Pieza | Ruta |
|---|---|
| Migración: normalización más estricta (fusiona casi-duplicados existentes), permiso directo de la app sobre `medios_verificacion`, trigger que propaga un renombre al texto heredado | `db/migrations/20261015000003_medios_verificacion_mantenimiento.sql` |
| Permisos del rol de la app: `SELECT, INSERT, UPDATE` en `medios_verificacion` (nunca `DELETE`) | `db/permisos.sql` |
| CRUD del catálogo (listar con filtros, detalle con indicadores que lo usan, alta, renombrar, desactivar, reactivar) | `src/datos/mediosVerificacion.ts`, `src/mediosVerificacion.ts`, registro en `src/app.ts` |
| Pruebas de restricciones de la base (normalización, alta/edición/desactivación directas, no se borra un medio referenciado) | `db/pruebas/medios-verificacion.sql` (9) |
| Corrección de una invariante de `probar.sh` que asumía que ninguna versión histórica diverge nunca de la configuración actual (ya no es cierto cuando una fusión de catálogo edita un indicador con una versión congelada por un reporte — comportamiento correcto del versionado, no un defecto) | `db/pruebas/actualizacion.sql` |
| Pruebas HTTP (permisos, bitácora, duplicados, CA-3, consulta con filtros) | `pruebas/medios-verificacion.test.ts` (14) |
| Prueba de permisos ajustada: ya no exige que la app falle al escribir `medios_verificacion`; nuevo caso que confirma alta/renombre/activo sí y `DELETE` no | `pruebas/permisos.test.ts` |
| Decisión documentada (fuente y fecha) | `db/DECISIONES.md` |
| Diccionario actualizado (normalización, trigger nuevo, permisos) | `db/DICCIONARIO-PLANEACION.md` |

## Criterios

| CA / RN | Estado | Evidencia |
|---|---|---|
| **CA-1** HU-R4-11 selecciona medios existentes desde BD | Cumplido | Ya existía (ticket 3: `<select>` del formulario, solo activos). Se agrega además `GET /api/admin/medios-verificacion` para el mantenimiento, con los mismos activos verificados en prueba |
| **CA-2** No se permite referencia a un medio inexistente | Cumplido | Del lado del indicador: ya cubierto en el ticket 3 (`nombreDeMedioActivo`), con un control en este archivo. Del lado del catálogo: nombre vacío (422) y casi-duplicado — mayúsculas, espacios **y puntuación final** — (409), en BD (`medios-verificacion.sql`) y en HTTP (`medios-verificacion.test.ts`) |
| **CA-3** Las modificaciones no destruyen referencias históricas | Cumplido | Renombrar o desactivar un medio no borra ni invalida `indicadores.medio_verificacion_id` de quien ya lo usa (FK sin `ON DELETE`, nunca hay `DELETE`); el trigger `medios_verificacion_propagar` además actualiza el texto heredado. Probado en BD y en HTTP. Las versiones ya congeladas por un reporte conservan el medio con el que se generó, sin recalcularse (principio existente del modelo) |
| **CA-4** Las operaciones administrativas acordadas están protegidas y auditadas | Cumplido | `protegida(['admin'])` en las 6 rutas (401 sin sesión, 403 a Revisor/Enlace, probado para cada una); alta, renombre, desactivación y reactivación quedan en la bitácora con antes/después, probado |
| Tareas: confirmar campos y reglas | Cumplido | Campo único: `nombre` (obligatorio, único salvo mayúsculas/espacios/puntuación final) y `activo`. Documentado en `DICCIONARIO-PLANEACION.md` |
| Tareas: cargar medios iniciales validados | Cumplido por el esquema | Ya los cargó el ticket 2 (import del CSV institucional) vía el trigger del ticket 3; esta ficha corrige el único casi-duplicado real que había quedado (98 medios para 123 indicadores tras la fusión, verificado en `probar.sh` paso 5) |
| Tareas: implementar consulta y mantenimiento | Cumplido | Ver «Qué se entrega» |

## Verificado con `db/probar.sh` y `npm test`

```
db/probar.sh
  catalogo-admin.sql        19 pruebas pasaron
  medios-verificacion.sql    9 pruebas pasaron
  modelo-metas.sql          35 pruebas pasaron
  restricciones.sql         58 pruebas pasaron
  4. Reversión completa: ✓ la base queda vacía
  5. Actualización sobre S1 con datos:
     ✓ Medios: 98 en catálogo para 123 indicadores; versiones: 172; reportes con versión: 124
     ✓ Ninguna tabla de S1 perdió filas (11 tablas, 393 filas)
  Todo en orden.

npm run tipos   → limpio
npm test        → 532 pruebas: 529 pasan, 0 fallan, 1 omitida, 2 todo
```

(98 medios para 123 indicadores con medio, frente a los 99 valores distintos del CSV: se fusionó el único
casi-duplicado real — confirma el hallazgo hecho antes de implementar.)

## Límites y notas del ticket

- **Sin pantalla propia en el navegador.** La ficha sugiere un perfil «backend y frontend», pero lo que se
  confirmó con el equipo antes de implementar fue el **modelo de permisos y la ubicación del código**
  (rutas propias, mantenimiento exclusivo del Admin), no el diseño de una pantalla. Se entrega la API
  completa (CA-1 a CA-4) y probada; falta decidir y construir la pantalla de `estructura-indicadores.html`
  (o una propia) que la use — queda **Pendiente**, no «Cumplido», hasta que se acuerde el diseño.
- **CA-2 del lado del indicador** (no referenciar un medio inexistente/inactivo) se verificó de nuevo aquí
  como control, pero su cobertura principal sigue siendo la del ticket 3 (`indicadores-admin.test.ts`); no
  se duplicó toda esa batería.
- **La columna de texto heredada** (`indicadores.medio_verificacion`) sigue viva mientras `pendientes.ts` la
  lea (transición documentada desde el ticket 3); esta ficha no la quita, solo la mantiene sincronizada
  también cuando el renombre viene del catálogo.
