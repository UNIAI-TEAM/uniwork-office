/**
 * The sheets shortcut table's glue (UNI-2011): Univer keyCode bindings,
 * sub-action rows, tooltip hints and the application menu's accelerators.
 */
import { describe, expect, it } from 'vitest'
import { parseChord } from '@genoffice/shortcuts'
import { MetaKeys } from '@univerjs/ui'
import { sheetsMenuAccelerator } from '../src/shared/sheets-shortcuts'
import {
  blocksUniverShortcut,
  chordToUniverBinding,
  isSecondSubAction,
  sheetsHint,
} from '../src/renderer/sheets-keymap'

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
