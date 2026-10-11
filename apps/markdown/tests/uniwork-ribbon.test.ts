import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'

// The assistant is unrelated to quick-access file actions.
vi.mock('../src/renderer/ai/AiPanel', () => ({ GensparkMark: () => null }))

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function renderRibbon(extra: {
  uniworkBound?: boolean
  readOnly?: boolean
  autoSave?: boolean
  hasOutline?: boolean
}) {
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
    disabled: false,
    dirty: false,
    onSave,
    onSaveAs,
    onFind: vi.fn(),
    autoSave: extra.autoSave ?? false,
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
    ...extra,
  }
  act(() => root.render(createElement(Ribbon, props)))
  cleanups.push(() => {
    act(() => root.unmount())
    editor.destroy()
    container.remove()
  })
  return { container, onSave, onSaveAs }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(`.ribbon-tabs button[aria-label="${label}"]`)!
}

/** the first quick-access button is Save (its label carries the platform shortcut) */
function saveButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('.ribbon-tabs button.qa-btn')!
}

function autoSaveInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('.autosave-toggle input')!
}

describe('Ribbon on a UniWork copy', () => {
  it('a plain local file keeps the genoffice toggle and a clean Save stays off', () => {
    const { container } = renderRibbon({ autoSave: true })
    expect(autoSaveInput(container).disabled).toBe(false)
    expect(autoSaveInput(container).checked).toBe(true)
    expect(saveButton(container).disabled).toBe(true)
  })

  it('a bound copy has no AutoSave toggle at all, and Save works while clean', () => {
    const { container } = renderRibbon({ autoSave: true, uniworkBound: true })
    expect(container.querySelector('.autosave-toggle')).toBeNull()
    expect(saveButton(container).disabled).toBe(false)
  })

  it('a view-only copy disables Save but keeps Save As for a local copy', () => {
    const { container } = renderRibbon({ uniworkBound: true, readOnly: true })
    expect(saveButton(container).disabled).toBe(true)
    expect(button(container, '另存为…').disabled).toBe(false)
  })

  it('a view-only copy can still be read: Find, outline, spelling and properties stay on', () => {
    const { container } = renderRibbon({ uniworkBound: true, readOnly: true, hasOutline: true })
    const find = container.querySelector<HTMLButtonElement>(
      '.ribbon-tabs button[aria-label^="查找和替换"]',
    )!
    const body = (label: string) =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    expect(find.disabled).toBe(false)
    expect(body('大纲').disabled).toBe(false)
    expect(body('拼写检查').disabled).toBe(false)
    expect(body('属性').disabled).toBe(false)
    // the editable source pane stays off
    expect(body('源码').disabled).toBe(true)
  })
})
