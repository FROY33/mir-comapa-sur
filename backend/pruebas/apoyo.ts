// Utilidades compartidas por las pruebas.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { crearApp } from '../src/app.js'
import { crearBD, type BD } from '../src/bd.js'
import { cargarConfig, type ConfigBD } from '../src/config.js'
import { crearLog } from '../src/log.js'

export const configBD = cargarConfig().bd

// Backend completo en un puerto libre, con el log capturado en `lineas` en vez de la consola
export async function levantar(bd: Partial<ConfigBD> = {}) {
  const lineas: string[] = []
  const log = crearLog((l) => lineas.push(l))
  const base: BD = crearBD({ ...configBD, ...bd }, log)
  const servidor: Server = createServer(crearApp(base, log))
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  return {
    bd: base,
    lineas,
    url,
    pedir: async (ruta: string) => {
      const r = await fetch(url + ruta)
      return { status: r.status, cabeceras: r.headers, texto: await r.text() }
    },
    cerrar: async () => {
      servidor.closeAllConnections()
      await new Promise((ok) => servidor.close(ok))
      await base.cerrar()
    },
  }
}
