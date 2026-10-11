// XSS en el frontend: los datos que llegan de la API o de la cookie de perfil se pintan como
// texto, nunca como HTML. Se ejecuta el código real de las vistas con un DOM mínimo y se les da
// un nombre malicioso; si alguna interpolación no pasa por escaparHTML (session.js), la etiqueta
// llega viva al HTML y la prueba falla.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { archivo, codigoSesion, ejecutarEnNavegador, scriptDePagina } from './apoyo-frontend.js'

const MALO = '<img src=x onerror=alert(1)>'
const ESCAPADO = '&lt;img src=x onerror=alert(1)&gt;'
// Para ids que acaban en atributos y manejadores en línea
const ROMPE_ATRIBUTO = `x" onmouseover="alert(1)`
const ROMPE_JS = `');alert(1);('`

const esperar = async () => { for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok)) }

/** Comprueba que el HTML pintado no trae ninguna de las cargas activas y sí el texto escapado. */
function sinEtiquetaActiva(html: string) {
  assert.ok(!html.includes('<img'), `se pintó una etiqueta <img> activa:\n${html.slice(html.indexOf('<img') - 200, html.indexOf('<img') + 60)}`)
  assert.ok(!html.includes('onmouseover="'), 'un id rompió el atributo')
  assert.ok(!html.includes("');alert(1)"), 'un id rompió la cadena del manejador en línea')
  assert.ok(html.includes(ESCAPADO), 'el dato no se pintó (la prueba no ejercitó el renderizador)')
}

const perfil = (rol: string) => `comapa_perfil=${encodeURIComponent(JSON.stringify({
  nombre: MALO, email: 'a@b.mx', rol, gerencia: MALO, gerenciaClave: 'COM', unidad: MALO, redirigirA: 'x.html',
}))}`

/** Un reporte de GET /api/pendientes con todos los textos maliciosos. */
const reporte = (codigo: string) => ({
  codigo, reporte_id: 'r1', tipo: 'mir', nombre: MALO, unidad: MALO, nivel: 'actividad',
  medio_verificacion: MALO, frecuencia: 'mensual', periodo: '2026-09', fecha_limite: '2026-10-15',
  estado: 'pendiente_carga', actualizado_at: '2026-10-01T00:00:00Z', es_iso: false,
  pendiente: true, vencido: false, urgente: false,
})
const PENDIENTES = { reportes: [reporte(MALO), reporte(ROMPE_ATRIBUTO), reporte(ROMPE_JS)], resumen: { pendientes: 3, total: 3 } }

