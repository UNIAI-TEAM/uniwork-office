// UNI-2011 S-html-md: the Markdown module's keys come from the @genoffice/shortcuts markdown table.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  markdownShortcuts,
  parseChord,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { OPEN_LINK_EVENT } from '../src/renderer/editor/tableKeymap'
import {
  isAppCommand,
  isEditorCommand,
  markdownHint,
  markdownShortcutCommand,
  withMarkdownHint,
  type MarkdownCommand,
} from '../src/renderer/shortcuts'

const NAMED: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  Period: '.',
  Slash: '/',
}

/** a keydown for a canonical chord on a US layout */
function press(chord: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  const p = parseChord(chord)!
  const key = p.key
  const isLetter = /^[A-Z]$/.test(key)
  const isDigit = /^[0-9]$/.test(key)
  return {
    key: isLetter ? key.toLowerCase() : isDigit ? key : (NAMED[key] ?? key),
    code: isLetter ? `Key${key}` : isDigit ? `Digit${key}` : key,
    ctrlKey: p.ctrl,
    altKey: p.alt,
    shiftKey: p.shift,
    metaKey: p.cmd,
    // a browser keydown reports AltGraph; an event that cannot is read as AltGr on Windows
    getModifierState: () => false,
    ...extra,
  }
}

const EXPECTED: ReadonlyArray<{ command: MarkdownCommand; win: string[]; mac: string[] }> = [
  { command: 'save', win: ['Ctrl+S'], mac: ['Cmd+S'] },
  { command: 'saveAs', win: ['F12'], mac: ['Shift+Cmd+S'] },
  { command: 'print', win: ['Ctrl+P'], mac: ['Cmd+P'] },
  { command: 'undo', win: ['Ctrl+Z'], mac: ['Cmd+Z'] },
  { command: 'redo', win: ['Ctrl+Y', 'Ctrl+Shift+Z'], mac: ['Cmd+Y', 'Shift+Cmd+Z'] },
  { command: 'find', win: ['Ctrl+F'], mac: ['Cmd+F'] },
  { command: 'findNext', win: ['Shift+F4'], mac: ['Shift+F4'] },
  { command: 'replace', win: ['Ctrl+H'], mac: ['Ctrl+H'] },
  { command: 'bold', win: ['Ctrl+B'], mac: ['Cmd+B'] },
  { command: 'italic', win: ['Ctrl+I'], mac: ['Cmd+I'] },
  { command: 'strike', win: ['Ctrl+Shift+S'], mac: ['Shift+Cmd+X'] },
  { command: 'toggleSource', win: ['Ctrl+E'], mac: ['Cmd+E'] },
  { command: 'heading1', win: ['Ctrl+Alt+1'], mac: ['Alt+Cmd+1'] },
  { command: 'heading2', win: ['Ctrl+Alt+2'], mac: ['Alt+Cmd+2'] },
  { command: 'heading3', win: ['Ctrl+Alt+3'], mac: ['Alt+Cmd+3'] },
  { command: 'paragraph', win: ['Ctrl+Alt+0'], mac: ['Alt+Cmd+0'] },
  { command: 'orderedList', win: ['Ctrl+Shift+7'], mac: ['Shift+Cmd+7'] },
  { command: 'link', win: ['Ctrl+K'], mac: ['Cmd+K'] },
  { command: 'duplicateBlock', win: ['Ctrl+D'], mac: ['Cmd+D'] },
  { command: 'zoomIn', win: ['Ctrl+Equal'], mac: ['Cmd+Equal'] },
  { command: 'zoomOut', win: ['Ctrl+Minus'], mac: ['Cmd+Minus'] },
  { command: 'zoomReset', win: ['Ctrl+0'], mac: ['Cmd+0'] },
]

const SURFACES: ShortcutSurface[] = ['desktop', 'web']
const PLATFORMS: ShortcutPlatform[] = ['win', 'mac']

