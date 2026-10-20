/**
 * UNI-2011: Docs keys come from the @genoffice/shortcuts docs table. Each
 * command's chords fire it on both platforms and both surfaces (desktop app,
 * web frame), the old keys that collide with Word's leave, composition and
 * AltGr never fire, and menus / hints show the table's primary key.
 */
import { describe, expect, it } from 'vitest'
import {
  parseChord,
  type Chord,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import {
  SHORTCUTS,
  consumeWhen,
  createShortcutMatcher,
  shortcutChords,
  shortcutHint,
  shortcutTip,
} from '../src/renderer/shortcuts'
import { docsMenuAccelerator } from '../src/shared/docs-shortcuts'

const NAMED_KEYS: Record<string, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Space: ' ',
}
const PUNCTUATION: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
}

/** the keydown a US keyboard sends for a canonical chord */
function keydown(chord: Chord, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  const parsed = parseChord(chord)
  if (!parsed) throw new Error(`bad chord ${chord}`)
  const { key } = parsed
  let eventKey = NAMED_KEYS[key] ?? key
  let code = key
  if (/^[A-Z]$/.test(key)) {
    eventKey = parsed.shift ? key : key.toLowerCase()
    code = `Key${key}`
  } else if (/^[0-9]$/.test(key)) {
    code = `Digit${key}`
  } else if (PUNCTUATION[key]) {
    eventKey = PUNCTUATION[key]
  } else if (NAMED_KEYS[key]) {
    code = key === 'Space' ? 'Space' : `Arrow${key}`
  }
  return {
    key: eventKey,
    code,
    ctrlKey: parsed.ctrl,
    altKey: parsed.alt,
    shiftKey: parsed.shift,
    metaKey: parsed.cmd,
    // a DOM event always has it; without it the matcher reads Windows Ctrl+Alt as AltGr
    getModifierState: () => false,
    ...extra,
  }
}

const all = SHORTCUTS.filter((def) => def.action).map((def) => def.id)
const match = createShortcutMatcher(all)
const CASES: [ShortcutPlatform, ShortcutSurface][] = [
  ['win', 'desktop'],
  ['mac', 'desktop'],
  ['win', 'web'],
  ['mac', 'web'],
]

describe('every command fires on its own chords', () => {
  it.each(CASES)('%s %s', (platform, surface) => {
    for (const def of SHORTCUTS) {
      if (!def.action) continue
      for (const chord of shortcutChords(def, platform, surface)) {
        expect(match(keydown(chord), platform, surface), `${chord} → ${def.id}`).toBe(def.id)
      }
    }
  })
})

