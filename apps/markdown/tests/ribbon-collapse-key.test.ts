// UNI-2011 markdown-037: the ribbon collapse key comes from the markdown row, not common-10, so the web
// surface gets the Microsoft web Ctrl+F3 and desktop keeps Ctrl+F1 / ⌥⌘R.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { resetForTest } from '../src/renderer/capabilities'
import { Ribbon } from '../src/renderer/components/Ribbon'

const w = window as unknown as { markdownApi?: unknown }
const previousApi = w.markdownApi

const cleanups: Array<() => void> = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // each test starts expanded: the collapsed state persists in localStorage between mounts
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  w.markdownApi = previousApi
  resetForTest()
})

function host(surface: 'web' | 'desktop', platform: 'win' | 'mac'): void {
  w.markdownApi = surface === 'web' ? { capabilities: { platform: 'web' } } : undefined
  resetForTest()
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform === 'mac' ? 'MacIntel' : 'Win32')
}

function renderRibbon(): HTMLElement {
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
  return container.querySelector<HTMLElement>('.ribbon')!
}

interface KeyInit {
  key: string
  code: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}
const ctrlF1: KeyInit = { key: 'F1', code: 'F1', ctrlKey: true }
const ctrlF3: KeyInit = { key: 'F3', code: 'F3', ctrlKey: true }
const optCmdR: KeyInit = { key: '®', code: 'KeyR', altKey: true, metaKey: true }

function press(init: KeyInit): void {
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  act(() => {
    window.dispatchEvent(e)
  })
}

const collapsed = (ribbon: HTMLElement) => ribbon.classList.contains('ribbon-collapsed')
const collapseTip = () =>
  document.querySelector('.ribbon-collapse-btn')!.getAttribute('aria-label') ?? ''

describe('markdown ribbon collapse key (markdown-037)', () => {
  it('web: Ctrl+F3 collapses the ribbon and Ctrl+F1 does not', () => {
    host('web', 'win')
    const ribbon = renderRibbon()
    press(ctrlF1)
    expect(collapsed(ribbon)).toBe(false)
    press(ctrlF3)
    expect(collapsed(ribbon)).toBe(true)
    press(ctrlF3)
    expect(collapsed(ribbon)).toBe(false)
  })

  it('desktop Windows: Ctrl+F1 collapses the ribbon, Ctrl+F3 does not', () => {
    host('desktop', 'win')
    const ribbon = renderRibbon()
    press(ctrlF3)
    expect(collapsed(ribbon)).toBe(false)
    press(ctrlF1)
    expect(collapsed(ribbon)).toBe(true)
  })

  it('desktop Mac: ⌥⌘R collapses the ribbon, Ctrl+F1 does not', () => {
    host('desktop', 'mac')
    const ribbon = renderRibbon()
    press(ctrlF1)
    expect(collapsed(ribbon)).toBe(false)
    press(optCmdR)
    expect(collapsed(ribbon)).toBe(true)
  })

  it('shows the row’s key per platform and surface in the collapse hint', () => {
    host('web', 'win')
    renderRibbon()
    expect(collapseTip()).toMatch(/\(Ctrl\+F3\)$/)
    cleanups.splice(0).forEach((cleanup) => cleanup())

    host('desktop', 'win')
    renderRibbon()
    expect(collapseTip()).toMatch(/\(Ctrl\+F1\)$/)
    cleanups.splice(0).forEach((cleanup) => cleanup())

    host('desktop', 'mac')
    renderRibbon()
    expect(collapseTip()).toMatch(/\(⌥⌘R\)$/)
  })
})
