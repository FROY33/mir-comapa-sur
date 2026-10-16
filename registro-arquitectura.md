# Registro de arquitectura — COMAPA MIR

Decisiones de arquitectura, una por entrada, en orden. **Solo se agrega**: una decisión que cambia no se
edita, se escribe una nueva que la reemplaza y la anterior pasa a «Reemplazada por AR-NNN».

Qué entra aquí: elegir o quitar un componente, un patrón, una dependencia o la forma de servir/operar el
sistema. Qué no: el modelo de datos (va en `backend/db/DECISIONES.md`) ni el estado del código (lo dicen el
código y `git log`). Cada entrada responde a una presión de la tabla «El problema pide…» de `CLAUDE.md`.

Se escribe con `/arquitectura`.

---

## AR-001 — La arquitectura se documenta por el problema, no por el estado del código

- **Fecha:** 15/10/2026 · **Estado:** Vigente
- **Presión:** todas (la tabla de `CLAUDE.md`)
- **Contexto:** `CLAUDE.md` y los skills empezaban a describir archivos y componentes; esas descripciones se
  desfasan (p. ej. `/ficha` decía que las rutas se registran en `rutas.ts`, que es el mapa página→rol). Un
  agente que «hace coincidir» docs y código acaba copiando lo que existe en vez de lo que el problema pide.
- **Decisión:** `CLAUDE.md` describe las presiones del problema, la decisión que cada una motiva y su costo.
  El estado actual se lee del código. Los cambios de arquitectura quedan en este registro.
- **Alternativas descartadas:** mantener un inventario de componentes en `CLAUDE.md` (se desfasa en cada PR);
  un skill que audite docs contra código (refuerza lo existente aunque esté mal).
- **Costo:** quien llega nuevo lee el código para ubicar piezas; el registro hay que alimentarlo a mano.
- **Fuente:** decisión del equipo, 15/10/2026.
