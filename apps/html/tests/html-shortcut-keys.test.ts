// UNI-2011 S-html-md: the HTML module's keys come from the @genoffice/shortcuts html table.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  htmlShortcuts,
  parseChord,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import {
  htmlHint,
  htmlShortcutCommand,
  withHtmlHint,
  type HtmlShortcutCommand,
} from '../src/renderer/shortcuts'
import { normalizeLinkHref } from '../src/renderer/components/LinkPopover'
import { parseFromInspector } from '../src/renderer/preview/inspector-validate'
import { buildExtensions } from '../src/renderer/source/cm-setup'

const NAMED: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  Backslash: '\\',
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
    code: isLetter ? `Key${key}` : isDigit ? `Digit${key}` : /^F\d+$/.test(key) ? key : key,
    ctrlKey: p.ctrl,
    altKey: p.alt,
    shiftKey: p.shift,
    metaKey: p.cmd,
    ...extra,
  }
}

const EXPECTED: ReadonlyArray<{
  command: HtmlShortcutCommand
  win: string[]
  mac: string[]
}> = [
  { command: 'save', win: ['Ctrl+S'], mac: ['Cmd+S'] },
  { command: 'saveAs', win: ['F12', 'Ctrl+Shift+S'], mac: ['Shift+Cmd+S'] },
  { command: 'undo', win: ['Ctrl+Z'], mac: ['Cmd+Z'] },
  { command: 'redo', win: ['Ctrl+Y', 'Ctrl+Shift+Z'], mac: ['Cmd+Y', 'Shift+Cmd+Z'] },
  { command: 'find', win: ['Ctrl+F'], mac: ['Cmd+F'] },
  { command: 'findNext', win: ['Shift+F4'], mac: ['Shift+F4'] },
  { command: 'replace', win: ['Ctrl+H'], mac: ['Ctrl+H'] },
  { command: 'bold', win: ['Ctrl+B'], mac: ['Cmd+B'] },
  { command: 'italic', win: ['Ctrl+I'], mac: ['Cmd+I'] },
  { command: 'underline', win: ['Ctrl+U'], mac: ['Cmd+U'] },
  { command: 'link', win: ['Ctrl+K'], mac: ['Cmd+K'] },
  { command: 'zoomIn', win: ['Ctrl+Equal'], mac: ['Cmd+Equal'] },
  { command: 'zoomOut', win: ['Ctrl+Minus'], mac: ['Cmd+Minus'] },
  { command: 'zoomReset', win: ['Ctrl+0'], mac: ['Cmd+0'] },
  { command: 'cycleView', win: ['Ctrl+Backslash'], mac: ['Cmd+Backslash'] },
]

const SURFACES: ShortcutSurface[] = ['desktop', 'web']
const PLATFORMS: ShortcutPlatform[] = ['win', 'mac']

describe('html keys come from the table', () => {
  for (const platform of PLATFORMS) {
    for (const surface of SURFACES) {
      it(`${platform} ${surface}: every chord fires its command`, () => {
        for (const row of EXPECTED) {
          for (const chord of row[platform]) {
            expect(htmlShortcutCommand(press(chord), platform, surface), `${chord}`).toBe(
              row.command,
            )
          }
        }
      })
    }
  }

  it('web adds Ctrl+G to Find (Microsoft 365 for the web); desktop does not', () => {
    expect(htmlShortcutCommand(press('Ctrl+G'), 'win', 'web')).toBe('find')
    expect(htmlShortcutCommand(press('Ctrl+G'), 'win', 'desktop')).toBeNull()
    expect(htmlShortcutCommand(press('Cmd+G'), 'mac', 'web')).toBeNull()
  })

  it('the table rows these commands read exist and carry the module scope', () => {
    const ids = new Set(htmlShortcuts.map((a) => a.id))
    for (const id of ['html-002', 'html-003', 'html-007', 'html-017', 'html-018', 'html-025']) {
      expect(ids.has(id)).toBe(true)
    }
    expect(htmlShortcuts.every((a) => a.scope === 'html')).toBe(true)
  })

  it('Ctrl+K is the link key; Ask AI no longer owns it', () => {
    expect(htmlShortcutCommand(press('Ctrl+K'), 'win', 'desktop')).toBe('link')
    expect(htmlShortcutCommand(press('Cmd+K'), 'mac', 'web')).toBe('link')
  })

  it('Save As is F12 on Windows (Ctrl+Shift+S stays an alias) and Shift+Cmd+S on macOS', () => {
    expect(htmlShortcutCommand(press('F12'), 'win', 'desktop')).toBe('saveAs')
    expect(htmlShortcutCommand(press('Ctrl+Shift+S'), 'win', 'desktop')).toBe('saveAs')
    expect(htmlShortcutCommand(press('F12'), 'mac', 'desktop')).toBeNull()
    expect(htmlShortcutCommand(press('Ctrl+Shift+S'), 'mac', 'desktop')).toBeNull()
  })

  it('a Windows chord does not fire on macOS and the reverse', () => {
    expect(htmlShortcutCommand(press('Ctrl+S'), 'mac', 'desktop')).toBeNull()
    expect(htmlShortcutCommand(press('Cmd+S'), 'win', 'desktop')).toBeNull()
  })

  it('modifier extras do not match (Ctrl+Alt+B, Ctrl+Shift+B)', () => {
    expect(htmlShortcutCommand(press('Ctrl+Alt+B'), 'win', 'desktop')).toBeNull()
    expect(htmlShortcutCommand(press('Ctrl+Shift+B'), 'win', 'desktop')).toBeNull()
  })

  it('an IME composition fires nothing (isComposing and keyCode 229)', () => {
    for (const chord of ['Ctrl+S', 'Ctrl+K', 'Ctrl+Z', 'F12']) {
      expect(htmlShortcutCommand(press(chord, { isComposing: true }), 'win', 'desktop')).toBeNull()
      expect(htmlShortcutCommand(press(chord, { keyCode: 229 }), 'win', 'desktop')).toBeNull()
    }
  })

  it('AltGr (Ctrl+Alt with AltGraph) never fires a command', () => {
    const event = {
      ...press('Ctrl+Alt+U'),
      getModifierState: (key: string) => key === 'AltGraph',
    }
    expect(htmlShortcutCommand(event, 'win', 'desktop')).toBeNull()
  })

  it('a held key repeats undo, redo and zoom but not one-shot commands', () => {
    expect(htmlShortcutCommand(press('Ctrl+Z', { repeat: true }), 'win', 'desktop')).toBe('undo')
    expect(htmlShortcutCommand(press('Ctrl+Equal', { repeat: true }), 'win', 'desktop')).toBe(
      'zoomIn',
    )
    expect(htmlShortcutCommand(press('Ctrl+S', { repeat: true }), 'win', 'desktop')).toBeNull()
    expect(htmlShortcutCommand(press('Ctrl+K', { repeat: true }), 'win', 'desktop')).toBeNull()
  })

  it('Caps Lock and Shift do not change a letter chord (key is compared case-insensitively)', () => {
    expect(htmlShortcutCommand({ ...press('Ctrl+B'), key: 'B' }, 'win', 'desktop')).toBe('bold')
    expect(htmlShortcutCommand({ ...press('Ctrl+Shift+Z'), key: 'z' }, 'win', 'desktop')).toBe(
      'redo',
    )
  })
})

