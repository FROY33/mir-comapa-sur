---
name: ficha
description: Trabajar una ficha del RQM de COMAPA MIR (HU-R…, TEC-…, R…) de principio a fin — leerla contra lo decidido, detectar criterios mal pegados, pruebas primero, implementar, escribir la evidencia y cerrar sin completitud ficticia. Usar cuando alguien pega una ficha, dice "empecemos la HU…", "trabajemos TEC-…", "cierra la ficha", "escribe la evidencia".
---

# Ficha del RQM

## 1. Leer antes de escribir código

1. Identifica la ficha (HU-R1-01, TEC-06…) y sus CA / RN. Si es nueva para la rama, crea la rama
   `<ficha-en-minúsculas>/<tema>` desde `main`.
2. Cruza cada criterio con `backend/db/DECISIONES.md` (decididas, supuestos, abiertas) y con lo que ya existe
   (`backend/src`, `backend/db/EXTENSION.md`, `backend/evidencia/`). Dilo si algo ya está hecho.
3. **Revisa la ficha misma.** Las fichas se generan con plantilla y a veces traen secciones de otra:
   un criterio de aceptación de autenticación en una ficha de modelo de datos, «pruebas de permisos de los
   tres roles» en una ficha sin rutas. Señálalo y pregunta; no escribas pruebas para cumplir texto que no aplica.
4. Si un criterio depende de una pregunta abierta, propón un supuesto barato de cambiar y anótalo en
   `DECISIONES.md` (tabla de supuestos) en vez de bloquearte.
5. Antes de una decisión de diseño grande, presenta 2–3 opciones con su costo y una recomendación.

## 2. Pruebas primero

- Una prueba por CA/RN que lo permita, en `backend/pruebas/<tema>.test.ts` (`node:test`, `tsx`).
  Apoyos existentes: `pruebas/apoyo.ts`, `apoyo-login.ts`, `apoyo-frontend.ts`.
- Reglas de la base: además, casos en `backend/db/pruebas/restricciones.sql` (ver `/migracion`).
- Córrela y confirma que falla por la razón correcta antes de implementar.

## 3. Implementar

- Datos en `backend/src/datos/<tema>.ts`, ruta HTTP en `backend/src/<tema>.ts`, registro en `app.ts` (`rutas.ts` es el mapa página→rol).
- La autorización vive en el backend (la gerencia sale de la sesión, nunca del query string).
- Cambios de base → `/migracion`. Permisos nuevos del rol de la app → `backend/db/permisos.sql` + `pruebas/permisos.test.ts`.
- `npm test`, `npm run tipos` y, si tocaste la base, `db/probar.sh`: todo en verde.

## 4. Evidencia

`backend/evidencia/<FICHA>.md`, mismo formato que las existentes (ver `HU-R1-01.md`):

```markdown
# Evidencia — <FICHA>: <título>

**Fecha:** dd/mm/aaaa · **Entorno:** <SO>, Node <v>, PostgreSQL <v>

## Qué se entrega
| Pieza | Ruta |

## Criterios
| CA / RN | Estado | Evidencia |      ← Cumplido / Cumplido por el esquema / Parcial / Pendiente

## Verificado con servidores reales (HTTP)   ← salida real, recortada; nunca inventada

## Límites y notas del ticket
```

## 5. Cerrar

- **Sin completitud ficticia.** Si un criterio no se puede comprobar porque depende de otra ficha,
  queda «Pendiente» con la dependencia nombrada, o la ficha se divide explícitamente. Nunca «Cumplido».
- Lo que no se verificó (p. ej. la pantalla en navegador) se dice en «Límites».
- Commit con el formato de `CLAUDE.md`; el cuerpo dice el estado y el siguiente paso. PR contra `main`.
