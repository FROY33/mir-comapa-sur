// CA-2: lo que el backend escribe sobrevive a su reinicio.
// Arranca el servidor real (src/servidor.ts) dos veces como proceso aparte, con SIGTERM entre una y otra.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { crearBD } from '../src/bd.js'
import { auditarAcceso, ENTIDAD } from '../src/datos/acceso.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

// Arranca el backend y espera a que avise que registró su inicio en la bitácora
function arrancar() {
  const proceso = spawn(process.execPath, ['--import', 'tsx', 'src/servidor.ts'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const lineas: Record<string, unknown>[] = []
  const listo = new Promise<{ evento: string; puerto: number }>((ok, falla) => {
    let puerto = 0
    createInterface({ input: proceso.stdout }).on('line', (l) => {
      const e = JSON.parse(l)
      lineas.push(e)
      if (e.mensaje === 'Backend escuchando') puerto = e.puerto
      if (e.mensaje === 'Conectado a la BD') ok({ evento: e.evento, puerto })
      if (e.nivel === 'error') falla(new Error(l))
    })
    proceso.once('exit', (c) => falla(new Error(`el backend terminó antes de tiempo (código ${c})`)))
  })
  const detener = () => new Promise<number | null>((ok) => { proceso.once('exit', ok); proceso.kill('SIGTERM') })
  return { listo, detener, lineas }
}

test('lo escrito antes del reinicio sigue ahí después', async () => {
  const primero = arrancar()
  const { evento: inicio1, puerto } = await primero.listo
  assert.equal((await fetch(`http://127.0.0.1:${puerto}/api/salud`)).status, 200)

  // Un evento de acceso escrito mientras el primer proceso vive (TEC-05 CA-3)
  const emailAcceso = `reinicio-${randomUUID()}@comapasur.gob.mx`
  await auditarAcceso.loginFallido(bd, emailAcceso, 'credenciales', '10.0.0.1')

  assert.equal(await primero.detener(), 0, 'el apagado debe ser limpio')

  const segundo = arrancar()
  const { evento: inicio2, puerto: puerto2 } = await segundo.listo
  try {
    // Lo que el primer proceso escribió (su inicio y su apagado) sigue en la base
    const eventos = await listarEventos(bd, 'sistema', 'backend')
    const ids = eventos.map((e) => e.id)
    assert.ok(ids.includes(inicio1), 'se perdió el inicio del primer arranque')
    assert.ok(ids.includes(inicio2))
    const apagado1 = eventos.find((e) => e.accion === 'apagado' && BigInt(e.id) > BigInt(inicio1) && BigInt(e.id) < BigInt(inicio2))
    assert.ok(apagado1, 'el apagado del primer proceso no quedó registrado')

    // El evento de acceso también sobrevivió (TEC-05 CA-3)
    const acceso = await listarEventos(bd, ENTIDAD, emailAcceso)
    assert.equal(acceso.length, 1, 'se perdió el evento de acceso al reiniciar')
    assert.equal(acceso[0]?.accion, 'login_fallido')

    // Y el segundo proceso lee la base sin problema
    assert.equal((await fetch(`http://127.0.0.1:${puerto2}/api/frecuencias`)).status, 200)
  } finally {
    await segundo.detener()
  }
})
