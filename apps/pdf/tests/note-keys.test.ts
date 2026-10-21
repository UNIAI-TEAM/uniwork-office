/**
 * UNI-2011 S-pdf: the margin-note boxes and the in-place text editor commit only
 * on Ctrl/Cmd+Enter. The table rows `pdf-21` / `pdf-24` also hold Esc, Backspace
 * and Delete, so a handler that tests the row id would commit on those keys.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentShortcutPlatform } from '@genoffice/shortcuts'
import { createI18n } from '@genoffice/i18n'
import { NoteMarginColumn, type NoteMarginThread } from '../src/renderer/NoteMargin'
import { isCommitKey, textEditKeyAction } from '../src/renderer/shortcuts'
import { strings } from '../src/renderer/i18n/strings'
import type { TFunc } from '../src/renderer/i18n/locale'
import type { NoteThreadItem } from '../src/renderer/note-threads'

// the margin measures its cards; jsdom has no ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const translate = createI18n(strings)
const t: TFunc = (key, params) => translate('en', key, params)

const keydown = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

/** the chord's own modifier: Cmd on a Mac, Ctrl elsewhere */
const commitMod = (): KeyboardEventInit =>
  currentShortcutPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }

const ENTER_COMMIT = (): KeyboardEvent => keydown({ key: 'Enter', code: 'Enter', ...commitMod() })
const ESC = (): KeyboardEvent => keydown({ key: 'Escape', code: 'Escape' })
const BACKSPACE = (): KeyboardEvent => keydown({ key: 'Backspace', code: 'Backspace' })
const DELETE = (): KeyboardEvent => keydown({ key: 'Delete', code: 'Delete' })
const PLAIN_ENTER = (): KeyboardEvent => keydown({ key: 'Enter', code: 'Enter' })

const mounted: Array<{ root: Root; container: HTMLElement }> = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

function item(key: string, contents: string): NoteThreadItem {
  return {
    key,
    saved: null,
    pendingId: key,
    author: 'An',
    contents,
    timeMs: 0,
    color: null,
    at: [0, 0],
    replies: [],
  }
}

interface Handlers {
  onReply: ReturnType<typeof vi.fn>
  onEditSubmit: ReturnType<typeof vi.fn>
  onEditCancel: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onDraftConfirm: ReturnType<typeof vi.fn>
  onDraftCancel: ReturnType<typeof vi.fn>
}

function mountColumn(opts: { draft?: boolean; editing?: boolean }): {
  container: HTMLElement
  h: Handlers
} {
  const h: Handlers = {
    onReply: vi.fn(),
    onEditSubmit: vi.fn(),
    onEditCancel: vi.fn(),
    onClose: vi.fn(),
    onDraftConfirm: vi.fn(),
    onDraftCancel: vi.fn(),
  }
  const root = item('P1', 'first')
  const thread: NoteMarginThread = { origIdx: 0, root, pinX: -10, pinY: 20 }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = createRoot(container)
  mounted.push({ root: reactRoot, container })
  const noop = () => undefined
  act(() =>
    reactRoot.render(
      createElement(NoteMarginColumn, {
        width: 280,
        threads: opts.draft ? [] : [thread],
        draft: opts.draft
          ? { placementKey: 'p', origIdx: 0, pinX: -10, pinY: 20, color: [1, 0.78, 0.13] }
          : null,
        activeKey: opts.draft ? null : 'P1',
        author: 'An',
        lang: 'en',
        readOnly: false,
        t,
        onActivate: noop,
        onReply: h.onReply,
        editingKey: opts.editing ? 'P1' : null,
        editingText: opts.editing ? 'edited' : '',
        onEditStart: noop,
        onEditChange: noop,
        onEditCancel: h.onEditCancel,
        onEditSubmit: h.onEditSubmit,
        onDeleteItem: noop,
        onClose: h.onClose,
        onDraftConfirm: h.onDraftConfirm,
        onDraftCancel: h.onDraftCancel,
      }),
    ),
  )
  return { container, h }
}

