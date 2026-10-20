import { describe, expect, it } from 'vitest'
import {
  acceleratorSkipReason,
  chordToElectronAccelerator,
  formatChord,
  formatHint,
  hintParts,
  toElectronAccelerator,
  type ShortcutAction,
} from '../src/index'

function action(partial: Partial<ShortcutAction> & { id: string }): ShortcutAction {
  return { scope: 'docs', win: [], mac: [], match: 'key', guard: {}, ...partial }
}

const saveAs = action({ id: 'save-as', win: ['Ctrl+Shift+S'], mac: ['Shift+Cmd+S'] })
const devTools = action({ id: 'devtools', win: ['Ctrl+Shift+I'], mac: ['Alt+Cmd+I'] })
const wordSaveAs = action({ id: 'docs-005', win: ['F12'], mac: ['Shift+Cmd+S'] })
const replace = action({ id: 'replace', win: ['Ctrl+H'], mac: ['Ctrl+H'] })
const winOnly = action({ id: 'print-preview', win: ['Ctrl+Alt+I'], mac: [] })
const close = action({
  id: 'close',
  win: ['Ctrl+W'],
  mac: ['Cmd+W'],
  web: { win: [], mac: [] },
  webAlt: { win: 'Alt+Shift+W' },
})

describe('toElectronAccelerator', () => {
  it('uses CmdOrCtrl when Windows and macOS differ only by Ctrl/Cmd', () => {
    expect(toElectronAccelerator(saveAs, 'win')).toBe('CmdOrCtrl+Shift+S')
    expect(toElectronAccelerator(saveAs, 'mac')).toBe('CmdOrCtrl+Shift+S')
  })

  it('writes the platform chord when the two differ', () => {
    expect(toElectronAccelerator(devTools, 'mac')).toBe('Alt+Command+I')
    expect(toElectronAccelerator(devTools, 'win')).toBe('Ctrl+Shift+I')
    expect(toElectronAccelerator(wordSaveAs, 'win')).toBe('F12')
    expect(toElectronAccelerator(wordSaveAs, 'mac')).toBe('Shift+Command+S')
  })

  it('keeps Mac Control as Ctrl (Electron reads Ctrl as Control on macOS)', () => {
    expect(toElectronAccelerator(replace, 'mac')).toBe('Ctrl+H')
  })

  it('returns null when the platform has no chord', () => {
    expect(toElectronAccelerator(winOnly, 'mac')).toBeNull()
    expect(acceleratorSkipReason(winOnly, 'mac')).toMatch(/no desktop chord/)
  })

  it('keeps Windows Ctrl+Alt chords out of menus (AltGr), with a reason (RS-table M4)', () => {
    const heading1 = action({
      id: 'docs-056',
      win: ['Ctrl+Alt+1'],
      mac: ['Alt+Cmd+1'],
      guard: { altGraph: true },
    })
    expect(toElectronAccelerator(heading1, 'win')).toBeNull()
    expect(acceleratorSkipReason(heading1, 'win')).toMatch(/AltGr/)
    expect(formatHint(heading1, 'win', 'desktop')).toBe('Ctrl+Alt+1')
    expect(toElectronAccelerator(heading1, 'mac')).toBe('CmdOrCtrl+Alt+1')
    expect(acceleratorSkipReason(heading1, 'mac')).toBeNull()
    expect(toElectronAccelerator(winOnly, 'win')).toBeNull()
    expect(acceleratorSkipReason(saveAs, 'win')).toBeNull()
  })

  it('writes punctuation keys as characters', () => {
    expect(chordToElectronAccelerator('Ctrl+Shift+Period', 'win')).toBe('Ctrl+Shift+.')
    expect(chordToElectronAccelerator('Cmd+BracketRight', 'mac')).toBe('Command+]')
    expect(chordToElectronAccelerator('Ctrl+Equal', 'win')).toBe('Ctrl+=')
    expect(chordToElectronAccelerator('Shift+F10', 'win')).toBe('Shift+F10')
    expect(chordToElectronAccelerator('Alt+Shift+Up', 'win')).toBe('Alt+Shift+Up')
  })

  it('refuses chords Electron or the platform cannot express', () => {
    expect(chordToElectronAccelerator('Cmd+S', 'win')).toBeNull()
    expect(chordToElectronAccelerator('Shift+ContextMenu', 'win')).toBeNull()
    expect(chordToElectronAccelerator('Ctrl+Bogus', 'win')).toBeNull()
  })
})

describe('formatChord / formatHint', () => {
  it('Windows: Ctrl+Shift+S style', () => {
    expect(formatHint(saveAs, 'win', 'desktop')).toBe('Ctrl+Shift+S')
    expect(formatChord('Ctrl+Alt+Minus', 'win')).toBe('Ctrl+Alt+-')
    expect(formatChord('Ctrl+PageDown', 'win')).toBe('Ctrl+PgDn')
    expect(formatChord('Escape', 'win')).toBe('Esc')
  })

  it('macOS: Apple glyph order ⌃⌥⇧⌘', () => {
    expect(formatHint(saveAs, 'mac', 'desktop')).toBe('⇧⌘S')
    expect(formatHint(devTools, 'mac', 'desktop')).toBe('⌥⌘I')
    expect(formatHint(replace, 'mac', 'desktop')).toBe('⌃H')
    expect(formatChord('Ctrl+Alt+Shift+Cmd+G', 'mac')).toBe('⌃⌥⇧⌘G')
    expect(formatChord('Shift+Cmd+Enter', 'mac')).toBe('⇧⌘↩')
    expect(formatChord('Alt+Right', 'mac')).toBe('⌥→')
  })

  it('empty when the action has no chord on the platform', () => {
    expect(formatHint(winOnly, 'mac', 'desktop')).toBe('')
  })

  it('web: shows the alternative and hands back the desktop chord for the note', () => {
    expect(formatHint(close, 'win', 'web')).toBe('Alt+Shift+W')
    expect(hintParts(close, 'win', 'web')).toEqual({ primary: 'Alt+Shift+W', desktop: 'Ctrl+W' })
    expect(hintParts(close, 'win', 'desktop')).toEqual({ primary: 'Ctrl+W', desktop: null })
    expect(formatHint(close, 'mac', 'web')).toBe('')
  })

  it('web: no desktop note when the action keeps its desktop chord', () => {
    expect(hintParts(saveAs, 'win', 'web')).toEqual({ primary: 'Ctrl+Shift+S', desktop: null })
  })
})
