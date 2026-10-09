// Punto de entrada: npm run dev (desarrollo) o npm start (después de npm run build).

import { createServer } from 'node:http'
import { crearApp } from './app.js'
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
const servidor = createServer(crearApp(bd, log))
const sistema = { entidad: 'sistema', entidadId: 'backend' }

servidor.listen(config.puerto, () => {
  const direccion = servidor.address()
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : config.puerto
  log.info('Backend escuchando', { puerto, entorno: config.entorno })
})

// Si la base no está, el backend arranca igual: responde 503 hasta que vuelva y se recupera solo
try {
  const esquema = await bd.versionEsquema()
  const evento = await registrarEvento(bd, { ...sistema, accion: 'inicio', detalle: { pid: process.pid, entorno: config.entorno } })
  log.info('Conectado a la BD', { esquema, evento })
} catch (err) {
  log.error('Sin conexión a la BD al arrancar; se responde 503 hasta que vuelva', detalleError(err))
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
