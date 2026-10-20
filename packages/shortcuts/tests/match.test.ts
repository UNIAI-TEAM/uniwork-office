import { describe, expect, it } from 'vitest'
import {
  createMatcher,
  docsShortcuts,
  fromElectronInput,
  matchChord,
  matchShortcut,
  type ShortcutAction,
  type ShortcutKeyEvent,
} from '../src/index'

function keyEvent(
  init: Partial<ShortcutKeyEvent> & { key: string; code: string },
  modifierState: Record<string, boolean> = {},
): ShortcutKeyEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: (name: string) => modifierState[name] === true,
    ...init,
  }
}

function action(partial: Partial<ShortcutAction> & { id: string }): ShortcutAction {
  return { scope: 'docs', win: [], mac: [], match: 'key', guard: {}, ...partial }
}

const save = action({ id: 'save', win: ['Ctrl+S'], mac: ['Cmd+S'] })
const heading1 = action({
  id: 'h1',
  win: ['Ctrl+Alt+1'],
  mac: ['Alt+Cmd+1'],
  guard: { altGraph: true },
})
const replace = action({ id: 'replace', win: ['Ctrl+H'], mac: ['Ctrl+H'] })
const newDoc = action({
  id: 'new',
  win: ['Ctrl+N'],
  mac: ['Cmd+N'],
  web: { win: [], mac: [] },
  webAlt: { win: 'Alt+Shift+N', mac: 'Alt+Shift+N' },
})

describe('matchChord: composition guard', () => {
  it('ignores events while an IME (Telex/VNI) is composing', () => {
    const event = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true, isComposing: true })
    expect(matchChord('Ctrl+S', event, 'win')).toBe(false)
  })

  it('ignores keyCode 229 (composition keydown in Chromium/Safari)', () => {
    const event = keyEvent({ key: 'Process', code: 'KeyS', ctrlKey: true, keyCode: 229 })
    expect(matchChord('Ctrl+S', event, 'win')).toBe(false)
    expect(matchShortcut(event, [save], 'win', 'desktop')).toBeNull()
  })

  it('matches the same chord once composition ends', () => {
    const event = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true, isComposing: false })
    expect(matchChord('Ctrl+S', event, 'win')).toBe(true)
  })
})

describe('matchChord: AltGr guard', () => {
  it('rejects Ctrl+Alt chords typed with AltGr on Windows', () => {
    const event = keyEvent(
      { key: '1', code: 'Digit1', ctrlKey: true, altKey: true },
      { AltGraph: true },
    )
    expect(matchChord('Ctrl+Alt+1', event, 'win')).toBe(false)
    expect(matchShortcut(event, [heading1], 'win', 'desktop')).toBeNull()
  })

  it('accepts the real Ctrl+Alt chord', () => {
    const event = keyEvent({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true })
    expect(matchShortcut(event, [heading1], 'win', 'desktop')?.id).toBe('h1')
  })

  it('does not apply the Windows AltGr rule to macOS Option', () => {
    const event = keyEvent(
      { key: '¡', code: 'Digit1', altKey: true, metaKey: true },
      { AltGraph: true },
    )
    expect(matchShortcut(event, [heading1], 'mac', 'desktop')?.id).toBe('h1')
  })
})

