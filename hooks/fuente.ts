// Detección y lectura automática del roadmap: el plan de la sesión o un doc del
// repo, interpretado por Haiku. Funciones puras; las llamadas a $ van en los hooks.

import type { EstadoItem } from '../types'

/** Roadmaps conocidos, relativos a la raíz del repo, en orden de preferencia. */
export const CANDIDATOS = [
  'ROADMAP.md',
  'roadmap.md',
  'docs/roadmap.md',
  'docs/ROADMAP.md',
  'doc/roadmap.md',
  '.claude/roadmap.md',
]

/** Máximo de texto que se manda a Haiku (los planes largos se recortan). */
export const MAX_TEXTO = 60_000

/** Ruta comparable: barras normales y minúsculas (Windows no distingue mayúsculas). */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/').toLowerCase()
}

export function esPlan(ruta: string): boolean {
  return /\/\.claude\/plans\/[^/]+\.md$/.test(normalizarRuta(ruta))
}

export function unirRuta(base: string, relativa: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${relativa}`
}

/** Nombre corto para mostrar la fuente en la vista. */
export function nombreFuente(ruta: string, raiz: string): string {
  const r = ruta.replace(/\\/g, '/')
  const base = raiz.replace(/\\/g, '/').replace(/\/+$/, '')
  if (base && normalizarRuta(r).startsWith(`${normalizarRuta(base)}/`)) return r.slice(base.length + 1)
  return r.split('/').pop() ?? r
}

/** FNV-1a de 32 bits: detecta si el texto cambió sin guardar el texto. */
export function hashTexto(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const SISTEMA = `Conviertes un documento de roadmap o plan de trabajo (cualquier formato: tablas, listas, prosa, ✅/⏳, [x]) en JSON para una vista de avance.

Responde SOLO con JSON válido, sin texto ni bloques de código, con esta forma:
{"etapaActual":"<nombre exacto de una etapa>","etapas":[{"nombre":"...","items":[{"titulo":"...","estado":"pendiente|en_curso|hecho|bloqueado","progreso":0}]}]}

Reglas:
- Etapas = las grandes fases del documento (horizontes, fases, hitos, sprints, bloques). Si el documento es un plan de una sola feature, sus pasos o bloques son los ítems de una única etapa.
- Ítems = entregables concretos de cada etapa (máximo 10 por etapa, máximo 8 etapas). Títulos cortos (≤ 50 caracteres), en el idioma del documento.
- Estado y progreso (0-100) según lo que el documento marca: ✅/[x]/"hecho"/"completo" → hecho 100; ⏳/"en curso"/"casi" → en_curso con un progreso estimado; sin marca → pendiente 0; "bloqueado" → bloqueado.
- Si una etapa dice "Completo", todos sus ítems están hechos; si dice "Pendiente" y no hay otras marcas, sus ítems están pendientes.
- Ignora secciones de contexto, decisiones, verificación, historial y métricas: solo trabajo planificado.
- etapaActual = la primera etapa no terminada en la que hay trabajo en curso; si ninguna tiene, la primera no terminada.`

const ESTADOS: EstadoItem[] = ['pendiente', 'en_curso', 'hecho', 'bloqueado']

export type Lectura = {
  etapaActual: string | null
  etapas: { nombre: string; items: { titulo: string; estado: EstadoItem; progreso: number }[] }[]
}

/** Interpreta la respuesta de Haiku; null si no trae un roadmap usable. */
export function parsearLectura(texto: string): Lectura | null {
  const inicio = texto.indexOf('{')
  const fin = texto.lastIndexOf('}')
  if (inicio < 0 || fin <= inicio) return null
  let crudo: unknown
  try {
    crudo = JSON.parse(texto.slice(inicio, fin + 1))
  } catch {
    return null
  }
  const obj = crudo as { etapaActual?: unknown; etapas?: unknown }
  if (!Array.isArray(obj.etapas)) return null
  const etapas = obj.etapas
    .map(e => {
      const et = e as { nombre?: unknown; items?: unknown }
      const items = (Array.isArray(et.items) ? et.items : [])
        .map(i => {
          const it = i as { titulo?: unknown; estado?: unknown; progreso?: unknown }
          const estado = ESTADOS.includes(it.estado as EstadoItem) ? (it.estado as EstadoItem) : 'pendiente'
          const progreso = typeof it.progreso === 'number' && Number.isFinite(it.progreso) ? it.progreso : 0
          return { titulo: String(it.titulo ?? '').slice(0, 80), estado, progreso }
        })
        .filter(i => i.titulo)
        .slice(0, 12)
      return { nombre: String(et.nombre ?? '').slice(0, 80), items }
    })
    .filter(e => e.nombre)
    .slice(0, 10)
  if (etapas.length === 0) return null
  return { etapaActual: typeof obj.etapaActual === 'string' ? obj.etapaActual : null, etapas }
}
