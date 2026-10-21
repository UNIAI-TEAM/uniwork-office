/**
 * UNI-2011 follow-up (F-docs): Find next (Shift+F4), hidden text (Ctrl+Shift+H),
 * Ctrl+Space clear formatting on Windows only, F5 Go To in the web frame, and the
 * rows left unmapped (double underline, web Close, Repeat) with their reasons.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import {
  SHORTCUT_NOTES,
  SHORTCUT_UNMAPPED,
  chordsFor,
  findShortcut,
  matchShortcut,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { toggleHiddenText } from '../src/renderer/editor/hidden-text'
import { FindPanel } from '../src/renderer/components/FindPanel'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import { SHORTCUTS, createShortcutMatcher, shortcutHint } from '../src/renderer/shortcuts'

Object.assign(window, { desktop: { onLanguageChanged: () => () => undefined } })
setModuleLang('en')
// jsdom has no layout: stepping to a match scrolls it into view
Element.prototype.scrollIntoView = () => {}

const key = (
  init: Partial<ShortcutKeyEvent> & { key: string; code: string },
): ShortcutKeyEvent => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  getModifierState: () => false,
  ...init,
})

const matchApp = createShortcutMatcher([
  'find',
  'find-next',
  'hidden-text',
  'clear-formatting',
  'goto',
])
const on = (
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
  surface: ShortcutSurface = 'desktop',
) => matchApp(event, platform, surface)

describe('Find next (docs-019)', () => {
  it('Shift+F4 fires it on both platforms and both surfaces', () => {
    const f4 = key({ key: 'F4', code: 'F4', shiftKey: true })
    for (const platform of ['win', 'mac'] as const)
      for (const surface of ['desktop', 'web'] as const)
        expect(on(f4, platform, surface), `${platform} ${surface}`).toBe('find-next')
  })

  it('plain F4 (Repeat, deferred) and Ctrl+Shift+F4 fire nothing', () => {
    expect(on(key({ key: 'F4', code: 'F4' }), 'win')).toBeNull()
    expect(on(key({ key: 'F4', code: 'F4', shiftKey: true, ctrlKey: true }), 'win')).toBeNull()
  })

  it('shows Shift+F4 as its hint', () => {
    expect(shortcutHint('find-next', 'win', 'desktop')).toBe('Shift+F4')
  })

  describe('in the Find panel', () => {
    let root: Root | undefined
    let editor: Editor | undefined
    afterEach(() => {
      if (root) act(() => root!.unmount())
      editor?.destroy()
      root = undefined
      editor = undefined
    })

    const panel = (findNextNonce: number) =>
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(FindPanel, {
          editor: editor!,
          onClose: () => {},
          focusFindNonce: 1,
          findNextNonce,
        }),
      })

    const mountPanel = () => {
      editor = new Editor({
        element: document.createElement('div'),
        extensions: editorExtensions,
        content: {
          type: 'doc',
          content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'ab ab ab' }] }],
        },
      })
      const container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      act(() => root!.render(panel(0)))
      return {
        container,
        render: (nonce: number) => act(() => root!.render(panel(nonce))),
      }
    }

    const typeQuery = (container: HTMLElement, value: string) => {
      const input = container.querySelector<HTMLInputElement>('.find-input')!
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      act(() => {
        set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const count = (container: HTMLElement) => container.querySelector('.find-count')!.textContent

    it('a bumped nonce steps to the next match and wraps', () => {
      const { container, render } = mountPanel()
      typeQuery(container, 'ab')
      // the first bump flushes the debounced scan, which lands on match 1 like Enter does
      render(1)
      expect(count(container)).toBe('1/3')
      render(2)
      expect(count(container)).toBe('2/3')
      render(3)
      render(4)
      expect(count(container)).toBe('1/3')
    })

    it('a panel mounted with a non-zero nonce does not step', () => {
      editor = new Editor({
        element: document.createElement('div'),
        extensions: editorExtensions,
        content: {
          type: 'doc',
          content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'ab ab' }] }],
        },
      })
      const container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      act(() => root!.render(panel(5)))
      typeQuery(container, 'ab')
      expect(count(container)).not.toBe('2/2')
    })
  })
})

describe('Hidden text (docs-037)', () => {
  it('Ctrl+Shift+H on Windows, no Mac key', () => {
    const chord = key({ key: 'h', code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(on(chord, 'win')).toBe('hidden-text')
    expect(on(chord, 'win', 'web')).toBe('hidden-text')
    expect(on(key({ key: 'h', code: 'KeyH', metaKey: true, shiftKey: true }), 'mac')).toBeNull()
    expect(on(chord, 'mac')).toBeNull()
    expect(shortcutHint('hidden-text', 'win', 'desktop')).toBe('Ctrl+Shift+H')
    expect(shortcutHint('hidden-text', 'mac', 'desktop')).toBe('')
  })

  const makeEditor = () =>
    new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'secret text' }] }],
      },
    })
  const select = (editor: Editor, from: number, to: number) =>
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    )

  it('toggles the run’s own vanish on and back off', () => {
    const editor = makeEditor()
    select(editor, 1, 7)
    expect(toggleHiddenText(editor)).toBe(true)
    select(editor, 1, 7)
    expect(editor.getAttributes('docTextStyle')).toMatchObject({ vanish: true, vanishOwn: true })
    expect(editor.view.dom.innerHTML).toContain('display: none')
    toggleHiddenText(editor)
    select(editor, 1, 7)
    expect(editor.getAttributes('docTextStyle').vanish).toBeFalsy()
    expect(editor.getAttributes('docTextStyle').vanishOwn).toBeFalsy()
    editor.destroy()
  })

  it('is one undo step', () => {
    const editor = makeEditor()
    select(editor, 1, 7)
    toggleHiddenText(editor)
    expect(editor.view.dom.innerHTML).toContain('display: none')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.view.dom.innerHTML).not.toContain('display: none')
    editor.destroy()
  })

  const hiddenRuns = (editor: Editor) => {
    const runs: [string, unknown][] = []
    editor.state.doc.descendants((node) => {
      if (node.isText)
        runs.push([
          node.text!,
          node.marks.find((mark) => mark.type.name === 'docTextStyle')?.attrs.vanish ?? null,
        ])
    })
    return runs
  }
  const mixedEditor = (order: 'hidden-first' | 'hidden-last') => {
    const hidden = {
      type: 'text',
      text: 'ab',
      marks: [{ type: 'docTextStyle', attrs: { vanish: true, vanishOwn: true } }],
    }
    const plain = { type: 'text', text: 'cd' }
    return new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            content: order === 'hidden-first' ? [hidden, plain] : [plain, hidden],
          },
        ],
      },
    })
  }

  it.each(['hidden-first', 'hidden-last'] as const)(
    'a selection mixing hidden and shown text hides all of it (%s)',
    (order) => {
      const editor = mixedEditor(order)
      select(editor, 1, 5)
      toggleHiddenText(editor)
      expect(hiddenRuns(editor).every(([, vanish]) => vanish === true)).toBe(true)
      // all hidden now, so the next press shows it again
      select(editor, 1, 5)
      toggleHiddenText(editor)
      expect(hiddenRuns(editor).every(([, vanish]) => vanish === false)).toBe(true)
      editor.destroy()
    },
  )
})

describe('Clear character formatting (docs-039)', () => {
  const space = (mods: Partial<ShortcutKeyEvent>) => key({ key: ' ', code: 'Space', ...mods })

  it('Ctrl+Space on Windows; Mac stays unmapped (Control+Space switches input sources)', () => {
    expect(on(space({ ctrlKey: true }), 'win')).toBe('clear-formatting')
    expect(on(space({ ctrlKey: true }), 'win', 'web')).toBe('clear-formatting')
    expect(on(space({ ctrlKey: true }), 'mac')).toBeNull()
    expect(on(space({ ctrlKey: true }), 'mac', 'web')).toBeNull()
    expect(shortcutHint('clear-formatting', 'mac', 'desktop')).toBe('')
    const reasons = SHORTCUT_UNMAPPED.docs.filter(
      (entry) => entry.id === 'docs-039' && entry.part.endsWith('mac'),
    )
    expect(reasons.map((entry) => entry.part).sort()).toEqual(['desktop.mac', 'web.mac'])
    expect(reasons.every((entry) => /input.source/i.test(entry.reason))).toBe(true)
  })
})

describe('Go To in the web frame (docs-021)', () => {
  it('F5 opens Go To on Windows web only; Cmd+Option+G stays on Mac web', () => {
    const f5 = key({ key: 'F5', code: 'F5' })
    expect(on(f5, 'win', 'web')).toBe('goto')
    expect(on(f5, 'win')).toBeNull()
    expect(on(f5, 'mac', 'web')).toBeNull()
    expect(on(key({ key: 'g', code: 'KeyG', altKey: true, metaKey: true }), 'mac', 'web')).toBe(
      'goto',
    )
    // Ctrl+G is still Find there
    expect(on(key({ key: 'g', code: 'KeyG', ctrlKey: true }), 'win', 'web')).toBe('find')
    // a held F5 keeps matching, so the frame swallows every auto-repeat and the page never reloads
    expect(on({ ...f5, repeat: true }, 'win', 'web')).toBe('goto')
    expect(shortcutHint('goto', 'win', 'web')).toBe('F5')
    expect(shortcutHint('goto', 'win', 'desktop')).toBe('Ctrl+G')
  })
})

describe('rows left unmapped', () => {
  const reasons = (id: string, part: string) =>
    SHORTCUT_UNMAPPED.docs.filter((entry) => entry.id === id && entry.part === part)

  it('double underline: no such mark, so no chord anywhere and nothing runs', () => {
    const row = findShortcut('docs', 'docs-025')!
    for (const platform of ['win', 'mac'] as const)
      for (const surface of ['desktop', 'web'] as const)
        expect(chordsFor(row, platform, surface), `${platform} ${surface}`).toEqual([])
    expect(
      matchShortcut(
        key({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }),
        [row],
        'win',
        'web',
      ),
    ).toBeNull()
    for (const part of ['desktop.win', 'desktop.mac', 'web.win', 'web.mac'])
      expect(
        reasons('docs-025', part).some((entry) => /double.underline/i.test(entry.reason)),
        part,
      ).toBe(true)
  })

  it('web Close: the frame has no Close action, so Alt+Shift+W is not offered', () => {
    const row = findShortcut('docs', 'docs-008')!
    expect(chordsFor(row, 'win', 'web')).toEqual([])
    expect(row.webAlt).toBeUndefined()
    expect(row.win).toEqual(['Ctrl+W'])
    expect(row.mac).toEqual(['Cmd+W'])
    expect(reasons('docs-008', 'web.win').some((entry) => /Close/.test(entry.reason))).toBe(true)
    // the desktop menu keeps its accelerators
    expect(SHORTCUTS.find((def) => def.id === 'close')?.desktopOnly).toBe(true)
  })

  it('each row the slice rewrote keeps one reason per part, none of the CSV prose (RS-F-docs M1)', () => {
    const expected: Record<string, string[]> = {
      'docs-012': ['row'],
      'docs-025': ['desktop.mac', 'desktop.win', 'web.mac', 'web.win'],
      'docs-037': ['desktop.mac', 'web.mac'],
      'docs-039': ['desktop.mac', 'web.mac'],
    }
    for (const [id, parts] of Object.entries(expected)) {
      const entries = SHORTCUT_UNMAPPED.docs.filter((entry) => entry.id === id)
      expect(entries.map((entry) => entry.part).sort(), id).toEqual(parts)
      expect(
        entries.filter((entry) =>
          /proposal has prose|needs a decision|Conflicts with/.test(entry.reason),
        ),
        id,
      ).toEqual([])
    }
    // the CSV's "no web chord" notes are covered by those entries
    expect(
      SHORTCUT_NOTES.docs.filter(
        (note) => ['docs-037', 'docs-039'].includes(note.id) && note.part === 'web.mac',
      ),
    ).toEqual([])
  })

  it('Repeat (F4) stays deferred with its reason', () => {
    expect(
      SHORTCUT_UNMAPPED.docs.some(
        (entry) =>
          entry.id === 'docs-012' && entry.part === 'row' && /deferred/i.test(entry.reason),
      ),
    ).toBe(true)
  })
})
