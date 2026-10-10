# Evidencia — TEC-05: auditoría de acceso

Fecha: 2026-10-10 · Rama: `tec-05/auditoria-acceso` · Base: `main` en `c8c3a37`

## Qué ya venía hecho

Buena parte del ticket la entregaron TEC-02, TEC-03 y R7-06. Se documenta para no
atribuirlo a este ticket:

| Checklist de TEC-05 | Dónde estaba |
|---|---|
| Registro reutilizable en AUDIT_LOG | `src/datos/bitacora.ts` — `registrarEvento`, de TEC-03 |
| Restringir modificación y eliminación | Triggers `bitacora_sin_cambios` y `bitacora_sin_truncate`, de TEC-02, con 3 pruebas en `db/pruebas/restricciones.sql` |
| Integrar el bloqueo | `cuenta_bloqueada` y `cuenta_desbloqueada`, de R7-06 |

## Qué agrega este ticket

| Componente | Ruta |
|---|---|
| Vocabulario y escritura de eventos de acceso | `src/datos/acceso.ts` |
| Captura de la IP del cliente | `src/http.ts` — `ipDelCliente`, expuesta en `Solicitud.ip` |
| Ajuste de confianza en el proxy | `src/config.ts` — `CONFIAR_PROXY` |
| Pruebas | `pruebas/acceso.test.ts` — 18 pruebas |
| Persistencia tras reinicio real | `pruebas/reinicio.test.ts` — ampliada con un evento de acceso |

Suite completa: **57 pruebas, 57 pasando** (`npm test`).

### El hueco que se cerró

`registrarFallo(bd, email, ip?)` aceptaba una IP y `bitacora.ip` es de tipo `inet`,
pero **la capa HTTP nunca extraía la IP del cliente**, así que nada se la pasaba: el
evento `cuenta_bloqueada` de R7-06 se guardaba con `ip = NULL`. CA-1 pide
explícitamente la IP en el bloqueo. Ahora `Solicitud.ip` la lleva y queda registrada.

### La decisión de seguridad

`X-Forwarded-For` **no se usa por defecto**. Esa cabecera la puede mandar cualquiera,
así que un backend expuesto directo registraría la IP que el atacante quiera — en una
bitácora, una IP falseable es peor que ninguna. Con `CONFIAR_PROXY=true` (solo cuando
hay un proxy propio delante) se toma el primer salto de la cabecera; si no, la
dirección del socket, que no se puede falsear. Las IPv4 mapeadas en IPv6
(`::ffff:10.0.0.1`) se normalizan.

## Criterios de aceptación

| CA | Estado | Evidencia |
|---|---|---|
| **CA-1** login exitoso y fallido generan registros; el bloqueo registra email, IP, fecha e intentos | **Parcial** | El bloqueo: **cumplido y probado** con email, IP, fecha e intentos. El login exitoso y fallido: la escritura está implementada y probada (`auditarAcceso.loginExitoso` / `loginFallido`), pero **no hay ruta de login que la llame** — eso es R7-01 |
| **CA-2** el cierre de sesión genera evento | **Parcial** | `auditarAcceso.logout` implementado y probado; **no hay ruta de logout** — eso es R7-04 |
| **CA-3** los eventos persisten tras reiniciar | **Cumplido** | Un evento de acceso escrito por el primer proceso se lee después de un SIGTERM y un arranque nuevo (`reinicio.test.ts`), y se lee también desde un pool distinto |
| **CA-4** no se registran contraseñas, cookies ni tokens | **Cumplido** | `sinSecretos` oculta 24 patrones de clave (con o sin acento, en cualquier capitalización, anidados en objetos y arreglos) y pasa los textos por `ocultarSecretos`. Probado de punta a punta leyendo la columna `detalle` de la base |
| **CA-5** usuarios operativos no pueden alterar ni eliminar eventos por la API | **Cumplido** | La API no expone ninguna ruta de escritura sobre la auditoría (verificado con POST, PUT, PATCH y DELETE sobre cuatro rutas), y si se intentara desde la capa de datos la base lo rechaza: el error sale como `ErrorBD` tipo `bloqueado`, status 409, sin filtrar el trigger ni el detalle interno |

## Decisiones tomadas

- **Un solo vocabulario.** `src/datos/acceso.ts` define las cinco acciones
  (`login_exitoso`, `login_fallido`, `logout`, `cuenta_bloqueada`,
  `cuenta_desbloqueada`) y es el único camino para escribirlas, para que R7-01, R7-04
  y R7-06 no inventen cada uno su acción ni su formato. `loginIntentos.ts` se cambió
  para usarlo: mismo comportamiento, y sus 14 pruebas siguen pasando.
- **La llave de la auditoría es el correo normalizado**, no el id de usuario: un login
  fallido puede no tener usuario, y la serie de eventos de un correo debe ser una sola
  aunque se escriba con mayúsculas o espacios.
- **Los secretos se ocultan, no rechazan el evento.** Perder un registro de auditoría
  por un error de quien lo llama es peor que guardarlo incompleto; lo quitado queda
  marcado como `[oculto]`.
- **`logout` se audita como acción propia.** Es una propuesta de TEC-05, no un CA
  original de R7-04, como dice la nota del ticket.
- **La IP se lee con `host(ip)`**, no con `ip::text`: la columna `inet` devuelve la
  máscara (`10.0.0.7/32`).

## Lo que no cierra y por qué

**CA-1 y CA-2 no se pueden verificar de punta a punta porque no existe el login ni el
cierre de sesión.** `src/app.ts` tiene dos rutas, `GET /api/salud` y
`GET /api/frecuencias`, y no hay capa de sesión, cookie ni token en todo `src/`. El
propio encabezado de `loginIntentos.ts` lo dice: «Uso desde el login (R7-01)».

Al 2026-10-10 no hay rama ni PR de R7-01 ni de R7-04. Cuando lleguen, auditar es una
línea por camino:

```ts
await auditarAcceso.loginExitoso(bd, email, { id: usuario.id, rol: usuario.rol }, s.ip)
await auditarAcceso.loginFallido(bd, email, 'credenciales', s.ip, estado.intentos)
await auditarAcceso.logout(bd, email, { id: usuario.id, rol: usuario.rol }, s.ip)
```

Pendiente aparte, fuera de este ticket: **no hay API de lectura de la auditoría**. El
Administrador necesitará consultarla (HU de historial y auditoría global), y eso
requiere autenticación, que depende también de R7-01.
