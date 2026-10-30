import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__roadmap-monitor__roadmap'

const PANE = {
  plugin: 'roadmap-monitor',
  component: 'Pane',
  requestId: 'roadmap-monitor',
  props: {
    title: 'Roadmap',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Mundo = {
  store: Map<string, unknown>
  /** Archivos del disco simulado: ruta → { texto, mtime }. */
  archivos: Map<string, { texto: string; mtime: number }>
  /** Prompts que recibió Haiku. */
  lecturas: string[]
  reloj: ReturnType<typeof mock.clock>
}

const RESPUESTA_HAIKU = JSON.stringify({
  etapaActual: 'H2 Dashboards',
  etapas: [
    { nombre: 'H1 Plataforma', items: [{ titulo: 'Módulos', estado: 'hecho', progreso: 100 }] },
    {
      nombre: 'H2 Dashboards',
      items: [
        { titulo: 'Motor de métricas', estado: 'hecho', progreso: 100 },
        { titulo: 'Gráficos y widgets', estado: 'en_curso', progreso: 40 },
      ],
    },
  ],
})

/** Lo que el motor contesta bajo el mod: store, disco y Haiku en memoria. */
function motor(on: On, opciones: { suscripcion?: boolean; nombreAgente?: string } = {}): Mundo {
  const store = new Map<string, unknown>()
  const archivos = new Map<string, { texto: string; mtime: number }>()
  const lecturas: string[] = []
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  // El motor puede normalizar la ruta (unidad, barras) antes de llegar aquí.
  const clave = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '').toLowerCase()
  const buscar = (p: string) => [...archivos].find(([ruta]) => clave(ruta) === clave(p))?.[1]
  on('fs.exists', (_, e) => ({ value: buscar(e.path) !== undefined }))
  on('fs.stat', (_, e) => {
    const a = buscar(e.path)
    if (!a) return { deny: 'ENOENT' }
    return { value: { kind: 'file' as const, size: a.texto.length, mtimeMs: a.mtime, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const a = buscar(e.path)
    return a ? { value: a.texto } : { deny: 'ENOENT' }
  })
  on('model.complete', (_, e) => {
    lecturas.push(e.prompt)
    return {
      value: {
        isAnswered: true as const,
        text: RESPUESTA_HAIKU,
        usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('session.id', () => ({ value: 's1' }))
  const reloj = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: { command: 'roadmap' } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 50_000, percent: 25 },
      rateLimits: opciones.suscripcion
        ? [
            { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(1_000_000 + 2 * 3_600_000).toISOString() },
            { kind: 'seven_day', percentUsed: 85 },
          ]
        : [],
      cost: { usd: 1.5 },
    },
  }))
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: 'buscar endpoints', type: 'Explore', status: 'running', name: opciones.nombreAgente }],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  return { store, archivos, lecturas, reloj }
}

function paso(tokens: number) {
  return async function* (_: unknown, e: { turnId: string; index: number; model: string }) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  }
}

async function drenar(stream: AsyncGenerator<unknown, unknown>) {
  for await (const _ of stream) {
    // sin chunks
  }
}

test('vacío: el pane muestra los avisos', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Sin roadmap/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sin tareas/ })).toBeDefined()
    // La card de Claude siempre aparece, aunque no esté trabajando.
    expect(await ui.find({ type: 'Text', text: /Claude/ })).toBeDefined()
    await ui.unmount()
  }
})

test('definir, activar y avanzar se ven con su barra y tokens', async ($, on) => {
  const { store } = motor(on)
  on('turn.step', paso(1500))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({
    tool: TOOL,
    accion: 'definir',
    etapas: [
      { id: 'e1', nombre: 'Etapa uno', items: [{ id: 'a', titulo: 'Ítem A' }, { id: 'b', titulo: 'Ítem B' }] },
      { id: 'e2', nombre: 'Etapa dos', items: [{ titulo: 'Ítem C' }] },
    ],
  })
  await $.tool.call({ tool: TOOL, accion: 'activar', item: 'a' })
  await $.tool.call({ tool: TOOL, accion: 'avance', item: 'a', progreso: 50 })
  await $.tool.call({ tool: TOOL, accion: 'avance', item: 'b', estado: 'hecho' })

  // TodoWrite del main, con una tarea en curso que recibe los tokens del paso.
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Leer código', status: 'completed', activeForm: 'Leyendo código' },
      { content: 'Escribir mod', status: 'in_progress', activeForm: 'Escribiendo mod' },
      { content: 'Probar en vivo', status: 'pending', activeForm: 'Probando en vivo' },
    ],
  })
  await $.turn.start({ text: 'hola', turnId: 't' })
  await drenar($.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1 }))

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Etapa uno/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /75%/ })).toBeDefined() // (50 + 100) / 2
    expect(await ui.find({ type: 'Text', text: /Ítem A/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Etapa dos/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Escribiendo mod/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\.5k/ })).toBeDefined()
    // Sub-ítems del ítem activo: último hecho, en curso y el que viene.
    expect(await ui.find({ type: 'Text', text: /^Leer código$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Luego: Probar en vivo/ })).toBeDefined()
    await ui.unmount()
  }

  // Lo persistido incluye los tokens del ítem activo.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const guardado = store.get('roadmap:/repo') as { etapas: { items: { id: string; tokens: number }[] }[] }
  expect(guardado.etapas[0]?.items.find(i => i.id === 'a')?.tokens).toBe(1500)
})