describe('markdown keys come from the table', () => {
  for (const platform of PLATFORMS) {
    for (const surface of SURFACES) {
      it(`${platform} ${surface}: every chord fires its command`, () => {
        for (const row of EXPECTED) {
          for (const chord of row[platform]) {
            expect(markdownShortcutCommand(press(chord), platform, surface), chord).toBe(
              row.command,
            )
          }
        }
      })
    }
  }

  it('Bulleted list: Ctrl+Shift+L on desktop, the existing Ctrl+Shift+8 on both surfaces', () => {
    for (const chord of ['Ctrl+Shift+L', 'Ctrl+Shift+8']) {
      expect(markdownShortcutCommand(press(chord), 'win', 'desktop'), chord).toBe('bulletList')
    }
    expect(markdownShortcutCommand(press('Shift+Cmd+L'), 'mac', 'desktop')).toBe('bulletList')
    expect(markdownShortcutCommand(press('Shift+Cmd+8'), 'mac', 'web')).toBe('bulletList')
    expect(markdownShortcutCommand(press('Ctrl+Shift+8'), 'win', 'web')).toBe('bulletList')
    expect(markdownShortcutCommand(press('Ctrl+Shift+L'), 'win', 'web')).toBeNull()
  })

  it('web adds Ctrl+G to Find, Ctrl+/ to Numbered list and Ctrl+. to Bulleted list', () => {
    expect(markdownShortcutCommand(press('Ctrl+G'), 'win', 'web')).toBe('find')
    expect(markdownShortcutCommand(press('Ctrl+G'), 'win', 'desktop')).toBeNull()
    expect(markdownShortcutCommand(press('Ctrl+Slash'), 'win', 'web')).toBe('orderedList')
    expect(markdownShortcutCommand(press('Ctrl+Slash'), 'win', 'desktop')).toBeNull()
    expect(markdownShortcutCommand(press('Ctrl+Period'), 'win', 'web')).toBe('bulletList')
  })

  it('the old colliding keys are gone from their primary slot', () => {
    // Windows: Ctrl+Shift+S is Strikethrough now, Save As is F12
    expect(markdownShortcutCommand(press('Ctrl+Shift+S'), 'win', 'desktop')).toBe('strike')
    // macOS: Cmd+Shift+S stays Save As, Strikethrough is Shift+Cmd+X
    expect(markdownShortcutCommand(press('Shift+Cmd+S'), 'mac', 'desktop')).toBe('saveAs')
    // Ctrl+E is the source toggle only (inline code gave it up)
    expect(markdownShortcutCommand(press('Ctrl+E'), 'win', 'desktop')).toBe('toggleSource')
    expect(markdownShortcuts.filter((a) => a.win.includes('Ctrl+E'))).toHaveLength(1)
    expect(markdownShortcuts.filter((a) => a.mac.includes('Cmd+E'))).toHaveLength(1)
  })

  it('the window handler claims app commands only; strikethrough stays with the editor', () => {
    const strike = markdownShortcutCommand(press('Ctrl+Shift+S'), 'win', 'desktop')!
    expect(isAppCommand(strike)).toBe(false)
    expect(isEditorCommand(strike)).toBe(true)
    const saveAs = markdownShortcutCommand(press('F12'), 'win', 'desktop')!
    expect(isAppCommand(saveAs)).toBe(true)
    for (const chord of ['Ctrl+Shift+S', 'Ctrl+D', 'Ctrl+K', 'Ctrl+Alt+1', 'Ctrl+B']) {
      const command = markdownShortcutCommand(press(chord), 'win', 'desktop')!
      expect(isAppCommand(command), chord).toBe(false)
    }
  })

  it('an IME composition fires nothing (isComposing and keyCode 229)', () => {
    for (const chord of ['Ctrl+S', 'Ctrl+B', 'Ctrl+K', 'F12', 'Ctrl+E']) {
      expect(
        markdownShortcutCommand(press(chord, { isComposing: true }), 'win', 'desktop'),
      ).toBeNull()
      expect(markdownShortcutCommand(press(chord, { keyCode: 229 }), 'win', 'desktop')).toBeNull()
    }
  })

  it('AltGr (Ctrl+Alt with AltGraph) never fires a heading chord', () => {
    for (const chord of ['Ctrl+Alt+1', 'Ctrl+Alt+2', 'Ctrl+Alt+3', 'Ctrl+Alt+0']) {
      const event = { ...press(chord), getModifierState: (key: string) => key === 'AltGraph' }
      expect(markdownShortcutCommand(event, 'win', 'desktop'), chord).toBeNull()
    }
    // a real Ctrl+Alt press (AltGraph not held) fires; an event that cannot say is read as AltGr
    expect(markdownShortcutCommand(press('Ctrl+Alt+1'), 'win', 'desktop')).toBe('heading1')
    const unknown = { ...press('Ctrl+Alt+1'), getModifierState: undefined }
    expect(markdownShortcutCommand(unknown, 'win', 'desktop')).toBeNull()
  })

  it('a held key repeats undo and zoom but not one-shot commands', () => {
    expect(markdownShortcutCommand(press('Ctrl+Z', { repeat: true }), 'win', 'desktop')).toBe(
      'undo',
    )
    expect(markdownShortcutCommand(press('Ctrl+Equal', { repeat: true }), 'win', 'desktop')).toBe(
      'zoomIn',
    )
    expect(markdownShortcutCommand(press('Ctrl+S', { repeat: true }), 'win', 'desktop')).toBeNull()
    expect(markdownShortcutCommand(press('Ctrl+D', { repeat: true }), 'win', 'desktop')).toBeNull()
  })

  it('Caps Lock does not change a letter chord', () => {
    expect(markdownShortcutCommand({ ...press('Ctrl+B'), key: 'B' }, 'win', 'desktop')).toBe('bold')
    expect(markdownShortcutCommand({ ...press('Ctrl+Shift+Z'), key: 'z' }, 'win', 'desktop')).toBe(
      'redo',
    )
  })
})

