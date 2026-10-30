// Gráficos SVG para las superficies que los dibujan (VS Code, desktop, mobile).
// Funciones puras: devuelven el documento SVG como texto.

/** Colores pensados para verse en tema claro y oscuro. */
export const COLOR = {
  acento: '#D97757',
  exito: '#3FA36B',
  error: '#D9534F',
  pista: 'rgba(136,136,136,0.28)',
  sugerencia: '#5B8DEF',
}

type Accesorio = 'chispa' | 'lupa' | 'lentes' | 'gorra' | 'casco' | 'boina' | 'insignia' | 'libro' | 'llave' | 'corbata'

/** Perfil visual de cada tipo de agente: color del cuerpo y accesorio que lo distingue. */
type Perfil = { cuerpo: string; acc: string; acc2: string; accesorio: Accesorio }

const PERFILES: Record<string, Perfil> = {
  claude: { cuerpo: '#D97757', acc: '#F6D2C2', acc2: '#B5583A', accesorio: 'chispa' },
  Explore: { cuerpo: '#2BA8A0', acc: '#BFE9F5', acc2: '#5A3E2B', accesorio: 'lupa' },
  Plan: { cuerpo: '#8E6BD8', acc: '#FFFFFF', acc2: '#1B1B1F', accesorio: 'lentes' },
  'general-purpose': { cuerpo: '#5B8DEF', acc: '#22397A', acc2: '#FFFFFF', accesorio: 'gorra' },
  'claude-code-guide': { cuerpo: '#4C9BD6', acc: '#C0392B', acc2: '#F5F0E6', accesorio: 'libro' },
  'statusline-setup': { cuerpo: '#7A9A3A', acc: '#9AA5B1', acc2: '#5D6873', accesorio: 'llave' },
}
const EXTRA = ['#C76B4A', '#B05CC2', '#2F9E8F', '#D0A030', '#4C7FD6', '#9A6A3A']
const ESTILOS: Pick<Perfil, 'acc' | 'acc2' | 'accesorio'>[] = [
  { acc: '#1B1B1F', acc2: '#FFFFFF', accesorio: 'corbata' },
  { acc: '#F2C230', acc2: '#C99A12', accesorio: 'casco' },
  { acc: '#2F2F4A', acc2: '#F4A5CB', accesorio: 'boina' },
  { acc: '#FFFFFF', acc2: '#2B7A4E', accesorio: 'insignia' },
]

/** Los tipos sin perfil fijo (los de cada proyecto) reciben uno estable, derivado del nombre. */
function perfilDe(tipo: string): Perfil {
  const fijo = PERFILES[tipo]
  if (fijo) return fijo
  let h = 0
  for (const c of tipo) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const cuerpo = EXTRA[h % EXTRA.length] ?? COLOR.sugerencia
  const estilo = ESTILOS[Math.floor(h / EXTRA.length) % ESTILOS.length] ?? { acc: '#1B1B1F', acc2: '#FFFFFF', accesorio: 'corbata' as const }
  return { cuerpo, ...estilo }
}

/** Color estable por tipo de agente (barras de tokens). */
export function colorDe(tipo: string): string {
  return perfilDe(tipo).cuerpo
}

type Tinta = { cuerpo: string; oscuro: string; acc: string; acc2: string; claro: string }

const GRISES: Tinta = { cuerpo: '#A6A6A6', oscuro: '#3E3E3E', acc: '#7A7A7A', acc2: '#CFCFCF', claro: '#E2E2E2' }