describe('matchChord: letters by key, case-insensitive', () => {
  it('matches with Caps Lock on (key arrives upper-case)', () => {
    const event = keyEvent({ key: 'S', code: 'KeyS', ctrlKey: true }, { CapsLock: true })
    expect(matchChord('Ctrl+S', event, 'win')).toBe(true)
  })

  it('requires Shift exactly as the chord says', () => {
    const shifted = keyEvent({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
    expect(matchChord('Ctrl+S', shifted, 'win')).toBe(false)
    expect(matchChord('Ctrl+Shift+S', shifted, 'win')).toBe(true)
  })

  it('follows the layout: Dvorak "s" is on the physical ; key', () => {
    const event = keyEvent({ key: 's', code: 'Semicolon', ctrlKey: true })
    expect(matchChord('Ctrl+S', event, 'win')).toBe(true)
    expect(matchChord('Ctrl+S', event, 'win', 'code')).toBe(false)
  })

  it('does not fall back to the position when the key types another ASCII character', () => {
    // AZERTY: the US M key types ",", Dvorak: the US Q key types "'".
    const azertyComma = keyEvent({ key: ',', code: 'KeyM', ctrlKey: true })
    expect(matchChord('Ctrl+M', azertyComma, 'win')).toBe(false)
    expect(matchChord('Ctrl+Comma', azertyComma, 'win')).toBe(true)
    const dvorakQuote = keyEvent({ key: "'", code: 'KeyQ', ctrlKey: true })
    expect(matchChord('Ctrl+Q', dvorakQuote, 'win')).toBe(false)
  })

  it('falls back to the physical key when the layout types no Latin letter', () => {
    const cyrillic = keyEvent({ key: 'ы', code: 'KeyS', ctrlKey: true })
    expect(matchChord('Ctrl+S', cyrillic, 'win')).toBe(true)
    const optionDeadKey = keyEvent({ key: 'å', code: 'KeyA', altKey: true, metaKey: true })
    expect(matchChord('Alt+Cmd+A', optionDeadKey, 'mac')).toBe(true)
  })
})

describe('matchChord: digits by code, punctuation by character', () => {
  it('matches Ctrl+1 on AZERTY, where the unshifted digit key types "&"', () => {
    const event = keyEvent({ key: '&', code: 'Digit1', ctrlKey: true })
    expect(matchChord('Ctrl+1', event, 'win')).toBe(true)
  })

  it('reads a Shift chord as its US character (Ctrl+Shift+Period is Ctrl+">")', () => {
    const event = keyEvent({ key: '>', code: 'Period', ctrlKey: true, shiftKey: true })
    expect(matchChord('Ctrl+Shift+Period', event, 'win')).toBe(true)
    expect(matchChord('Ctrl+Period', event, 'win')).toBe(false)
  })

  it('matches the character wherever the layout puts it, Shift included', () => {
    // German: ">" is Shift+<, "+" is the unshifted ] key, "/" is Shift+7.
    const germanGreater = keyEvent({
      key: '>',
      code: 'IntlBackslash',
      ctrlKey: true,
      shiftKey: true,
    })
    expect(matchChord('Ctrl+Shift+Period', germanGreater, 'win')).toBe(true)
    const germanPlus = keyEvent({ key: '+', code: 'BracketRight', ctrlKey: true })
    expect(matchChord('Ctrl+Shift+Equal', germanPlus, 'win')).toBe(true)
    expect(matchChord('Ctrl+BracketRight', germanPlus, 'win')).toBe(false)
    const germanSlash = keyEvent({ key: '/', code: 'Digit7', ctrlKey: true, shiftKey: true })
    expect(matchChord('Ctrl+Slash', germanSlash, 'win')).toBe(true)
  })

  it('keeps the other modifiers exact', () => {
    const event = keyEvent({ key: '/', code: 'Slash', ctrlKey: true, altKey: true })
    expect(matchChord('Ctrl+Slash', event, 'win')).toBe(false)
  })

  it('`code` rows still compare punctuation by position, Shift exact', () => {
    const germanPlus = keyEvent({ key: '+', code: 'BracketRight', ctrlKey: true })
    expect(matchChord('Ctrl+BracketRight', germanPlus, 'win', 'code')).toBe(true)
    expect(matchChord('Ctrl+Shift+Equal', germanPlus, 'win', 'code')).toBe(false)
  })

  it('matches the keypad keys by position only', () => {
    const numpadAdd = keyEvent({ key: '+', code: 'NumpadAdd', ctrlKey: true })
    expect(matchChord('Ctrl+NumpadAdd', numpadAdd, 'win')).toBe(true)
    expect(matchChord('Ctrl+Shift+Equal', numpadAdd, 'win')).toBe(false)
    const plus = keyEvent({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true })
    expect(matchChord('Ctrl+NumpadAdd', plus, 'win')).toBe(false)
    const numpad0 = keyEvent({ key: '0', code: 'Numpad0', metaKey: true })
    expect(matchChord('Cmd+Numpad0', numpad0, 'mac')).toBe(true)
    expect(matchChord('Cmd+0', numpad0, 'mac')).toBe(false)
  })

  it('does not take the numeric keypad for a digit chord', () => {
    const event = keyEvent({ key: '8', code: 'Numpad8', ctrlKey: true, shiftKey: true })
    expect(matchChord('Ctrl+Shift+8', event, 'win')).toBe(false)
  })
})

describe('matchChord: named keys', () => {
  it('matches F-keys, arrows and Space', () => {
    expect(matchChord('F12', keyEvent({ key: 'F12', code: 'F12' }), 'win')).toBe(true)
    expect(matchChord('Shift+F4', keyEvent({ key: 'F4', code: 'F4', shiftKey: true }), 'mac')).toBe(
      true,
    )
    expect(
      matchChord(
        'Alt+Shift+Up',
        keyEvent({ key: 'ArrowUp', code: 'ArrowUp', altKey: true, shiftKey: true }),
        'win',
      ),
    ).toBe(true)
    expect(
      matchChord('Ctrl+Space', keyEvent({ key: ' ', code: 'Space', ctrlKey: true }), 'win'),
    ).toBe(true)
  })
})

describe('matchChord: Mac vs Windows modifiers', () => {
  const cmdS = keyEvent({ key: 's', code: 'KeyS', metaKey: true })
  const ctrlS = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true })

  it('Cmd is the Mac primary modifier, Ctrl the Windows one', () => {
    expect(matchShortcut(cmdS, [save], 'mac', 'desktop')?.id).toBe('save')
    expect(matchShortcut(ctrlS, [save], 'mac', 'desktop')).toBeNull()
    expect(matchShortcut(ctrlS, [save], 'win', 'desktop')?.id).toBe('save')
    expect(matchShortcut(cmdS, [save], 'win', 'desktop')).toBeNull()
  })

  it('Mac Control is its own modifier, not Cmd', () => {
    const controlH = keyEvent({ key: 'h', code: 'KeyH', ctrlKey: true })
    const cmdH = keyEvent({ key: 'h', code: 'KeyH', metaKey: true })
    expect(matchShortcut(controlH, [replace], 'mac', 'desktop')?.id).toBe('replace')
    expect(matchShortcut(cmdH, [replace], 'mac', 'desktop')).toBeNull()
  })

  it('a Cmd chord never matches on Windows (the Windows key is not Cmd)', () => {
    const winKeyS = keyEvent({ key: 's', code: 'KeyS', metaKey: true })
    expect(matchChord('Cmd+S', winKeyS, 'win')).toBe(false)
  })

  it('an extra modifier blocks the match', () => {
    const ctrlAltS = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
    expect(matchShortcut(ctrlAltS, [save], 'win', 'desktop')).toBeNull()
  })
})

