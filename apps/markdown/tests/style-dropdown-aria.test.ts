// UNI-2060: the ribbon's block-style dropdown rows bound to a table row (Heading 1-3 =
// markdown-022..024, Normal text = markdown-025) announce their chord in aria-keyshortcuts; the
// option names stay the plain style names.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { createI18n, LANGS } from '@genoffice/i18n'
import { findDisplayChord, type ShortcutPlatform } from '@genoffice/shortcuts'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { strings } from '../src/renderer/i18n/strings'
import { markdownAria, markdownSurface, type MarkdownCommand } from '../src/renderer/shortcuts'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function openStyleDropdown(): HTMLElement {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>Saved document</p>',
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(Ribbon, {
        disabled: false,
        dirty: false,
        onSave: vi.fn(),
        onSaveAs: vi.fn(),
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
      }),
    ),
  )
  cleanups.push(() => {
    act(() => root.unmount())
    editor.destroy()
    container.remove()
  })
  act(() => {
    container.querySelector<HTMLButtonElement>('.rb-style .gs-dd-btn')!.click()
  })
  return container
}

const BOUND: ReadonlyArray<{ value: string; command: MarkdownCommand }> = [
  { value: 'h1', command: 'heading1' },
  { value: 'h2', command: 'heading2' },
  { value: 'h3', command: 'heading3' },
  { value: 'paragraph', command: 'paragraph' },
]

describe.each<ShortcutPlatform>(['win', 'mac'])('Markdown block-style dropdown (%s)', (platform) => {
  beforeEach(() => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(
      platform === 'mac' ? 'MacIntel' : 'Win32',
    )
  })

  it('table-bound rows carry the platform aria-keyshortcuts', () => {
    const container = openStyleDropdown()
    for (const { value, command } of BOUND) {
      const option = container.querySelector(`[role="option"][data-value="${value}"]`)!
      const want = markdownAria(command, platform, markdownSurface())
      expect(option.getAttribute('aria-keyshortcuts'), `${value} on ${platform}`).toBe(want || null)
    }
    // the headings have a chord on both platforms, so the check above is not vacuous
    expect(markdownAria('heading1', platform, markdownSurface())).not.toBe('')
  })

  it('rows without a table row announce no chord', () => {
    const container = openStyleDropdown()
    for (const value of ['h4', 'h5', 'h6', 'quote', 'codeBlock']) {
      const option = container.querySelector(`[role="option"][data-value="${value}"]`)!
      expect(option.getAttribute('aria-keyshortcuts'), value).toBeNull()
    }
  })

  it('option names carry no chord', () => {
    const container = openStyleDropdown()
    const options = [...container.querySelectorAll('[role="option"]')]
    expect(options.length).toBeGreaterThan(5)
    for (const option of options) {
      expect(findDisplayChord(option.getAttribute('aria-label') ?? ''), option.outerHTML).toBeNull()
    }
  })
})

describe('Markdown block-style labels in every locale', () => {
  it('carry no chord', () => {
    const translate = createI18n(strings)
    for (const lang of LANGS) {
      for (const key of ['styleParagraph', 'styleH1', 'styleH2', 'styleH3'] as const) {
        const name = translate(lang, key)
        expect(findDisplayChord(name), `${lang} ${key}: ${name}`).toBeNull()
      }
    }
  })
})