test('un ítem inexistente se rechaza con un mensaje para el modelo', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: TOOL, accion: 'avance', item: 'nada', progreso: 10 })
  expect(r.deny).toMatch(/No existe/)
})

test('un sub-agente aparece corriendo con sus tokens', async ($, on) => {
  motor(on)
  on('turn.step', paso(800))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'explora', turnId: 'ta', agentId: 'ag1' })
  await drenar($.turn.step({ turnId: 'ta', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'ag1' }))
  await $.tool.call({ tool: 'Grep', pattern: 'asistente', agentId: 'ag1' })

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /1 trabajando/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /800/ })).toBeDefined()
    // La card dice el modelo, su tarea y qué está haciendo ahora.
    expect(await ui.find({ type: 'Text', text: /— Haiku 5\.5 · low/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /buscar endpoints/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Buscando «asistente»/ })).toBeDefined()
    await ui.unmount()
  }
  // Al terminar, el agente pasa a dormir.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'ta', reason: 'answer', agentId: 'ag1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /0 trabajando|en reposo/ })).toBeDefined()
  await ui.unmount()
})

test('un agente con nombre asignado en la sesión se muestra con ese nombre', async ($, on) => {
  motor(on, { nombreAgente: 'revisora' })
  on('turn.step', paso(800))
  await $.session.start({ cwd: '/repo', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'explora', turnId: 'ta', agentId: 'ag1' })
  await drenar($.turn.step({ turnId: 'ta', index: 0, model: 'x', messageCount: 1, agentId: 'ag1' }))

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^revisora$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeUndefined()
  await ui.unmount()
})

test('detecta docs/roadmap.md del repo, lo lee con Haiku una sola vez y activa el ítem en curso', async ($, on) => {
  const w = motor(on)
  w.archivos.set('/repo/docs/roadmap.md', { texto: '# Roadmap\n| H2 | ⏳ |', mtime: 1 })
  await $.session.start({ cwd: '/repo', surface: 'vscode', isInteractive: true })
  await w.reloj.advance(2000)

  expect(w.lecturas.length).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /docs\/roadmap\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /H2 Dashboards/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Gráficos y widgets/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▶$/ })).toBeDefined() // marca del ítem activo
  await ui.unmount()

  // Sin cambios en el archivo, la revisión periódica no vuelve a llamar a Haiku.
  await w.reloj.advance(30_000)
  expect(w.lecturas.length).toBe(1)
  const guardado = w.store.get('roadmap:/repo/docs/roadmap.md') as { itemActivo: string | null }
  expect(guardado.itemActivo).toBe('graficos-y-widgets')
})

test('con suscripción muestra los límites de uso y el costo solo como referencia', async ($, on) => {
  motor(on, { suscripcion: true })
  await $.session.start({ cwd: '/repo', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'hola', turnId: 't' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Límite 5 h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^42%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /reinicia en 2h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Semana/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /equivalente API/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Costo API/ })).toBeUndefined()
  await ui.unmount()
})

test('sin suscripción muestra el costo de la API', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/repo', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'hola', turnId: 't' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Costo API/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.50/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Límite/ })).toBeUndefined()
  await ui.unmount()
})

test('un plan escrito en la sesión pasa a ser la fuente', async ($, on) => {
  const w = motor(on)
  w.archivos.set('/repo/ROADMAP.md', { texto: 'roadmap del repo', mtime: 1 })
  await $.session.start({ cwd: '/repo', surface: 'vscode', isInteractive: true })
  await w.reloj.advance(2000)

  const plan = 'C:\\Users\\u\\.claude\\plans\\mi-plan.md'
  w.archivos.set(plan, { texto: '# Plan\n- paso 1', mtime: 5 })
  await $.tool.call({ tool: 'Write', file_path: plan, content: '# Plan\n- paso 1' })
  await w.reloj.advance(2000)

  expect(w.store.get('plan:s1')).toBe(plan)
  expect(w.lecturas.at(-1)).toContain('paso 1')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /plan · mi-plan\.md/ })).toBeDefined()
  await ui.unmount()
})
