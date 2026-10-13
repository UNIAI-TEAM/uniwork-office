// UniWork module tints and the info signal (uniwork:packages/ui/styles/tokens.css, renamed
// -foreground -> -fg and info-soft -> info-bg) must be defined in all three tokens.css blocks:
// light in :root, the dark value in [data-theme='dark'] and in the system-dark fallback.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve(__dirname, '../src/tokens.css'), 'utf8')
const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

/** token -> [light, dark] */
const EXPECTED: Record<string, [string, string]> = {
  '--tint-gray': ['#eeeeef', '#262626'],
  '--tint-gray-fg': ['#5c5c5c', '#a1a1aa'],
  '--tint-green': ['#e6f7ee', '#16301f'],
  '--tint-green-fg': ['#137046', '#4ade80'],
  '--tint-yellow': ['#fff6d6', '#3a2f10'],
  '--tint-yellow-fg': ['#8f5300', '#fbbf24'],
  '--tint-orange': ['#ffece5', '#3d2416'],
  '--tint-orange-fg': ['#a84300', '#ffa06b'],
  '--tint-violet': ['#efedfd', '#2a1f4a'],
  '--tint-violet-fg': ['#7612fa', '#b38cff'],
  '--tint-blue': ['#e6f0ff', '#182640'],
  '--tint-blue-fg': ['#0a66bc', '#5db4ff'],
  '--tint-teal': ['#e0f5f2', '#123430'],
  '--tint-teal-fg': ['#0d6e66', '#3fd6c5'],
  '--tint-pink': ['#fff1fe', '#3d1a35'],
  '--tint-pink-fg': ['#b8107f', '#ff7ad9'],
  '--info': ['#0a66bc', '#5db4ff'],
  '--info-bg': ['#e6f0ff', '#182640'],
  // white text on --color-error keeps AA when --on-accent turns dark in dark themes
  '--on-danger': ['#ffffff', '#ffffff'],
}

const valueIn = (block: string, name: string) =>
  new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

describe('UniWork tint and info tokens', () => {
  it('tokens.css still has exactly three theme blocks', () => {
    expect(blocks).toHaveLength(3)
  })

  it.each(Object.entries(EXPECTED))(
    '%s: light value in :root, dark value in both dark blocks',
    (name, [light, dark]) => {
      expect(valueIn(blocks[0]!, name)).toBe(light)
      expect(valueIn(blocks[1]!, name)).toBe(dark)
      expect(valueIn(blocks[2]!, name)).toBe(dark)
    },
  )
})
