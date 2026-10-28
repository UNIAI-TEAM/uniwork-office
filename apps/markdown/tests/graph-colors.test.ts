import { afterEach, describe, expect, it } from 'vitest'
import {
  GRAPH_COLOR_FALLBACKS,
  graphTheme,
  readGraphColors,
} from '../src/renderer/components/graph-colors'

/** the graph canvas takes the semantic tokens first; the per-theme table only fills what is unset */

function style(tokens: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (name: string) => tokens[name] ?? '' } as CSSStyleDeclaration
}

afterEach(() => document.documentElement.removeAttribute('data-theme'))

describe('graph colours', () => {
  it('reads the tokens of the computed style before any fallback', () => {
    const colors = readGraphColors(
      style({
        '--text': ' tok-text ',
        '--text-tertiary': 'tok-dim',
        '--accent': 'tok-accent',
        '--border-control': 'tok-line',
      }),
    )
    expect(colors).toEqual({
      text: 'tok-text',
      dim: 'tok-dim',
      accent: 'tok-accent',
      line: 'tok-line',
    })
  })

  it('fills only the missing tokens, from the table of the current theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const colors = readGraphColors(style({ '--accent': 'tok-accent' }))
    expect(colors.accent).toBe('tok-accent')
    expect(colors.text).toBe(GRAPH_COLOR_FALLBACKS.dark.text)
    expect(colors.line).toBe(GRAPH_COLOR_FALLBACKS.dark.line)
  })

  it('falls back to the light table without a style and without a dark theme', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    expect(graphTheme()).toBe('light')
    expect(readGraphColors(null)).toEqual(GRAPH_COLOR_FALLBACKS.light)
  })
})
