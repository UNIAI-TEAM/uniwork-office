import { describe, expect, it } from 'vitest'
import {
  docsShortcuts,
  htmlShortcuts,
  matchShortcut,
  type ShortcutAction,
  type ShortcutKeyEvent,
} from '../src/index'

// Windows layouts as `code → [unshifted, shifted]` for the keys the tests
// press; every other key types its US character. `Dead` is a dead key.
type Layout = Readonly<Record<string, readonly [string, string]>>

const US: Layout = {
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', '('],
  Digit0: ['0', ')'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Backslash: ['\\', '|'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
}

const GERMAN: Layout = {
  ...US,
  Digit2: ['2', '"'],
  Digit3: ['3', '§'],
  Digit6: ['6', '&'],
  Digit7: ['7', '/'],
  Digit8: ['8', '('],
  Digit9: ['9', ')'],
  Digit0: ['0', '='],
  Minus: ['ß', '?'],
  Equal: ['Dead', 'Dead'],
  BracketLeft: ['ü', 'Ü'],
  BracketRight: ['+', '*'],
  Semicolon: ['ö', 'Ö'],
  Quote: ['ä', 'Ä'],
  Backslash: ['#', "'"],
  IntlBackslash: ['<', '>'],
  Comma: [',', ';'],
  Period: ['.', ':'],
  Slash: ['-', '_'],
}

const FRENCH: Layout = {
  ...US,
  Digit1: ['&', '1'],
  Digit2: ['é', '2'],
  Digit3: ['"', '3'],
  Digit4: ["'", '4'],
  Digit5: ['(', '5'],
  Digit6: ['-', '6'],
  Digit7: ['è', '7'],
  Digit8: ['_', '8'],
  Digit9: ['ç', '9'],
  Digit0: ['à', '0'],
  Minus: [')', '°'],
  Equal: ['=', '+'],
  BracketLeft: ['Dead', 'Dead'],
  BracketRight: ['$', '£'],
  Semicolon: ['m', 'M'],
  Quote: ['ù', '%'],
  Backslash: ['*', 'µ'],
  IntlBackslash: ['<', '>'],
  KeyM: [',', '?'],
  Comma: [';', '.'],
  Period: [':', '/'],
  Slash: ['!', '§'],
}

const SPANISH: Layout = {
  ...GERMAN,
  Digit3: ['3', '·'],
  Minus: ["'", '?'],
  Equal: ['¡', '¿'],
  BracketLeft: ['Dead', 'Dead'],
  Semicolon: ['ñ', 'Ñ'],
  Quote: ['Dead', 'Dead'],
  Backslash: ['ç', 'Ç'],
}

const ITALIAN: Layout = {
  ...GERMAN,
  Digit3: ['3', '£'],
  Minus: ["'", '?'],
  Equal: ['ì', '^'],
  BracketLeft: ['è', 'é'],
  Semicolon: ['ò', 'ç'],
  Quote: ['à', '°'],
  Backslash: ['ù', '§'],
}

const LAYOUTS = { US, German: GERMAN, French: FRENCH, Spanish: SPANISH, Italian: ITALIAN }

interface Mods {
  readonly ctrl?: boolean
  readonly shift?: boolean
}

/** The keydown a user makes to type `char` with Ctrl (and Shift when the layout needs it). */
function type(layout: Layout, char: string, mods: Mods = { ctrl: true }): ShortcutKeyEvent {
  for (const [code, [plain, shifted]] of Object.entries(layout)) {
    if (plain === char) return press(code, plain, mods)
    if (shifted === char) return press(code, shifted, { ...mods, shift: true })
  }
  throw new Error(`layout has no key for ${char}`)
}

/** The keydown of a physical key; `shift` picks the shifted character. */
function key(layout: Layout, code: string, mods: Mods = { ctrl: true }): ShortcutKeyEvent {
  const chars = layout[code]
  if (!chars) throw new Error(`layout has no ${code}`)
  return press(code, mods.shift ? chars[1] : chars[0], mods)
}

function press(code: string, typed: string, mods: Mods): ShortcutKeyEvent {
  return {
    key: typed,
    code,
    ctrlKey: mods.ctrl === true,
    altKey: false,
    shiftKey: mods.shift === true,
    metaKey: false,
    getModifierState: () => false,
  }
}

const numpad = (code: string, typed: string): ShortcutKeyEvent => press(code, typed, { ctrl: true })

function row(id: string, win: string[]): ShortcutAction {
  return { id, scope: 'pdf', win, mac: [], match: 'key', guard: {} }
}

// The shapes the module tables use: zoom with its aliases, Ctrl+/, rotate,
// font size, Ctrl+Period and Excel's Ctrl+Shift+1..6 number formats.
const TABLE: readonly ShortcutAction[] = [
  row('zoom-in', ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd']),
  row('zoom-out', ['Ctrl+Minus', 'Ctrl+NumpadSubtract']),
  row('zoom-reset', ['Ctrl+0', 'Ctrl+Numpad0']),
  row('slash', ['Ctrl+Slash']),
  row('rotate-left', ['Ctrl+BracketLeft']),
  row('rotate-right', ['Ctrl+BracketRight']),
  row('grow', ['Ctrl+Shift+Period']),
  row('shrink', ['Ctrl+Shift+Comma']),
  row('period', ['Ctrl+Period']),
  ...[1, 2, 3, 4, 5, 6].map((n) => row(`format-${n}`, [`Ctrl+Shift+${n}`])),
]

const hit = (event: ShortcutKeyEvent, table = TABLE) =>
  matchShortcut(event, table, 'win', 'desktop')?.id ?? null

describe.each(Object.entries(LAYOUTS))('%s layout', (_name, layout) => {
  it('zoom in: "=" or "+" with or without Shift, and the keypad +', () => {
    expect(hit(type(layout, '+'))).toBe('zoom-in')
    expect(hit(type(layout, '='))).toBe('zoom-in')
    expect(hit(numpad('NumpadAdd', '+'))).toBe('zoom-in')
  })

  it('zoom out: "-" and the keypad -; reset: the 0 key and keypad 0', () => {
    expect(hit(type(layout, '-'))).toBe('zoom-out')
    expect(hit(numpad('NumpadSubtract', '-'))).toBe('zoom-out')
    expect(hit(key(layout, 'Digit0'))).toBe('zoom-reset')
    expect(hit(numpad('Numpad0', '0'))).toBe('zoom-reset')
  })

  it('Ctrl+/ is the "/" character, wherever the layout puts it', () => {
    expect(hit(type(layout, '/'))).toBe('slash')
  })

  it('Ctrl+Shift+> / < follow the characters', () => {
    expect(hit(type(layout, '>'))).toBe('grow')
    expect(hit(type(layout, '<'))).toBe('shrink')
  })

  it('Ctrl+Period is the "." character', () => {
    expect(hit(type(layout, '.'))).toBe('period')
  })

  it('Ctrl+Shift+1..6 stay on the digit keys (Shift changes the character)', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(hit(key(layout, `Digit${n}`, { ctrl: true, shift: true }))).toBe(`format-${n}`)
    }
  })

  it('no key that types another ASCII character fires a symbol chord by position', () => {
    for (const [code, [plain, shifted]] of Object.entries(layout)) {
      for (const [typed, shift] of [
        [plain, false],
        [shifted, true],
      ] as const) {
        const id = hit(press(code, typed, { ctrl: true, shift }))
        const usChars = US[code]
        if (!id || !usChars || !/^[!-~]$/.test(typed)) continue
        const expected = hit(type(US, typed))
        // Digits win by position (format-n); every other hit is the US key of that character.
        if (!id.startsWith('format-'))
          expect(`${code} ${typed}: ${id}`).toBe(`${code} ${typed}: ${expected}`)
      }
    }
  })
})

describe('symbol chords on non-US layouts (RS-pdf H1, RS-html-md M1/M2)', () => {
  it('German Ctrl+"+" zooms instead of rotating; Ctrl+"-" zooms out instead of Ctrl+/', () => {
    expect(hit(type(GERMAN, '+'))).toBe('zoom-in')
    expect(hit(type(GERMAN, '-'))).toBe('zoom-out')
  })

  it('Spanish and Italian Ctrl+"+" (the ] key) zoom', () => {
    expect(hit(type(SPANISH, '+'))).toBe('zoom-in')
    expect(hit(type(ITALIAN, '+'))).toBe('zoom-in')
  })

  it('falls back to the key position when the key types no ASCII character', () => {
    // German ü, Italian è and the Spanish / French dead keys sit on the [ key.
    expect(hit(key(GERMAN, 'BracketLeft'))).toBe('rotate-left')
    expect(hit(key(ITALIAN, 'BracketLeft'))).toBe('rotate-left')
    expect(hit(key(SPANISH, 'BracketLeft'))).toBe('rotate-left')
    expect(hit(key(FRENCH, 'BracketLeft'))).toBe('rotate-left')
    // By position, Shift stays exact.
    expect(hit(key(GERMAN, 'BracketLeft', { ctrl: true, shift: true }))).toBeNull()
  })

  it('macOS Option glyphs fall back to the key position', () => {
    const optionPeriod = { ...press('Period', '≥', {}), altKey: true, metaKey: true }
    const table = [{ ...row('mac-period', []), mac: ['Alt+Cmd+Period'] }]
    expect(matchShortcut(optionPeriod, table, 'mac', 'desktop')?.id).toBe('mac-period')
  })

  it('the keypad does not stand in for a symbol chord', () => {
    expect(hit(numpad('NumpadDivide', '/'))).toBeNull()
    expect(hit(numpad('NumpadDecimal', '.'))).toBeNull()
  })

  it('a digit chord wins over a symbol chord on the same key (French Ctrl+6 types "-")', () => {
    const withCtrl6 = [row('ctrl-6', ['Ctrl+6']), ...TABLE]
    expect(hit(key(FRENCH, 'Digit6'), withCtrl6)).toBe('ctrl-6')
    expect(hit(key(FRENCH, 'Digit6'))).toBe('zoom-out')
    // Table order does not matter for the tie.
    expect(hit(key(FRENCH, 'Digit6'), [...TABLE, row('ctrl-6', ['Ctrl+6'])])).toBe('ctrl-6')
  })
})

describe('zoom aliases in the generated tables', () => {
  it('html zoom answers "+", Shift+=, the keypad and non-US layouts', () => {
    const html = (event: ShortcutKeyEvent) => hit(event, htmlShortcuts)
    expect(html(type(US, '='))).toBe('html-019')
    expect(html(type(US, '+'))).toBe('html-019')
    expect(html(numpad('NumpadAdd', '+'))).toBe('html-019')
    expect(html(type(GERMAN, '+'))).toBe('html-019')
    expect(html(type(GERMAN, '-'))).toBe('html-020')
    expect(html(numpad('NumpadSubtract', '-'))).toBe('html-020')
    expect(html(numpad('Numpad0', '0'))).toBe('html-021')
  })

  it('docs: Ctrl+Shift+= stays superscript (the exact chord wins), the keypad + zooms', () => {
    const docs = (event: ShortcutKeyEvent) => hit(event, docsShortcuts)
    expect(docs(type(US, '+'))).toBe('docs-028')
    expect(docs(type(US, '='))).toBe('docs-082')
    expect(docs(numpad('NumpadAdd', '+'))).toBe('docs-082')
    // German types "+" without Shift: by character it is Word's superscript key.
    expect(docs(type(GERMAN, '+'))).toBe('docs-028')
  })
})
