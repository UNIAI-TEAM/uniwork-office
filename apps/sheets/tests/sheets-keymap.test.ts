/**
 * The sheets shortcut table's glue (UNI-2011): Univer keyCode bindings,
 * sub-action rows, tooltip hints and the application menu's accelerators.
 */
import { describe, expect, it } from 'vitest'
import { MetaKeys } from '@univerjs/ui'
import { sheetsMenuAccelerator } from '../src/shared/sheets-shortcuts'
import {
  chordsFor,
  findShortcut,
  matchShortcut,
  parseChord,
  sheetsShortcuts,
} from '@genoffice/shortcuts'
import {
  blocksUniverShortcut,
  chordToUniverBinding,
  clipboardHint,
  isSecondSubAction,
  sheetsHint,
  withKeyHint,
} from '../src/renderer/sheets-keymap'
import { tFor } from '../src/renderer/i18n/locale'

const { SHIFT, ALT, CTRL_COMMAND, MAC_CTRL } = MetaKeys

describe('chordToUniverBinding', () => {
  it('maps Ctrl to CTRL_COMMAND off a Mac', () => {
    expect(chordToUniverBinding('Ctrl+Shift+Equal', 'win')).toBe(187 | SHIFT | CTRL_COMMAND)
    expect(chordToUniverBinding('Ctrl+Alt+PageDown', 'win')).toBe(34 | ALT | CTRL_COMMAND)
  })

  it('maps Cmd to CTRL_COMMAND and Control to MAC_CTRL on a Mac', () => {
    expect(chordToUniverBinding('Cmd+9', 'mac')).toBe(57 | CTRL_COMMAND)
    expect(chordToUniverBinding('Ctrl+Shift+9', 'mac')).toBe(57 | SHIFT | MAC_CTRL)
    expect(chordToUniverBinding('Alt+Right', 'mac')).toBe(39 | ALT)
  })

  it('maps letters, F-keys and punctuation to their keyCodes', () => {
    expect(chordToUniverBinding('Ctrl+D', 'win')).toBe(68 | CTRL_COMMAND)
    expect(chordToUniverBinding('F4', 'win')).toBe(115)
    expect(chordToUniverBinding('Ctrl+Semicolon', 'win')).toBe(186 | CTRL_COMMAND)
  })

  it('has no binding for a Cmd chord on Windows', () => {
    expect(chordToUniverBinding('Cmd+T', 'win')).toBeNull()
  })
})

describe('isSecondSubAction', () => {
  const second = (id: string, chord: string) => isSecondSubAction(id, parseChord(chord)!)

  it('picks the second sub-action of a row by its chord', () => {
    expect(second('sheets-22', 'Ctrl+9')).toBe(false)
    expect(second('sheets-22', 'Shift+Cmd+9')).toBe(false)
    expect(second('sheets-22', 'Ctrl+Shift+9')).toBe(true)
    expect(second('sheets-33', 'Ctrl+Shift+End')).toBe(true)
    expect(second('sheets-56', 'Ctrl+BracketRight')).toBe(true)
    expect(second('sheets-67', 'Ctrl+Shift+Comma')).toBe(true)
    expect(second('sheets-75', 'Alt+Cmd+Minus')).toBe(true)
    expect(second('sheets-91', 'Shift+Cmd+J')).toBe(true)
    expect(second('sheets-91', 'Shift+Cmd+K')).toBe(false)
  })
})

describe('blocksUniverShortcut', () => {
  const event = {
    key: 'v',
    code: 'KeyV',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
  }

  it('blocks AltGr on Windows only', () => {
    const altGr = { ...event, getModifierState: (key: string) => key === 'AltGraph' }
    expect(blocksUniverShortcut(altGr, 'win')).toBe(true)
    expect(blocksUniverShortcut(altGr, 'mac')).toBe(false)
    expect(blocksUniverShortcut({ ...event, getModifierState: () => false }, 'win')).toBe(false)
  })
})

