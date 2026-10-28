/**
 * Canvas colours of the wiki graph. The canvas cannot read CSS variables itself, so GraphView
 * asks the computed style for the semantic tokens first; this table is only the answer when a
 * token is missing (a bare test harness, a renderer that has not loaded tokens.css). It is keyed
 * by the current theme so a fallback never lights a dark window.
 */
export interface GraphColors {
  text: string
  dim: string
  accent: string
  line: string
}

export type GraphTheme = 'light' | 'dark'

export const GRAPH_COLOR_FALLBACKS: Readonly<Record<GraphTheme, Readonly<GraphColors>>> = {
  light: { text: '#333333', dim: '#999999', accent: '#4a7d00', line: '#878c93' },
  dark: { text: '#e6e6e6', dim: '#a0a0a0', accent: '#8fc43a', line: '#707070' },
}

/** the theme the window shows: the explicit `data-theme`, else the system preference */
export function graphTheme(): GraphTheme {
  const explicit = document.documentElement.getAttribute('data-theme')
  if (explicit === 'dark' || explicit === 'light') return explicit
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const TOKENS: Readonly<Record<keyof GraphColors, string>> = {
  text: '--text',
  dim: '--text-tertiary',
  accent: '--accent',
  line: '--border-control',
}

/** tokens of the canvas's computed style first, the per-theme table for any that is unset */
export function readGraphColors(style: CSSStyleDeclaration | null): GraphColors {
  const fallback = GRAPH_COLOR_FALLBACKS[graphTheme()]
  const pick = (key: keyof GraphColors): string =>
    style?.getPropertyValue(TOKENS[key]).trim() || fallback[key]
  return { text: pick('text'), dim: pick('dim'), accent: pick('accent'), line: pick('line') }
}