describe('Word keys per platform and surface', () => {
  const on = (chord: Chord, platform: ShortcutPlatform, surface: ShortcutSurface = 'desktop') =>
    match(keydown(chord), platform, surface)

  it('Save As is F12 / Shift+Cmd+S everywhere, including the web frame (P0)', () => {
    expect(on('F12', 'win')).toBe('save-as')
    expect(on('F12', 'win', 'web')).toBe('save-as')
    expect(on('Shift+Cmd+S', 'mac')).toBe('save-as')
    // the old web handler compared key === 's', which Shift turns into 'S'
    expect(on('Shift+Cmd+S', 'mac', 'web')).toBe('save-as')
    // Ctrl+Shift+S is Word's Apply Styles (not bound yet), no longer Save As
    expect(on('Ctrl+Shift+S', 'win')).toBeNull()
    expect(on('Ctrl+Shift+S', 'win', 'web')).toBeNull()
  })

  it('redo answers to Ctrl+Y first and keeps Ctrl+Shift+Z', () => {
    expect(on('Ctrl+Y', 'win')).toBe('redo')
    expect(on('Ctrl+Shift+Z', 'win')).toBe('redo')
    expect(on('Cmd+Y', 'mac')).toBe('redo')
    expect(on('Shift+Cmd+Z', 'mac', 'web')).toBe('redo')
  })

  it('insert comment is Ctrl+Alt+M / Cmd+Option+A; the Paragraph dialog has no key', () => {
    expect(on('Ctrl+Alt+M', 'win')).toBe('comment')
    expect(on('Ctrl+Alt+M', 'win', 'web')).toBe('comment')
    expect(on('Alt+Cmd+A', 'mac')).toBe('comment')
    expect(on('Ctrl+Alt+A', 'win')).toBeNull()
    expect(on('Alt+Cmd+M', 'mac')).toBeNull()
  })

  it('lists: Ctrl+Shift+L on desktop, Word web Ctrl+. and Ctrl+/', () => {
    expect(on('Ctrl+Shift+L', 'win')).toBe('bullets')
    expect(on('Shift+Cmd+L', 'mac')).toBe('bullets')
    expect(on('Ctrl+Period', 'win', 'web')).toBe('bullets')
    expect(on('Ctrl+Shift+L', 'win', 'web')).toBeNull()
    expect(on('Ctrl+Slash', 'win', 'web')).toBe('numbering')
    // desktop: Ctrl+. stays a superscript alias and Ctrl+/ opens the shortcut sheet
    expect(on('Ctrl+Period', 'win')).toBe('superscript')
    expect(on('Ctrl+Slash', 'win')).toBe('shortcuts')
    expect(on('F1', 'win')).toBe('shortcuts')
    expect(on('F1', 'win', 'web')).toBeNull()
  })

  it('headings, Normal style, alignment and font size', () => {
    expect(on('Ctrl+Alt+1', 'win')).toBe('style-h1')
    expect(on('Alt+Cmd+3', 'mac')).toBe('style-h3')
    expect(on('Ctrl+Shift+N', 'win')).toBe('style-normal')
    expect(on('Ctrl+Alt+0', 'win')).toBe('style-normal')
    // the browser keeps Ctrl+Shift+N
    expect(on('Ctrl+Shift+N', 'win', 'web')).toBeNull()
    expect(on('Ctrl+Alt+0', 'win', 'web')).toBe('style-normal')
    for (const [letter, id] of [
      ['L', 'align-left'],
      ['E', 'align-center'],
      ['R', 'align-right'],
      ['J', 'align-justify'],
    ]) {
      expect(on(`Ctrl+${letter}`, 'win', 'web')).toBe(id)
      expect(on(`Cmd+${letter}`, 'mac')).toBe(id)
    }
    expect(on('Ctrl+Shift+Period', 'win')).toBe('grow-font')
    expect(on('Shift+Cmd+Comma', 'mac')).toBe('shrink-font')
  })

  it('Word for Mac keys differ from a Cmd-for-Ctrl rewrite', () => {
    expect(on('Ctrl+Shift+M', 'mac')).toBe('indent')
    expect(on('Shift+Cmd+M', 'mac')).toBe('outdent')
    expect(on('Ctrl+M', 'mac')).toBeNull()
    expect(on('Ctrl+Shift+D', 'mac')).toBe('field-date')
    expect(on('Alt+Shift+D', 'win')).toBe('field-date')
    expect(on('Alt+Cmd+C', 'mac')).toBe('copy-format')
    expect(on('Alt+Cmd+V', 'mac')).toBe('paste-format')
    // Shift+Cmd+V is Word's Paste text only
    expect(on('Shift+Cmd+V', 'mac')).toBe('paste-plain')
    expect(on('Shift+Cmd+X', 'mac')).toBe('strike')
    // F1 is Word for Mac's Undo alias, Cmd+, its Preferences
    expect(on('F1', 'mac')).toBeNull()
    expect(on('Cmd+Comma', 'mac')).toBeNull()
  })

  it('subscript moves to Ctrl+Shift+Minus; the non-breaking hyphen to Alt+Shift+Minus', () => {
    expect(on('Ctrl+Shift+Minus', 'win')).toBe('subscript')
    expect(on('Shift+Cmd+Minus', 'mac')).toBe('subscript')
    expect(on('Alt+Shift+Minus', 'win')).toBe('nb-hyphen')
    expect(on('Alt+Shift+Minus', 'mac')).toBe('nb-hyphen')
    expect(on('Alt+Space', 'mac')).toBe('nbsp')
  })

  it('web only: Go To leaves Ctrl+G to Find, Ctrl+F3 toggles the ribbon', () => {
    expect(on('Ctrl+G', 'win')).toBe('goto')
    expect(on('Ctrl+G', 'win', 'web')).toBe('find')
    expect(on('Alt+Cmd+G', 'mac', 'web')).toBe('goto')
    expect(on('Ctrl+F3', 'win', 'web')).toBe('ribbon-toggle')
    expect(on('Ctrl+F3', 'win')).toBeNull()
    expect(on('Alt+Shift+Right', 'win', 'web')).toBe('indent')
    expect(on('Ctrl+M', 'win', 'web')).toBeNull()
    // Mac web: the desktop Mac keys; Tab stays with the editor keymap
    expect(on('Ctrl+Shift+M', 'mac', 'web')).toBe('indent')
    expect(on('Shift+Cmd+M', 'mac', 'web')).toBe('outdent')
    expect(on('Tab', 'win', 'web')).toBeNull()
    // the browser keeps Ctrl+T: no hanging indent key on the web
    expect(on('Ctrl+T', 'win', 'web')).toBeNull()
    expect(on('Ctrl+T', 'win')).toBe('hanging-indent')
  })

  it('letters follow the layout and ignore Caps Lock', () => {
    expect(match({ ...keydown('Ctrl+B'), key: 'B' }, 'win', 'desktop')).toBe('bold')
    // Cyrillic layout: no Latin letter, the physical key decides
    expect(match({ ...keydown('Ctrl+K'), key: 'л' }, 'win', 'desktop')).toBe('link')
  })
})