/** type into a controlled textarea the way a browser does */
function type(area: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(area: HTMLTextAreaElement, event: KeyboardEvent): KeyboardEvent {
  act(() => {
    area.dispatchEvent(event)
  })
  return event
}

describe('draft note box (NoteDraftCard)', () => {
  const area = (container: HTMLElement): HTMLTextAreaElement => {
    const el = container.querySelector<HTMLTextAreaElement>('.pdf-note-draft-box textarea')
    if (!el) throw new Error('no draft textarea')
    return el
  }

  it('Esc cancels the draft and does not post the typed text', () => {
    const { container, h } = mountColumn({ draft: true })
    type(area(container), 'hello')
    const esc = press(area(container), ESC())
    expect(h.onDraftCancel).toHaveBeenCalledTimes(1)
    expect(h.onDraftConfirm).not.toHaveBeenCalled()
    expect(esc.defaultPrevented).toBe(true)
  })

  it('Backspace, Delete and a plain Enter edit the text and commit nothing', () => {
    const { container, h } = mountColumn({ draft: true })
    type(area(container), 'hello')
    for (const ev of [BACKSPACE(), DELETE(), PLAIN_ENTER()]) {
      expect(press(area(container), ev).defaultPrevented).toBe(false)
    }
    expect(h.onDraftConfirm).not.toHaveBeenCalled()
    expect(h.onDraftCancel).not.toHaveBeenCalled()
  })

  it('Ctrl/Cmd+Enter posts the text', () => {
    const { container, h } = mountColumn({ draft: true })
    type(area(container), 'hello')
    press(area(container), ENTER_COMMIT())
    expect(h.onDraftConfirm).toHaveBeenCalledWith('hello')
    expect(h.onDraftCancel).not.toHaveBeenCalled()
  })
})

describe('reply box (NoteCard)', () => {
  const area = (container: HTMLElement): HTMLTextAreaElement => {
    const el = container.querySelector<HTMLTextAreaElement>('.pdf-note-reply-box textarea')
    if (!el) throw new Error('no reply textarea')
    return el
  }

  it('Esc closes the thread without posting the reply', () => {
    const { container, h } = mountColumn({})
    type(area(container), 'reply')
    press(area(container), ESC())
    expect(h.onClose).toHaveBeenCalledTimes(1)
    expect(h.onReply).not.toHaveBeenCalled()
  })

  it('Backspace and Delete edit the reply and post nothing', () => {
    const { container, h } = mountColumn({})
    type(area(container), 'reply')
    expect(press(area(container), BACKSPACE()).defaultPrevented).toBe(false)
    expect(press(area(container), DELETE()).defaultPrevented).toBe(false)
    expect(h.onReply).not.toHaveBeenCalled()
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('Ctrl/Cmd+Enter posts the reply', () => {
    const { container, h } = mountColumn({})
    type(area(container), 'reply')
    press(area(container), ENTER_COMMIT())
    expect(h.onReply).toHaveBeenCalledWith(expect.anything(), 'reply')
    expect(h.onClose).not.toHaveBeenCalled()
  })
})

describe('edit box (NoteCard rewriting a comment)', () => {
  const area = (container: HTMLElement): HTMLTextAreaElement => {
    const el = container.querySelector<HTMLTextAreaElement>('.pdf-note-edit-box textarea')
    if (!el) throw new Error('no edit textarea')
    return el
  }

  it('Esc cancels the edit', () => {
    const { container, h } = mountColumn({ editing: true })
    press(area(container), ESC())
    expect(h.onEditCancel).toHaveBeenCalledTimes(1)
    expect(h.onEditSubmit).not.toHaveBeenCalled()
  })

  it('Backspace and Delete edit the text and submit nothing', () => {
    const { container, h } = mountColumn({ editing: true })
    expect(press(area(container), BACKSPACE()).defaultPrevented).toBe(false)
    expect(press(area(container), DELETE()).defaultPrevented).toBe(false)
    expect(h.onEditSubmit).not.toHaveBeenCalled()
    expect(h.onEditCancel).not.toHaveBeenCalled()
  })

  it('Ctrl/Cmd+Enter submits the edit', () => {
    const { container, h } = mountColumn({ editing: true })
    press(area(container), ENTER_COMMIT())
    expect(h.onEditSubmit).toHaveBeenCalledTimes(1)
    expect(h.onEditCancel).not.toHaveBeenCalled()
  })
})

describe('isCommitKey', () => {
  it('is the chord Enter with Ctrl (win) or Cmd (mac), nothing else of the row', () => {
    const enter = { key: 'Enter', code: 'Enter' }
    const ctrl = keydown({ ...enter, ctrlKey: true })
    const cmd = keydown({ ...enter, metaKey: true })
    expect(isCommitKey(ctrl, 'note', 'win', 'desktop')).toBe(true)
    expect(isCommitKey(cmd, 'note', 'win', 'desktop')).toBe(false)
    expect(isCommitKey(cmd, 'note', 'mac', 'desktop')).toBe(true)
    expect(isCommitKey(ctrl, 'note', 'mac', 'desktop')).toBe(false)
    expect(isCommitKey(ctrl, 'text-edit', 'win', 'web')).toBe(true)
    expect(isCommitKey(keydown(enter), 'note', 'win', 'desktop')).toBe(false)
    for (const key of ['Escape', 'Backspace', 'Delete']) {
      expect(
        isCommitKey(keydown({ key, code: key, ctrlKey: true }), 'text-edit', 'win', 'desktop'),
      ).toBe(false)
      expect(isCommitKey(keydown({ key, code: key }), 'text-edit', 'win', 'desktop')).toBe(false)
    }
  })

  it('refuses an IME composition and a context that does not own the chord', () => {
    const enter = { key: 'Enter', code: 'Enter', ctrlKey: true }
    expect(isCommitKey(keydown({ ...enter, isComposing: true }), 'note', 'win', 'desktop')).toBe(
      false,
    )
    expect(isCommitKey(keydown(enter), 'dialog', 'win', 'desktop')).toBe(false)
  })
})

describe('textEditKeyAction (the in-place text editor)', () => {
  const act1 = (event: KeyboardEvent, empty = false) => textEditKeyAction(event, empty)

  it('Ctrl/Cmd+Enter commits', () => {
    expect(act1(ENTER_COMMIT())).toBe('commit')
    expect(act1(ENTER_COMMIT(), true)).toBe('commit')
  })

  it('Esc cancels, even on an empty draft', () => {
    expect(act1(ESC())).toBe('cancel')
    expect(act1(ESC(), true)).toBe('cancel')
  })

  it('Backspace and Delete edit the text; only on an empty draft they delete the run', () => {
    expect(act1(BACKSPACE())).toBeNull()
    expect(act1(DELETE())).toBeNull()
    expect(act1(BACKSPACE(), true)).toBe('delete-run')
    expect(act1(DELETE(), true)).toBe('delete-run')
  })

  it('a plain Enter and an IME key do nothing', () => {
    expect(act1(PLAIN_ENTER())).toBeNull()
    expect(act1(keydown({ key: 'Escape', isComposing: true }))).toBeNull()
    expect(act1(keydown({ key: 'Backspace', keyCode: 229 }), true)).toBeNull()
  })
})