describe('markdown hints', () => {
  it('per platform and surface', () => {
    expect(markdownHint('save', 'win', 'desktop')).toBe('Ctrl+S')
    expect(markdownHint('save', 'mac', 'desktop')).toBe('⌘S')
    expect(markdownHint('saveAs', 'win', 'desktop')).toBe('F12')
    expect(markdownHint('saveAs', 'mac', 'web')).toBe('⇧⌘S')
    expect(markdownHint('strike', 'win', 'desktop')).toBe('Ctrl+Shift+S')
    expect(markdownHint('strike', 'mac', 'desktop')).toBe('⇧⌘X')
    expect(markdownHint('bulletList', 'win', 'desktop')).toBe('Ctrl+Shift+L')
    expect(markdownHint('bulletList', 'win', 'web')).toBe('Ctrl+Shift+8')
    expect(markdownHint('toggleSource', 'win', 'web')).toBe('Ctrl+E')
  })

  it('replaces a hand-written hint in a translated label', () => {
    expect(withMarkdownHint('Save (⌘S)', 'save', 'win', 'desktop')).toBe('Save (Ctrl+S)')
    expect(withMarkdownHint('Save As…', 'saveAs', 'mac', 'desktop')).toBe('Save As… (⇧⌘S)')
    expect(withMarkdownHint('Strikethrough', 'strike', 'win', 'desktop')).toBe(
      'Strikethrough (Ctrl+Shift+S)',
    )
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

describe('editor keymap (win desktop)', () => {
  it('Ctrl+Shift+S toggles strikethrough', () => {
    const editor = createEditor('hello world')
    editor.commands.selectAll()
    key(editor, 'Ctrl+Shift+S')
    expect(editor.isActive('strike')).toBe(true)
    key(editor, 'Ctrl+Shift+S')
    expect(editor.isActive('strike')).toBe(false)
  })

  it('Ctrl+E no longer toggles inline code', () => {
    const editor = createEditor('hello world')
    editor.commands.selectAll()
    key(editor, 'Ctrl+E')
    expect(editor.isActive('code')).toBe(false)
  })

  it('Ctrl+B and Ctrl+I toggle the marks', () => {
    const editor = createEditor('hello world')
    editor.commands.selectAll()
    key(editor, 'Ctrl+B')
    key(editor, 'Ctrl+I')
    expect(editor.isActive('bold')).toBe(true)
    expect(editor.isActive('italic')).toBe(true)
  })

  it('Ctrl+Alt+2 makes a heading, Ctrl+Alt+0 a paragraph again', () => {
    const editor = createEditor('title')
    editor.commands.setTextSelection(2)
    key(editor, 'Ctrl+Alt+2')
    expect(editor.getAttributes('heading').level).toBe(2)
    key(editor, 'Ctrl+Alt+0')
    expect(editor.isActive('paragraph')).toBe(true)
  })

  it.each(['Ctrl+Shift+L', 'Ctrl+Shift+8'])('%s makes a bulleted list', (chord) => {
    const editor = createEditor('item')
    editor.commands.setTextSelection(2)
    key(editor, chord)
    expect(editor.isActive('bulletList')).toBe(true)
  })

  it('Ctrl+Shift+7 makes a numbered list', () => {
    const editor = createEditor('item')
    editor.commands.setTextSelection(2)
    key(editor, 'Ctrl+Shift+7')
    expect(editor.isActive('orderedList')).toBe(true)
  })

  it('Ctrl+D duplicates the block', () => {
    const editor = createEditor('one\n\ntwo')
    editor.commands.setTextSelection(2)
    key(editor, 'Ctrl+D')
    const blocks: string[] = []
    editor.state.doc.forEach((n) => blocks.push(n.textContent))
    expect(blocks).toEqual(['one', 'one', 'two'])
  })

  it('Ctrl+K asks the ribbon for its link popover instead of window.prompt', () => {
    const editor = createEditor('link me')
    const prompt = vi.fn()
    vi.stubGlobal('prompt', prompt)
    const opened = vi.fn()
    window.addEventListener(OPEN_LINK_EVENT, opened)
    editor.commands.selectAll()
    key(editor, 'Ctrl+K')
    window.removeEventListener(OPEN_LINK_EVENT, opened)
    vi.unstubAllGlobals()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('a composing keydown does nothing', () => {
    const editor = createEditor('hello')
    editor.commands.setTextSelection(2)
    const event = new KeyboardEvent('keydown', {
      key: 'L',
      code: 'KeyL',
      ctrlKey: true,
      shiftKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    editor.view.dom.dispatchEvent(event)
    expect(editor.isActive('bulletList')).toBe(false)
  })
})
