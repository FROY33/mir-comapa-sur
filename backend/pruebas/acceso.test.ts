// TEC-05: auditoría de acceso. Qué se registra, qué nunca se registra y qué no se
// puede alterar. El login y el cierre de sesión todavía no existen como rutas
// (R7-01 y R7-04), así que aquí se ejercita la capa que ellos van a llamar.

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD, type BD } from '../src/bd.js'
import { auditarAcceso, ENTIDAD, registrarAcceso, sinSecretos } from '../src/datos/acceso.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { MAX_INTENTOS, registrarFallo } from '../src/datos/loginIntentos.js'
import { ErrorBD } from '../src/errores.js'
import { crearManejador, ipDelCliente } from '../src/http.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

const correoNuevo = () => `acceso-${randomUUID()}@comapasur.gob.mx`

/** Primera fila de una consulta, fallando con un mensaje claro si no vino ninguna. */
async function fila<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T> {
  const [f] = await bd.consultar<T>(sql, params)
  assert.ok(f !== undefined, `la consulta no devolvió filas: ${sql}`)
  return f
}
const eventos = (email: string) => listarEventos(bd, ENTIDAD, email.toLowerCase())

// Un usuario real: usuario_id en la bitácora tiene FK, y rol y usuario van juntos o ninguno
let usuario: { id: string; rol: 'admin' }
let emailUsuario: string
before(async () => {
  const sufijo = randomUUID()
  const [org] = await bd.consultar<{ id: string }>(
    'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org acceso ${sufijo}`])
  const [ger] = await bd.consultar<{ id: string }>(
    `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'PLA', 'Planeación') RETURNING id`, [org!.id])
  const [uni] = await bd.consultar<{ id: string }>(
    `INSERT INTO unidades (gerencia_id, nombre) VALUES ($1, 'Coordinación General') RETURNING id`, [ger!.id])
  emailUsuario = correoNuevo()
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, 'Quien accede', $3, 'x', 'admin', false) RETURNING id`,
    [ger!.id, uni!.id, emailUsuario])
  usuario = { id: u!.id, rol: 'admin' }
})

describe('CA-1: login exitoso y fallido quedan registrados', () => {
  test('el login exitoso guarda usuario, rol, acción, fecha e IP', async () => {
    await auditarAcceso.loginExitoso(bd, emailUsuario, usuario, '10.0.0.7')
    const [e] = await eventos(emailUsuario)
    assert.equal(e?.accion, 'login_exitoso')
    assert.equal(e?.usuario_id, usuario.id)
    assert.equal(e?.rol, 'admin')
    assert.equal(e?.entidad, ENTIDAD)
    assert.ok(e?.created_at instanceof Date, 'falta la fecha del evento')
    // inet::text agrega la máscara ('10.0.0.7/32'); host() devuelve solo la dirección
    const guardado = await fila<{ ip: string }>('SELECT host(ip) AS ip FROM bitacora WHERE id = $1', [e!.id])
    assert.equal(guardado.ip, '10.0.0.7')
  })

  test('el login fallido se registra aunque la cuenta no exista, y sin usuario', async () => {
    const email = correoNuevo()
    await auditarAcceso.loginFallido(bd, email, 'cuenta_inexistente', '10.0.0.8')
    const [e] = await eventos(email)
    assert.equal(e?.accion, 'login_fallido')
    assert.equal(e?.usuario_id, null, 'un fallo sin usuario identificado no debe inventar uno')
    assert.equal(e?.rol, null)
    assert.deepEqual(e?.detalle, { motivo: 'cuenta_inexistente' })
  })

  test('el correo se normaliza, así que la auditoría de un correo es una sola serie', async () => {
    const email = correoNuevo()
    await auditarAcceso.loginFallido(bd, email.toUpperCase(), 'credenciales')
    await auditarAcceso.loginFallido(bd, `  ${email}  `, 'credenciales')
    assert.equal((await eventos(email)).length, 2)
  })

  test('el bloqueo registra email, IP, fecha y número de intentos', async () => {
    const email = correoNuevo()
    for (let i = 0; i < MAX_INTENTOS; i++) await registrarFallo(bd, email, '10.0.0.9')

    const bloqueos = (await eventos(email)).filter((e) => e.accion === 'cuenta_bloqueada')
    assert.equal(bloqueos.length, 1, 'el bloqueo debe dejar exactamente un evento')
    const [b] = bloqueos
    assert.equal((b!.detalle as { intentos_fallidos: number }).intentos_fallidos, MAX_INTENTOS)
    assert.ok(b!.created_at instanceof Date)

    const guardado = await fila<{ ip: string | null; entidad_id: string }>(
      'SELECT host(ip) AS ip, entidad_id FROM bitacora WHERE id = $1', [b!.id])
    assert.equal(guardado.entidad_id, email.toLowerCase())
    assert.equal(guardado.ip, '10.0.0.9', 'el bloqueo debe guardar la IP del intento')
  })
})

describe('CA-2: el cierre de sesión genera evento', () => {
  test('el logout guarda usuario, rol e IP', async () => {
    const email = correoNuevo()
    await auditarAcceso.logout(bd, email, usuario, '10.0.0.10')
    const [e] = await eventos(email)
    assert.equal(e?.accion, 'logout')
    assert.equal(e?.usuario_id, usuario.id)
    assert.equal(e?.rol, 'admin')
  })
})

describe('CA-3: los eventos persisten', () => {
  test('se leen desde una conexión nueva, no de memoria del proceso', async () => {
    const email = correoNuevo()
    await auditarAcceso.loginExitoso(bd, email, usuario)

    // Pool aparte: si el evento solo viviera en memoria, esta lectura no lo vería
    const otra: BD = crearBD(configBD, crearLog(() => {}))
    try {
      const encontrados = await listarEventos(otra, ENTIDAD, email.toLowerCase())
      assert.equal(encontrados.length, 1)
      assert.equal(encontrados[0]?.accion, 'login_exitoso')
    } finally {
      await otra.cerrar()
    }
  })
})

describe('CA-4: no se registran contraseñas, cookies ni tokens', () => {
  test('sinSecretos oculta las claves sensibles, en cualquier capitalización o con acento', () => {
    const limpio = sinSecretos({
      motivo: 'credenciales',
      password: 'Secreta123',
      passwordHash: '$2b$12$abc',
      Contraseña: 'otra',
      access_token: 'eyJhbG',
      Cookie: 'sesion=abc',
      authorization: 'Bearer xyz',
      anidado: { apiKey: 'k-1', intentos: 3 },
      lista: [{ secret: 's' }, 'texto'],
    }) as Record<string, unknown>

    assert.equal(limpio.motivo, 'credenciales', 'lo que no es secreto se conserva')
    for (const clave of ['password', 'passwordHash', 'Contraseña', 'access_token', 'Cookie', 'authorization']) {
      assert.equal(limpio[clave], '[oculto]', `no se ocultó ${clave}`)
    }
    assert.deepEqual(limpio.anidado, { apiKey: '[oculto]', intentos: 3 })
    assert.deepEqual(limpio.lista, [{ secret: '[oculto]' }, 'texto'])
  })

  test('una cadena de conexión embebida en un texto no entra con su clave', () => {
    const limpio = sinSecretos({ mensaje: 'falló postgres://usuario:MiClave@host:5432/base' }) as { mensaje: string }
    assert.ok(!limpio.mensaje.includes('MiClave'), 'la clave salió en claro')
    assert.ok(limpio.mensaje.includes('***'))
  })

  test('nada de eso llega a la bitácora al registrar un evento real', async () => {
    const email = correoNuevo()
    await registrarAcceso(bd, {
      accion: 'login_fallido',
      email,
      detalle: { motivo: 'credenciales', password: 'Secreta123', cookie: 'sid=1', token: 'eyJhbG' },
    })
    const guardado = await fila<{ detalle: string }>(
      `SELECT detalle::text FROM bitacora WHERE entidad = $1 AND entidad_id = $2`, [ENTIDAD, email.toLowerCase()])
    for (const secreto of ['Secreta123', 'sid=1', 'eyJhbG']) {
      assert.ok(!guardado.detalle.includes(secreto), `el secreto ${secreto} quedó en la bitácora`)
    }
    assert.ok(guardado.detalle.includes('credenciales'), 'el motivo sí debe quedar')
  })

  test('ninguna columna de la bitácora guarda algo que parezca un secreto', async () => {
    const sospechosas = await bd.consultar<{ id: string }>(
      `SELECT id FROM bitacora
       WHERE entidad = $1
         AND (comentario ~* '(password|token|cookie|bearer)'
              OR detalle::text ~* '(Secreta123|eyJhbG|sid=1)')`, [ENTIDAD])
    assert.deepEqual(sospechosas, [])
  })
})

describe('CA-5: los eventos no se pueden alterar ni eliminar', () => {
  const falla = async (promesa: Promise<unknown>) => {
    await assert.rejects(promesa, (err) => {
      assert.ok(err instanceof ErrorBD, `se esperaba ErrorBD y llegó ${String(err)}`)
      assert.equal(err.tipo, 'bloqueado')
      return true
    })
  }

  test('la capa de datos no puede editar ni borrar un evento', async () => {
    const email = correoNuevo()
    await auditarAcceso.loginFallido(bd, email, 'credenciales')
    await falla(bd.consultar(`UPDATE bitacora SET comentario = 'alterado' WHERE entidad = $1`, [ENTIDAD]))
    await falla(bd.consultar(`DELETE FROM bitacora WHERE entidad = $1`, [ENTIDAD]))
  })

  test('el error se traduce a 409 y no filtra el detalle interno', async () => {
    await assert.rejects(
      bd.consultar(`DELETE FROM bitacora WHERE entidad = $1`, [ENTIDAD]),
      (err) => {
        assert.ok(err instanceof ErrorBD)
        assert.equal(err.status, 409)
        assert.ok(!/trigger|plpgsql|bitacora_inmutable/i.test(err.message), 'el mensaje expone interno')
        return true
      })
  })

  test('la API no expone ninguna ruta que escriba en la auditoría', async () => {
    // Se comprueba por comportamiento sobre la app real, no inspeccionando la tabla de rutas
    const { crearApp } = await import('../src/app.js')
    const servidor = createServer(crearApp(bd, crearLog(() => {})))
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
    try {
      for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const ruta of ['/api/bitacora', '/api/auditoria', '/api/acceso', '/api/salud']) {
          const r = await fetch(base + ruta, { method: metodo })
          assert.equal(r.status, 404, `${metodo} ${ruta} debería no existir y devolvió ${r.status}`)
        }
      }
    } finally {
      servidor.closeAllConnections()
      await new Promise((ok) => servidor.close(ok))
    }
  })
})

describe('IP del cliente', () => {
  const pedir = (headers: Record<string, string>, remoto: string) =>
    ipDelCliente({ headers, socket: { remoteAddress: remoto } } as unknown as IncomingMessage, false)

  test('sin confiar en el proxy se usa la dirección del socket, no la cabecera', () => {
    assert.equal(pedir({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1'), '10.0.0.1')
  })

  const detrasDelProxy = (xff: string) => ipDelCliente(
    { headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage, true)

  test('confiando en el proxy se toma la última entrada de X-Forwarded-For, la que agrega el proxy', () => {
    assert.equal(detrasDelProxy('1.2.3.4'), '1.2.3.4')
  })

  test('una entrada inventada por el cliente al inicio de la cabecera no suplanta su IP', () => {
    // nginx con $proxy_add_x_forwarded_for agrega la IP real al final de lo que mandó el cliente
    assert.equal(detrasDelProxy('6.6.6.6, 1.2.3.4'), '1.2.3.4')
  })

  test('un valor que no es IP se ignora y se usa el socket', () => {
    assert.equal(detrasDelProxy('no-es-ip'), '10.0.0.1')
    assert.equal(detrasDelProxy('1.2.3.4, basura'), '10.0.0.1')
  })

  test('una IPv4 mapeada en IPv6 se normaliza', () => {
    assert.equal(pedir({}, '::ffff:192.168.1.5'), '192.168.1.5')
  })

  test('sin dirección se devuelve undefined, no una cadena vacía', () => {
    assert.equal(pedir({}, ''), undefined)
  })

  test('la IP del cliente llega a los manejadores', async () => {
    const app = crearManejador({ 'GET /eco': async (s) => ({ status: 200, cuerpo: { ip: s.ip } }) },
      crearLog(() => {}))
    const servidor = createServer(app)
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
    try {
      const puerto = (servidor.address() as AddressInfo).port
      const r = await fetch(`http://127.0.0.1:${puerto}/eco`)
      assert.deepEqual(await r.json(), { ip: '127.0.0.1' })
    } finally {
      servidor.closeAllConnections()
      await new Promise((ok) => servidor.close(ok))
    }
  })
})
