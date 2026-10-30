import { atom, read, update } from 'claude-code'
import type { AgentInfo, Register, SessionUsage, TurnUsage } from 'claude-code'

import type { Agente, Etapa, EstadoItem, Fuente, Item, Monitor, Roadmap, Todo } from '../types'
import {
  CANDIDATOS,
  MAX_TEXTO,
  SISTEMA,
  esPlan,
  hashTexto,
  nombreFuente,
  normalizarRuta,
  parsearLectura,
  unirRuta,
} from './fuente'
import { describirLlamada, etapaActual, limitar, progresoEtapa } from './util'
import { vista } from './vista'

const PLUGIN = 'roadmap-monitor'
const PANE = 'roadmap-monitor'
const TOOL = `mcp__${PLUGIN}__roadmap`

// Cambiar el tag cuando cambie la forma: lo guardado por una versión anterior
// sobrevive a la recarga y se descarta al leerlo.
const roadmapAtom = atom({ plugin: 'roadmap-monitor', key: 'roadmap' } as const, vacio(), { shape: 'roadmap-1' })
const monitorAtom = atom({ plugin: 'roadmap-monitor', key: 'monitor' } as const, monitorVacio(), { shape: 'monitor-1' })
const fuenteAtom = atom({ plugin: 'roadmap-monitor', key: 'fuente' } as const, fuenteManual(''), { shape: 'fuente-1' })
const claveAtom = atom({ plugin: 'roadmap-monitor', key: 'clave' } as const, '')
const abiertoAtom = atom({ plugin: 'roadmap-monitor', key: 'abierto' } as const, false)

function vacio(): Roadmap {
  return { etapas: [], etapaActual: null, itemActivo: null }
}

function fuenteManual(nombre: string): Fuente {
  return { ruta: null, tipo: 'manual', nombre, mtime: 0, hash: '', estado: 'ok' as const, error: null, tokens: 0, sincronizado: 0 }
}

/**
 * Tras una lectura: fija la etapa actual por nombre y, si no hay ítem activo
 * vigente, activa el primero en curso de esa etapa (para atribuirle tokens).
 */
function conActual(r: Roadmap, nombreEtapa: string | null): Roadmap {
  const etapa = r.etapas.find(e => e.nombre === nombreEtapa) ?? etapaActual(r)
  const vigente = r.itemActivo ? buscarItem(r, r.itemActivo) : null
  const activo =
    vigente && vigente.item.estado !== 'hecho'
      ? r.itemActivo
      : (etapa?.items.find(i => i.estado === 'en_curso')?.id ?? null)
  return { ...r, etapaActual: etapa?.id ?? r.etapaActual, itemActivo: activo }
}

function monitorVacio(): Monitor {
  return {
    todos: {},
    tokensTarea: {},
    agentes: {},
    tokensMain: 0,
    turno: null,
    sesion: { usd: null, contexto: null },
    ahora: 0,
  }
}

// ---------- utilidades ----------

const ESTADOS: EstadoItem[] = ['pendiente', 'en_curso', 'hecho', 'bloqueado']

function slug(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'item'
  )
}

/** Tokens que cuentan como consumo: entrada sin caché, escritura de caché y salida. */
function tokensDe(u: TurnUsage): number {
  return u.input_tokens + u.cache_creation_input_tokens + u.output_tokens
}

function buscarItem(r: Roadmap, id: string): { etapa: Etapa; item: Item } | null {
  for (const etapa of r.etapas) {
    const item = etapa.items.find(i => i.id === id)
    if (item) return { etapa, item }
  }
  return null
}

/** Copia profunda: los valores de $.state llegan congelados. */
function clonar(r: Roadmap): Roadmap {
  return {
    ...r,
    etapas: r.etapas.map(e => ({ ...e, items: e.items.map(i => ({ ...i })) })),
  }
}

function resumen(r: Roadmap): string {
  if (r.etapas.length === 0) return 'Roadmap vacío.'
  const actual = etapaActual(r)?.id
  const lineas: string[] = []
  for (const e of r.etapas) {
    lineas.push(`${e.id === actual ? '▶ ' : ''}[${e.id}] ${e.nombre} (${progresoEtapa(e)}%)`)
    for (const i of e.items) {
      const activo = i.id === r.itemActivo ? ' ← activo' : ''
      lineas.push(`  - [${i.id}] ${i.titulo}: ${i.estado} ${i.progreso}%${activo}`)
    }
  }
  return lineas.join('\n')
}

