import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/styles.css', 'utf8')
const rule = (selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replaceAll('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('toast placement (UNI-2111)', () => {
  it('sits above the status bar, never over the ribbon at the top', () => {
    const toast = rule('.app-toast')
    expect(toast).toContain('position: fixed')
    expect(toast).toMatch(/bottom: \d+px/)
    expect(toast).not.toMatch(/(^|[\s;])top:/)
  })

  it('slides in vertically from below and stays centred (RTL-safe, no inline offsets)', () => {
    expect(rule('.app-toast')).toContain('transform: translate(-50%, 8px)')
    expect(rule('.app-toast.show')).toContain('transform: translate(-50%, 0)')
    expect(rule('.app-toast')).toContain('left: 50%')
  })
})
