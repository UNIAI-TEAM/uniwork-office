/**
 * Visual r2 H-07: when the host does not grant AI the ribbon used to drop the AI group without a
 * word. It now keeps one AI entry that says why it is off (aria-disabled so it still takes hover
 * and focus), and a granted AI keeps the normal group.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { appStrings } from '../src/renderer/i18n/strings-app'

vi.mock('../src/renderer/ai/AiPanel', () => ({ GensparkMark: () => null }))

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function renderRibbon(extra: Record<string, unknown>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const noop = vi.fn()
  act(() =>
    root.render(
      createElement(Ribbon, {
        disabled: false,
        dirty: false,
        onSave: noop,
        onSaveAs: noop,
        onFind: noop,
        autoSave: false,
        onToggleAutoSave: noop,
        aiOpen: false,
        onToggleAi: noop,
        onAiPreset: noop,
        canUndo: false,
        canRedo: false,
        onUndo: noop,
        onRedo: noop,
        view: 'preview',
        onView: noop,
        canInsert: true,
        onInsert: noop,
        canvasMode: 'edit',
        onPresent: noop,
        ...extra,
      }),
    ),
  )
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

describe('ribbon without a host AI grant', () => {
  it('shows one disabled AI entry that carries the reason', () => {
    const hint = appStrings.en.aiNotEnabled
    const box = renderRibbon({ showAi: false, aiOffHint: hint })
    const entries = [...box.querySelectorAll<HTMLButtonElement>('.ai-entry')]
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry!.getAttribute('aria-disabled')).toBe('true')
    // not `disabled`: a disabled button takes no hover / focus, so the reason could never be read
    expect(entry!.disabled).toBe(false)
    expect(entry!.dataset.tip).toBe(hint)
    expect(entry!.getAttribute('aria-label')).toContain(hint)
  })

  it('the entry does nothing when pressed', () => {
    const onToggleAi = vi.fn()
    const onAiPreset = vi.fn()
    const box = renderRibbon({ showAi: false, aiOffHint: 'x', onToggleAi, onAiPreset })
    act(() => box.querySelector<HTMLButtonElement>('.ai-entry')!.click())
    expect(onToggleAi).not.toHaveBeenCalled()
    expect(onAiPreset).not.toHaveBeenCalled()
  })

  it('has no hint entry when AI is granted (the normal four AI buttons show)', () => {
    const box = renderRibbon({ showAi: true })
    expect(box.querySelector('.ai-off')).toBeNull()
    expect(box.querySelectorAll('.ai-entry').length).toBeGreaterThan(1)
  })

  it('every locale has real copy for the reason, with no internal codes', () => {
    const dicts = appStrings as unknown as Record<string, Record<string, string>>
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(dict.aiNotEnabled, lang).toBeTruthy()
      expect(dict.aiNotEnabled, lang).not.toMatch(/UNI-|GO-\d|git/i)
      if (lang !== 'en') expect(dict.aiNotEnabled, lang).not.toBe(dicts.en!.aiNotEnabled)
    }
  })
})
