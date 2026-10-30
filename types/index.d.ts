export type EstadoItem = 'pendiente' | 'en_curso' | 'hecho' | 'bloqueado'

export type Item = {
  id: string
  titulo: string
  estado: EstadoItem
  progreso: number
  tokens: number
}

export type Etapa = { id: string; nombre: string; items: Item[] }

export type Roadmap = {
  etapas: Etapa[]
  etapaActual: string | null
  itemActivo: string | null
}

export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export type Agente = {
  id: string
  tipo: string
  /** Nombre asignado en la sesión; sin él, se muestra el tipo. */
  nombre?: string
  descripcion: string
  corriendo: boolean
  inicio: number
  fin: number | null
  tokens: number
}

export type Monitor = {
  /** Listas TodoWrite por loop: 'main' o el agentId. */
  todos: Record<string, Todo[]>
  /** Tokens por tarea, clave `<loop>|<content>`. */
  tokensTarea: Record<string, number>
  agentes: Record<string, Agente>
  /** Última herramienta que usó cada loop ('main' o agentId), en palabras. */
  actividad?: Record<string, { texto: string; desde: number }>
  /** Modelo y esfuerzo del último paso de cada loop ('main' o agentId). */
  modelos?: Record<string, { modelo: string; esfuerzo: string | null }>
  tokensMain: number
  turno: { inicio: number; fin: number | null; tokens: number } | null
  sesion: {
    /** Costo a precio de lista de la API (lo que muestra /cost). */
    usd: number | null
    contexto: number | null
    /** Límites de la suscripción (5 h, semanal); vacío al usar la API directa. */
    limites?: { tipo: string; pct: number; reinicio: number | null }[]
  }
  ahora: number
}

/** De dónde sale el roadmap que se muestra y cómo va su lectura. */
export type Fuente = {
  /** Ruta absoluta del archivo leído; null = roadmap manual (herramienta). */
  ruta: string | null
  tipo: 'plan' | 'doc' | 'manual'
  /** Nombre corto para mostrar. */
  nombre: string
  mtime: number
  hash: string
  estado: 'leyendo' | 'ok' | 'error'
  error: string | null
  /** Tokens que costó la última lectura con Haiku. */
  tokens: number
  sincronizado: number
}

declare module 'claude-code' {
  interface PluginState {
    'roadmap-monitor': {
      roadmap: Shaped<Roadmap>
      fuente: Shaped<Fuente>
      clave: string
      monitor: Shaped<Monitor>
      abierto: boolean
    }
  }
}