function claveStore(clave: string): string {
  return `roadmap:${clave}`
}

// Los tokens del ítem activo se acumulan en $.state en cada paso y se
// persisten agrupados (tick o fin de turno), no en cada paso.
let sucio = false

// Sincronización con la fuente: los hooks piden y el tick de session.start lee.
let pedido: { forzar: boolean } | null = null
let planNuevo: string | null = null
let sincronizando = false

// ---------- herramienta roadmap ----------

type EntradaItem = { id?: string; titulo: string; estado?: EstadoItem; progreso?: number }
type EntradaEtapa = { id?: string; nombre: string; items?: EntradaItem[] }
type EntradaTool = {
  accion: 'ver' | 'definir' | 'agregar' | 'etapa_actual' | 'avance' | 'activar' | 'borrar' | 'sincronizar'
  etapas?: EntradaEtapa[]
  etapa?: string
  item?: string | null
  titulo?: string
  progreso?: number
  estado?: EstadoItem
}

const DESCRIPCION = [
  'Roadmap que el usuario ve en una vista lateral (etapas con ítems y su avance).',
  'Se lee solo: del plan de la sesión (~/.claude/plans) o, si no hay, de un roadmap del repo (ROADMAP.md, docs/roadmap.md...);',
  'para cambiar avances de un roadmap leído, edita ese archivo (la vista se actualiza sola). Úsala para:',
  'activar {item|null} al empezar un ítem (los tokens gastados se le suman mientras esté activo), ver, sincronizar (releer la fuente).',
  'Solo sin archivo fuente: definir {etapas:[{id?,nombre,items:[{id?,titulo,estado?,progreso?}]}]} | agregar {etapa,titulo,item?} |',
  'etapa_actual {etapa} | avance {item,progreso?,estado?,titulo?} | borrar (con fuente, la próxima lectura los reemplaza).',
].join(' ')

const ESQUEMA = {
  type: 'object',
  properties: {
    accion: {
      type: 'string',
      enum: ['ver', 'definir', 'agregar', 'etapa_actual', 'avance', 'activar', 'borrar', 'sincronizar'],
    },
    etapas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                titulo: { type: 'string' },
                estado: { type: 'string', enum: ESTADOS },
                progreso: { type: 'number' },
              },
              required: ['titulo'],
            },
          },
        },
        required: ['nombre'],
      },
    },
    etapa: { type: 'string' },
    item: { type: ['string', 'null'] },
    titulo: { type: 'string' },
    progreso: { type: 'number' },
    estado: { type: 'string', enum: ESTADOS },
  },
  required: ['accion'],
}

function normalizarItem(i: Item): Item {
  if (i.estado === 'hecho') return { ...i, progreso: 100 }
  if (i.progreso >= 100) return { ...i, progreso: 100, estado: 'hecho' }
  if (i.progreso > 0 && i.estado === 'pendiente') return { ...i, estado: 'en_curso' }
  return i
}

