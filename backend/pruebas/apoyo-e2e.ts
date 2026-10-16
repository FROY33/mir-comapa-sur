// Piezas del recorrido de punta a punta, compartidas por las pruebas que levantan el backend y el
// sitio reales (recorrido-e2e, recorrido-planeacion): puertos libres, procesos y un navegador de juguete.

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

export const puertoLibre = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number }
    s.close(() => ok(port))
  })
})

/** Arranca un proceso y espera a que anuncie que está listo. */
export function arrancar(archivo: string, env: Record<string, string>, senal: string) {
  const proceso = spawn(process.execPath, ['--import', 'tsx', archivo], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const listo = new Promise<void>((ok, falla) => {
    proceso.stdout.on('data', (t: Buffer) => { if (String(t).includes(senal)) ok() })
    proceso.once('exit', (c) => falla(new Error(`${archivo} terminó antes de tiempo (código ${c})`)))
  })
  return { proceso, listo }
}

/** Contraseña de los usuarios de los recorridos. */
export const PASSWORD = 'Recorrido-2026'

/**
 * Un navegador de juguete: guarda las cookies que le mandan y las reenvía, sin seguir
 * redirecciones, para poder mirar cada paso.
 */
export function navegador(sitio: string) {
  const galleta = new Map<string, string>()

  const guardar = (lineas: string[]) => {
    for (const linea of lineas) {
      const [par = ''] = linea.split(';')
      const corte = par.indexOf('=')
      if (corte < 1) continue
      const nombre = par.slice(0, corte).trim()
      const valor = par.slice(corte + 1).trim()
      // Max-Age=0 borra, como en un navegador de verdad
      if (/Max-Age=0/i.test(linea) || valor === '') galleta.delete(nombre)
      else galleta.set(nombre, valor)
    }
  }

  const ir = async (ruta: string, opciones: RequestInit = {}) => {
    const cookie = [...galleta].map(([n, v]) => `${n}=${v}`).join('; ')
    const r = await fetch(sitio + ruta, {
      ...opciones,
      redirect: 'manual',
      headers: { ...(opciones.headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
    })
    guardar(r.headers.getSetCookie())
    return {
      status: r.status,
      destino: r.headers.get('location'),
      texto: await r.text(),
    }
  }

  return {
    ir,
    tiene: (nombre: string) => galleta.has(nombre),
    valor: (nombre: string) => decodeURIComponent(galleta.get(nombre) ?? ''),
    entrar: (email: string) => ir('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
    salir: () => ir('/api/auth/logout', { method: 'POST' }),
    cookies: galleta,
  }
}

