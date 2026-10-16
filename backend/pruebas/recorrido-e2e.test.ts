// Recorrido de punta a punta. Levanta los dos servidores reales —el backend y el del
// sitio— y recorre el camino de un usuario a través del sitio, como lo haría un
// navegador: todo pasa por el mismo origen y las cookies viajan solas.
//
// Las demás pruebas verifican cada pieza por separado. Esta verifica que encajen: que
// la guardia del sitio consulte al backend, que la cookie de destino escrita por uno la
// valide el otro, que la sesión que se revoca deje de servir en los dos, y que todo el
// recorrido quede en la bitácora.

import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { ENTIDAD } from '../src/datos/acceso.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'
import { arrancar, navegador as navegadorEn, PASSWORD, puertoLibre } from './apoyo-e2e.js'

const bd = crearBD(configBD, crearLog(() => {}))

let sitio = ''
const navegador = () => navegadorEn(sitio)
const procesos: ChildProcess[] = []

before(async () => {
  const [puertoApi, puertoSitio] = [await puertoLibre(), await puertoLibre()]
  const api = arrancar('src/servidor.ts', { PORT: String(puertoApi) }, 'Conectado a la BD')
  procesos.push(api.proceso)
  await api.listo
  const web = arrancar('src/sitio.ts', {
    PUERTO_SITIO: String(puertoSitio),
    BACKEND_URL: `http://127.0.0.1:${puertoApi}`,
  }, 'Prototipo en')
  procesos.push(web.proceso)
  await web.listo
  sitio = `http://127.0.0.1:${puertoSitio}`
})

after(async () => {
  for (const p of procesos) p.kill('SIGTERM')
  await bd.cerrar()
})

/** Crea un usuario real en la base. */
async function usuario(rol: 'admin' | 'revisor' | 'enlace') {
  const sufijo = randomUUID()
  const [org] = await bd.consultar<{ id: string }>(
    'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org e2e ${sufijo}`])
  const [g] = await bd.consultar<{ id: string }>(
    `INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, 'TEC', 'Gerencia Técnica') RETURNING id`, [org!.id])
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO unidades (gerencia_id, nombre) VALUES ($1, 'Coordinación General Técnica') RETURNING id`, [g!.id])
  const email = `e2e-${sufijo}@comapasur.gob.mx`
  await bd.consultar(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, 'Quien recorre', $3, $4, $5, false)`,
    [g!.id, u!.id, email, await bcrypt.hash(PASSWORD, 12), rol])
  return email
}

const PROPIAS: Record<string, string[]> = {
  admin: ['dashboard-admin.html', 'configuracion.html', 'reportes.html'],
  revisor: ['dashboard-revisor.html', 'bandeja-revision.html', 'reportes-revisor.html'],
  enlace: ['dashboard-enlace.html', 'mis-actividades.html', 'mis-observaciones.html'],
}
const AJENAS: Record<string, string[]> = {
  admin: ['dashboard-revisor.html', 'mis-actividades.html'],
  revisor: ['dashboard-admin.html', 'configuracion.html'],
  enlace: ['dashboard-admin.html', 'bandeja-revision.html'],
}

describe('anónimo', () => {
  test('una página protegida lo manda al login y recuerda a dónde iba', async () => {
    const nav = navegador()
    const r = await nav.ir('/bandeja-revision.html')
    assert.equal(r.status, 302)
    assert.equal(r.destino, '/login.html', 'sin cookie de sesión no debe decir que expiró')
    assert.equal(nav.valor('comapa_destino'), 'bandeja-revision.html')
  })

  test('el login y la raíz sí se sirven', async () => {
    const nav = navegador()
    for (const ruta of ['/login.html', '/index.html', '/']) {
      assert.equal((await nav.ir(ruta)).status, 200, `${ruta} debería servirse`)
    }
  })

  test('no se le da la identidad de nadie', async () => {
    const r = await navegador().ir('/api/auth/sesion')
    assert.equal(r.status, 401)
  })
})