describe('escaparHTML', () => {
  const { api } = ejecutarEnNavegador(codigoSesion(), ['escaparHTML'])
  const escapar = api.escaparHTML!

  test('escapa los cinco caracteres con significado en HTML', () => {
    assert.equal(escapar(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })

  test('null y undefined son cadena vacía; números y texto normal pasan igual', () => {
    assert.deepEqual([escapar(null), escapar(undefined), escapar(42), escapar('Gerencia Técnica')], ['', '', '42', 'Gerencia Técnica'])
  })

  test('escapar dos veces no deshace nada: & se escapa primero', () => {
    assert.equal(escapar('&lt;'), '&amp;lt;')
  })
})

describe('Usuarios del sistema (configuracion.html + usuarios-admin.js)', () => {
  test('nombre, correo, gerencia, unidad e id de la API no inyectan HTML', async () => {
    const usuario = (id: string) => ({
      id, nombre: MALO, email: MALO, rol: 'enlace', activo: true, bloqueado: false,
      gerencia: { id: 'g1', nombre: MALO }, unidad: { id: 'u1', nombre: MALO }, ultimo_acceso: null,
    })
    const codigo = codigoSesion() + '\n;\n' + scriptDePagina('configuracion.html', 'function renderTabla') +
      '\n;\n' + archivo('usuarios-admin.js')
    const p = ejecutarEnNavegador(codigo, [], {
      cookie: perfil('admin'), pagina: 'configuracion.html',
      respuestas: {
        '/api/admin/usuarios': { usuarios: [usuario('u-1'), usuario(ROMPE_ATRIBUTO), usuario(ROMPE_JS)], advertencias: [] },
        '/api/admin/catalogo': { gerencias: [{ id: 'g1', nombre: MALO, unidades: [{ id: ROMPE_ATRIBUTO, nombre: MALO }] }] },
      },
    })
    await esperar()
    sinEtiquetaActiva(p.documento.getElementById('tbodyUsuarios')!.innerHTML)

    // Selects de gerencia y unidad, armados con el catálogo
    sinEtiquetaActiva(p.documento.getElementById('fGerencia')!.innerHTML)
    p.documento.getElementById('fGerencia')!.value = 'g1'
    ;(p.ventana.onGerenciaChange as () => void)()
    sinEtiquetaActiva(p.documento.getElementById('fUnidadAdmin')!.innerHTML)
  })
})

describe('Mis actividades (mis-actividades.html)', () => {
  const abrir = async () => {
    const codigo = codigoSesion() + '\n;\n' + scriptDePagina('mis-actividades.html', 'function renderRow')
    const p = ejecutarEnNavegador(codigo, ['setView'], {
      cookie: perfil('enlace'), pagina: 'mis-actividades.html', respuestas: { '/api/pendientes': PENDIENTES },
    })
    p.disparar('DOMContentLoaded')
    await esperar()
    return p
  }

  test('las filas de la tabla pintan el reporte real como texto', async () => {
    const p = await abrir()
    sinEtiquetaActiva(p.documento.getElementById('tableBody')!.innerHTML)
  })

  test('las tarjetas también', async () => {
    const p = await abrir()
    p.api.setView!('cards')
    sinEtiquetaActiva(p.documento.getElementById('cardsContainer')!.innerHTML)
  })

  test('el enlace al detalle lleva el código codificado en la URL', async () => {
    const p = await abrir()
    assert.match(p.documento.getElementById('tableBody')!.innerHTML,
      /data-url="detalle-actividad\.html\?id=x%22%20onmouseover%3D%22alert\(1\)"/)
  })
})

describe('Dashboard del Enlace (dashboard-enlace.html)', () => {
  test('la lista de próximos a reportar pinta los reportes reales como texto', async () => {
    const codigo = codigoSesion() + '\n;\n' + scriptDePagina('dashboard-enlace.html', 'function pintarDashboardEnlace')
    const p = ejecutarEnNavegador(codigo, [], {
      cookie: perfil('enlace'), pagina: 'dashboard-enlace.html', respuestas: { '/api/pendientes': PENDIENTES },
    })
    await esperar()
    sinEtiquetaActiva(p.documento.getElementById('deadlineList')!.innerHTML)
  })
})

describe('Franja de periodos abiertos (vistas-mir.js)', () => {
  test('pinta frecuencia y etiqueta con textContent', async () => {
    const p = ejecutarEnNavegador(codigoSesion() + '\n;pintarPeriodosAbiertos();', [], {
      cookie: perfil('enlace'), pagina: 'dashboard-enlace.html',
      respuestas: { '/api/periodos/abiertos': [{ frecuencia: MALO, etiqueta: MALO, fecha_limite: '2026-10-20', anteriores_abiertos: 0 }] },
    })
    await esperar()
    assert.ok(!p.htmlPintado().includes('<img'))
    assert.ok(p.textoPintado().includes(`${MALO} ${MALO} · fecha límite`), 'la franja no se pintó')
  })
})

describe('Encabezado (layout.js)', () => {
  test('nombre y gerencia de la cookie de perfil, y las notificaciones, no inyectan HTML', async () => {
    const notificaciones = `function getNotificationsForRole() { return [{ id: ${JSON.stringify(ROMPE_ATRIBUTO)},
      titulo: ${JSON.stringify(MALO)}, mensaje: ${JSON.stringify(MALO)}, fecha: 'hoy', hora: '10:00',
      icono: 'upload', leida: false, actividadId: ${JSON.stringify(MALO)} }] }`
    const codigo = codigoSesion() + '\n;\n' + notificaciones + '\n;\n' + archivo('layout.js')
    const p = ejecutarEnNavegador(codigo, [], { cookie: perfil('enlace'), pagina: 'dashboard-enlace.html' })
    p.disparar('DOMContentLoaded')
    const html = p.documento.body.innerHTML
    sinEtiquetaActiva(html)
    assert.ok(html.includes(`<span class="h-user-name">${ESCAPADO}</span>`), 'el nombre no se pintó en el encabezado')
  })
})
