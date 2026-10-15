// HU-R4-11: el catálogo administrado desde la API sobrevive al reinicio del backend.
// Arranca src/servidor.ts como proceso aparte, da de alta y desactiva un indicador, lo apaga con
// SIGTERM y comprueba con un segundo proceso que el indicador y su bitácora siguen ahí.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { after, test } from 'node:test'
import { crearBD } from '../src/bd.js'
import { listarEventos } from '../src/datos/bitacora.js'
import { COOKIE_SESION, crear } from '../src/datos/sesiones.js'
import { crearLog } from '../src/log.js'
import { configBD } from './apoyo.js'

const bd = crearBD(configBD, crearLog(() => {}))
after(() => bd.cerrar())

function arrancar() {
  const proceso = spawn(process.execPath, ['--import', 'tsx', 'src/servidor.ts'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const listo = new Promise<number>((ok, falla) => {
    let puerto = 0
    createInterface({ input: proceso.stdout }).on('line', (l) => {
      const e = JSON.parse(l)
      if (e.mensaje === 'Backend escuchando') puerto = e.puerto
      if (e.mensaje === 'Conectado a la BD') ok(puerto)
      if (e.nivel === 'error') falla(new Error(l))
    })
    proceso.once('exit', (c) => falla(new Error(`el backend terminó antes de tiempo (código ${c})`)))
  })
  const detener = () => new Promise<number | null>((ok) => { proceso.once('exit', ok); proceso.kill('SIGTERM') })
  return { listo, detener }
}

test('HU-R4-11: el indicador dado de alta y desactivado, y su bitácora, siguen tras reiniciar', async () => {
  const sufijo = randomUUID().slice(0, 8)
  const [org] = await bd.consultar<{ id: string }>('INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id', [`Org reinicio ${sufijo}`])
  const [ger] = await bd.consultar<{ id: string }>(
    'INSERT INTO gerencias (organizacion_id, clave, nombre) VALUES ($1, $2, $3) RETURNING id', [org!.id, 'RE', `Gerencia reinicio ${sufijo}`])
  const [uni] = await bd.consultar<{ id: string }>(
    'INSERT INTO unidades (gerencia_id, nombre, es_coord_general) VALUES ($1, $2, true) RETURNING id', [ger!.id, `Coordinación reinicio ${sufijo}`])
  const [u] = await bd.consultar<{ id: string }>(
    `INSERT INTO usuarios (gerencia_id, unidad_id, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, 'admin', $3, 'x', 'admin', false) RETURNING id`, [ger!.id, uni!.id, `admin-reinicio-${sufijo}@comapasur.gob.mx`])
  const cookie = `${COOKIE_SESION}=${await crear(bd, u!.id)}`
  const pedir = async (puerto: number, metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
      method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    return { status: r.status, cuerpo: (await r.json()) as any }
  }

  const [medio] = await bd.consultar<{ id: string }>('INSERT INTO medios_verificacion (nombre) VALUES ($1) RETURNING id', [`Informe reinicio ${sufijo}`])
  const primero = arrancar()
  const p1 = await primero.listo
  const alta = await pedir(p1, 'POST', '/api/admin/indicadores', {
    gerencia_id: ger!.id, codigo: `RE-${sufijo}`, tipo: 'mir', nivel: 'actividad', nombre: `Persistente ${sufijo}`,
    unidad_medida: 'Porcentaje', frecuencia: 'mensual', tipo_calculo: 'valor_directo', acumulable: false, medio_verificacion_id: medio!.id,
  })
  assert.equal(alta.status, 201, JSON.stringify(alta.cuerpo))
  const id = alta.cuerpo.indicador.id as string
  assert.equal((await pedir(p1, 'POST', `/api/admin/indicadores/${id}/desactivar`, {})).status, 200)
  await primero.detener()   // en Windows SIGTERM termina el proceso sin código 0: aquí solo importa que se apague

  const segundo = arrancar()
  const p2 = await segundo.listo
  try {
    const r = await pedir(p2, 'GET', `/api/admin/indicadores/${id}`)
    assert.equal(r.status, 200)
    assert.deepEqual([r.cuerpo.indicador.codigo, r.cuerpo.indicador.activo], [`RE-${sufijo}`, false])
    assert.deepEqual((await listarEventos(bd, 'indicador', id)).map((e) => e.accion), ['indicador_creado', 'indicador_desactivado'])
  } finally {
    await segundo.detener()
  }
})
