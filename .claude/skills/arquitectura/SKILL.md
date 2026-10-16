---
name: arquitectura
description: Decidir y registrar un cambio de arquitectura de COMAPA MIR — atarlo a lo que pide el problema (tabla de CLAUDE.md), contrastar alternativas con su costo, y dejar la entrada AR-NNN en registro-arquitectura.md. Usar al elegir, agregar o quitar un componente, framework, librería, patrón o proceso; al cambiar cómo se sirve u opera el sistema; cuando alguien dice "registra la decisión", "¿usamos X?", "cambiemos la arquitectura" o "por qué está hecho así".
---

# Decisión de arquitectura

Contexto: la tabla «El problema pide…» de `CLAUDE.md` y `registro-arquitectura.md` (lo ya decidido).
El modelo de datos no va aquí: es `/migracion` y `backend/db/DECISIONES.md`.

## 1. Atar la decisión al problema

- ¿Qué fila de la tabla atiende? Si no atiende ninguna, no es una decisión de arquitectura que tomar ahora:
  dilo y para. «Así se hace en otro lado del código» o «es lo estándar» no cuentan como razón.
- Si el problema trae una presión nueva que la tabla no tiene (viene del RQM o del equipo, con fuente),
  propón la fila nueva; no la inventes.
- Revisa el registro: si contradice una entrada vigente, la nueva la reemplaza explícitamente.

## 2. Contrastar antes de decidir

- 2–3 opciones, incluida «no hacer nada», cada una con lo que gana y lo que cuesta frente a esa presión.
- Haz de abogado del diablo contra tu propia recomendación. Recomienda una y pide aprobación
  («¿estás de acuerdo?»); no se escribe la entrada como Vigente sin ella.

## 3. Registrar

Agrega al final de `registro-arquitectura.md` (numeración consecutiva, nunca se reutiliza):

```markdown
## AR-NNN — <la decisión en una línea>

- **Fecha:** dd/mm/aaaa · **Estado:** Vigente | Propuesta | Reemplazada por AR-NNN
- **Presión:** <fila de la tabla de CLAUDE.md>
- **Contexto:** <qué la provocó, con la ficha si hay>
- **Decisión:** <qué se hace>
- **Alternativas descartadas:** <cuál y por qué, en una línea cada una>
- **Costo:** <lo que se acepta perder>
- **Fuente:** <quién lo aprobó, fecha; RQM o ficha>
```

- Una entrada reemplazada solo cambia su **Estado**; el resto no se toca.
- Si cambia el «Por eso…» o el «Costo» de una fila, actualiza la tabla de `CLAUDE.md` en el mismo commit.
- No describas archivos ni componentes actuales: eso se desfasa.

## 4. Cerrar

Commit `docs: <decisión> (AR-NNN)` en su rama, o dentro del PR de la ficha que la motivó; el cuerpo dice por
qué y qué se descartó.
