import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toastBottomPx } from '../src/renderer/toast-offset'

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

  it('reads its bottom offset from --slides-toast-bottom, falling back to 8px over the status bar', () => {
    expect(rule('.app-toast')).toContain('bottom: var(--slides-toast-bottom, 32px)')
  })

  it('follows the notes pane: 8px above it when shown, 8px above the status bar when hidden', () => {
    expect(toastBottomPx(false, 100)).toBe(32)
    expect(toastBottomPx(true, 100)).toBe(132)
    expect(toastBottomPx(true, 30)).toBe(62)
    expect(toastBottomPx(true, 480)).toBe(512)
    expect(toastBottomPx(true, 0)).toBe(32)
  })

  it('App sets the variable on its root from showNotes/notesHeight', () => {
    const app = readFileSync('src/renderer/App.tsx', 'utf8')
    expect(app).toMatch(
      /<div\s+className="app"\s+style=\{\s*\{\s*'--slides-toast-bottom': `\$\{toastBottomPx\(showNotes, notesHeight\)\}px`,?\s*\} as React\.CSSProperties\s*\}/,
    )
  })
})
