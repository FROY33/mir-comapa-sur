// Punto de entrada: npm run dev (desarrollo) o npm start (después de npm run build).

import { createServer } from 'node:http'
import { crearApp } from './app.js'
import { correrApertura } from './ciclos.js'
import { marcarVencidasDeCiclos } from './datos/metaVencida.js'
import { crearBD } from './bd.js'
import { cargarConfig, type Config } from './config.js'
import { registrarEvento } from './datos/bitacora.js'
import { detalleError } from './errores.js'
import { crearLog } from './log.js'

const log = crearLog()

let config: Config
try {
  config = cargarConfig()
} catch (err) {
  log.error('Configuración inválida; el backend no arranca', { causa: (err as Error).message })
  process.exit(1)
}

const bd = crearBD(config.bd, log)
const servidor = createServer(crearApp(bd, log, { confiarProxy: config.confiarProxy, produccion: config.entorno === 'production' }))
const sistema = { entidad: 'sistema', entidadId: 'backend' }

servidor.listen(config.puerto, config.host, () => {
  const direccion = servidor.address()
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : config.puerto
  log.info('Backend escuchando', { host: config.host, puerto, entorno: config.entorno })
})

// Si la base no está, el backend arranca igual: responde 503 hasta que vuelva y se recupera solo
try {
  const esquema = await bd.versionEsquema()
  const evento = await registrarEvento(bd, { ...sistema, accion: 'inicio', detalle: { pid: process.pid, entorno: config.entorno } })
  log.info('Conectado a la BD', { esquema, evento })
} catch (err) {
  log.error('Sin conexión a la BD al arrancar; se responde 503 hasta que vuelva', detalleError(err))
}

// Apertura de ciclos (HU-R3-01): al arrancar y cada hora. Es idempotente, así que correrla de
// más no cambia nada; si la base no está, se intenta en la siguiente vuelta.
const UNA_HORA = 60 * 60 * 1000
async function aperturaAutomatica(): Promise<void> {
  try {
    const nuevas = (await correrApertura(bd)).filter((a) => a.periodo_nuevo || a.reportes_creados > 0)
    if (nuevas.length > 0) log.info('Ciclos abiertos', { aperturas: nuevas })
  } catch (err) {
    log.aviso('No se pudo correr la apertura de ciclos', detalleError(err))
  }
  try {
    const vencidas = await bd.transaccion((tx) => marcarVencidasDeCiclos(tx))
    if (vencidas > 0) log.info('Metas marcadas como vencidas', { vencidas })
  } catch (err) {
    log.aviso('No se pudo marcar las metas vencidas', detalleError(err))
  }
}
if (config.ciclosAutomaticos) {
  await aperturaAutomatica()
  setInterval(() => void aperturaAutomatica(), UNA_HORA).unref()
}

async function apagar(senal: string): Promise<void> {
  log.info('Apagando', { senal })
  servidor.close()
  try {
    await registrarEvento(bd, { ...sistema, accion: 'apagado', detalle: { pid: process.pid, senal } })
  } catch (err) {
    log.aviso('No se pudo registrar el apagado en la bitácora', detalleError(err))
  }
  await bd.cerrar()
  process.exit(0)
}

process.once('SIGINT', () => void apagar('SIGINT'))
process.once('SIGTERM', () => void apagar('SIGTERM'))
