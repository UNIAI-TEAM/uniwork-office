import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/styles.css', 'utf8')
const rule = (selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replaceAll('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('toast placement (UNI-2118)', () => {
  it('sits above the status bar, never over the ribbon at the top', () => {
    const toast = rule('.app-toast')
    expect(toast).toContain('position: fixed')
    expect(toast).toMatch(/bottom: [^;]+;/)
    expect(toast).not.toMatch(/(^|[\s;])top:/)
  })

  it('slides in vertically from below and stays centred (RTL-safe, no inline offsets)', () => {
    expect(rule('.app-toast')).toContain('transform: translate(-50%, 8px)')
    expect(rule('.app-toast.show')).toContain('transform: translate(-50%, 0)')
    expect(rule('.app-toast')).toContain('left: 50%')
  })

  // Univer's footer (the 36px sheet tab strip inside #univer-container) sits above the status bar
  // and does not follow --ui-scale; the status bar is 24px and does. The toast must clear both.
  const bottomAt = (scale: number) => {
    const toast = rule('.app-toast')
    const vars = new Map(
      [...toast.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(
        (m) => [m[1], (m[2] ?? '').trim()] as const,
      ),
    )
    const decl = /bottom:\s*([^;]+);/.exec(toast)?.[1] ?? ''
    const resolve = (expr: string): string =>
      expr
        .replace(/var\((--ui-scale),\s*[^)]*\)/g, String(scale))
        .replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(vars.get(name) ?? 'NaN'))
    const arithmetic = resolve(decl).replace(/calc/g, '').replace(/px/g, '')
    return Function(`return (${arithmetic})`)() as number
  }

  it('clears the sheet tab strip plus the status bar at 1x (68px)', () => {
    expect(bottomAt(1)).toBe(68)
  })

  it('keeps clearing the scaled status bar at 1.5x (80px) while the strip stays 36px', () => {
    expect(bottomAt(1.5)).toBe(80)
  })
})
