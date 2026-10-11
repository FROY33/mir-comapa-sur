// HU-R7-06: bloqueo por intentos fallidos. Cada prueba usa un correo propio; para simular el paso
// del tiempo se mueve bloqueado_hasta hacia atrás en la base, sin esperar 15 minutos.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { listarEventos } from '../src/datos/bitacora.js'
import {
  consultarBloqueo, desbloquear, MAX_INTENTOS, MENSAJE_BLOQUEO, MINUTOS_BLOQUEO, registrarFallo, reiniciar,
  reservarIntento,
} from '../src/datos/loginIntentos.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

const correoNuevo = () => `prueba-${randomUUID()}@comapasur.gob.mx`

async function fallar(email: string, veces: number) {
  let estado
  for (let i = 0; i < veces; i++) estado = await registrarFallo(bd, email, '10.0.0.7')
  return estado!
}

// Lleva el fin del bloqueo al pasado, como si ya hubieran pasado los 15 minutos
const vencerBloqueo = (email: string) =>
  bd.consultar(`UPDATE login_intentos SET bloqueado_hasta = now() - interval '1 second' WHERE email = $1`, [email])

const eventosBloqueo = async (email: string) =>
  (await listarEventos(bd, 'acceso', email)).filter((e) => e.accion === 'cuenta_bloqueada')