describe('hints', () => {
  it('follows the platform and surface', () => {
    const win = { platform: 'win', surface: 'desktop' } as const
    const mac = { platform: 'mac', surface: 'desktop' } as const
    const web = { platform: 'win', surface: 'web' } as const
    expect(sheetsHint('sheets-61', win)).toBe('Ctrl+1')
    expect(sheetsHint('sheets-61', mac)).toBe('⌘1')
    expect(sheetsHint('sheets-04', win)).toBe('F12')
    expect(sheetsHint('sheets-04', web)).toBe('Alt+F2')
    expect(sheetsHint('sheets-81', mac)).toBe('⇧⌘F')
  })

  it('promises no key for spell check: no command listens to F7 (sheets-58)', () => {
    for (const platform of ['win', 'mac'] as const) {
      for (const surface of ['desktop', 'web'] as const) {
        expect(sheetsHint('sheets-58', { platform, surface })).toBe('')
        const f7 = { key: 'F7', code: 'F7' }
        expect(matchShortcut(f7 as never, sheetsShortcuts, platform, surface)).toBeNull()
      }
    }
  })

  it('gives every toolbar tooltip its key from the table, per platform and surface (RS-sheets M1)', () => {
    const win = { platform: 'win', surface: 'desktop' } as const
    const mac = { platform: 'mac', surface: 'desktop' } as const
    const web = { platform: 'win', surface: 'web' } as const
    expect([win, mac, web].map((t) => sheetsHint('sheets-03', t))).toEqual([
      'Ctrl+S',
      '⌘S',
      'Ctrl+S',
    ])
    expect([win, mac].map((t) => sheetsHint('sheets-02', t))).toEqual(['Ctrl+O', '⌘O'])
    // Find: Univer's Ctrl+F / Cmd+F on desktop, Excel for the web's Ctrl+F in the frame; on a
    // Mac in the frame Univer acts on Cmd+F first, so that is the key the hint leads with
    const webMac = { platform: 'mac', surface: 'web' } as const
    expect([win, mac, web, webMac].map((t) => sheetsHint('sheets-43', t))).toEqual([
      'Ctrl+F',
      '⌘F',
      'Ctrl+F',
      '⌘F',
    ])
    expect(sheetsHint('sheets-07', win)).toBe('Ctrl+Z')
    expect(sheetsHint('sheets-07', mac)).toBe('⌘Z')
  })

  it('reads Cut / Copy / Paste from the clipboard row', () => {
    const win = { platform: 'win', surface: 'desktop' } as const
    const mac = { platform: 'mac', surface: 'desktop' } as const
    const web = { platform: 'win', surface: 'web' } as const
    expect(['X', 'C', 'V'].map((k) => clipboardHint(k as 'X', win))).toEqual([
      'Ctrl+X',
      'Ctrl+C',
      'Ctrl+V',
    ])
    expect(['X', 'C', 'V'].map((k) => clipboardHint(k as 'X', mac))).toEqual(['⌘X', '⌘C', '⌘V'])
    expect(clipboardHint('V', web)).toBe('Ctrl+V')
  })

  it('shows Excel for Mac’s Control+G first on Go To, F5 on Windows', () => {
    expect(sheetsHint('sheets-42', { platform: 'mac', surface: 'desktop' })).toBe('⌃G')
    expect(sheetsHint('sheets-42', { platform: 'win', surface: 'desktop' })).toBe('F5')
  })

  it('drops an empty hint instead of printing empty parentheses', () => {
    expect(withKeyHint('Save', 'Ctrl+S')).toBe('Save (Ctrl+S)')
    expect(withKeyHint('Open Workbook', '')).toBe('Open Workbook')
  })
})

describe('Excel for Mac accepts the Control form where Excel prints both (RS-sheets M2)', () => {
  it('lists Cmd+1 / Ctrl+1 and Cmd+K / Ctrl+K on a Mac', () => {
    for (const id of ['sheets-61', 'sheets-78']) {
      const key = id === 'sheets-61' ? '1' : 'K'
      const row = findShortcut('sheets', id)!
      expect(chordsFor(row, 'mac', 'desktop')).toEqual([`Cmd+${key}`, `Ctrl+${key}`])
      expect(chordsFor(row, 'mac', 'web')).toEqual([`Cmd+${key}`, `Ctrl+${key}`])
      expect(chordsFor(row, 'win', 'desktop')).toEqual([`Ctrl+${key}`])
    }
  })
})