describe('matchShortcut: surfaces and guards', () => {
  it('uses the web column and the web alternative on web only', () => {
    const ctrlN = keyEvent({ key: 'n', code: 'KeyN', ctrlKey: true })
    const altShiftN = keyEvent({ key: 'N', code: 'KeyN', altKey: true, shiftKey: true })
    expect(matchShortcut(ctrlN, [newDoc], 'win', 'desktop')?.id).toBe('new')
    expect(matchShortcut(ctrlN, [newDoc], 'win', 'web')).toBeNull()
    expect(matchShortcut(altShiftN, [newDoc], 'win', 'web')?.id).toBe('new')
    expect(matchShortcut(altShiftN, [newDoc], 'win', 'desktop')).toBeNull()
  })

  it('falls back to the desktop chords when an action has no web column', () => {
    const ctrlS = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true })
    expect(matchShortcut(ctrlS, [save], 'win', 'web')?.id).toBe('save')
  })

  it('skips auto-repeat for noRepeat actions', () => {
    const once = action({ id: 'once', win: ['Ctrl+S'], mac: [], guard: { noRepeat: true } })
    const repeat = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true, repeat: true })
    expect(matchShortcut(repeat, [once], 'win', 'desktop')).toBeNull()
    expect(matchShortcut(repeat, [save], 'win', 'desktop')?.id).toBe('save')
  })

  it('createMatcher binds the table', () => {
    const match = createMatcher([save, heading1])
    const ctrlAlt1 = keyEvent({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true })
    expect(match(ctrlAlt1, 'win', 'desktop')?.id).toBe('h1')
  })
})