/** El accesorio, dibujado sobre el cuerpo (cuerpo: x 8-32, y 11-29; brazo derecho x 32-36). */
function accesorio(a: Accesorio, t: Tinta, trabajando: boolean): string {
  switch (a) {
    case 'chispa': {
      // El asterisco de Claude sobre la cabeza; gira mientras trabaja.
      const giro = trabajando
        ? '<animateTransform attributeName="transform" type="rotate" from="0 20 5" to="360 20 5" dur="6s" repeatCount="indefinite"/>'
        : ''
      const rayos = [0, 45, 90, 135]
        .map(g => `<line x1="20" y1="1.2" x2="20" y2="8.8" transform="rotate(${g} 20 5)"/>`)
        .join('')
      return `<g stroke="${t.acc2}" stroke-width="1.8" stroke-linecap="round">${giro}${rayos}</g>`
    }
    case 'lupa':
      return `<g>${trabajando ? '<animateTransform attributeName="transform" type="rotate" values="-8 34 21;8 34 21;-8 34 21" dur="1.6s" repeatCount="indefinite"/>' : ''}
<line x1="34.5" y1="20.5" x2="36.5" y2="17.5" stroke="${t.acc2}" stroke-width="2" stroke-linecap="round"/>
<circle cx="37" cy="13.5" r="3.6" fill="${t.acc}" fill-opacity="0.55" stroke="${trabajando ? '#4F87A6' : t.acc}" stroke-width="1.6"/></g>`
    case 'lentes':
      return `<g fill="${t.acc}" fill-opacity="0.25" stroke="${t.acc2}" stroke-width="1.2">
<circle cx="15.5" cy="20" r="3.4"/><circle cx="24.5" cy="20" r="3.4"/></g>
<line x1="18.9" y1="19.6" x2="21.1" y2="19.6" stroke="${t.acc2}" stroke-width="1.2"/>`
    case 'gorra':
      return `<path d="M8.5 11.5 Q20 1.5 31.5 11.5 Z" fill="${t.acc}"/>
<rect x="24" y="9.8" width="11" height="2.2" rx="1.1" fill="${t.acc}"/>
<circle cx="20" cy="5.2" r="1" fill="${t.acc2}"/>`
    case 'casco':
      return `<path d="M9 11.5 Q20 0.5 31 11.5 Z" fill="${t.acc}"/>
<rect x="6" y="10.3" width="28" height="2.4" rx="1.2" fill="${t.acc}"/>
<rect x="18.8" y="3.6" width="2.4" height="7" rx="1" fill="${t.acc2}"/>`
    case 'boina':
      return `<ellipse cx="18" cy="10" rx="11" ry="3.6" fill="${t.acc}" transform="rotate(-8 18 10)"/>
<rect x="17" y="4.6" width="2" height="2.6" rx="1" fill="${t.acc}"/>
<g>${trabajando ? '<animateTransform attributeName="transform" type="rotate" values="-12 34 22;10 34 22;-12 34 22" dur="0.9s" repeatCount="indefinite"/>' : ''}
<line x1="34" y1="22" x2="37.5" y2="14" stroke="${t.oscuro}" stroke-width="1.4" stroke-linecap="round"/>
<circle cx="37.7" cy="13.4" r="1.5" fill="${t.acc2}"/></g>`
    case 'insignia':
      return `<circle cx="20" cy="25.8" r="3.2" fill="${t.acc}" stroke="${t.acc2}" stroke-width="0.8"/>
<path d="M18.4 25.9 l1.1 1.1 l2.1 -2.3" stroke="${t.acc2}" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'libro':
      return `<g>${trabajando ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" dur="0.8s" repeatCount="indefinite"/>' : ''}
<rect x="33" y="14" width="6" height="8" rx="0.8" fill="${t.acc}"/>
<rect x="34" y="15" width="4" height="6" rx="0.4" fill="${t.acc2}"/></g>`
    case 'llave':
      return `<g>${trabajando ? '<animateTransform attributeName="transform" type="rotate" values="0 34 21;-25 34 21;0 34 21" dur="0.7s" repeatCount="indefinite"/>' : ''}
<line x1="34" y1="21" x2="37" y2="14.5" stroke="${t.acc}" stroke-width="2" stroke-linecap="round"/>
<circle cx="37.4" cy="13.4" r="2.2" fill="none" stroke="${t.acc}" stroke-width="1.6"/></g>`
    case 'corbata':
      return `<path d="M20 27 L16.5 25 L16.5 29 Z M20 27 L23.5 25 L23.5 29 Z" fill="${t.acc}"/>
<circle cx="20" cy="27" r="0.9" fill="${t.acc}"/>`
  }
}

/**
 * Avatar con la forma de la mascota de Claude: bloque con brazos cortos, cuatro
 * patas y dos ojos rectangulares. Trabajando: a color, camina, mueve los brazos,
 * mira a los lados y parpadea. Durmiendo: en grises, ojos cerrados, respira lento y suelta «z».
 */
export function avatar(tipo: string, trabajando: boolean): string {
  const p = perfilDe(tipo)
  const t: Tinta = trabajando ? { cuerpo: p.cuerpo, oscuro: '#1B1B1F', acc: p.acc, acc2: p.acc2, claro: '#FFFFFF' } : GRISES
  const acc = accesorio(p.accesorio, t, trabajando)
  const svg = (contenido: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">${contenido}</svg>`

  if (trabajando) {
    const pata = (x: number, fase: string) =>
      `<rect x="${x}" y="29" width="3" height="6" fill="${t.cuerpo}"><animateTransform attributeName="transform" type="translate" values="${fase}" dur="0.5s" repeatCount="indefinite"/></rect>`
    return svg(`
${pata(10, '0 0;0 -1.4;0 0')}${pata(22, '0 0;0 -1.4;0 0')}${pata(15, '0 -1.4;0 0;0 -1.4')}${pata(27, '0 -1.4;0 0;0 -1.4')}
<g>
<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.8;0 0" dur="0.5s" repeatCount="indefinite"/>
<rect x="4" y="18" width="4" height="5" fill="${t.cuerpo}"><animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" dur="0.5s" repeatCount="indefinite"/></rect>
<rect x="32" y="18" width="4" height="5" fill="${t.cuerpo}"><animateTransform attributeName="transform" type="translate" values="0 -1;0 0;0 -1" dur="0.5s" repeatCount="indefinite"/></rect>
<rect x="8" y="11" width="24" height="18" rx="1.5" fill="${t.cuerpo}"/>
<g fill="${t.oscuro}">
<animateTransform attributeName="transform" type="translate" values="-1.2 0;1.2 0;1.2 0;-1.2 0;-1.2 0" keyTimes="0;0.3;0.5;0.8;1" dur="2.8s" repeatCount="indefinite"/>
<rect x="14" y="16.5" width="3" height="5.5" rx="0.6"><animate attributeName="height" values="5.5;5.5;0.8;5.5" keyTimes="0;0.9;0.95;1" dur="3.4s" repeatCount="indefinite"/><animate attributeName="y" values="16.5;16.5;18.9;16.5" keyTimes="0;0.9;0.95;1" dur="3.4s" repeatCount="indefinite"/></rect>
<rect x="23" y="16.5" width="3" height="5.5" rx="0.6"><animate attributeName="height" values="5.5;5.5;0.8;5.5" keyTimes="0;0.9;0.95;1" dur="3.4s" repeatCount="indefinite"/><animate attributeName="y" values="16.5;16.5;18.9;16.5" keyTimes="0;0.9;0.95;1" dur="3.4s" repeatCount="indefinite"/></rect>
</g>
${acc}
</g>`)
  }

  return svg(`
<rect x="10" y="29" width="3" height="6" fill="${t.cuerpo}"/><rect x="15" y="29" width="3" height="6" fill="${t.cuerpo}"/>
<rect x="22" y="29" width="3" height="6" fill="${t.cuerpo}"/><rect x="27" y="29" width="3" height="6" fill="${t.cuerpo}"/>
<g>
<animateTransform attributeName="transform" type="translate" values="0 0;0 0.7;0 0" dur="3.6s" repeatCount="indefinite"/>
<rect x="4" y="19" width="4" height="5" fill="${t.cuerpo}"/><rect x="32" y="19" width="4" height="5" fill="${t.cuerpo}"/>
<rect x="8" y="11" width="24" height="18" rx="1.5" fill="${t.cuerpo}"/>
<path d="M13 21 h5 M22 21 h5" stroke="${t.oscuro}" stroke-width="2" stroke-linecap="round"/>
${acc}
</g>
<g fill="none" stroke="#9A9A9A" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
<path d="M33 7 h3 l-3 3.5 h3">
<animateTransform attributeName="transform" type="translate" values="0 2;1.5 -3" dur="2.4s" repeatCount="indefinite"/>
<animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite"/>
</path>
<path d="M36 2.5 h2.2 l-2.2 2.6 h2.2">
<animateTransform attributeName="transform" type="translate" values="0 2;1.5 -3" dur="2.4s" begin="1.2s" repeatCount="indefinite"/>
<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="1.2s" repeatCount="indefinite"/>
</path>
</g>`)
}

/** Barra redondeada de progreso. */
export function barraSvg(pct: number, ancho: number, color: string, alto = 6): string {
  const p = Math.max(0, Math.min(100, pct))
  const lleno = p === 0 ? 0 : Math.max(alto, (ancho * p) / 100)
  const r = alto / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">
<rect width="${ancho}" height="${alto}" rx="${r}" fill="${COLOR.pista}"/>
${lleno > 0 ? `<rect width="${lleno.toFixed(1)}" height="${alto}" rx="${r}" fill="${color}"/>` : ''}
</svg>`
}

/** Barra apilada: cada segmento es la parte de un agente en el total. */
export function barraApilada(segmentos: { valor: number; color: string }[], ancho: number, alto = 6): string {
  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1
  let x = 0
  const rects = segmentos
    .map(sg => {
      const w = (ancho * sg.valor) / total
      const r = `<rect x="${x.toFixed(1)}" width="${Math.max(0, w - 1).toFixed(1)}" height="${alto}" fill="${sg.color}"/>`
      x += w
      return r
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">
<clipPath id="c"><rect width="${ancho}" height="${alto}" rx="${alto / 2}"/></clipPath>
<g clip-path="url(#c)"><rect width="${ancho}" height="${alto}" fill="${COLOR.pista}"/>${rects}</g>
</svg>`
}

/** Anillo de progreso (sin texto: el porcentaje va al lado, en el tema del editor). */
export function anillo(pct: number, color: string, tam = 44): string {
  const p = Math.max(0, Math.min(100, pct))
  const r = 18
  const c = 2 * Math.PI * r
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${tam}" height="${tam}">
<circle cx="22" cy="22" r="${r}" fill="none" stroke="${COLOR.pista}" stroke-width="5"/>
<circle cx="22" cy="22" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
 stroke-dasharray="${((c * p) / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 22 22)"/>
</svg>`
}

/** Avatar de texto para la terminal, con la cara de la mascota; `fase` alterna en cada tick. */
export function avatarTexto(trabajando: boolean, fase: number): string {
  if (!trabajando) return '▐- -▌ᶻ'
  return ['▐▮ ▮▌', '▐ ▮▮▌', '▐▮▮ ▌', '▐- -▌'][fase % 4] ?? '▐▮ ▮▌'
}
