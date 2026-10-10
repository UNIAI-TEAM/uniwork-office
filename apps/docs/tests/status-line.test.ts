// A status line set in one UI language must not outlive a language switch.
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { useClearStatusOnLangChange } from '../src/renderer/status-line'

let setStatusRef: ((s: string) => void) | null = null

function Probe({ lang }: { lang: string }) {
  const [status, setStatus] = useState('')
  useClearStatusOnLangChange(lang, setStatus)
  setStatusRef = setStatus
  return createElement('span', { 'data-testid': 'status' }, status)
}

function mount(lang: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(Probe, { lang })))
  return {
    text: () => container.textContent,
    rerender: (next: string) => act(() => root.render(createElement(Probe, { lang: next }))),
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('useClearStatusOnLangChange', () => {
  it('keeps the line while the language stays the same', () => {
    const view = mount('vi')
    act(() => setStatusRef?.('Thiếu phông chữ trong tài liệu: Aptos'))
    expect(view.text()).toBe('Thiếu phông chữ trong tài liệu: Aptos')
    view.rerender('vi')
    expect(view.text()).toBe('Thiếu phông chữ trong tài liệu: Aptos')
    view.cleanup()
  })

  it('drops the line when the UI language changes', () => {
    const view = mount('vi')
    act(() => setStatusRef?.('Thiếu phông chữ trong tài liệu: Aptos'))
    view.rerender('en')
    expect(view.text()).toBe('')
    act(() => setStatusRef?.('Missing document fonts: Aptos (substitutes shown)'))
    expect(view.text()).toBe('Missing document fonts: Aptos (substitutes shown)')
    view.cleanup()
  })

  it('does not wipe a line set on the first render', () => {
    const view = mount('en')
    act(() => setStatusRef?.('Opened a.docx'))
    expect(view.text()).toBe('Opened a.docx')
    view.cleanup()
  })
})
