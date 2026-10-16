# Evidencia — S2-TEC-02: cargar y validar el catálogo inicial de indicadores

**Fecha:** 15/10/2026 · **Entorno:** Windows 11, Node 24, PostgreSQL 17 local (pruebas); icarus corre Linux
**Ficha:** tarea técnica propuesta, sin HU en el RQM. Commit `69f1985`, sobre el modelo de S2-TEC-01
(`564591b`, `e31f1b8`).

## Qué se entrega

| Pieza | Ruta |
|---|---|
| Importador repetible del CSV institucional (genera CSV, `manifest.json` y `CONCILIACION.md`) | `db/semilla/importar-csv-unificada.ts`, `db/semilla/conciliacion-catalogo.ts` (`npm run bd:importar-catalogo`) |
| Carga sobre la base del sprint 1: `sembrar.sh --catalogo` (y `--forzar`) | `db/semilla/catalogo.ts`, `db/semilla/organizacion.ts`, `db/semilla/cargar.ts`, `db/semilla/plan.ts`, `db/sembrar.sh` |
| Equivalencias prototipo → código institucional (123 filas) | `db/semilla/datos/equivalencias_prototipo.csv` |
| Datos regenerados (catálogo, fixtures, conteos de gerencias) | `db/semilla/datos/*.csv`, `db/semilla/manifest.json` |
| Reporte de conciliación | `db/semilla/CONCILIACION.md` |
| Diferencia autorizada y decisiones | `db/DECISIONES.md` (filas «Catálogo oficial: 123 o 132» y «Tipo indicador de los ids 26 y 36») |
| La app puede escribir `indicadores` (SELECT, INSERT, UPDATE; nunca DELETE) | `db/permisos.sql`, prueba en `pruebas/permisos.test.ts` |
| CSV de la semilla siempre con LF (el `sha256` de `manifest.json` no cambia en Windows) | `.gitattributes` |
| CA-4a: la pantalla del catálogo sin arreglos del prototipo | `estructura-indicadores.html`, `indicadores-admin.js` |
| Pruebas | `pruebas/catalogo-carga.test.ts` (15) · `pruebas/semilla.test.ts` (15) · `pruebas/permisos.test.ts` (7) |

## Qué hace la carga

- **Renombra, no duplica.** Cada MIR del prototipo (`ADM-ACT-42`…) pasa a su código institucional
  conservando el `id`, así que sus reportes siguen ligados. El emparejamiento es por gerencia y «Número
  indicador» (`equivalencias_prototipo.csv`): **121 renombrados**.
- **Sin equivalente, se desactiva y no se borra:** `ADM-PROP-124` y `COM-ACT-125`. Sus fixtures se
  reasignan a otro indicador de la misma gerencia (listado en `CONCILIACION.md`).
- **Upsert por código** del resto, y 2 MIR institucionales sin MIR del prototipo se insertan.
- **Bitácora:** un evento `catalogo_importado` con conteos y `sha256` de `indicadores.csv`.
- **Los medios de verificación los liga el trigger de S2-TEC-01** al escribir el texto; la carga no
  hace nada más con ellos.
- **No se inventó nada:** `Meta` y `Línea base` vienen vacías en todo el CSV y no se cargan (viven en las
  tablas de metas); se conservan solo en columnas `*_prototipo` del CSV intermedio.

## Cómo se reproduce

```sh
cd backend
./db/migrar.sh up
./db/sembrar.sh --con-fixtures          # base de S1 con códigos del prototipo
./db/sembrar.sh --catalogo              # renombra, upsert, desactiva, registra
./db/sembrar.sh --catalogo              # segunda vez: se niega (RN_4 de HU-R4-11)
./db/sembrar.sh --catalogo --forzar     # recarga explícita; no pisa lo editado desde la pantalla
npm test -- pruebas/catalogo-carga.test.ts
```

## Criterios

