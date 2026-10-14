// Shell chrome uses the UniWork brand blue: #0a52e6 under white text in light, #5a96ff under a
// dark ink in both dark blocks (white on #5a96ff is under 3:1). --on-accent is the text token
// .btn-primary and .new-chat-send paint on --accent.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const home = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
const OPENERS = {
  light: '\n:root {',
  dark: "\n[data-theme='dark'] {",
  system: '\n@media (prefers-color-scheme: dark) {',
} as const

function blockOf(which: keyof typeof OPENERS): string {
  const start = home.indexOf(OPENERS[which])
  if (start < 0) throw new Error(`no ${which} block`)
  return home.slice(start, home.indexOf('\n}', start + 1))
}
const valueIn = (block: string, name: string) =>
  new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const EXPECTED = {
  light: { accent: '#0a52e6', hover: '#0843bd', on: '#ffffff', rgb: 'rgb(10 82 230' },
  dark: { accent: '#5a96ff', hover: '#7aabff', on: '#0d1220', rgb: 'rgb(90 150 255' },
  system: { accent: '#5a96ff', hover: '#7aabff', on: '#0d1220', rgb: 'rgb(90 150 255' },
} as const

describe('shell accent', () => {
  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
    '%s: brand blue, its hover, readable text and a matching button shadow',
    (which) => {
      const block = blockOf(which)
      const want = EXPECTED[which]
      expect(valueIn(block, '--accent')).toBe(want.accent)
      expect(valueIn(block, '--accent-hover')).toBe(want.hover)
      expect(valueIn(block, '--on-accent')).toBe(want.on)
      expect(valueIn(block, '--shadow-btn-primary')).toContain(want.rgb)
      expect(contrast(want.on, want.accent)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
