import { describe, expect, it } from 'vitest'

import { withShortcutHint } from '../src/renderer/src/home-shortcut-hints'

describe('Home tooltip hints', () => {
  it('shows the table chord per platform', () => {
    expect(withShortcutHint('New document', 'common-01', 'win')).toBe('New document (Ctrl+N)')
    expect(withShortcutHint('New document', 'common-01', 'mac')).toBe('New document (⌘N)')
    expect(withShortcutHint('Open', 'common-03', 'win')).toBe('Open (Ctrl+O)')
  })

  it('is the bare label when the row has no chord or does not exist', () => {
    expect(withShortcutHint('Close', 'common-does-not-exist', 'win')).toBe('Close')
  })
})
