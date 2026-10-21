// UNI-2060: a ribbon button's accessible name is the plain command name; the chord goes into
// aria-keyshortcuts (from the same @genoffice/shortcuts row) and stays in the visible tooltip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import {
  accessibleShortcutProblems,
  findDisplayChord,
  findShortcut,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'
import { Ribbon } from '../src/renderer/components/Ribbon'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

import { markdownHint, markdownSurface, type MarkdownCommand } from '../src/renderer/shortcuts'

function renderRibbon(disabled = false) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>Saved document</p>',
  })
  const onSave = vi.fn()
  const onSaveAs = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const props = {
    disabled,
    dirty: false,
    onSave,
    onSaveAs,
    onFind: vi.fn(),
    autoSave: false,
    onToggleAutoSave: vi.fn(),
    aiOpen: false,
    onToggleAi: vi.fn(),
    onAiPreset: vi.fn(),
    editor,
    imageEnabled: true,
    onInsertImage: vi.fn(),
    frontmatterOpen: false,
    onToggleFrontmatter: vi.fn(),
    outlineOpen: false,
    onToggleOutline: vi.fn(),
    hasOutline: false,
  }
  act(() => root.render(createElement(Ribbon, props)))
  cleanups.push(() => {
    act(() => root.unmount())
    editor.destroy()
    container.remove()
  })
  return { container, onSave, onSaveAs }
}

/** buttons bound to a table row: the command and the row that drives it */
const BOUND: ReadonlyArray<{ command: MarkdownCommand; row: string }> = [
  { command: 'save', row: 'markdown-002' },
  { command: 'saveAs', row: 'markdown-003' },
  { command: 'undo', row: 'markdown-006' },
  { command: 'redo', row: 'markdown-007' },
  { command: 'find', row: 'markdown-013' },
  { command: 'bold', row: 'markdown-016' },
  { command: 'italic', row: 'markdown-017' },
  { command: 'strike', row: 'markdown-019' },
  { command: 'toggleSource', row: 'markdown-021' },
  { command: 'bulletList', row: 'markdown-026' },
  { command: 'orderedList', row: 'markdown-027' },
  { command: 'link', row: 'markdown-029' },
]

describe.each<ShortcutPlatform>(['win', 'mac'])(
  'Markdown ribbon accessible names (%s)',
  (platform) => {
    beforeEach(() => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(
        platform === 'mac' ? 'MacIntel' : 'Win32',
      )
    })

    it('no aria-label carries a chord', () => {
      const { container } = renderRibbon()
      // the shared collapse / expand buttons live in packages/ui and are covered by its own lock test
      const own = '[aria-label]:not(.ribbon-collapse-btn):not(.ribbon-expand-btn)'
      expect(container.querySelectorAll(own).length).toBeGreaterThan(5)
      for (const el of container.querySelectorAll(own)) {
        expect(findDisplayChord(el.getAttribute('aria-label')!), el.outerHTML).toBeNull()
      }
    })

    it('every table-bound button has the plain name and the platform aria-keyshortcuts', () => {
      const { container } = renderRibbon()
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[data-tip]')]
      for (const { command, row } of BOUND) {
        const hint = markdownHint(command, platform, markdownSurface())
        expect(hint, `${command} has a chord on ${platform}`).not.toBe('')
        // the visible tooltip keeps the chord
        const matches = buttons.filter((b) => b.getAttribute('data-tip')!.endsWith(`(${hint})`))
        expect(matches, `${command} tooltip ends with (${hint})`).toHaveLength(1)
        const button = matches[0]!
        expect(
          accessibleShortcutProblems(
            {
              name: button.getAttribute('aria-label') ?? button.textContent ?? '',
              keyshortcuts: button.getAttribute('aria-keyshortcuts'),
            },
            findShortcut('markdown', row)!,
            platform,
            markdownSurface(),
          ),
        ).toEqual([])
      }
    })
  },
)