describe('notice strings take their keys from the table (RS-sheets L3)', () => {
  it('shows the table’s Save / Undo keys, never a hand-written glyph', () => {
    const save = sheetsHint('sheets-03')
    const undo = sheetsHint('sheets-07')
    expect(save).not.toBe('')
    expect(tFor('en', 'appTableCreated')).toBe(`Table created — save with ${save}.`)
    expect(tFor('en', 'appAppliedRevision', { revision: 3 })).toContain(`undo with ${undo}`)
    expect(tFor('vi', 'appTableCreated')).toContain(save)
    expect(tFor('en', 'aiUndoTitle')).toContain(undo)
  })

  it('has no hard-coded Save / Undo chord left in any locale', () => {
    const files = import.meta.glob('../src/renderer/i18n/{app,ai,dialogs}/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const stale = Object.entries(files).flatMap(([file, text]) =>
      text
        .split(/\r?\n/)
        .flatMap((line, index) =>
          /(⌘|Cmd\+|Ctrl\+|Command\+)[SZ]\b/.test(line) ? [`${file}:${index + 1}`] : [],
        ),
    )
    expect(stale).toEqual([])
  })
})

describe('Univer punctuation bindings are US-layout keyCodes (RS-sheets L2)', () => {
  // Univer matches `keyCode`, the table's `event.code`: these rows are the ones that
  // depend on it. A change to one of these numbers has to be a deliberate decision.
  it('pins the keyCode of every punctuation chord a Univer row registers', () => {
    const univerPunctuation: readonly [string, number][] = [
      ['Ctrl+Shift+Equal', 187],
      ['Ctrl+Minus', 189],
      ['Cmd+Equal', 187],
      ['Ctrl+Semicolon', 186],
      ['Ctrl+Shift+Backquote', 192],
      ['Ctrl+BracketRight', 221],
      ['Ctrl+Shift+Comma', 188],
    ]
    for (const [chord, keyCode] of univerPunctuation) {
      const platform = chord.startsWith('Cmd') ? 'mac' : 'win'
      expect(chordToUniverBinding(chord, platform)! & 0xff, chord).toBe(keyCode)
    }
  })
})

describe('menu accelerators', () => {
  it('come from the table per platform', () => {
    expect(sheetsMenuAccelerator('save', 'win')).toBe('CmdOrCtrl+S')
    expect(sheetsMenuAccelerator('save', 'mac')).toBe('CmdOrCtrl+S')
    expect(sheetsMenuAccelerator('saveAs', 'win')).toBe('F12')
    expect(sheetsMenuAccelerator('saveAs', 'mac')).toBe('Shift+Command+S')
    expect(sheetsMenuAccelerator('redo', 'win')).toBe('CmdOrCtrl+Y')
    expect(sheetsMenuAccelerator('print', 'mac')).toBe('CmdOrCtrl+P')
  })
})

describe('symbol chords match by character, digits by code (UNI-2011 rebase)', () => {
  const key = (init: {
    key: string
    code: string
    ctrlKey?: boolean
    shiftKey?: boolean
  }): Parameters<typeof matchShortcut>[0] => ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...init,
  })
  const route = (event: Parameters<typeof matchShortcut>[0]) =>
    matchShortcut(event, sheetsShortcuts, 'win', 'desktop')?.id

  it('picks date and time by the typed character on a German layout', () => {
    // German: ; is Shift+Comma, : is Shift+Period
    expect(route(key({ key: ';', code: 'Comma', ctrlKey: true, shiftKey: true }))).toBe('sheets-76')
    expect(route(key({ key: ':', code: 'Period', ctrlKey: true, shiftKey: true }))).toBe(
      'sheets-77',
    )
  })

  it('keeps the US positions working', () => {
    expect(route(key({ key: ';', code: 'Semicolon', ctrlKey: true }))).toBe('sheets-76')
    expect(route(key({ key: ':', code: 'Semicolon', ctrlKey: true, shiftKey: true }))).toBe(
      'sheets-77',
    )
  })

  it('keeps Ctrl+Shift+1..6 on the digit keys of an AZERTY layout', () => {
    // AZERTY types & é " ' ( - on the digit row; Shift gives the digit
    for (const [digit, id] of [
      ['1', 'sheets-69'],
      ['2', 'sheets-70'],
      ['3', 'sheets-71'],
      ['4', 'sheets-72'],
      ['5', 'sheets-73'],
      ['6', 'sheets-74'],
    ] as const) {
      expect(route(key({ key: digit, code: `Digit${digit}`, ctrlKey: true, shiftKey: true }))).toBe(
        id,
      )
    }
  })

  it('does not fire the backquote chord from the German ´ dead key', () => {
    expect(route(key({ key: 'Dead', code: 'Equal', ctrlKey: true }))).toBeUndefined()
  })
})
