import type { ElementTable, RenderSurface } from 'claude-code'

import type { EstadoItem, Fuente, Monitor, Roadmap, Todo } from '../types'
import { COLOR, anillo, avatar, avatarTexto, barraApilada, barraSvg, colorDe, numero } from './graficos'
import { barra, etapaActual, fmtDur, fmtTok, limitar, nombreModelo, progresoEtapa } from './util'

export type Datos = {
  r: Roadmap
  m: Monitor
  fuente: Fuente
  surface: RenderSurface
  /** Ancho del cuerpo del pane, en columnas. */
  ancho: number
  /** Alto del cuerpo del pane, en filas (solo la terminal lo usa). */
  filas: number
}

const ESTADO: Record<EstadoItem, { glifo: string; tema: string; svg: string; nombre: string }> = {
  hecho: { glifo: '✓', tema: 'success', svg: COLOR.exito, nombre: 'hecho' },
  en_curso: { glifo: '◐', tema: 'claude', svg: COLOR.acento, nombre: 'en curso' },
  pendiente: { glifo: '○', tema: 'subtle', svg: COLOR.pista, nombre: 'pendiente' },
  bloqueado: { glifo: '✕', tema: 'error', svg: COLOR.error, nombre: 'bloqueado' },
}

/**
 * Línea separadora que ocupa todo el ancho disponible: sin `width`, el Svg toma
 * el ancho de su espacio (el SVG es más ancho que cualquier pane) y, con
 * `preserveAspectRatio="none"` y `height={1}`, se estira sin perder el grosor.
 * Así deja el mismo margen a ambos lados, el padding del contenedor.
 */
const LINEA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 1" width="4000" height="1" preserveAspectRatio="none"><rect width="4000" height="1" fill="${COLOR.pista}"/></svg>`

const TAREA: Record<Todo['status'], { glifo: string; tema: string }> = {
  completed: { glifo: '✓', tema: 'success' },
  in_progress: { glifo: '◐', tema: 'claude' },
  pending: { glifo: '○', tema: 'subtle' },
}

/** Una card de agente: el principal (Claude) y cada sub-agente. */
type Fila = {
  clave: string
  nombre: string
  tipo: string
  trabajando: boolean
  /** La tarea que tiene asignada (o, para Claude, la tarea en curso). */
  tarea: string
  /** Lo que está haciendo ahora mismo (su última herramienta). */
  actividad: string | null
  /** Avance de su lista de tareas, si tiene. */
  progreso: { hechas: number; total: number } | null
  /** «Opus 5.5 · high», del último paso de su loop; null si aún no hay. */
  modelo: string | null
  tokens: number
  duracion: number
}