for (const rol of ['admin', 'revisor', 'enlace'] as const) {
  describe(`recorrido de un ${rol}`, () => {
    test('entra, abre lo suyo, choca con lo ajeno y sale', async () => {
      const nav = navegador()
      const email = await usuario(rol)

      // 1. Entra
      const entrada = await nav.entrar(email)
      assert.equal(entrada.status, 200)
      const datos = JSON.parse(entrada.texto) as { redirigirA: string; usuario: { rol: string } }
      assert.equal(datos.usuario.rol, rol)
      assert.equal(datos.redirigirA, PROPIAS[rol]![0])
      assert.ok(nav.tiene('comapa_sesion'), 'debería quedar con sesión')
      assert.ok(nav.tiene('comapa_perfil'), 'y con perfil para pintar')

      // 2. Abre sus páginas
      for (const pagina of PROPIAS[rol]!) {
        const r = await nav.ir('/' + pagina)
        assert.equal(r.status, 200, `${rol} debería poder abrir ${pagina}`)
      }

      // 3. Las ajenas lo rebotan a su propio inicio
      for (const pagina of AJENAS[rol]!) {
        const r = await nav.ir('/' + pagina)
        assert.equal(r.status, 403, `${rol} no debería abrir ${pagina}`)
        assert.match(r.texto, new RegExp(PROPIAS[rol]![0]!),
          'el 403 debe ofrecer el inicio del propio rol')
      }

      // 4. Sale
      assert.equal((await nav.salir()).status, 200)
      assert.equal(nav.tiene('comapa_sesion'), false, 'la cookie de sesión debió borrarse')
      assert.equal(nav.tiene('comapa_perfil'), false)

      // 5. Y ya no entra a lo suyo
      const despues = await nav.ir('/' + PROPIAS[rol]![0])
      assert.equal(despues.status, 302)
      assert.equal(despues.destino, '/login.html')
    })
  })
}

describe('la sesión expira a medio camino', () => {
  test('lo manda al login diciéndolo, y al volver aterriza donde iba', async () => {
    const nav = navegador()
    const email = await usuario('revisor')
    await nav.entrar(email)
    assert.equal((await nav.ir('/bandeja-revision.html')).status, 200)

    // Se vence la sesión sin tocar el navegador, como pasaría al cabo de 8 h
    await bd.consultar(
      `UPDATE sesiones SET expira_at = now() - interval '1 second'
        WHERE usuario_id = (SELECT id FROM usuarios WHERE email = $1)`, [email])

    const bloqueado = await nav.ir('/reportes-revisor.html')
    assert.equal(bloqueado.status, 302)
    assert.equal(bloqueado.destino, '/login.html?sesion=expirada',
      'traía cookie de sesión: el login debe poder avisar que expiró')
    assert.equal(nav.valor('comapa_destino'), 'reportes-revisor.html')

    // Vuelve a entrar y el backend lo devuelve a donde iba
    const entrada = await nav.entrar(email)
    const datos = JSON.parse(entrada.texto) as { redirigirA: string }
    assert.equal(datos.redirigirA, 'reportes-revisor.html')
    assert.equal(nav.tiene('comapa_destino'), false, 'el destino debe consumirse')
    assert.equal((await nav.ir('/reportes-revisor.html')).status, 200)
  })

  test('un destino que el rol no puede abrir se descarta al volver', async () => {
    const nav = navegador()
    const email = await usuario('enlace')

    // Iba al dashboard del Administrador sin estar autenticado
    const r = await nav.ir('/dashboard-admin.html')
    assert.equal(r.status, 302)
    assert.equal(nav.valor('comapa_destino'), 'dashboard-admin.html')

    const entrada = await nav.entrar(email)
    const datos = JSON.parse(entrada.texto) as { redirigirA: string }
    assert.equal(datos.redirigirA, 'dashboard-enlace.html', 'se honró un destino prohibido')
  })
})

describe('la bitácora cuenta el recorrido', () => {
  test('un intento fallido, una entrada y una salida quedan en orden, con IP', async () => {
    const nav = navegador()
    const email = await usuario('admin')

    await nav.ir('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'equivocada' }),
    })
    await nav.entrar(email)
    await nav.salir()

    const eventos = await listarEventos(bd, ENTIDAD, email.toLowerCase())
    assert.deepEqual(eventos.map((e) => e.accion), ['login_fallido', 'login_exitoso', 'logout'])

    const [sinIp] = await bd.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM bitacora WHERE entidad = $1 AND entidad_id = $2 AND ip IS NULL`,
      [ENTIDAD, email.toLowerCase()])
    assert.equal(sinIp!.n, '0', 'todos los eventos de acceso deben llevar IP')

    // Ni la contraseña ni el token de sesión asoman por ningún lado
    const [fuga] = await bd.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM bitacora
        WHERE entidad = $1 AND (detalle::text LIKE '%' || $2 || '%' OR comentario LIKE '%' || $2 || '%')`,
      [ENTIDAD, PASSWORD])
    assert.equal(fuga!.n, '0')
  })
})

describe('el sitio no entrega lo que no debe', () => {
  test('ni configuración, ni código del backend, ni el historial', async () => {
    const nav = navegador()
    await nav.entrar(await usuario('admin'))        // incluso con la sesión de más poder
    for (const ruta of ['/backend/.env', '/backend/src/auth.ts', '/.git/config', '/package.json']) {
      assert.equal((await nav.ir(ruta)).status, 404, `${ruta} no debería servirse`)
    }
  })
})