/** Aplica una acción; devuelve el roadmap nuevo o un error para el modelo. */
function aplicar(actual: Roadmap, a: EntradaTool): Roadmap | string {
  const r = clonar(actual)
  switch (a.accion) {
    case 'ver':
    case 'sincronizar':
      return r
    case 'borrar':
      return vacio()
    case 'definir': {
      if (!a.etapas?.length) return 'definir requiere etapas.'
      const previos = new Map<string, Item>()
      for (const e of r.etapas) for (const i of e.items) previos.set(i.id, i)
      const usados = new Set<string>()
      const unico = (base: string) => {
        let id = base
        for (let n = 2; usados.has(id); n++) id = `${base}-${n}`
        usados.add(id)
        return id
      }
      const etapas: Etapa[] = a.etapas.map(e => ({
        id: unico(e.id || slug(e.nombre)),
        nombre: e.nombre,
        items: (e.items ?? []).map(i => {
          const id = unico(i.id || slug(i.titulo))
          const previo = previos.get(id)
          return normalizarItem({
            id,
            titulo: i.titulo,
            estado: i.estado ?? previo?.estado ?? 'pendiente',
            progreso: limitar(Math.round(i.progreso ?? previo?.progreso ?? 0), 0, 100),
            tokens: previo?.tokens ?? 0,
          })
        }),
      }))
      const activo = r.itemActivo && etapas.some(e => e.items.some(i => i.id === r.itemActivo)) ? r.itemActivo : null
      const etapaVigente = etapas.some(e => e.id === r.etapaActual) ? r.etapaActual : null
      return { etapas, etapaActual: etapaVigente, itemActivo: activo }
    }
    case 'agregar': {
      const etapa = r.etapas.find(e => e.id === a.etapa)
      if (!etapa) return `No existe la etapa "${a.etapa ?? ''}".`
      if (!a.titulo) return 'agregar requiere titulo.'
      const base = a.item || slug(a.titulo)
      let id = base
      for (let n = 2; buscarItem(r, id); n++) id = `${base}-${n}`
      etapa.items.push({ id, titulo: a.titulo, estado: 'pendiente', progreso: 0, tokens: 0 })
      return r
    }
    case 'etapa_actual': {
      if (!r.etapas.some(e => e.id === a.etapa)) return `No existe la etapa "${a.etapa ?? ''}".`
      r.etapaActual = a.etapa ?? null
      return r
    }
    case 'avance': {
      const hallado = a.item ? buscarItem(r, a.item) : null
      if (!hallado) return `No existe el ítem "${a.item ?? ''}".`
      const { etapa, item } = hallado
      let nuevo: Item = { ...item }
      if (a.titulo) nuevo.titulo = a.titulo
      if (typeof a.progreso === 'number') nuevo.progreso = limitar(Math.round(a.progreso), 0, 100)
      if (a.estado) nuevo.estado = a.estado
      if (a.estado === 'pendiente' && typeof a.progreso !== 'number') nuevo.progreso = 0
      nuevo = normalizarItem(nuevo)
      etapa.items = etapa.items.map(i => (i.id === item.id ? nuevo : i))
      if (nuevo.estado === 'hecho' && r.itemActivo === item.id) r.itemActivo = null
      return r
    }
    case 'activar': {
      if (!a.item) {
        r.itemActivo = null
        return r
      }
      const hallado = buscarItem(r, a.item)
      if (!hallado) return `No existe el ítem "${a.item}".`
      r.itemActivo = a.item
      r.etapaActual = hallado.etapa.id
      if (hallado.item.estado === 'pendiente') hallado.item.estado = 'en_curso'
      return r
    }
  }
}

// ---------- monitor (funciones puras sobre Monitor) ----------

const VIVOS = new Set(['pending', 'running', 'waiting'])

function conTokens(m: Monitor, agentId: string | undefined, n: number): Monitor {
  const loop = agentId ?? 'main'
  const enCurso = (m.todos[loop] ?? []).find(t => t.status === 'in_progress')
  const tokensTarea = { ...m.tokensTarea }
  if (enCurso) {
    const k = `${loop}|${enCurso.content}`
    tokensTarea[k] = (tokensTarea[k] ?? 0) + n
  }
  const agentes = { ...m.agentes }
  const ag = agentId ? agentes[agentId] : undefined
  if (agentId && ag) agentes[agentId] = { ...ag, tokens: ag.tokens + n }
  return {
    ...m,
    tokensTarea,
    agentes,
    tokensMain: agentId ? m.tokensMain : m.tokensMain + n,
    turno: m.turno && m.turno.fin === null ? { ...m.turno, tokens: m.turno.tokens + n } : m.turno,
  }
}

function conTokensItem(r: Roadmap, n: number): Roadmap {
  const activo = r.itemActivo
  if (!activo) return r
  return {
    ...r,
    etapas: r.etapas.map(e => ({
      ...e,
      items: e.items.map(i => (i.id === activo ? { ...i, tokens: i.tokens + n } : i)),
    })),
  }
}

function agenteDe(id: string, lista: AgentInfo[], ahora: number, previo?: Agente): Agente {
  const info = lista.find(a => a.id === id)
  return {
    id,
    tipo: info?.type ?? previo?.tipo ?? 'agente',
    nombre: info?.name || previo?.nombre,
    descripcion: info?.description || previo?.descripcion || '',
    corriendo: true,
    inicio: previo?.corriendo ? previo.inicio : ahora,
    fin: null,
    tokens: previo?.tokens ?? 0,
  }
}

function sesionDe(u: SessionUsage | null): Monitor['sesion'] {
  const limites = (u?.rateLimits ?? []).map(l => {
    const reinicio = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    return { tipo: l.kind, pct: l.percentUsed, reinicio: Number.isFinite(reinicio) ? reinicio : null }
  })
  return { usd: u?.cost?.usd ?? null, contexto: u?.context.percent ?? null, limites }
}

