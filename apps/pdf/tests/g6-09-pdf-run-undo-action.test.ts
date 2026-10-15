// Small pieces around a PDF AI run (G6-09 fix r1): the "Undo this run" note ids stay unique
// (RFB-6) and the paused-edits notice shows while a run is open (RFB-2).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { RunUndoAction } from '../src/renderer/ai/RunUndoAction'
import { EditsPausedNotice } from '../src/renderer/ai/EditsPausedNotice'

describe('pdf run undo pieces', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
  })

  function mount(node: ReturnType<typeof createElement>, lang = 'en') {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(createElement(LocaleProvider, { initial: lang }, node)))
    return container
  }

  it('gives two blocked actions whose run ids differ only in odd characters their own note ids', () => {
    const el = mount(
      createElement('div', null, [
        createElement(RunUndoAction, {
          key: 'a',
          runId: 'run:1!a',
          state: 'later',
          busy: false,
          onUndo: () => {},
        }),
        createElement(RunUndoAction, {
          key: 'b',
          runId: 'run:1?a',
          state: 'later',
          busy: false,
          onUndo: () => {},
        }),
      ]),
    )
    const buttons = [...el.querySelectorAll('button')]
    const ids = buttons.map((b) => b.getAttribute('aria-describedby'))
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) {
      const note = el.querySelector(`[id="${id}"]`)
      expect(note?.textContent).toContain('Later changes sit on top')
    }
  })

  it('has no run id in the note id', () => {
    const el = mount(
      createElement(RunUndoAction, {
        runId: 'run-secret-7',
        state: 'later',
        busy: false,
        onUndo: () => {},
      }),
    )
    const id = el.querySelector('button')!.getAttribute('aria-describedby')!
    expect(id).not.toContain('run-secret-7')
  })

  it('shows the paused-edits reason while a run is open, in vi and en', () => {
    const en = mount(createElement(EditsPausedNotice, { active: true }))
    const note = en.querySelector('[role="status"]')
    expect(note?.textContent).toBe(
      'The assistant is editing this document. Your edits are paused; stop the assistant to continue.',
    )
    act(() => root!.unmount())
    container!.remove()
    const vi = mount(createElement(EditsPausedNotice, { active: true }), 'vi')
    expect(vi.querySelector('[role="status"]')?.textContent).toBe(
      'Trợ lý đang chỉnh sửa tài liệu này. Bạn tạm thời không sửa được; hãy dừng trợ lý để tiếp tục.',
    )
  })

  it('renders nothing when no run is open', () => {
    const el = mount(createElement(EditsPausedNotice, { active: false }))
    expect(el.querySelector('[role="status"]')).toBeNull()
  })
})
