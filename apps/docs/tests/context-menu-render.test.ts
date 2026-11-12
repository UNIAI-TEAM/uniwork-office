// @vitest-environment jsdom
/**
 * FE-W1-01 / W1-E1 regression test: `<EditorContextMenu>` must render without
 * throwing when `trackChanges` is provided (`shortcut: 'track-changes'`, not a
 * raw `'⇧⌘E'` glyph string that throws in `shortcutHint()`), and must include
 * the fork's UniWork AI "Hide the selection from AI" (`redactMenuLabel`) item
 * alongside upstream's Track Changes / Comment items.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorContextMenu } from '../src/renderer/components/ContextMenu'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { DocRedaction } from '../src/renderer/editor/redaction'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'
import { shortcutHint } from '../src/renderer/shortcuts'

describe('EditorContextMenu render & fork seams (FE-W1-01 / W1-E1)', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null
  let editor: Editor | null = null

  beforeEach(() => {
    setModuleLang('en')
    resetCapabilitiesForTest()
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      writable: true,
      value: {
        onLanguageChanged: () => () => {},
        onChromePressed: () => () => {},
      },
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [...editorExtensions, DocRedaction],
      content: {
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: { docxIndex: 0 },
            content: [{ type: 'text', text: 'Sensitive words here' }],
          },
        ],
      },
    })
    // Select "Sensitive"
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 10)),
    )
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
    editor?.destroy()
    editor = null
    host?.remove()
    host = null
    resetCapabilitiesForTest()
  })

  it('mounts .ctx-menu with trackChanges and UniWork AI Hide selection item without throwing', async () => {
    const onToggleTrack = vi.fn()
    const onRedact = vi.fn()

    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(EditorContextMenu, {
            editor: editor!,
            menu: { x: 100, y: 100, pos: 2 },
            commentsAllowed: true,
            onClose: vi.fn(),
            onFontDialog: vi.fn(),
            onParagraphDialog: vi.fn(),
            onLink: vi.fn(),
            onNewComment: vi.fn(),
            onViewImage: vi.fn(),
            onSaveImageAs: vi.fn(),
            onAiPreset: vi.fn(),
            onRedact,
            onUnredact: vi.fn(),
            trackChanges: { on: false, onToggle: onToggleTrack },
          }),
        }),
      )
    })

    const menuEl = host!.querySelector('.ctx-menu')
    expect(menuEl).not.toBeNull()

    const labels = [...host!.querySelectorAll('.ctx-menu .ctx-label')].map((el) => el.textContent)
    expect(labels).toContain(t('redactMenuLabel'))
    expect(labels).toContain(t('ribbonTrackChanges'))

    const trackBtn = [...host!.querySelectorAll<HTMLButtonElement>('.ctx-menu .ctx-item')].find(
      (btn) => btn.querySelector('.ctx-label')?.textContent === t('ribbonTrackChanges'),
    )
    expect(trackBtn).toBeDefined()
    expect(trackBtn?.querySelector('.ctx-key')?.textContent).toBe(shortcutHint('track-changes'))
  })
})