| CA | Estado | Evidencia |
|---|---|---|
| **CA-1** 132 indicadores o diferencia autorizada con su fuente | **Cumplido con diferencia autorizada: 123 MIR, no 132** | La PO autorizó la diferencia el 14/10/2026. Fuente: el CSV institucional `2026.09.14-MIR-COMAPA_UNIFICADA.csv` (123 MIR). Por gerencia, CSV frente a `proyecto.md`: PLA 14/15, COM 24/29, ADM 43/46, TEC 40/41, GEN 2/0 (faltan 9). Es **provisional**: se revisa si aparecen los 9 restantes. Quedó en `DECISIONES.md` y en `CONCILIACION.md` (diferencia −9). Prueba: «renombra sin duplicar, conserva los reportes y desactiva sin equivalente (CA-1, CA-2)» |
| **CA-2** la repetición no duplica | **Cumplido** | «renombra sin duplicar…»: 157 filas = 155 + 2 desactivados, ningún código del prototipo queda, los ids de los reportes no cambian. «HU-R4-11 RN_4: sin --forzar se niega y no toca ninguna fila» (conteo y `md5` de `indicadores` y de la bitácora iguales). «--forzar conserva lo que el Administrador editó y lo lista; repetirlo no cambia nada (CA-2)» (misma huella). «el sembrado normal ya no pisa el catálogo una vez importado». Importador: dos corridas seguidas con el CSV institucional dan los mismos bytes (ver Límites) |
| **CA-3** conteos por gerencia, códigos y obligatorios | **Cumplido** | «los conteos por gerencia coinciden con gerencias.csv; ningún MIR queda incompleto (CA-3)»: MIR activos por gerencia iguales a `gerencias.csv`, y 0 MIR sin nombre, unidad de medida, frecuencia ni tipo de cálculo. «los ids 26 y 36 del CSV se cargan como gestión»: 0 MIR sin `tipo_indicador`. «manifest.json y todos los CSV que lista coinciden en conteos y sha256». «cada indicador con texto de medio queda ligado al medio del catálogo con ese nombre» |
| **CA-4** los datos de negocio se consultan desde la BD, no desde arreglos | **Dividido, con aceptación de la PO.** CA-4a cumplido; **CA-4b diferido a los tickets 5 y 10** | **CA-4a:** «CA-4a: la pantalla del catálogo lee de la base» — `estructura-indicadores.html` no carga `mir-actividades-data.js` ni los arreglos y `indicadores-admin.js` pide `/api/admin/indicadores`; se quitaron `buildIndicators` y el `saveIndicator` heredado. **CA-4b:** las demás pantallas siguen con `mir-actividades-data.js` o `planeacion-data.js`; `CONCILIACION.md` las lista una por una con su ticket (ticket 10: planeación, mis actividades, reportes; ticket 5: tableros, detalles, bandeja y revisión) |
| **Pruebas mínimas** | Ver tabla siguiente | |

### Conciliación sobre una carga real

Base desechable: migrar, `sembrar.sh --con-fixtures`, `sembrar.sh --catalogo`. Coincide con `CONCILIACION.md`:

```
MIR activos            123   (GEN 2, PLA 14, COM 24, ADM 43, TEC 40)
gerenciales             32
niveles MIR            Fin 1 · Propósito 1 · Componente 4 · Actividad 117
MIR sin tipo             0
prototipo → institucional   121 renombrados · 2 sin equivalente desactivados
```

### Pruebas mínimas de la ficha

| Prueba | Resultado |
|---|---|
| Recorrido esperado | Base de S1 con reportes → `--catalogo` → mismos reportes en los indicadores renombrados, conteos, bitácora y conciliación (`catalogo-carga.test.ts`) |
| Datos incompletos | Ningún MIR sin los obligatorios (CA-3); los ids 26 y 36 (tipo vacío o inválido en el CSV) se corrigen por decisión de la PO y se listan en `CONCILIACION.md` como correcciones autorizadas; `Meta`/`Línea base` vacías se declaran, no se rellenan |
| Permisos de los tres roles / otra gerencia | **No aplica a la carga:** es una operación de línea de comandos, sin ruta. Lo que sí se verificó: el rol de la app tiene SELECT, INSERT y UPDATE en `indicadores` y no DELETE (`permisos.test.ts`); el aislamiento por gerencia de las cuentas sembradas lo prueba `semilla.test.ts` (CA-5 de TEC-04). El acceso de los roles a la pantalla del catálogo es de HU-R4-11 (`evidencia/HU-R4-11.md`) |
| Persistencia tras reinicio | Los datos viven en PostgreSQL. La persistencia del catálogo tras reiniciar el servidor está en `indicadores-reinicio.test.ts` (HU-R4-11) |