describe('AltGr guard without getModifierState (RS-table M4)', () => {
  const plain = (init: Partial<ShortcutKeyEvent> & { key: string; code: string }) => ({
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
  })

  it('treats Ctrl+Alt as possible AltGr on Windows when the event cannot tell', () => {
    const event = plain({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true })
    expect(matchChord('Ctrl+Alt+1', event, 'win')).toBe(false)
    expect(matchShortcut(event, [heading1], 'win', 'desktop')).toBeNull()
  })

  it('still matches other chords, and Option chords on macOS', () => {
    expect(matchChord('Ctrl+S', plain({ key: 's', code: 'KeyS', ctrlKey: true }), 'win')).toBe(true)
    const optionCmd1 = plain({ key: '¡', code: 'Digit1', altKey: true, metaKey: true })
    expect(matchShortcut(optionCmd1, [heading1], 'mac', 'desktop')?.id).toBe('h1')
  })

  it('fromElectronInput maps before-input-event fields and keeps the guard on', () => {
    const input = {
      type: 'keyDown',
      key: 's',
      code: 'KeyS',
      control: true,
      alt: false,
      shift: false,
      meta: false,
      isAutoRepeat: true,
    }
    expect(fromElectronInput(input)).toMatchObject({ key: 's', ctrlKey: true, repeat: true })
    const altGr = fromElectronInput({ ...input, key: '1', code: 'Digit1', alt: true })
    expect(matchShortcut(altGr, [heading1], 'win', 'desktop')).toBeNull()
  })
})

describe('generated tables: auto-repeat (RS-table M1)', () => {
  const ctrl = (key: string, code: string, repeat: boolean) =>
    keyEvent({ key, code, ctrlKey: true, repeat })

  it('an editing command (Save) ignores auto-repeat', () => {
    expect(matchShortcut(ctrl('s', 'KeyS', false), docsShortcuts, 'win', 'desktop')?.id).toBe(
      'docs-004',
    )
    expect(matchShortcut(ctrl('s', 'KeyS', true), docsShortcuts, 'win', 'desktop')).toBeNull()
  })

  it('undo and zoom may repeat', () => {
    expect(matchShortcut(ctrl('z', 'KeyZ', true), docsShortcuts, 'win', 'desktop')?.id).toBe(
      'docs-010',
    )
    expect(matchShortcut(ctrl('=', 'Equal', true), docsShortcuts, 'win', 'desktop')?.id).toBe(
      'docs-082',
    )
  })
})

describe('matchShortcut: context (RS-table L4)', () => {
  const hidePointer = action({
    id: 'slides-32',
    scope: 'slides',
    context: 'slideshow',
    win: ['Ctrl+H'],
    mac: ['Ctrl+H'],
  })
  const replaceRow = { ...replace, scope: 'slides' as const }

  it('matches only the rows of the active context', () => {
    const ctrlH = keyEvent({ key: 'h', code: 'KeyH', ctrlKey: true })
    const table = [hidePointer, replaceRow]
    expect(matchShortcut(ctrlH, table, 'win', 'desktop')?.id).toBe('replace')
    expect(matchShortcut(ctrlH, table, 'win', 'desktop', 'slideshow')?.id).toBe('slides-32')
    expect(createMatcher(table)(ctrlH, 'win', 'desktop', 'slideshow')?.id).toBe('slides-32')
  })
})
