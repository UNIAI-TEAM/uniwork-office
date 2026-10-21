import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { shortcutHint, withShortcutHint } from '../src/renderer/src/home-shortcut-hints'

describe('Home tooltip hints', () => {
  it('shows the table chord per platform', () => {
    expect(withShortcutHint('New document', 'common-01', 'win')).toBe('New document (Ctrl+N)')
    expect(withShortcutHint('New document', 'common-01', 'mac')).toBe('New document (⌘N)')
    expect(withShortcutHint('Open', 'common-03', 'win')).toBe('Open (Ctrl+O)')
  })

  it('is the bare label when the row has no chord or does not exist', () => {
    expect(withShortcutHint('Close', 'common-does-not-exist', 'win')).toBe('Close')
  })

  it('the chord alone, for a ScreenTip kbd slot', () => {
    expect(shortcutHint('common-03', 'win')).toBe('Ctrl+O')
    expect(shortcutHint('common-03', 'mac')).toBe('⌘O')
    expect(shortcutHint('common-does-not-exist', 'win')).toBe('')
  })

  it('the Open card shows its chord in the ScreenTip, not in a second native title (RS-delta-core L2)', () => {
    const home = readFileSync(join(__dirname, '../src/renderer/src/Home.tsx'), 'utf8')
    const card = home.slice(home.indexOf('onClick={() => void window.aiOffice.browse()}'))
    const open = card.slice(0, card.indexOf('\n        >'))
    expect(open).toContain('data-tip={OPEN_LOCAL_EXTENSIONS}')
    expect(open).toContain("data-tip-kbd={shortcutHint('common-03') || undefined}")
    expect(open).not.toContain(' title=')
  })
})
