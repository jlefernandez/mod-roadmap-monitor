import type { Etapa, Roadmap } from '../types'

export function limitar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}

/** Barra de texto para la terminal. */
export function barra(pct: number, ancho: number): string {
  const w = Math.max(3, ancho)
  const llenos = Math.round((limitar(pct, 0, 100) / 100) * w)
  return '█'.repeat(llenos) + '░'.repeat(w - llenos)
}

function base(ruta: unknown): string {
  return (
    String(ruta ?? '')
      .split(/[\\/]/)
      .pop() ?? ''
  )
}

function corto(texto: unknown, max = 48): string {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Qué está haciendo un agente, en palabras, a partir de su llamada a una herramienta. */
export function describirLlamada(herramienta: string, a: Record<string, unknown>): string {
  switch (herramienta) {
    case 'Read':
      return `Leyendo ${base(a.file_path)}`
    case 'Write':
      return `Escribiendo ${base(a.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editando ${base(a.file_path ?? a.notebook_path)}`
    case 'Grep':
      return `Buscando «${corto(a.pattern, 32)}»`
    case 'Glob':
      return `Listando ${corto(a.pattern, 36)}`
    case 'Bash':
    case 'PowerShell':
      return `Ejecutando ${corto(a.description ?? a.command)}`
    case 'WebSearch':
      return `Buscando en la web «${corto(a.query, 32)}»`
    case 'WebFetch':
      return `Leyendo ${corto(String(a.url ?? '').replace(/^https?:\/\//, ''), 40)}`
    case 'Agent':
    case 'Task':
      return `Delegando: ${corto(a.description)}`
    case 'TodoWrite':
      return 'Actualizando tareas'
    case 'AskUserQuestion':
      return 'Esperando tu respuesta'
    case 'Skill':
      return `Usando la skill ${corto(a.skill, 30)}`
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(herramienta)
      if (mcp) return `Usando ${mcp[2]} (${mcp[1]})`
      return `Usando ${herramienta}`
    }
  }
}

/** «claude-opus-5-5» → «Opus 5.5»; un id que no sigue ese formato queda igual. */
export function nombreModelo(id: string): string {
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?![\d])/i.exec(id)
  if (!m || !m[1] || !m[2]) return id
  const familia = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return `${familia} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

export function progresoEtapa(etapa: Etapa): number {
  if (etapa.items.length === 0) return 0
  return Math.round(etapa.items.reduce((s, i) => s + i.progreso, 0) / etapa.items.length)
}

export function etapaActual(r: Roadmap): Etapa | undefined {
  return r.etapas.find(e => e.id === r.etapaActual) ?? r.etapas.find(e => progresoEtapa(e) < 100) ?? r.etapas[0]
}