```
npm run tipos                 → limpio
npm test (suite completa)     → 487 pruebas, 482 pasan, 2 fallan (Windows, ver Límites), 2 todo
db/probar.sh                  → 5 pasos; catalogo-admin 19, modelo-metas 35, restricciones 58
```

## Decisiones tomadas en este ticket

- **Renombrar conservando el `id`**, para no perder los reportes de S1 ni tener que reasignarlos.
- **La carga es única (HU-R4-11 RN_4).** Con un `catalogo_importado` previo, `--catalogo` se niega sin tocar la
  base. `--forzar` repite la carga **sin sobrescribir los campos editados desde la pantalla** (eventos
  `indicador_edicion`/`indicador_editado` posteriores a la primera carga) y los lista en la salida y en el evento.
- **Una vez importado, el sembrado normal ya no escribe indicadores.**
- **Ids 26 y 36 como gestión**, por `DECISIONES.md`. El texto del criterio decía «nulo»; la decisión de la PO
  prevalece.
- **Importador determinista** (sin fecha en `CONCILIACION.md`), que regenera `manifest.json` y los conteos de
  `gerencias.csv`. `conciliacion-catalogo.ts` y `organizacion.ts` salen de ficheros que pasaban de ~300 líneas.
- **Gerencia General queda activa con 2 MIR** (Fin y Propósito del CSV). El prototipo no le daba Revisor ni reportes y
  las pruebas de aislamiento de TEC-04 CA-5 fallaban en Linux. **Datos solo de prueba:** un Revisor en
  `usuarios_prueba.csv` y un borrador de `GEN-PROP` en `fixtures_sinteticas.csv`, que el importador no reescribe.
  Ninguna cuenta real cambia.
- **Sobre el modelo de S2-TEC-01:** `permisos.sql` pasa a SELECT, INSERT y UPDATE en `indicadores` (antes solo leía y
  el catálogo no podía guardar nada en producción); `.gitattributes` fija LF en los CSV; `semilla.test.ts` y
  `semilla-inicial.test.ts` llaman `sembrar.sh` y `migrar.sh` con `bash`, así que corren también en Windows.

## Lo que no cierra y por qué

1. **CA-4b → tickets 5 y 10.** Reescribir Consulta MIR, planeación y los tableros es el alcance de esos tickets.
   Hacerlo aquí habría duplicado ese trabajo o dejado este ticket abierto por algo que no puede resolver solo. La PO
   aceptó cerrar con CA-4a; la condición de cierre de la ficha pedía dividir de forma explícita, y así se hizo.
2. **Los 9 MIR que faltan.** La diferencia 123/132 es autorizada pero provisional. No se inventaron.
3. **Pregunta abierta para la PO: ¿quién es el Revisor real de Gerencia General?** Hoy solo existe el de prueba.
   En producción alguien tiene que revisar los reportes de sus 2 indicadores.
4. **`Meta` y `Línea base`** no existen en el CSV institucional; llegarán con los ciclos de planeación.

## Límites de esta evidencia

- **Dos fallos en la suite completa en Windows, previos y ajenos a este ticket:** el tiempo del login bajo carga
  («tres inicios de sesión seguidos…» y «CA_3: la respuesta del login llega en menos de un segundo») y
  `reinicio.test.ts` («el apagado debe ser limpio»: salida `null` tras SIGTERM). Deben pasar en Linux (icarus).
- **La prueba «correrlo dos veces produce los mismos bytes» se omite** cuando el CSV institucional no está en las
  rutas que busca (vive fuera del repositorio, en la carpeta de COMAPA). Se comprobó a mano el 15/10/2026: dos
  corridas de `importar-csv-unificada.ts` con ese CSV dejaron los mismos bytes. Esa corrida mostró además que
  `manifest.json` guardaba un `sha256` viejo de `datos/unidades.csv` (calculado con fin de línea CRLF en Windows); se
  corrigió y la prueba del manifest ahora revisa **todos** los archivos que lista, no solo cuatro.
- **La conciliación de la carga real** (cifras de arriba) se corrió sobre una base desechable, no sobre producción.
  Falta correr `--catalogo` en el servidor, que es un paso del despliegue.