describe('html hints', () => {
  it('per platform and surface', () => {
    expect(htmlHint('save', 'win', 'desktop')).toBe('Ctrl+S')
    expect(htmlHint('save', 'mac', 'desktop')).toBe('⌘S')
    expect(htmlHint('saveAs', 'win', 'desktop')).toBe('F12')
    expect(htmlHint('saveAs', 'mac', 'web')).toBe('⇧⌘S')
    expect(htmlHint('redo', 'win', 'web')).toBe('Ctrl+Y')
    expect(htmlHint('link', 'win', 'web')).toBe('Ctrl+K')
    expect(htmlHint('cycleView', 'mac', 'desktop')).toBe('⌘\\')
  })

  it('replaces a hand-written hint in a translated label', () => {
    expect(withHtmlHint('Save (⌘S)', 'save', 'win', 'desktop')).toBe('Save (Ctrl+S)')
    expect(withHtmlHint('Save (Ctrl+S)', 'save', 'mac', 'desktop')).toBe('Save (⌘S)')
    expect(withHtmlHint('Save As…', 'saveAs', 'win', 'desktop')).toBe('Save As… (F12)')
    expect(withHtmlHint('查找和替换 (⌘F)', 'find', 'win', 'web')).toBe('查找和替换 (Ctrl+F)')
  })

  it('keeps a parenthesised note that is not a key hint', () => {
    expect(withHtmlHint('Previous (earlier hit)', 'undo', 'win', 'desktop')).toBe(
      'Previous (earlier hit) (Ctrl+Z)',
    )
  })
})

describe('link address', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
    ['example.com', 'https://example.com'],
    ['#top', '#top'],
    ['./next.html', './next.html'],
    ['  /docs  ', '/docs'],
    ['localhost:3000/x', 'https://localhost:3000/x'],
    ['example.com:8080', 'https://example.com:8080'],
    ['tel:5551234', 'tel:5551234'],
  ])('%s -> %s', (raw, out) => {
    expect(normalizeLinkHref(raw)).toBe(out)
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    '',
    'a b',
    'javascript:1',
    'data:text/html;base64,AAAA',
  ])('refuses %j', (raw) => {
    expect(normalizeLinkHref(raw)).toBeNull()
  })
})

describe('preview frame relay', () => {
  it('accepts the link and underline commands the frame posts for Ctrl+K and Ctrl+U', () => {
    for (const command of ['link', 'underline', 'bold', 'italic']) {
      const input = { type: 'gx:keyCommand', command, version: 4 }
      expect(parseFromInspector(input), command).toEqual(input)
    }
  })

  it('inspector.js maps k to link (not Ask AI) and u to underline', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')
    expect(source).toContain("{ b: 'bold', i: 'italic', u: 'underline', k: 'link' }")
    expect(source).not.toContain("k: 'askAi'")
  })
})

describe('source view keymap', () => {
  it('leaves Ctrl+G to the Find shortcut: CodeMirror binds no go-to-line / find-next on it', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'a\nb', extensions: buildExtensions(() => {}) }),
      parent: document.body,
    })
    for (const init of [
      { key: 'g', code: 'KeyG', ctrlKey: true },
      { key: 'g', code: 'KeyG', ctrlKey: true, altKey: true },
      { key: 'F4', code: 'F4', shiftKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      view.contentDOM.dispatchEvent(event)
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(false)
    }
    view.destroy()
  })
})
