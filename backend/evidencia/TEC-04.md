# Evidencia — TEC-04: datos iniciales y cuenta Administrador

Fecha: 2026-10-10 · Rama: `tec-04/dataset-origen` · Base del esquema: `main` en `c8c3a37`

## Qué se entregó

| Componente | Ruta |
|---|---|
| Dataset de origen (7 tablas + cuentas de prueba) | `db/semilla/datos/*.csv` |
| Extractor desde el prototipo | `db/semilla/extraer.ts` |
| Traducción prototipo → catálogos del esquema | `db/semilla/mapeos.ts` |
| Cargador idempotente | `db/semilla/cargar.ts` |
| Envoltura de operación | `db/sembrar.sh`, `npm run bd:sembrar` |
| Pruebas | `pruebas/semilla.test.ts` (12 pruebas) |
| Hallazgos y preguntas abiertas | `db/semilla/INCONSISTENCIAS.md` (19) |

## Cómo se reproduce

```sh
createdb comapa_mir
cd backend/db && ./migrar.sh up
cd .. && ./db/sembrar.sh --con-fixtures     # o npm run bd:sembrar
npm test                                    # 51 pruebas, incluidas las 12 de la semilla
```

## Estado de la base tras la carga

```
organizaciones            1
gerencias                 5    (4 activas + Gerencia General inactiva)
unidades                 34
usuarios                 39    (1 admin, 4 revisores, 34 enlaces)
indicadores             155    (123 MIR + 32 gerenciales)
indicadores_con_padre   116
periodos_reporte         28    (los de 2026 de las 6 frecuencias)
reportes                123    (solo con --con-fixtures)
```

Indicadores por gerencia: ADM 53, COM 32, PLA 21, TEC 49.
Reportes por estado: `cerrado` 93, `pendiente_carga` 11, `enviado_revision` 11, `borrador` 4, `observado` 4.

## Criterios de aceptación

| CA | Estado | Evidencia |
|---|---|---|
| **CA-1** — datos institucionales confirmados o identificados como pruebas | **No cumplido** | Las 5 gerencias y 34 unidades están en `confirmacion_institucional=PENDIENTE`. Falta la confirmación de Planeación Estratégica. Las 5 cuentas de prueba sí están identificadas, en `usuarios_prueba.csv` con su motivo |
| **CA-2** — bcrypt de 12 rondas o más | **Cumplido** | Los 39 hashes son `$2b$12$`, con sal propia por usuario (39 hashes distintos). Prueba: «CA-2: las contraseñas son bcrypt de 12 rondas o más» |
| **CA-3** — la carga se repite sin duplicar | **Cumplido** | Segunda corrida: conteos idénticos y mismo `md5` del conjunto de hashes. Prueba: «CA-3: la segunda carga no duplica ni cambia los hashes» |
| **CA-4** — las fixtures no corren por defecto en producción | **Cumplido** | Sin `--con-fixtures` se carga la definición y 0 reportes; con `NODE_ENV=production` el cargador rechaza la bandera y sale con código 1. Prueba: «CA-4: sin --con-fixtures…» |
| **CA-5** — datos para probar aislamiento y estados | **Cumplido** | Aislamiento: cada gerencia activa tiene Revisor y Enlace, y ninguna unidad ni usuario cruza de gerencia. Estados: `pendiente_carga` 11, `borrador` 4 (uno por gerencia, sintéticos — hallazgo 19), `observado` 4, `enviado_revision` 11, `cerrado` 93. Salvedad: PLA se queda sin `pendiente_carga` porque tenía uno solo y es el que se promovió a `borrador` |

## Decisiones tomadas en este ticket

- **Las contraseñas no salen del prototipo.** `session.js` tiene tres credenciales en claro; el
  dataset no las exporta. El cargador genera el hash con una contraseña inicial común
  (`SEMILLA_PASSWORD` si se define) y deja a los 39 usuarios con `debe_cambiar_password = true`.
- **Un hash por usuario.** Hashear una vez y reutilizar habría dejado las 39 cuentas con el mismo
  hash. Cuesta ~9 s por corrida.
- **El hash no se regenera al recargar.** `ON CONFLICT (email) DO UPDATE` actualiza gerencia,
  unidad, nombre y rol, pero no `password_hash`: bcrypt daría un hash distinto cada vez y la
  carga no sería comparable.
- **Los reportes ya cargados no se tocan.** `ON CONFLICT DO NOTHING` en `reportes`, porque 93 de
  las 123 fixtures están `cerrado` y el trigger de TEC-02 impide editarlas sin autorización de
  reapertura.
- **La unidad de 6 usuarios la puso el extractor.** `usuarios.unidad_id` es `NOT NULL` y seis
  cuentas del prototipo no traían unidad; se les asignó la Coordinación General de su gerencia,
  marcado en `unidad_por_defecto`.
- **Se corrigió la gerencia de `revisor@comapa.mx`** a PLA, porque las fixtures lo ponen revisando
  Planeación y Técnica ya tiene revisor. Override explícito en `usuarios_prueba.csv` (hallazgo 18).
- **Cuatro reportes en `borrador` son sintéticos.** El prototipo no traía ninguno y CA-5 lo pide.
  Los valores de avance están declarados en `BORRADORES_CA5` dentro de `extraer.ts`, uno por
  gerencia, y el CSV conserva el estado original en `estado_prototipo` (hallazgo 19).

## Lo que no cierra y por qué

1. **CA-1 depende de Planeación Estratégica.** Mientras `confirmacion_institucional` siga en
   `PENDIENTE`, el criterio no se cumple. Son 5 gerencias y 34 unidades a confirmar sobre
   `gerencias.csv` y `unidades.csv`.
2. **Tres preguntas de `../DECISIONES.md` siguen abiertas y afectan esta carga:** la 5 (¿el
   Administrador tiene gerencia y unidad? ¿Gerencia General existe?), la 24a (¿el Fin es uno o
   cuatro indicadores?) y la 24g (¿32 o 49 indicadores gerenciales?). La respuesta cambia filas,
   no estructura: el dataset se regenera con `node db/semilla/extraer.ts`.
3. **El universo oficial de indicadores sigue sin definirse:** 123 operativos, 193 en el catálogo
   de abril, 132 en la documentación (hallazgo 2).
