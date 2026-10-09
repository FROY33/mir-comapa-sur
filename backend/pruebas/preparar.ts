// Antes de las pruebas: borra y recrea la base de .env.test y le aplica todas las migraciones.
// cargarConfig ya garantiza que el nombre termine en _test.

import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { cargarConfig, nombreBase } from '../src/config.js'

const { bd } = cargarConfig()
const base = nombreBase(bd.url)
if (!/^[a-z0-9_]+$/.test(base)) throw new Error(`Nombre de base de pruebas no válido: ${base}`)

const mantenimiento = new URL(bd.url)
mantenimiento.pathname = '/postgres'
const cliente = new pg.Client({ connectionString: mantenimiento.toString() })
await cliente.connect()
await cliente.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
await cliente.query(`CREATE DATABASE ${base}`)
await cliente.end()

execFileSync('db/migrar.sh', ['up'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: bd.url } })