export function vista(t: ElementTable, d: Datos) {
  const { Box, Text } = t
  // Por superficie: la tabla de la terminal también puede traer Svg, sin dibujarlo.
  const Svg = d.surface !== 'terminal' && 'Svg' in t ? t.Svg : null
  const grafica = Svg !== null
  const { r, m } = d

  // Píxeles aproximados por columna en las superficies gráficas.
  const px = Math.max(180, d.ancho * 7)
  const ahora = Math.max(m.ahora, m.turno?.inicio ?? 0)
  const fase = Math.floor(ahora / 2000)

  const Barra = (pct: number, colorSvg: string, tema: string, anchoPx: number, celdas: number, alto = 6) =>
    Svg ? (
      <Svg source={barraSvg(pct, anchoPx, colorSvg, alto)} alt={`${Math.round(pct)}%`} width={anchoPx} height={alto} />
    ) : (
      <Text color={tema}>{barra(pct, celdas)}</Text>
    )

  const Seccion = (titulo: string, extra?: string) => (
    <Box flexDirection="row" alignItems="center" justifyContent="space-between" marginTop={grafica ? 1 : 0}>
      <Text size="caption" weight="semibold" dimColor>
        {titulo.toUpperCase()}
      </Text>
      {extra ? (
        <Text size="caption" dimColor tabular>
          {extra}
        </Text>
      ) : null}
    </Box>
  )

  // ================= roadmap =================
  const etapa = etapaActual(r)
  const celdasBarra = limitar(Math.floor(d.ancho / 5), 4, 12)
  const anchoBarraCard = limitar(Math.round(px * 0.3), 40, 120)

  const todos = m.todos.main ?? []
  const hechas = todos.filter(x => x.status === 'completed').length
  const visibles = [...todos.filter(x => x.status !== 'completed'), ...todos.filter(x => x.status === 'completed')].slice(0, grafica ? 8 : 5)
  const tareas = (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={1} marginTop={grafica ? 1 : 0}>
        <Box flexGrow={1}>
          <Text size="caption" weight="semibold" dimColor>
            TAREAS
          </Text>
        </Box>
        {todos.length > 0 ? Barra((hechas / todos.length) * 100, COLOR.exito, 'success', anchoBarraCard, celdasBarra, 3) : null}
        {todos.length > 0 ? (
          <Text size="caption" dimColor tabular>
            {hechas}/{todos.length}
          </Text>
        ) : null}
      </Box>
      {todos.length === 0 ? <Text dimColor>Sin tareas.</Text> : null}
      {visibles.map(x => {
        const g = TAREA[x.status]
        const tok = m.tokensTarea[`main|${x.content}`] ?? 0
        return (
          <Box flexDirection="row" alignItems="center" gap={grafica ? 1 : 0}>
            <Text color={g.tema}>{g.glifo} </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" dimColor={x.status === 'completed'} weight={x.status === 'in_progress' ? 'semibold' : 'regular'}>
                {x.status === 'in_progress' ? x.activeForm : x.content}
              </Text>
            </Box>
            {tok > 0 ? (
              <Text size="caption" dimColor tabular>
                {' '}
                {fmtTok(tok)}
              </Text>
            ) : null}
          </Box>
        )
      })}
      {todos.length > visibles.length ? <Text dimColor>+{todos.length - visibles.length} más</Text> : null}
    </Box>
  )

  // De dónde sale el roadmap y cómo va su lectura.
  const f = d.fuente
  const icono = f.tipo === 'plan' ? '◆' : f.tipo === 'doc' ? '▤' : '✎'
  const estadoFuente =
    f.estado === 'leyendo'
      ? 'leyendo…'
      : f.estado === 'error'
        ? (f.error ?? 'error')
        : f.tipo === 'manual'
          ? 'sin archivo de roadmap'
          : f.tokens > 0
            ? `lectura ${fmtTok(f.tokens)} tok`
            : ''
  const lineaFuente = (
    <Text
      size="caption"
      wrap="truncate-end"
      dimColor={f.estado === 'ok'}
      color={f.estado === 'error' ? 'error' : f.estado === 'leyendo' ? 'claude' : undefined}
    >
      {icono} {f.tipo === 'manual' ? 'roadmap manual' : f.nombre}
      {estadoFuente ? ` · ${estadoFuente}` : ''}
    </Text>
  )

  const roadmap = !etapa ? (
    <Box flexDirection="column">
      {Seccion('Roadmap')}
      {lineaFuente}
      <Text dimColor>
        {f.estado === 'leyendo'
          ? 'Leyendo el roadmap…'
          : 'Sin roadmap: crea ROADMAP.md o docs/roadmap.md, aprueba un plan, o pídele a Claude que lo defina.'}
      </Text>
      {tareas}
    </Box>
  ) : (
    (() => {
      const pct = progresoEtapa(etapa)
      const hechos = etapa.items.filter(i => i.estado === 'hecho').length
      const tokEtapa = etapa.items.reduce((s, i) => s + i.tokens, 0)
      const completas = r.etapas.filter(e => progresoEtapa(e) >= 100).length
      const totalTok = r.etapas.reduce((s, e) => s + e.items.reduce((u, i) => u + i.tokens, 0), 0)
      const indice = r.etapas.findIndex(e => e.id === etapa.id) + 1

      const cabecera = Svg ? (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={anillo(pct, pct >= 100 ? COLOR.exito : COLOR.acento, 36)} alt={`Etapa al ${pct}%`} width={36} height={36} />
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text size="caption" dimColor>
              Etapa {indice} de {r.etapas.length}
            </Text>
            <Text size="heading" weight="bold" wrap="truncate-end">
              {etapa.nombre}
            </Text>
            <Text size="caption" dimColor tabular>
              {hechos}/{etapa.items.length} ítems · {fmtTok(tokEtapa)} tokens
            </Text>
          </Box>
          <Text size="title" weight="bold" tabular>
            {pct}%
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Text bold wrap="truncate-end">
              {etapa.nombre}
            </Text>
            <Text dimColor>
              {hechos}/{etapa.items.length} · {fmtTok(tokEtapa)} tok
            </Text>
          </Box>
          <Text>
            <Text color="claude">{barra(pct, d.ancho - 12)}</Text> <Text bold>{pct}%</Text>
          </Text>
        </Box>
      )

      // Sub-ítems del ítem activo: las tareas del hilo principal (último hecho,
      // el que está en curso y el que viene).
      const sub = m.todos.main ?? []
      const iCurso = sub.findIndex(x => x.status === 'in_progress')
      const ultimoHecho = [...sub].reverse().find(x => x.status === 'completed')
      const enCursoSub = iCurso >= 0 ? sub[iCurso] : undefined
      const siguiente = sub.find((x, k) => x.status === 'pending' && k > iCurso)
      const subitems: { glifo: string; tema: string; texto: string; fuerte?: boolean }[] = [
        ...(ultimoHecho ? [{ glifo: '✓', tema: 'success', texto: ultimoHecho.content }] : []),
        ...(enCursoSub ? [{ glifo: '◐', tema: 'claude', texto: enCursoSub.activeForm, fuerte: true }] : []),
        ...(siguiente ? [{ glifo: '○', tema: 'subtle', texto: `Luego: ${siguiente.content}` }] : []),
      ]
      const hechasSub = sub.filter(x => x.status === 'completed').length

      // Un renglón de avance: el mismo para los ítems de la etapa y para la lista de etapas.
      const anchoBarraItem = limitar(Math.round(px * 0.22), 48, 90)
      const filaAvance = (titulo: string, estado: EstadoItem, progreso: number, tokens: number, activo: boolean) => {
        const e = ESTADO[estado]
        const colorBarra = estado === 'hecho' ? COLOR.exito : estado === 'bloqueado' ? COLOR.error : COLOR.acento
        return grafica ? (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={activo ? 'claude' : e.tema} weight="bold">
              {activo ? '▶' : e.glifo}
            </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" weight={activo ? 'semibold' : 'regular'} dimColor={estado === 'hecho'}>
                {titulo}
              </Text>
            </Box>
            {tokens > 0 ? (
              <Text size="caption" dimColor tabular>
                {fmtTok(tokens)}
              </Text>
            ) : null}
            {Barra(progreso, colorBarra, e.tema, anchoBarraItem, 0, 3)}
            <Box width={4} justifyContent="flex-end">
              <Text size="caption" tabular weight={activo ? 'semibold' : 'regular'} dimColor={!activo}>
                {progreso}%
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="row" alignItems="center">
            <Text color={activo ? 'claude' : e.tema}>{activo ? '▶' : e.glifo} </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" bold={activo} dimColor={estado === 'hecho'}>
                {titulo}
              </Text>
            </Box>
            <Text color={estado === 'hecho' ? 'success' : 'claude'}> {barra(progreso, celdasBarra)}</Text>
            <Text>{String(progreso).padStart(4)}%</Text>
            <Text dimColor>{fmtTok(tokens).padStart(6)}</Text>
          </Box>
        )
      }

      // Todas las etapas, con el mismo formato que los ítems; la actual, marcada.
      const etapas = (
        <Box flexDirection="column">
          {Seccion('Etapas', `${completas}/${r.etapas.length} completas`)}
          {r.etapas.map(o => {
            const p = progresoEtapa(o)
            const estado: EstadoItem =
              p >= 100
                ? 'hecho'
                : o.items.some(i => i.estado === 'bloqueado')
                  ? 'bloqueado'
                  : p > 0 || o.items.some(i => i.estado === 'en_curso')
                    ? 'en_curso'
                    : 'pendiente'
            const tok = o.items.reduce((s, i) => s + i.tokens, 0)
            return filaAvance(o.nombre, estado, p, tok, o.id === etapa.id)
          })}
        </Box>
      )

      const items = etapa.items.map(i => {
        const activo = i.id === r.itemActivo
        const fila = filaAvance(i.titulo, i.estado, i.progreso, i.tokens, activo)
        if (!activo || subitems.length === 0) return fila
        return (
          <Box flexDirection="column">
            {fila}
            <Box flexDirection="column" paddingLeft={2}>
              {subitems.map(s => (
                <Box flexDirection="row" alignItems="center" gap={grafica ? 1 : 0}>
                  <Text size="caption" color={s.tema}>
                    {grafica ? s.glifo : `${s.glifo} `}
                  </Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text size="caption" wrap="truncate-end" weight={s.fuerte ? 'semibold' : 'regular'} dimColor={!s.fuerte}>
                      {s.texto}
                    </Text>
                  </Box>
                  {s.fuerte ? (
                    <Text size="caption" dimColor tabular>
                      {' '}
                      {hechasSub}/{sub.length}
                    </Text>
                  ) : null}
                </Box>
              ))}
            </Box>
          </Box>
        )
      })

      return (
        <Box flexDirection="column">
          {Seccion('Roadmap', totalTok > 0 ? `${fmtTok(totalTok)} tokens en total` : undefined)}
          {lineaFuente}
          {etapas}
          {Seccion('Etapa actual')}
          {cabecera}
          {items}
          {tareas}
        </Box>
      )
    })()
  )

  // ================= monitor =================
  const turnoVivo = m.turno !== null && m.turno.fin === null
  const durTurno = m.turno ? (m.turno.fin ?? ahora) - m.turno.inicio : 0
  const enCurso = todos.find(x => x.status === 'in_progress')

  const actividad = m.actividad ?? {}
  const modeloDe = (loop: string) => {
    const x = m.modelos?.[loop]
    if (!x) return null
    return x.esfuerzo ? `${nombreModelo(x.modelo)} · ${x.esfuerzo}` : nombreModelo(x.modelo)
  }
  const avance = (lista: Todo[]) =>
    lista.length > 0 ? { hechas: lista.filter(x => x.status === 'completed').length, total: lista.length } : null

  const filas: Fila[] = [
    {
      clave: 'main',
      nombre: 'Claude',
      tipo: 'principal',
      trabajando: turnoVivo,
      tarea: turnoVivo ? (enCurso?.activeForm ?? '') : '',
      actividad: turnoVivo ? (actividad.main?.texto ?? 'Pensando…') : null,
      progreso: avance(todos),
      modelo: modeloDe('main'),
      tokens: m.tokensMain,
      duracion: durTurno,
    },
    ...Object.values(m.agentes)
      .sort((a, b) => Number(b.corriendo) - Number(a.corriendo) || b.inicio - a.inicio)
      .slice(0, 6)
      .map(a => {
        const sub = m.todos[a.id] ?? []
        const subEnCurso = sub.find(x => x.status === 'in_progress')
        return {
          clave: a.id,
          nombre: a.nombre || a.tipo,
          tipo: a.tipo,
          trabajando: a.corriendo,
          tarea: a.descripcion || 'Sin descripción',
          actividad: a.corriendo ? (subEnCurso?.activeForm ?? actividad[a.id]?.texto ?? 'Pensando…') : null,
          progreso: avance(sub),
          modelo: modeloDe(a.id),
          tokens: a.tokens,
          duracion: (a.fin ?? ahora) - a.inicio,
        }
      }),
  ]
  // Las que trabajan primero; Claude encabeza su grupo.
  filas.sort((a, b) => Number(b.trabajando) - Number(a.trabajando))

  // El costo es una estimación a precio de lista (como /cost): con suscripción
  // la sesión informa límites de uso y ese monto no es lo que se cobra.
  const costo = (usd: number | null) => (usd !== null ? `$${usd.toFixed(2)}` : '—')
  const usdSesion = m.sesion.usd
  const usdInicio = m.turno?.usdInicio ?? null
  const usdTurno = usdSesion !== null && usdInicio !== null ? Math.max(0, usdSesion - usdInicio) : null
  const notaCosto = (m.sesion.limites ?? []).length > 0 ? '≈ API' : undefined

  const Grande = (texto: string) => {
    if (!Svg) return null
    const n = numero(texto, COLOR.acento)
    return <Svg source={n.source} alt={texto} width={n.ancho} height={n.alto} />
  }

  const tiles: { etiqueta: string; valor: string; sub?: string }[] = [
    { etiqueta: turnoVivo ? 'Turno ▶' : 'Turno', valor: m.turno ? fmtDur(durTurno) : '—' },
    { etiqueta: 'Tokens turno', valor: m.turno ? fmtTok(m.turno.tokens) : '—' },
    { etiqueta: 'Costo turno', valor: costo(usdTurno), sub: notaCosto },
    { etiqueta: 'Costo sesión', valor: costo(usdSesion), sub: notaCosto },
  ]

  const estadisticas = grafica ? (
    // Siempre una fila (nowrap explícito: VS Code envuelve si no se indica). Mismo
    // ancho: parten de un porcentaje que deja sitio a los espacios y crecen por
    // igual. Mismo alto: stretch, tengan o no segunda línea.
    <Box flexDirection="row" flexWrap="nowrap" alignItems="stretch" gap={1}>
      {tiles.map(x => (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={`${80 / tiles.length}%`} flexGrow={1} flexShrink={1} minWidth={0}>
          <Text size="caption" dimColor>
            {x.etiqueta}
          </Text>
          <Box flexDirection="row" alignItems="flex-end" gap={1}>
            {Grande(x.valor)}
            {x.sub ? (
              <Text size="caption" dimColor tabular>
                {x.sub}
              </Text>
            ) : null}
          </Box>
        </Box>
      ))}
    </Box>
  ) : (
    // Cada dato aparte: en una sola línea los últimos se cortarían en un pane angosto.
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {m.turno === null ? <Text dimColor>sin actividad</Text> : null}
      {tiles
        .filter(x => x.valor !== '—')
        .map(x => (
          <Text color={turnoVivo ? 'claude' : undefined}>{`${x.etiqueta.replace(' ▶', '')} ${x.valor}${x.sub ? ` ${x.sub}` : ''}`}</Text>
        ))}
    </Box>
  )

  // Aire vertical de unos 4 px (el padding de VS Code va en líneas enteras).
  const aire = Svg ? (
    <Svg source={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 4" width="1" height="4"></svg>'} alt="" width={1} height={4} />
  ) : null

  const card = (f: Fila) => {
    const tipoAvatar = f.clave === 'main' ? 'claude' : f.tipo
    const pctTareas = f.progreso ? (f.progreso.hechas / f.progreso.total) * 100 : 0
    if (!Svg) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center">
            <Text color={f.trabajando ? 'claude' : undefined} dimColor={!f.trabajando}>
              {avatarTexto(f.trabajando, fase).padEnd(7)}
            </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" dimColor={!f.trabajando}>
                <Text bold={f.trabajando}>{f.nombre}</Text>
                {f.modelo ? <Text dimColor> — {f.modelo}</Text> : null} <Text dimColor>{f.tarea}</Text>
              </Text>
            </Box>
            {f.progreso ? <Text dimColor> {`${f.progreso.hechas}/${f.progreso.total}`}</Text> : null}
            <Text dimColor> {f.duracion > 0 ? fmtDur(f.duracion) : ''}</Text>
            <Text dimColor> {fmtTok(f.tokens).padStart(5)}</Text>
          </Box>
          {/* Línea reservada: la card no cambia de alto al empezar o terminar. */}
          <Text color="claude" wrap="truncate-end">
            {f.actividad ? `       ▸ ${f.actividad}` : ' '}
          </Text>
        </Box>
      )
    }
    // El texto se centra junto al avatar mostrando solo las líneas con dato.
    const altoAvatar = 48
    return (
      <Box flexDirection="column">
        {aire}
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={avatar(tipoAvatar, f.trabajando)}
            alt={`${f.nombre}: ${f.trabajando ? 'trabajando' : 'durmiendo'}`}
            width={altoAvatar}
            height={altoAvatar}
            isInteractive
          />
          <Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="center">
            {/* Nombre en negrita y modelo aparte, en texto normal: un Text anidado
                hereda la negrita en la terminal. */}
            <Box flexDirection="row" alignItems="center">
              <Text weight="semibold" dimColor={!f.trabajando}>
                {f.nombre}
              </Text>
              {f.modelo ? (
                <Box flexShrink={1}>
                  <Text weight="regular" dimColor wrap="truncate-end">
                    {` — ${f.modelo}`}
                  </Text>
                </Box>
              ) : null}
            </Box>
            {f.tarea ? (
              <Text size="caption" wrap="truncate-end" dimColor={!f.trabajando}>
                {f.tarea}
              </Text>
            ) : null}
            {f.actividad ? (
              <Text size="caption" wrap="truncate-end" color="claude">
                ▸ {f.actividad}
              </Text>
            ) : null}
            {f.progreso ? (
              <Box flexDirection="row" alignItems="center" gap={1}>
                {Barra(pctTareas, f.trabajando ? colorDe(tipoAvatar) : COLOR.pista, 'subtle', anchoBarraCard, 0, 3)}
                <Text size="caption" dimColor tabular>
                  {f.progreso.hechas}/{f.progreso.total} tareas
                </Text>
              </Box>
            ) : null}
          </Box>
          <Box flexDirection="column" alignItems="flex-end" justifyContent="center">
            <Text tabular weight="semibold" dimColor={!f.trabajando}>
              {fmtTok(f.tokens)}
            </Text>
            {f.duracion > 0 ? (
              <Text size="caption" tabular dimColor>
                {fmtDur(f.duracion)}
              </Text>
            ) : null}
          </Box>
        </Box>
        {aire}
      </Box>
    )
  }

  const agentes = (
    <Box flexDirection="column" marginTop={grafica ? 1 : 0}>
      {filas.map(card)}
    </Box>
  )

  const reparto = filas
    .filter(f => f.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
  const maxRep = reparto[0]?.tokens ?? 1
  const tokens =
    reparto.length === 0 ? null : Svg ? (
      // Una sola barra apilada con su leyenda: el reparto de un vistazo.
      <Box flexDirection="column" marginTop={1}>
        <Svg
          source={barraApilada(
            reparto.map(f => ({ valor: f.tokens, color: colorDe(f.clave === 'main' ? 'claude' : f.tipo) })),
            px - 16,
            6,
          )}
          alt={reparto.map(f => `${f.nombre} ${fmtTok(f.tokens)}`).join(', ')}
          width={px - 16}
          height={6}
        />
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={2}>
          {reparto.map(f => (
            <Text size="caption" tabular>
              <Text color={colorDe(f.clave === 'main' ? 'claude' : f.tipo)}>■</Text> <Text dimColor>{f.nombre}</Text>{' '}
              {fmtTok(f.tokens)}
            </Text>
          ))}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        {reparto.map(f => (
          <Box flexDirection="row" alignItems="center" gap={grafica ? 1 : 0}>
            <Box width={12}>
              <Text wrap="truncate-end" dimColor size="caption">
                {f.nombre}
              </Text>
            </Box>
            <Box flexGrow={1}>
              {Barra((f.tokens / maxRep) * 100, colorDe(f.clave === 'main' ? 'claude' : f.tipo), 'suggestion', px - 150, celdasBarra, 6)}
            </Box>
            <Text size="caption" tabular dimColor>
              {' '}
              {fmtTok(f.tokens)}
            </Text>
          </Box>
        ))}
      </Box>
    )

  const monitor = (
    <Box flexDirection="column">
      {estadisticas}
      {tokens}
      {agentes}
    </Box>
  )

  if (grafica) {
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        {roadmap}
        <Svg source={LINEA} alt="" height={1} />
        {monitor}
      </Box>
    )
  }

  // Terminal: dos mitades con borde y alto fijo.
  const altoArriba = Math.floor(d.filas / 2)
  return (
    <Box flexDirection="column" width={d.ancho}>
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} height={altoArriba} overflow="hidden">
        {roadmap}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} height={d.filas - altoArriba} overflow="hidden">
        {monitor}
      </Box>
    </Box>
  )
}
