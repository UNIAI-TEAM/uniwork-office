// A status line set in one UI language must not outlive a language switch:
// key + params lines re-translate at render, ready strings are dropped.
import { afterEach, describe, expect, it } from 'vitest'
import { setModuleLang, statusText, t } from '../src/renderer/i18n/locale'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { useClearStatusOnLangChange } from '../src/renderer/status-line'

afterEach(() => setModuleLang('zh'))

describe('status-bar line kept as key + params', () => {
  it('is translated when drawn, so a language switch rewrites an "Opened …" line', () => {
    const line = { key: 'appOpenedFile', params: { name: 'Docx Simple.docx' } } as const
    setModuleLang('en')
    expect(statusText(line, t)).toBe('Opened Docx Simple.docx')
    setModuleLang('vi')
    expect(statusText(line, t)).toBe('Đã mở Docx Simple.docx')
  })

  it('passes ready text through unchanged', () => {
    setModuleLang('vi')
    expect(statusText('Đã lưu', t)).toBe('Đã lưu')
  })
})

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

describe('language switch with a key + params line (App wiring)', () => {
  it('keeps a key line, which re-translates, and drops a ready string', () => {
    type Line = Parameters<typeof statusText>[0]
    let set: ((s: Line) => void) | null = null
    function KeyProbe({ lang }: { lang: string }) {
      const [line, setLine] = useState<Line>('')
      useClearStatusOnLangChange(lang, () =>
        setLine((cur) => (typeof cur === 'string' ? '' : cur)),
      )
      set = setLine
      return createElement('span', null, statusText(line, t))
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    setModuleLang('vi')
    act(() => root.render(createElement(KeyProbe, { lang: 'vi' })))
    act(() => set?.({ key: 'appOpenedFile', params: { name: 'a.docx' } }))
    expect(container.textContent).toBe('Đã mở a.docx')
    setModuleLang('en')
    act(() => root.render(createElement(KeyProbe, { lang: 'en' })))
    expect(container.textContent).toBe('Opened a.docx')
    act(() => set?.('Đã lưu'))
    setModuleLang('vi')
    act(() => root.render(createElement(KeyProbe, { lang: 'vi' })))
    expect(container.textContent).toBe('')
    act(() => root.unmount())
    container.remove()
  })
})
