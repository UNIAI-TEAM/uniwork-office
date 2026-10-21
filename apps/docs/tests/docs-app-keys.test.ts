/**
 * UNI-2011 follow-up (F-docs, RS-F-docs L3): the App.tsx key handler branches the matcher
 * tests cannot reach. Mounts the real App on a one-paragraph docx and dispatches keydowns on
 * window: Shift+F4 with Find closed opens Find, Ctrl+Shift+H hides the selection as one undo
 * step, stays off inside the Find field and on a read-only editor, and a held F5 on the web
 * frame is swallowed key for key.
 */
import { Buffer } from 'node:buffer'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { App } from '../src/renderer/App'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'

const harnessSettings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'k', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

const winHost = window as unknown as { desktop?: Record<string, unknown> }
const docHost = document as unknown as { fonts?: unknown }

/**
 * Integration mount: the App load path goes through undici fetch + React's own
 * scheduler, which fake timers cannot drive — tick the macrotask queue inside
 * act() instead of awaiting a named promise the boot sequence does not expose.
 * Each loadFile await step (fetch, zip walk, parse, fonts) needs its own real
 * tick, so wait for the mounted surface, not a fixed count.
 */
const tick = async (): Promise<void> => {
  // Promise.withResolvers is above the app tsconfig's lib target; the harness
  // convention (docs-ai-run-harness.ts) uses the executor form for the same tick
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await tick()
}
const untilMounted = async (): Promise<void> => {
  for (let i = 0; i < 200 && !document.querySelector('.ProseMirror'); i++) await tick()
}

