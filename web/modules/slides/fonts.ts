/**
 * Text metrics and fonts of the Slides web frame (GO-B5 S4, inventory-b5 3.5).
 *
 * The desktop lays text out with OpentypeMetrics over the machine's font files (main/fonts.ts)
 * plus HarfBuzz for complex scripts. The web frame has no font files and no wasm (CSP), so it
 * measures with the same engine that draws: `canvas.measureText`, with the font string Konva
 * uses for `fillText`. Measure and draw agree by construction (shaping included); where a deck's
 * font is missing on the viewer's machine both fall back to the same browser font. Calibri maps
 * to its bundled metric twin Carlito (as on the desktop). No canvas (jsdom) -> HeuristicMetrics.
 *
 * Embedded pptx fonts become `FontFace`s from their bytes (font-src does not apply to
 * ArrayBuffer faces); open waits for them and for Carlito before the first layout.
 */
import { listEmbeddedFonts, type OpenedPptx } from '@genoffice/pptx-engine'
import {
  HeuristicMetrics,
  type FontMetrics,
  type FontMetricsProvider,
  type RunStyle,
} from '@genoffice/pptx-render'

/** families drawn with a bundled metric-compatible twin (same map as the desktop's alias table) */
const ALIASES: Readonly<Record<string, string>> = {
  calibri: 'Carlito',
  'calibri light': 'Carlito',
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])

export function cssFamily(family: string): string {
  const alias = ALIASES[family.trim().toLowerCase()]
  return alias ?? family.trim()
}

/** the CSS `font` shorthand Konva builds for a run (style weight size family) */
export function cssFont(style: RunStyle, family = cssFamily(style.fontFamily)): string {
  const quoted = GENERIC.has(family.toLowerCase()) ? family : `"${family.replace(/"/g, '')}"`
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSizePx}px ${quoted}`
}

const MAX_CACHE = 20000

export class CanvasMetrics implements FontMetricsProvider {
  private readonly widths = new Map<string, number>()
  private readonly lines = new Map<string, FontMetrics>()

  constructor(
    private readonly g: CanvasRenderingContext2D,
    private readonly fallback: FontMetricsProvider = new HeuristicMetrics(),
  ) {}

  private setFont(style: RunStyle): string {
    const font = cssFont(style)
    if (this.g.font !== font) this.g.font = font
    return font
  }

  metrics(style: RunStyle): FontMetrics {
    const font = cssFont(style)
    const hit = this.lines.get(font)
    if (hit) return hit
    this.setFont(style)
    const m = this.g.measureText('Hg')
    const ascent = m.fontBoundingBoxAscent
    const descent = m.fontBoundingBoxDescent
    const out =
      Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
        ? { ascent, descent, lineHeight: ascent + descent }
        : this.fallback.metrics(style)
    this.lines.set(font, out)
    return out
  }

  measure(text: string, style: RunStyle): number {
    const font = cssFont(style)
    const key = `${font}\u0000${style.kerning === false ? 0 : 1}\u0000${text}`
    const hit = this.widths.get(key)
    if (hit !== undefined) return hit
    this.setFont(style)
    const g = this.g as CanvasRenderingContext2D & { fontKerning?: string }
    if ('fontKerning' in g) g.fontKerning = style.kerning === false ? 'none' : 'normal'
    const w = g.measureText(text).width
    const out = Number.isFinite(w) ? w : this.fallback.measure(text, style)
    if (this.widths.size > MAX_CACHE) this.widths.clear()
    this.widths.set(key, out)
    return out
  }

  displayFamily(style: RunStyle): string {
    return cssFamily(style.fontFamily)
  }
}

/** canvas metrics when the document has a 2d canvas, else the deterministic heuristic */
export function createWebFontMetrics(doc: Document = document): FontMetricsProvider {
  let g: CanvasRenderingContext2D | null
  try {
    g = doc.createElement('canvas').getContext('2d')
  } catch {
    g = null
  }
  return g ? new CanvasMetrics(g) : new HeuristicMetrics()
}

const WEIGHT: Record<string, { weight: string; style: string }> = {
  regular: { weight: '400', style: 'normal' },
  bold: { weight: '700', style: 'normal' },
  italic: { weight: '400', style: 'italic' },
  boldItalic: { weight: '700', style: 'italic' },
}

/** registered embedded faces, `family|style` -> face (a reopened deck does not register twice) */
const embedded = new Map<string, FontFace>()

/**
 * Register a deck's usable embedded fonts as FontFaces; resolves once they are loaded (a bad
 * face is skipped: embedded fonts are best-effort, as on the desktop). True when a face was
 * added, so cached metrics must be rebuilt.
 */
export async function registerEmbeddedFonts(opened: OpenedPptx): Promise<boolean> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false
  let faces
  try {
    faces = listEmbeddedFonts(opened.archive)
  } catch {
    return false
  }
  const added: FontFace[] = []
  for (const f of faces) {
    const key = `${f.typeface}|${f.style}`
    if (embedded.has(key)) continue
    const desc = WEIGHT[f.style] ?? WEIGHT.regular!
    const bytes = new Uint8Array(f.sfnt)
    const face = new FontFace(f.typeface, bytes.buffer, desc)
    embedded.set(key, face)
    document.fonts.add(face)
    added.push(face)
  }
  await Promise.all(added.map((face) => face.load().catch(() => null)))
  return added.length > 0
}

/** Carlito (the Calibri twin) faces the renderer bundles; canvas never triggers their download */
export async function loadBundledFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  await Promise.all(
    ['', 'bold ', 'italic ', 'italic bold '].map((v) =>
      document.fonts.load(`${v}16px Carlito`).catch(() => []),
    ),
  )
}
