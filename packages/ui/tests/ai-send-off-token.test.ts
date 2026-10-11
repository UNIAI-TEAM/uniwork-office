// A disabled Send button shows a pale brand square; in dark themes it must be dimmed through a
// token defined in all three tokens.css blocks (light, dark, system-dark fallback), shared by
// every module's AI panel via ai-model-picker.css.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (name: string) => readFileSync(resolve(__dirname, '../src', name), 'utf8')

describe('disabled Send button token', () => {
  const tokens = src('tokens.css')
  const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

  it('has a value in the light, dark and system-dark blocks', () => {
    expect(blocks).toHaveLength(3)
    for (const block of blocks) expect(block).toMatch(/--ai-send-off-filter:\s*[^;]+;/)
  })

  it('dims the art in both dark blocks and leaves it alone in light', () => {
    expect(blocks[0]).toMatch(/--ai-send-off-filter:\s*none;/)
    expect(blocks[1]).toMatch(/--ai-send-off-filter:\s*brightness\(/)
    expect(blocks[2]).toMatch(/--ai-send-off-filter:\s*brightness\(/)
  })

  it('the shared AI footer stylesheet applies it to a disabled Send button', () => {
    expect(src('ai-model-picker.css')).toMatch(
      /\.ai-send-btn:disabled img\s*{[^}]*var\(--ai-send-off-filter/,
    )
  })
})