let host: HTMLElement | null = null
let root: Root | null = null

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setModuleLang('en')
  localStorage.clear()
  resetCapabilitiesForTest()

  // jsdom lacks the browser APIs the app shell leans on; all are guarded or
  // degrade to the no-op paths below
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  window.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 0)
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
  window.CSS ??= {
    escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  } as typeof CSS
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      status: 'loaded',
      ready: Promise.resolve(),
      addEventListener() {},
      removeEventListener() {},
    },
  })

  const bytes = await buildDocx({
    bodyXml: '<w:p><w:r><w:t>one two one</w:t></w:r></w:p>',
  })
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from(bytes).toString('base64')}`
  winHost.desktop = {
    // document open path (loadFile → fetchDocBytes handles data: URLs)
    consumePendingOpenDocx: () =>
      Promise.resolve({
        path: '/docs/keys.docx',
        name: 'keys.docx',
        dataUrl,
        hash: 'h',
      }),
    consumeNewBlankDoc: () => Promise.resolve(false),
    consumeAiDocContent: () => Promise.resolve(null),
    consumeAiPreset: () => Promise.resolve(null),
    consumeHeadlessExport: () => Promise.resolve(null),
    onOpenDocx: () => () => {},
    onRenamedDocx: () => () => {},
    onAiPreset: () => () => {},
    // unguarded subscriptions / settings
    getAiSettings: () => Promise.resolve(harnessSettings),
    onAiSettingsChanged: () => () => {},
    getRecentFiles: () => Promise.resolve([]),
    docPasswordIntentRevision: () => Promise.resolve(0),
    discardDocPasswordIntents: () => Promise.resolve(),
    onZoteroRequest: () => () => {},
    provideDocBytes: () => () => {},
    onMenuCommand: () => () => {},
    onTeardown: () => () => {},
    onViewImage: () => () => {},
    getCommentAuthor: () => Promise.resolve(null),
    onCommentAuthorChanged: () => () => {},
    onContextMenuRequest: () => () => {},
    armContextMenu: () => {},
    confirmDocumentReplace: () => Promise.resolve(true),
    respellKick: () => Promise.resolve(),
    spellLanguages: () => Promise.resolve(['en']),
    onLanguageChanged: () => () => {},
    getPathForFile: () => '',
    // no-ops called on demand only, kept so an accidental call never throws
    onAiStream: () => () => {},
    aiStream: () => Promise.resolve(),
    aiStreamCancel: () => Promise.resolve(),
    saveDocx: () => Promise.resolve({ ok: true }),
    saveDocxAs: () => Promise.resolve({ ok: false }),
    saveDocxCopy: () => Promise.resolve({ ok: false }),
    openDocx: () => Promise.resolve(null),
    openDocxPath: () => Promise.resolve(null),
    openDocxDecrypt: () => Promise.resolve({ ok: false, reason: 'error' }),
    print: () => {},
    pickImage: () => Promise.resolve(null),
    fetchImage: () => Promise.resolve(null),
    saveImageAs: () => {},
    noteDocumentMounted: () => {},
    headlessExportDone: () => {},
    reportViewMenuState: () => {},
    reportCloseCheck: () => {},
    reportCloseSaveResult: () => {},
    onCloseCheck: () => () => {},
    onCloseSaveRequest: () => () => {},
    claimContextMenu: () => {},
    respondToZotero: () => {},
    setDocPassword: () => Promise.resolve({ ok: true }),
    aiGskStatus: () => Promise.resolve(null),
    spellDiag: () => {},
    spellAddWord: () => {},
    spellIgnoreWord: () => {},
    spellReplace: () => {},
    spellSetLanguages: () => {},
    setAiSettings: () => Promise.resolve(),
    setAiPanelPrefs: () => {},
    openInApp: () => {},
    openNewTab: () => {},
    listDocsTabs: () => Promise.resolve([]),
    focusDocsTab: () => {},
    zoteroCommand: () => Promise.resolve(null),
    uniworkState: () => Promise.resolve(null),
  }

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(LocaleProvider, { initial: 'en', children: createElement(App) }))
  })
  await untilMounted()
  await settle()
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  delete winHost.desktop
  delete docHost.fonts
  resetCapabilitiesForTest()
})

const press = (
  init: KeyboardEventInit & { key: string; code: string },
  target: EventTarget = window,
) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}
const editorOf = () =>
  (document.querySelector('.ProseMirror') as { editor?: Editor } | null)!.editor!
const selectAll = (editor: Editor) =>
  act(() => {
    const doc = editor.state.doc
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)),
    )
  })
const hiddenCount = () => document.querySelectorAll('.ProseMirror [style*="display: none"]').length
const shiftF4 = { key: 'F4', code: 'F4', shiftKey: true }
const ctrlShiftH = { key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }

describe('docs key handler wiring (F-docs follow-up)', () => {
  it('Shift+F4 with Find closed opens Find, and again steps without closing it', async () => {
    expect(document.querySelector('.find-panel')).toBeNull()
    const first = press(shiftF4)
    expect(first.defaultPrevented).toBe(true)
    await settle()
    expect(document.querySelector('.find-panel')).not.toBeNull()
    press(shiftF4)
    await settle()
    expect(document.querySelector('.find-panel')).not.toBeNull()
  })

  it('Ctrl+Shift+H hides the selected text, and one undo brings it back', async () => {
    const editor = editorOf()
    selectAll(editor)
    expect(hiddenCount()).toBe(0)
    expect(press(ctrlShiftH).defaultPrevented).toBe(true)
    expect(hiddenCount()).toBeGreaterThan(0)
    act(() => {
      editor.commands.undo()
    })
    expect(hiddenCount()).toBe(0)
  })

  it('Ctrl+Shift+H does nothing while the Find field has focus', async () => {
    const editor = editorOf()
    selectAll(editor)
    press(shiftF4)
    await settle()
    const input = document.querySelector<HTMLInputElement>('.find-input')!
    act(() => input.focus())
    expect(document.activeElement).toBe(input)
    const event = press(ctrlShiftH, input)
    expect(event.defaultPrevented).toBe(false)
    expect(hiddenCount()).toBe(0)
  })

  it('Ctrl+Shift+H does nothing on a read-only editor', async () => {
    const editor = editorOf()
    selectAll(editor)
    act(() => editor.setEditable(false))
    const event = press(ctrlShiftH)
    expect(event.defaultPrevented).toBe(false)
    expect(hiddenCount()).toBe(0)
  })

  it('on the web frame F5 opens Go To and every held repeat is swallowed (RS-F-docs M2)', async () => {
    winHost.desktop!.capabilities = { platform: 'web' }
    resetCapabilitiesForTest()
    const first = press({ key: 'F5', code: 'F5' })
    expect(first.defaultPrevented).toBe(true)
    await settle()
    expect(document.querySelector('.find-panel')).not.toBeNull()
    for (let i = 0; i < 3; i++)
      expect(press({ key: 'F5', code: 'F5', repeat: true }).defaultPrevented, `repeat ${i}`).toBe(
        true,
      )
  })

  it('on the desktop F5 is left alone', () => {
    expect(press({ key: 'F5', code: 'F5' }).defaultPrevented).toBe(false)
  })
})
