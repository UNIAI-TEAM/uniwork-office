/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { AiSaveDraftCard } from '../src/AiSaveDraftCard'
import { AI_SAVE_DRAFT_LABELS } from '../src/strings-ai-save-draft'

// After an AI run on an untitled document the apps ask before anything is written (G6-09 W8):
// one inline card under the answer, never a modal, nothing saved before the click.

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const render = (props: Parameters<typeof AiSaveDraftCard>[0]) =>
  act(() => root.render(createElement(AiSaveDraftCard, props)))
const buttons = () => [...host.querySelectorAll('button')]

describe('AiSaveDraftCard', () => {
  it('asks one question, names the file, and offers Save and Not now', () => {
    render({ lang: 'en', name: 'Quarterly plan', onSave: vi.fn(), onLater: vi.fn() })
    const group = host.querySelector('[role="group"]')!
    expect(group).not.toBeNull()
    expect(host.textContent).toContain('Save this document?')
    expect(host.textContent).toContain('Save as Quarterly plan')
    expect(buttons().map((b) => b.textContent)).toEqual(['Save', 'Not now'])
    // the group is named by its question (Accessibility Floor), not by an internal code
    const labelledBy = group.getAttribute('aria-labelledby')!
    expect(document.getElementById(labelledBy)?.textContent).toBe('Save this document?')
    // never a modal
    expect(host.querySelector('[role="dialog"], [aria-modal]')).toBeNull()
  })

  it('Save and Not now each call their handler once; nothing fires on render', () => {
    const onSave = vi.fn()
    const onLater = vi.fn()
    render({ lang: 'en', name: 'x', onSave, onLater })
    expect(onSave).not.toHaveBeenCalled()
    expect(onLater).not.toHaveBeenCalled()
    act(() => buttons()[0]!.click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onLater).not.toHaveBeenCalled()
    act(() => buttons()[1]!.click())
    expect(onLater).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not take focus when it appears, and its buttons are plain keyboard-reachable buttons', () => {
    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()
    render({ lang: 'en', name: 'x', onSave: vi.fn(), onLater: vi.fn() })
    expect(document.activeElement).toBe(outside)
    for (const b of buttons()) {
      expect(b.getAttribute('type')).toBe('button')
      expect(b.tabIndex).toBeGreaterThanOrEqual(0)
    }
    outside.remove()
  })

  it('reads naturally in Vietnamese', () => {
    render({ lang: 'vi', name: 'Kế hoạch quý', onSave: vi.fn(), onLater: vi.fn() })
    expect(host.textContent).toContain('Lưu tài liệu này?')
    expect(host.textContent).toContain('Lưu với tên Kế hoạch quý')
    expect(buttons().map((b) => b.textContent)).toEqual(['Lưu', 'Để sau'])
  })

  it('leaves out the file line when no name could be derived', () => {
    render({ lang: 'en', name: '', onSave: vi.fn(), onLater: vi.fn() })
    expect(host.textContent).toContain('Save this document?')
    expect(host.textContent).not.toContain('Save as')
    expect(buttons()).toHaveLength(2)
  })

  it('has every key in every locale, with no internal code or git word in the copy', () => {
    for (const lang of LANGS) {
      const labels = AI_SAVE_DRAFT_LABELS[lang]
      expect(labels, lang).toBeDefined()
      for (const text of [labels.question, labels.saveAs('Name'), labels.save, labels.later]) {
        expect(text.trim(), lang).not.toBe('')
        expect(text, lang).not.toMatch(/G6-|UNI-\d|\bgit\b|github/i)
      }
      expect(labels.saveAs('Name'), lang).toContain('Name')
    }
  })
})
