// UNI-2011 S-html-md fix1: RS-html-md M1 (zoom aliases), M2 (Ctrl+/ on a German layout), L1 (strike key), L7 (handler claims, Mac editor keys)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { parseChord, type ShortcutKeyEvent } from '@genoffice/shortcuts'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { markdownShortcutCommand, markdownWindowCommand } from '../src/renderer/shortcuts'

/** a keydown as a layout types it: `key` is the character, `code` the physical key */
function typed(
  key: string,
  code: string,
  mods: Partial<ShortcutKeyEvent> = { ctrlKey: true },
): ShortcutKeyEvent {
  return {
    key,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: () => false,
    ...mods,
  }
}

/** a keydown for a canonical chord on a US layout */
function press(chord: string): ShortcutKeyEvent {
  const p = parseChord(chord)!
  const isLetter = /^[A-Z]$/.test(p.key)
  const isDigit = /^[0-9]$/.test(p.key)
  return typed(
    isLetter ? p.key.toLowerCase() : isDigit ? p.key : p.key,
    isLetter ? `Key${p.key}` : isDigit ? `Digit${p.key}` : p.key,
    { ctrlKey: p.ctrl, altKey: p.alt, shiftKey: p.shift, metaKey: p.cmd },
  )
}

describe('zoom keys keep Ctrl+Shift+=, the numpad and non-US layouts (RS-html-md M1)', () => {
  const win = (event: ShortcutKeyEvent) => markdownShortcutCommand(event, 'win', 'desktop')

  it('Ctrl and "+" on a US keyboard is Ctrl+Shift+=', () => {
    expect(win(typed('+', 'Equal', { ctrlKey: true, shiftKey: true }))).toBe('zoomIn')
    expect(win(typed('=', 'Equal'))).toBe('zoomIn')
  })

  it('the keypad zooms', () => {
    expect(win(typed('+', 'NumpadAdd'))).toBe('zoomIn')
    expect(win(typed('-', 'NumpadSubtract'))).toBe('zoomOut')
    expect(win(typed('0', 'Numpad0'))).toBe('zoomReset')
  })

  it('German "+" and "-" zoom although they sit on other physical keys', () => {
    expect(win(typed('+', 'BracketRight'))).toBe('zoomIn')
    expect(win(typed('-', 'Slash'))).toBe('zoomOut')
  })

  it('macOS Cmd forms zoom too', () => {
    const cmd = { metaKey: true }
    expect(
      markdownShortcutCommand(typed('+', 'Equal', { ...cmd, shiftKey: true }), 'mac', 'web'),
    ).toBe('zoomIn')
    expect(markdownShortcutCommand(typed('0', 'Numpad0', cmd), 'mac', 'desktop')).toBe('zoomReset')
  })
})

describe('web Ctrl+/ is the "/" character (RS-html-md M2)', () => {
  it('German Ctrl+"-" (the physical Slash key) zooms out instead of toggling a numbered list', () => {
    const germanMinus = typed('-', 'Slash')
    expect(markdownShortcutCommand(germanMinus, 'win', 'web')).toBe('zoomOut')
    expect(markdownWindowCommand(germanMinus, 'win', 'web')).toBe('zoomOut')
  })

  it('Ctrl+/ where the layout types "/" still makes a numbered list on the web', () => {
    expect(markdownShortcutCommand(typed('/', 'Slash'), 'win', 'web')).toBe('orderedList')
    // German: "/" is Shift+7
    expect(
      markdownShortcutCommand(
        typed('/', 'Digit7', { ctrlKey: true, shiftKey: true }),
        'win',
        'web',
      ),
    ).toBe('orderedList')
  })

  it('the same press does nothing on the desktop surface', () => {
    expect(markdownShortcutCommand(typed('/', 'Slash'), 'win', 'desktop')).toBeNull()
  })
})

describe('what the window handler claims (RS-html-md L7)', () => {
  it('claims file, find, source and zoom keys', () => {
    expect(markdownWindowCommand(press('Ctrl+S'), 'win', 'desktop')).toBe('save')
    expect(markdownWindowCommand(press('F12'), 'win', 'desktop')).toBe('saveAs')
    expect(markdownWindowCommand(press('Shift+Cmd+S'), 'mac', 'desktop')).toBe('saveAs')
    expect(markdownWindowCommand(press('Ctrl+E'), 'win', 'desktop')).toBe('toggleSource')
    expect(markdownWindowCommand(press('Ctrl+F'), 'win', 'desktop')).toBe('find')
  })

  it('leaves text and block keys to the editor: Ctrl+Shift+S strikes, it does not save', () => {
    for (const chord of ['Ctrl+Shift+S', 'Ctrl+B', 'Ctrl+K', 'Ctrl+D', 'Ctrl+Alt+1', 'Ctrl+Z']) {
      expect(markdownWindowCommand(press(chord), 'win', 'desktop'), chord).toBeNull()
    }
    expect(markdownWindowCommand(press('Shift+Cmd+X'), 'mac', 'desktop')).toBeNull()
  })
})

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  vi.restoreAllMocks()
})

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

/** a keydown through ProseMirror's own handler, as the browser delivers it to the document */
function key(editor: Editor, chord: string): KeyboardEvent {
  const e = press(chord)
  const event = new KeyboardEvent('keydown', {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(event)
  return event
}

describe('editor keymap on macOS (RS-html-md L7)', () => {
  function onMac() {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  }

  it('Shift+Cmd+X toggles strikethrough', () => {
    onMac()
    const editor = createEditor('hello world')
    editor.commands.selectAll()
    key(editor, 'Shift+Cmd+X')
    expect(editor.isActive('strike')).toBe(true)
    key(editor, 'Shift+Cmd+X')
    expect(editor.isActive('strike')).toBe(false)
  })

  it("TipTap's own Mod-Shift-s no longer strikes: Shift+Cmd+S is Save As only (RS-html-md L1)", () => {
    onMac()
    const editor = createEditor('hello world')
    editor.commands.selectAll()
    key(editor, 'Shift+Cmd+S')
    expect(editor.isActive('strike')).toBe(false)
  })

  it('Alt+Cmd+1 makes a heading, Alt+Cmd+0 a paragraph', () => {
    onMac()
    const editor = createEditor('title')
    editor.commands.setTextSelection(2)
    key(editor, 'Alt+Cmd+1')
    expect(editor.getAttributes('heading').level).toBe(1)
    key(editor, 'Alt+Cmd+0')
    expect(editor.isActive('paragraph')).toBe(true)
  })
})

describe('editor keymap on Windows', () => {
  it('Ctrl+Shift+S strikes through the table; strike carries no key of its own', () => {
    const editor = createEditor('hello world')
    const strike = editor.extensionManager.extensions.find((x) => x.name === 'strike')
    expect(strike).toBeDefined()
    expect(strike!.config.addKeyboardShortcuts?.call({} as never)).toEqual({})
    editor.commands.selectAll()
    key(editor, 'Ctrl+Shift+S')
    expect(editor.isActive('strike')).toBe(true)
  })
})
