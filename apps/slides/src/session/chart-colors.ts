/** Chart color schemes for the "Change Colors" gallery, derived from the deck's theme. */
import { parseTheme, type OpenedPptx } from '@genoffice/pptx-engine'
import { tm } from '../main/i18n-main'

/** Legacy fixed color schemes (AI tools/old files still pass these keys; kept as fallback). */
export const CHART_COLOR_SCHEMES: Record<string, string[]> = {
  default: [],
  blue: ['#2E75B6', '#4472C4', '#5B9BD5', '#70AD47', '#ED7D31'],
  warm: ['#ED7D31', '#FFC000', '#FF0000', '#C55A11', '#833C00'],
  cool: ['#0070C0', '#00B0F0', '#00B0A0', '#7030A0', '#2E75B6'],
  mono: ['#404040', '#666666', '#888888', '#AAAAAA', '#CCCCCC'],
}

/** PowerPoint default theme accent sequence (fallback when the deck has no theme colors). */
const FALLBACK_ACCENTS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']

/** Mix a hex color with black/white by ratio (for mono-gradient steps). */
function mixHex(hex: string, target: number, ratio: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1]!, 16)
  const ch = (x: number) => Math.round(x + (target - x) * ratio)
  const r = ch((v >> 16) & 255)
  const g = ch((v >> 8) & 255)
  const b = ch(v & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`
}

/** Current deck's theme accent1..6 (read from the theme part of the first slide's inheritance chain). */
function deckAccents(opened: OpenedPptx): string[] {
  const slide = opened.deck.slides[0]
  if (!slide) return FALLBACK_ACCENTS
  try {
    const chain = opened.archive.resolveSlideChain(slide.path)
    const xml = chain.themePath ? opened.archive.readText(chain.themePath) : null
    const colors = xml ? parseTheme(xml).colors : undefined
    const acc = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
      .map((k) => colors?.[k])
      .filter((c): c is string => !!c)
    return acc.length >= 3 ? acc : FALLBACK_ACCENTS
  } catch {
    return FALLBACK_ACCENTS
  }
}

/** Theme-derived color schemes for the chart "Change Colors" gallery: two colorful sets + one mono gradient per accent. */
export function chartColorSchemes(
  opened: OpenedPptx,
): Array<{ key: string; label: string; colors: string[] }> {
  const acc = deckAccents(opened)
  const rot = [...acc.slice(3), ...acc.slice(0, 3)]
  const mono = (c: string) => [
    mixHex(c, 0, 0.25),
    c,
    mixHex(c, 255, 0.25),
    mixHex(c, 255, 0.45),
    mixHex(c, 255, 0.65),
  ]
  return [
    { key: 'default', label: tm('schemeThemeDefault'), colors: [] },
    { key: 'colorful', label: tm('schemeColorful'), colors: acc },
    { key: 'colorful2', label: tm('schemeColorful2'), colors: rot },
    ...acc.map((c, i) => ({
      key: `mono-accent${i + 1}`,
      label: tm('schemeMono', { n: i + 1 }),
      colors: mono(c),
    })),
  ]
}