/** Ids de agentes marcados corriendo cuya loop ya no está viva en la lista. */
function agentesTerminados(m: Monitor, lista: AgentInfo[]): string[] {
  return Object.values(m.agentes)
    .filter(a => {
      if (!a.corriendo) return false
      const info = lista.find(x => x.id === a.id)
      return !info || !VIVOS.has(info.status)
    })
    .map(a => a.id)
}

function cerrarAgentes(m: Monitor, ids: string[], ahora: number): Monitor {
  if (ids.length === 0) return m
  const agentes = { ...m.agentes }
  for (const id of ids) {
    const a = agentes[id]
    if (a?.corriendo) agentes[id] = { ...a, corriendo: false, fin: ahora }
  }
  return { ...m, agentes }
}

// ---------- registro ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let clave = ''
    try {
      clave = (await $.session.repo())?.root ?? ''
    } catch {
      // sin git: se usa la raíz de la sesión
    }
    if (!clave) clave = await $.session.root()
    const raiz = clave
    const sid = await $.session.id()
    // Solo al empezar la sesión (el estado sobrevive a las recargas del mod):
    // arranca con el roadmap manual del repo mientras se detecta la fuente.
    if (!(await read($, claveAtom))) {
      const guardado = (await $.store.get(claveStore(raiz))) as Roadmap | undefined
      await update($, claveAtom, () => raiz)
      await update($, roadmapAtom, () => (guardado && Array.isArray(guardado.etapas) ? guardado : vacio()))
      await update($, fuenteAtom, () => fuenteManual('manual'))
    }

    await $.tool.register({ name: 'roadmap', description: DESCRIPCION, inputSchema: ESQUEMA, isDeferred: false })
    await $.command.register({ name: 'roadmap', description: 'Abre la vista lateral del roadmap y el monitor' })

    /**
     * Detecta la fuente (plan de la sesión > doc del repo) y, si cambió, la lee
     * con Haiku. Una lectura ya hecha para el mismo texto (esta u otra sesión)
     * se reutiliza del store sin volver a llamar al modelo.
     */
    const revisar = async (forzar: boolean) => {
      if (sincronizando) return
      sincronizando = true
      try {
        if (planNuevo) {
          await $.store.set(`plan:${sid}`, planNuevo)
          planNuevo = null
        }
        const plan = (await $.store.get(`plan:${sid}`)) as string | undefined
        let ruta: string | null = null
        let tipo: Fuente['tipo'] = 'manual'
        if (plan && (await $.fs.exists(plan))) {
          ruta = plan
          tipo = 'plan'
        } else {
          for (const c of CANDIDATOS) {
            const p = unirRuta(raiz, c)
            if (await $.fs.exists(p)) {
              ruta = p
              tipo = 'doc'
              break
            }
          }
        }

        const actual = await read($, fuenteAtom)
        if (!ruta) {
          if (actual.tipo !== 'manual') {
            const guardado = (await $.store.get(claveStore(raiz))) as Roadmap | undefined
            await update($, claveAtom, () => raiz)
            await update($, roadmapAtom, () => (guardado && Array.isArray(guardado.etapas) ? guardado : vacio()))
            await update($, fuenteAtom, () => fuenteManual('manual'))
          }
          return
        }

        const st = await $.fs.stat(ruta)
        const misma = actual.ruta !== null && normalizarRuta(actual.ruta) === normalizarRuta(ruta)
        if (misma && !forzar && st.mtimeMs === actual.mtime) return

        const texto = await $.fs.read(ruta)
        const hash = hashTexto(texto)
        const nombre = tipo === 'plan' ? `plan · ${nombreFuente(ruta, raiz)}` : nombreFuente(ruta, raiz)
        const base = { ruta, tipo, nombre, mtime: st.mtimeMs }
        const fuenteRuta = ruta

        if (!misma) {
          const guardado = (await $.store.get(claveStore(fuenteRuta))) as Roadmap | undefined
          await update($, claveAtom, () => fuenteRuta)
          await update($, roadmapAtom, () => (guardado && Array.isArray(guardado.etapas) ? guardado : vacio()))
        }

        const meta = (await $.store.get(`fuente:${fuenteRuta}`)) as { hash?: string; tokens?: number } | undefined
        if (!forzar && meta?.hash === hash && (await read($, roadmapAtom)).etapas.length > 0) {
          const ahora = await $.clock.now()
          await update($, fuenteAtom, f => ({ ...f, ...base, hash, estado: 'ok' as const, error: null, tokens: meta.tokens ?? 0, sincronizado: ahora }))
          return
        }

        await update($, fuenteAtom, f => ({ ...f, ...base, estado: 'leyendo' as const, error: null }))
        const r = await $.model.complete({ model: 'haiku', system: SISTEMA, prompt: texto.slice(0, MAX_TEXTO), maxTokens: 4000 })
        const ahora = await $.clock.now()
        const tokens = r.usage.input_tokens + r.usage.cache_creation_input_tokens + r.usage.output_tokens
        const lectura = r.isAnswered ? parsearLectura(r.text) : null
        if (!lectura) {
          const error = r.isAnswered ? 'no se pudo interpretar el roadmap' : `Haiku no respondió (${r.reason})`
          // Se reintenta cuando el archivo cambie o con «sincronizar».
          await update($, fuenteAtom, f => ({ ...f, ...base, hash, estado: 'error' as const, error, tokens, sincronizado: ahora }))
          return
        }
        const definido = aplicar(await read($, roadmapAtom), {
          accion: 'definir',
          etapas: lectura.etapas.map(e => ({ nombre: e.nombre, items: e.items })),
        })
        if (typeof definido === 'string') {
          await update($, fuenteAtom, f => ({ ...f, ...base, hash, estado: 'error' as const, error: definido, tokens, sincronizado: ahora }))
          return
        }
        const nuevo = conActual(definido, lectura.etapaActual)
        await update($, roadmapAtom, () => nuevo)
        await $.store.set(claveStore(fuenteRuta), nuevo)
        await $.store.set(`fuente:${fuenteRuta}`, { hash, tokens })
        await update($, fuenteAtom, f => ({ ...f, ...base, hash, estado: 'ok' as const, error: null, tokens, sincronizado: ahora }))
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await update($, fuenteAtom, f => ({ ...f, estado: 'error' as const, error: error.slice(0, 160) }))
      } finally {
        sincronizando = false
      }
    }

    // Cada 2 s: persiste lo pendiente, atiende pedidos de lectura (y revisa la
    // fuente cada 30 s) y, solo si hay trabajo en curso, refresca reloj,
    // costo/contexto y agentes terminados.
    let ticks = 0
    pedido = { forzar: false }
    $.clock.every(2000, async () => {
      ticks++
      if (sucio) {
        sucio = false
        await $.store.set(claveStore(await read($, claveAtom)), await read($, roadmapAtom))
      }
      if (pedido || ticks % 15 === 0) {
        const forzar = pedido?.forzar ?? false
        pedido = null
        await revisar(forzar)
      }
      const m = await read($, monitorAtom)
      const hayAgentes = Object.values(m.agentes).some(a => a.corriendo)
      if (!(m.turno && m.turno.fin === null) && !hayAgentes) return
      const ahora = await $.clock.now()
      const uso = await $.session.usage().catch(() => null)
      const lista = hayAgentes ? await $.agent.list().catch(() => null) : null
      await update($, monitorAtom, actual => ({
        ...cerrarAgentes(actual, lista ? agentesTerminados(actual, lista) : [], ahora),
        sesion: sesionDe(uso),
        ahora,
      }))
    })

    if (!(await read($, abiertoAtom))) {
      await update($, abiertoAtom, () => true)
      void $.ui.open({ id: PANE, title: 'Roadmap' })
    }

    return next(e)
  })

  on('command.run', { command: 'roadmap' }, async $ => {
    const abierto = await $.ui.open({ id: PANE, title: 'Roadmap' })
    return { text: abierto.isPlaced ? 'Vista del roadmap abierta.' : `No se pudo abrir la vista: ${abierto.reason ?? ''}` }
  })

  on('tool.call', async ($, e, next) => {
    // Lo que hace cada loop ahora mismo, para la card de su agente.
    const loopActividad = e.agentId ?? 'main'
    const texto = describirLlamada(String(e.tool), e as unknown as Record<string, unknown>)
    const desde = await $.clock.now()
    await update($, monitorAtom, m => ({ ...m, actividad: { ...(m.actividad ?? {}), [loopActividad]: { texto, desde } } }))

    if (e.tool === TOOL) {
      const entrada = e as unknown as EntradaTool
      if (entrada.accion === 'sincronizar') {
        pedido = { forzar: true }
        const f = await read($, fuenteAtom)
        return { result: f.ruta ? `Releyendo ${f.nombre}; la vista se actualiza en unos segundos.` : 'No hay archivo fuente: el roadmap es manual.' }
      }
      const nuevo = aplicar(await read($, roadmapAtom), entrada)
      if (typeof nuevo === 'string') return { deny: nuevo }
      if (entrada.accion !== 'ver') {
        await update($, roadmapAtom, () => nuevo)
        sucio = false
        await $.store.set(claveStore(await read($, claveAtom)), nuevo)
      }
      return { result: entrada.accion === 'ver' || entrada.accion === 'definir' ? resumen(nuevo) : 'ok' }
    }

    // Escribir un plan (o aprobarlo) lo vuelve la fuente de esta sesión; editar
    // la fuente vigente la relee.
    const herramienta = String(e.tool)
    if (['Write', 'Edit', 'MultiEdit', 'ExitPlanMode'].includes(herramienta)) {
      const ran = await next(e)
      if (ran.deny || ran.isError) return ran
      const ruta =
        herramienta === 'ExitPlanMode'
          ? (ran.result as { filePath?: string } | undefined)?.filePath
          : (e as unknown as { file_path?: string }).file_path
      if (ruta) {
        if (esPlan(ruta)) {
          planNuevo = ruta
          pedido = { forzar: false }
        } else {
          const f = await read($, fuenteAtom)
          if (f.ruta && normalizarRuta(f.ruta) === normalizarRuta(ruta)) pedido = { forzar: false }
        }
      }
      return ran
    }

    if (e.tool !== 'TodoWrite') return next(e)
    const ran = await next(e)
    const todos = (e as unknown as { todos?: Todo[] }).todos
    if (!ran.deny && !ran.isError && Array.isArray(todos)) {
      const loop = e.agentId ?? 'main'
      await update($, monitorAtom, m => ({ ...m, todos: { ...m.todos, [loop]: todos.map(t => ({ ...t })) } }))
    }
    return ran
  }).catch(($, e, next) => {
    // Observa todas las llamadas: si falla, la llamada sigue; solo la propia se rechaza.
    if (next.called) return next(e)
    return e.tool === TOOL ? { deny: 'roadmap: error interno del mod, reintenta.' } : next(e)
  })

  on('turn.start', async ($, e, next) => {
    const ahora = await $.clock.now()
    const id = e.agentId
    if (id) {
      const lista = await $.agent.list().catch(() => [] as AgentInfo[])
      await update($, monitorAtom, m => ({
        ...m,
        agentes: { ...m.agentes, [id]: agenteDe(id, lista, ahora, m.agentes[id]) },
        ahora,
      }))
    } else {
      await update($, monitorAtom, m => ({ ...m, turno: { inicio: ahora, fin: null, tokens: 0 }, ahora }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    const ahora = await $.clock.now()
    const uso = await $.session.usage().catch(() => null)
    const id = e.agentId
    await update($, monitorAtom, m => {
      // Al terminar su turno, el loop ya no está haciendo nada.
      const actividad = { ...(m.actividad ?? {}) }
      delete actividad[id ?? 'main']
      const base = { ...m, actividad, sesion: sesionDe(uso), ahora }
      if (id) return cerrarAgentes(base, [id], ahora)
      return { ...base, turno: m.turno ? { ...m.turno, fin: ahora } : null }
    })
    if (sucio) {
      sucio = false
      await $.store.set(claveStore(await read($, claveAtom)), await read($, roadmapAtom))
    }
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    // Modelo que respondió y esfuerzo pedido, para la card de cada agente.
    const loop = e.agentId ?? 'main'
    const modelo = res.usage?.model || e.model
    const esfuerzo = e.effort === undefined ? null : String(e.effort)
    const previo = (await read($, monitorAtom)).modelos?.[loop]
    if (!previo || previo.modelo !== modelo || previo.esfuerzo !== esfuerzo) {
      await update($, monitorAtom, m => ({ ...m, modelos: { ...(m.modelos ?? {}), [loop]: { modelo, esfuerzo } } }))
    }
    const n = res.usage ? tokensDe(res.usage) : 0
    if (n > 0) {
      await update($, monitorAtom, m => conTokens(m, e.agentId, n))
      if ((await read($, roadmapAtom)).itemActivo) {
        await update($, roadmapAtom, r => conTokensItem(r, n))
        sucio = true
      }
    }
    return res
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const props = e.props as { bodyColumns?: number; scroll?: { bodyRows?: number } }
    return vista($.ui.resolve(e), {
      r: await read($, roadmapAtom),
      m: await read($, monitorAtom),
      fuente: await read($, fuenteAtom),
      surface: e.surface,
      ancho: Math.max(24, props.bodyColumns ?? e.viewport?.columns ?? 40),
      filas: Math.max(16, props.scroll?.bodyRows ?? e.viewport?.rows ?? 30),
    })
  })
}