describe('Open in the web frame (docs-003)', () => {
  it('Ctrl+O / Cmd+O open the file on every platform and surface', () => {
    for (const [platform, surface] of CASES) {
      const chord: Chord = platform === 'win' ? 'Ctrl+O' : 'Cmd+O'
      expect(match(keydown(chord), platform, surface), `${platform} ${surface}`).toBe('open')
    }
  })
})

describe('F12 pass-through', () => {
  it('a gated command swallows its key only when it ran', () => {
    let ran = 0
    const act = () => {
      ran += 1
    }
    expect(consumeWhen(false, act)).toBe(false)
    expect(ran).toBe(0)
    expect(consumeWhen(true, act)).toBe(true)
    expect(ran).toBe(1)
  })
})

describe('guards', () => {
  it('IME composition fires nothing', () => {
    expect(match(keydown('Ctrl+S', { isComposing: true }), 'win', 'desktop')).toBeNull()
    expect(match(keydown('Ctrl+Alt+1', { keyCode: 229 }), 'win', 'desktop')).toBeNull()
  })

  it('AltGr never fires a Ctrl+Alt chord on Windows', () => {
    const altGr = { getModifierState: (key: string) => key === 'AltGraph' }
    for (const chord of ['Ctrl+Alt+M', 'Ctrl+Alt+1', 'Ctrl+Alt+C', 'Ctrl+Alt+F'])
      expect(match(keydown(chord, altGr), 'win', 'desktop'), chord).toBeNull()
    expect(match(keydown('Ctrl+Alt+M'), 'win', 'desktop')).toBe('comment')
  })

  it('extra modifiers do not fire a shorter chord', () => {
    expect(match(keydown('Ctrl+Shift+B'), 'win', 'desktop')).toBeNull()
    expect(match(keydown('Ctrl+Alt+S'), 'win', 'desktop')).toBeNull()
  })
})

describe('menus and hints', () => {
  it('menu accelerators come from the table', () => {
    expect(docsMenuAccelerator('redo', 'win')).toBe('CmdOrCtrl+Y')
    expect(docsMenuAccelerator('redo', 'mac')).toBe('CmdOrCtrl+Y')
    expect(docsMenuAccelerator('saveAs', 'win')).toBe('F12')
    expect(docsMenuAccelerator('saveAs', 'mac')).toBe('Shift+Command+S')
    expect(docsMenuAccelerator('goto', 'win')).toBe('Ctrl+G')
    expect(docsMenuAccelerator('goto', 'mac')).toBe('Alt+Command+G')
    expect(docsMenuAccelerator('shortcuts', 'win')).toBe('F1')
    expect(docsMenuAccelerator('shortcuts', 'mac')).toBe('Command+/')
    expect(docsMenuAccelerator('pasteAndMatchStyle', 'mac')).toBe('CmdOrCtrl+Shift+V')
    expect(docsMenuAccelerator('zoomIn', 'win')).toBe('CmdOrCtrl+=')
    expect(docsMenuAccelerator('save', 'win')).toBe('CmdOrCtrl+S')
  })

  it('hints show the primary key of this platform and surface', () => {
    expect(shortcutHint('redo', 'win', 'desktop')).toBe('Ctrl+Y')
    expect(shortcutHint('redo', 'mac', 'desktop')).toBe('⌘Y')
    expect(shortcutHint('bold', 'win', 'web')).toBe('Ctrl+B')
    expect(shortcutHint('bold', 'mac', 'web')).toBe('⌘B')
    expect(shortcutHint('save-as', 'win', 'desktop')).toBe('F12')
    expect(shortcutHint('bullets', 'win', 'web')).toBe('Ctrl+.')
    expect(shortcutHint('new', 'win', 'web')).toBe('')
    expect(shortcutHint('link', 'mac', 'desktop')).toBe('⌘K')
  })

  it('quick-access tips append the primary key', () => {
    expect(shortcutTip('Redo', 'redo', 'win', 'desktop')).toBe('Redo (Ctrl+Y)')
    expect(shortcutTip('Redo', 'redo', 'mac', 'web')).toBe('Redo (⌘Y)')
    expect(shortcutTip('New', 'new', 'win', 'web')).toBe('New')
  })
})