// Un Administrador real: desbloquear() deja su id en la bitácora y la FK lo exige
let adminId: string
before(async () => {
  const sufijo = randomUUID()
  const [org] = await bd.consultar<{ id: string }>(
    'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org ${sufijo}`])
  const [ger] = await bd.consultar<{ id: string }>(
    `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'PLA', 'Planeación') RETURNING id`, [org!.id])
  const [uni] = await bd.consultar<{ id: string }>(
    `INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, 'Coordinación General', true) RETURNING id`,
    [ger!.id])
  const [adm] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol)
     VALUES ($1, $2, 'Admin de prueba', $3, 'x', 'admin') RETURNING id`,
    [ger!.id, uni!.id, `admin-${sufijo}@comapasur.gob.mx`])
  adminId = adm!.id
})

describe('CA_1: bloqueo tras 5 intentos consecutivos', () => {
  test('con 4 fallos la cuenta sigue abierta', async () => {
    const email = correoNuevo()
    const estado = await fallar(email, MAX_INTENTOS - 1)
    assert.equal(estado.intentos, 4)
    assert.equal(estado.bloqueado, false)
    assert.equal((await consultarBloqueo(bd, email)).bloqueado, false)
  })

  test('el quinto fallo bloquea 15 minutos', async () => {
    const email = correoNuevo()
    const estado = await fallar(email, MAX_INTENTOS)
    assert.equal(estado.intentos, 5)
    assert.equal(estado.bloqueado, true)

    // El bloqueo se fija al confirmar el quinto fallo: dura 15 minutos desde ese momento (±1 s)
    const [{ segundos }] = await bd.consultar<{ segundos: number }>(
      `SELECT extract(epoch FROM bloqueado_hasta - now()) AS segundos
         FROM login_intentos WHERE email = $1`, [email]) as [{ segundos: number }]
    assert.ok(Math.abs(Number(segundos) - MINUTOS_BLOQUEO * 60) < 1, `duración: ${segundos} s`)
    assert.equal((await consultarBloqueo(bd, email)).bloqueado, true)
  })

  test('durante el bloqueo, más fallos no suman, no lo alargan ni repiten el evento', async () => {
    const email = correoNuevo()
    const bloqueo = await fallar(email, MAX_INTENTOS)
    const despues = await fallar(email, 3)
    assert.equal(despues.intentos, 5)
    assert.deepEqual(despues.bloqueadoHasta, bloqueo.bloqueadoHasta)
    assert.equal((await eventosBloqueo(email)).length, 1)
  })

  test('mayúsculas y espacios cuentan como el mismo correo', async () => {
    const email = correoNuevo()
    await fallar(`  ${email.toUpperCase()} `, 2)
    await fallar(email, 3)
    assert.equal((await consultarBloqueo(bd, email)).bloqueado, true)
  })

  test('un correo que no existe también se bloquea (el login no revela qué correos hay)', async () => {
    const email = correoNuevo()
    const [existe] = await bd.consultar('SELECT 1 FROM usuarios WHERE email = $1', [email])
    assert.equal(existe, undefined)
    assert.equal((await fallar(email, MAX_INTENTOS)).bloqueado, true)
  })

  test('10 fallos simultáneos bloquean una sola vez', async () => {
    const email = correoNuevo()
    await Promise.all(Array.from({ length: 10 }, () => registrarFallo(bd, email)))
    const estado = await consultarBloqueo(bd, email)
    assert.equal(estado.intentos, 5)
    assert.equal(estado.bloqueado, true)
    assert.equal((await eventosBloqueo(email)).length, 1)
  })
})

describe('reserva antes de comparar (auditoría 10/10/2026)', () => {
  test('con 5 intentos en curso, el sexto se niega sin llegar a comparar', async () => {
    const email = correoNuevo()
    for (let i = 0; i < MAX_INTENTOS; i++) assert.equal((await reservarIntento(bd, email)).permitido, true)
    const sexto = await reservarIntento(bd, email)
    assert.equal(sexto.permitido, false)
  })

  test('si el intento en curso era la contraseña correcta, reiniciar() libera el cupo', async () => {
    const email = correoNuevo()
    for (let i = 0; i < MAX_INTENTOS; i++) await reservarIntento(bd, email)
    await reiniciar(bd, email)
    assert.equal((await reservarIntento(bd, email)).permitido, true)
  })

  test('reservas huérfanas de hace más de un minuto no dejan la cuenta trabada', async () => {
    const email = correoNuevo()
    for (let i = 0; i < MAX_INTENTOS; i++) await reservarIntento(bd, email)
    await bd.consultar(
      `UPDATE login_intentos SET ultimo_intento_at = now() - interval '2 minutes' WHERE email = $1`, [email])
    assert.equal((await reservarIntento(bd, email)).permitido, true)
    assert.equal((await consultarBloqueo(bd, email)).intentos, 1)
  })

  test('durante un bloqueo la reserva se niega y no mueve el contador', async () => {
    const email = correoNuevo()
    await fallar(email, MAX_INTENTOS)
    assert.equal((await reservarIntento(bd, email)).permitido, false)
    assert.equal((await consultarBloqueo(bd, email)).intentos, MAX_INTENTOS)
  })
})

describe('CA_2: mensaje de bloqueo', () => {
  test('el texto es el del RQM', () => {
    assert.equal(MENSAJE_BLOQUEO,
      'Tu cuenta ha sido bloqueada temporalmente por múltiples intentos fallidos. ' +
      'Espera 15 minutos o contacta al Administrador')
  })
})

describe('CA_3: el bloqueo queda en la bitácora', () => {
  test('con correo, IP, fecha e intentos fallidos', async () => {
    const email = correoNuevo()
    await fallar(email, MAX_INTENTOS)
    const [evento] = await eventosBloqueo(email)
    assert.ok(evento)
    assert.equal(evento.entidad_id, email)
    assert.equal(evento.usuario_id, null)          // lo hace el sistema, no un usuario
    assert.ok(evento.created_at instanceof Date)
    assert.equal((evento.detalle as { intentos_fallidos: number }).intentos_fallidos, 5)
    const [{ ip }] = await bd.consultar<{ ip: string }>(
      'SELECT host(ip) AS ip FROM bitacora WHERE id = $1', [evento.id]) as [{ ip: string }]
    assert.equal(ip, '10.0.0.7')
  })
})

describe('expiración del bloqueo', () => {
  test('pasados los 15 minutos la cuenta se abre y la cuenta de fallos empieza de nuevo', async () => {
    const email = correoNuevo()
    await fallar(email, MAX_INTENTOS)
    await vencerBloqueo(email)
    assert.equal((await consultarBloqueo(bd, email)).bloqueado, false)

    const estado = await registrarFallo(bd, email)
    assert.equal(estado.intentos, 1)
    assert.equal(estado.bloqueado, false)
  })

  test('después de vencer, otros 5 fallos vuelven a bloquear y dejan un segundo evento', async () => {
    const email = correoNuevo()
    await fallar(email, MAX_INTENTOS)
    await vencerBloqueo(email)
    assert.equal((await fallar(email, MAX_INTENTOS)).bloqueado, true)
    assert.equal((await eventosBloqueo(email)).length, 2)
  })
})

describe('CA_4: desbloqueo manual del Administrador', () => {
  test('abre la cuenta sin esperar y deja el evento con el Administrador', async () => {
    const email = correoNuevo()
    await fallar(email, MAX_INTENTOS)
    assert.equal(await desbloquear(bd, email, { usuarioId: adminId }, '10.0.0.1'), true)

    const estado = await consultarBloqueo(bd, email)
    assert.equal(estado.bloqueado, false)
    assert.equal(estado.intentos, 0)

    const eventos = (await listarEventos(bd, 'acceso', email)).filter((e) => e.accion === 'cuenta_desbloqueada')
    assert.equal(eventos.length, 1)
    assert.equal(eventos[0]!.usuario_id, adminId)
    assert.equal(eventos[0]!.rol, 'admin')
  })

  test('sobre una cuenta que no está bloqueada no hace nada ni deja evento', async () => {
    const email = correoNuevo()
    await fallar(email, 2)
    assert.equal(await desbloquear(bd, email, { usuarioId: adminId }), false)
    assert.equal((await consultarBloqueo(bd, email)).intentos, 2)
    assert.equal((await listarEventos(bd, 'acceso', email)).length, 0)
  })
})

describe('CA_5: un login correcto reinicia el contador', () => {
  test('4 fallos, login correcto y 4 fallos más no bloquean: los fallos deben ser consecutivos', async () => {
    const email = correoNuevo()
    await fallar(email, 4)
    await reiniciar(bd, email)
    assert.equal((await consultarBloqueo(bd, email)).intentos, 0)
    assert.equal((await fallar(email, 4)).bloqueado, false)
  })
})

describe('persistencia', () => {
  test('el contador sobrevive a un reinicio del backend (otra conexión lo ve)', async () => {
    const email = correoNuevo()
    await fallar(email, 3)
    const otra = crearBD(configBD, crearLog(() => {}))
    try {
      assert.equal((await consultarBloqueo(otra, email)).intentos, 3)
    } finally {
      await otra.cerrar()
    }
  })
})
