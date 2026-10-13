/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollabComposer, type CollabComposerProps } from '../src/collab/CollabComposer'
import { draftStorageKey, loadDraft, saveDraft } from '../src/collab/draft-store'
import {
  COMPOSER_STRINGS,
  ULID_A,
  candidate,
  fakeSource,
  makeHost,
  manyCandidates,
  settle,
} from './collab-composer-fixtures'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const DRAFT_KEY = { documentId: 'doc-1', threadKey: 'reply:c1' }

interface Mounted {
  props: CollabComposerProps
  onSubmit: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
  announce: ReturnType<typeof vi.fn>
  source: ReturnType<typeof fakeSource>
}

function render(over: Partial<CollabComposerProps> = {}): Mounted {
  const onSubmit = vi.fn(async () => {})
  const onCancel = vi.fn()
  const announce = vi.fn()
  const source = fakeSource([
    candidate(ULID_A, 'Minh Anh', 'minhanh@x.vn'),
    candidate('01J8X4USR0BBBBBBBBBBBBBBBB', 'Mai Hương'),
  ])
  const props: CollabComposerProps = {
    host: makeHost(),
    mode: 'reply',
    strings: COMPOSER_STRINGS,
    source,
    draftKey: DRAFT_KEY,
    onSubmit,
    onCancel,
    announce,
    ...over,
  }
  act(() => root.render(createElement(CollabComposer, props)))
  return { props, onSubmit, onCancel, announce, source }
}

const ta = () => host.querySelector('textarea')!
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
const buttonByText = (text: string) => buttons().find((b) => b.textContent === text)!
const sendBtn = () => buttonByText('Send')
const dialog = () => document.querySelector('[role=dialog]')
const listbox = () => document.querySelector('[role=listbox]')

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

function type(value: string, caret = value.length) {
  const el = ta()
  act(() => {
    el.focus()
    nativeValue.call(el, value)
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(k: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  act(() => {
    ;(document.activeElement ?? ta()).dispatchEvent(ev)
  })
  return ev
}

const sendKeys = (init: KeyboardEventInit = { ctrlKey: true }) => key('Enter', init)

async function openPicker(text = 'Nhờ @mi') {
  type(text)
  await settle(act, 150)
}

describe('labels, hint and mode', () => {
  it.each([
    ['root', 'Write a comment…'],
    ['reply', 'Write a reply…'],
    ['discussion', 'Write in the discussion…'],
  ] as const)('%s: the label is the placeholder', (mode, text) => {
    render({ mode })
    expect(ta().getAttribute('aria-label')).toBe(text)
    expect(ta().getAttribute('placeholder')).toBe(text)
  })

  it('edit: a hidden label "Edit" and no placeholder; the button says Save', () => {
    render({ mode: 'edit', initialBody: 'old text' })
    expect(ta().getAttribute('aria-label')).toBe('Edit')
    expect(ta().hasAttribute('placeholder')).toBe(false)
    expect(ta().value).toBe('old text')
    expect(buttonByText('Save')).toBeTruthy()
  })

  it('shows the send hint with the platform shortcut', () => {
    render()
    expect(host.textContent).toContain('Ctrl+Enter to send')
    act(() => root.unmount())
    root = createRoot(host)
    render({ host: makeHost({ platform: 'mac' }) })
    expect(host.textContent).toContain('⌘Enter to send')
  })
})

describe('sending', () => {
  it('Ctrl+Enter sends the trimmed body; plain Enter does not', async () => {
    const m = render()
    type('  hello  ')
    expect(key('Enter').defaultPrevented).toBe(false)
    expect(m.onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      sendKeys({ ctrlKey: true })
    })
    expect(m.onSubmit).toHaveBeenCalledWith('hello')
  })

  it('⌘+Enter sends too, and the Send button sends on click', async () => {
    const m = render()
    type('one')
    await act(async () => {
      sendKeys({ metaKey: true })
    })
    expect(m.onSubmit).toHaveBeenCalledTimes(1)
    type('two')
    await act(async () => sendBtn().click())
    expect(m.onSubmit).toHaveBeenLastCalledWith('two')
  })

  it('an empty or blank body is aria-disabled and never submitted', async () => {
    const m = render()
    expect(sendBtn().getAttribute('aria-disabled')).toBe('true')
    type('   ')
    await act(async () => {
      sendKeys()
    })
    await act(async () => sendBtn().click())
    expect(m.onSubmit).not.toHaveBeenCalled()
  })

  it('while in flight: Send is aria-disabled and says Sending…, the box is read-only, a second send is ignored', async () => {
    let finish!: () => void
    const m = render({ onSubmit: vi.fn(() => new Promise<void>((r) => (finish = r))) })
    type('hello')
    act(() => {
      sendKeys()
    })
    const btn = buttonByText('Sending…')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(ta().readOnly).toBe(true)
    act(() => {
      sendKeys()
    })
    await act(async () => btn.click())
    expect(m.props.onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(buttonByText('Send')).toBeTruthy()
  })

  it('disabledReason "sending" (host driven) shows the same Sending… state', () => {
    render({ disabledReason: 'sending' })
    type('x')
    expect(buttonByText('Sending…').getAttribute('aria-disabled')).toBe('true')
  })

  it('disabledReason "status": aria-disabled, aria-describedby the panel status line, still editable', async () => {
    const m = render({ disabledReason: 'status', statusLineId: 'panel-status' })
    type('keep me')
    expect(sendBtn().getAttribute('aria-disabled')).toBe('true')
    expect(sendBtn().getAttribute('aria-describedby')).toBe('panel-status')
    expect(ta().readOnly).toBe(false)
    await act(async () => {
      sendKeys()
    })
    expect(m.onSubmit).not.toHaveBeenCalled()
    expect(loadDraft(DRAFT_KEY)).toBe('keep me')
  })

  it('clears the box and the draft only after the server accepted', async () => {
    let accept!: () => void
    render({ onSubmit: vi.fn(() => new Promise<void>((r) => (accept = r))) })
    type('hello')
    expect(loadDraft(DRAFT_KEY)).toBe('hello')
    act(() => {
      sendKeys()
    })
    expect(loadDraft(DRAFT_KEY)).toBe('hello')
    expect(ta().value).toBe('hello')
    await act(async () => accept())
    expect(loadDraft(DRAFT_KEY)).toBeNull()
    expect(ta().value).toBe('')
  })

  it('a failed send keeps text and draft and shows collabSendFailed, linked by aria-describedby', async () => {
    const m = render({ onSubmit: vi.fn(async () => Promise.reject({ code: 'internal' })) })
    type('precious')
    await act(async () => {
      sendKeys()
    })
    expect(ta().value).toBe('precious')
    expect(loadDraft(DRAFT_KEY)).toBe('precious')
    const msg = [...host.querySelectorAll('p,div,span')].find(
      (n) => n.textContent === 'Couldn’t send. Your text is still in the box.',
    )!
    expect(msg).toBeTruthy()
    expect(ta().getAttribute('aria-describedby')!.split(' ')).toContain(msg.id)
    expect(m.announce).toHaveBeenCalledWith('Couldn’t send. Your text is still in the box.')
    // the user can press Send again, and a success removes the message
    await act(async () => sendBtn().click())
    expect(m.props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('a deleted target (conflict + comment_deleted) keeps the draft; the host shows its own line', async () => {
    render({
      onSubmit: vi.fn(async () =>
        Promise.reject({ code: 'conflict', details: { code: 'comment_deleted' } }),
      ),
    })
    type('still here')
    await act(async () => {
      sendKeys()
    })
    expect(ta().value).toBe('still here')
    expect(loadDraft(DRAFT_KEY)).toBe('still here')
    expect(host.textContent).not.toContain('Couldn’t send')
  })
})

describe('draft', () => {
  it('survives a remount of the composer', () => {
    render()
    type('half a thought')
    act(() => root.unmount())
    root = createRoot(host)
    render()
    expect(ta().value).toBe('half a thought')
  })

  it('a stored draft wins over initialBody', () => {
    saveDraft(DRAFT_KEY, 'my draft')
    render({ initialBody: 'suggestion' })
    expect(ta().value).toBe('my draft')
  })

  it('does not persist an unedited initialBody as a draft', () => {
    render({ mode: 'edit', initialBody: 'old' })
    type('old')
    expect(sessionStorage.getItem(draftStorageKey(DRAFT_KEY))).toBeNull()
    type('old!')
    expect(loadDraft(DRAFT_KEY)).toBe('old!')
  })
})

describe('Esc and cancel', () => {
  it('Esc with no draft cancels at once', () => {
    const m = render()
    key('Escape')
    expect(m.onCancel).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })

  it('Esc with a draft asks first: Discard (danger) / Keep writing, Keep writing focused', () => {
    const m = render()
    type('draft')
    key('Escape')
    expect(m.onCancel).not.toHaveBeenCalled()
    const dlg = dialog()!
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.textContent).toContain('Discard the draft?')
    expect(dlg.textContent).toContain('What you’ve written will be lost.')
    const keep = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Keep writing')!
    const discard = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!
    expect(document.activeElement).toBe(keep)
    expect(discard.hasAttribute('data-danger')).toBe(true)
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dlg.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('Keep writing closes the question and keeps text and draft', () => {
    const m = render()
    type('draft')
    key('Escape')
    act(() =>
      [...dialog()!.querySelectorAll('button')]
        .find((b) => b.textContent === 'Keep writing')!
        .click(),
    )
    expect(dialog()).toBeNull()
    expect(m.onCancel).not.toHaveBeenCalled()
    expect(ta().value).toBe('draft')
    expect(loadDraft(DRAFT_KEY)).toBe('draft')
  })

  it('Esc inside the question also keeps writing', () => {
    const m = render()
    type('draft')
    key('Escape')
    key('Escape')
    expect(dialog()).toBeNull()
    expect(m.onCancel).not.toHaveBeenCalled()
  })

  it('Discard cancels and clears the stored draft', () => {
    const m = render()
    type('draft')
    key('Escape')
    act(() =>
      [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!.click(),
    )
    expect(m.onCancel).toHaveBeenCalledTimes(1)
    expect(loadDraft(DRAFT_KEY)).toBeNull()
  })

  it('the Cancel button follows the same rule', () => {
    const m = render()
    act(() => buttonByText('Cancel').click())
    expect(m.onCancel).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    root = createRoot(host)
    const m2 = render()
    type('x')
    act(() => buttonByText('Cancel').click())
    expect(m2.onCancel).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it('edit: Esc on an unchanged body cancels, on a changed one asks', () => {
    const m = render({ mode: 'edit', initialBody: 'same' })
    key('Escape')
    expect(m.onCancel).toHaveBeenCalledTimes(1)
    type('changed')
    key('Escape')
    expect(m.onCancel).toHaveBeenCalledTimes(1)
    expect(dialog()).not.toBeNull()
  })
})

describe('AI draft label', () => {
  const LABEL = 'Draft suggested by UniWork AI. Review it, then send.'

  it('shows until the user edits', () => {
    render({ mode: 'discussion', initialBody: 'Suggested text', aiDraft: true })
    expect(host.textContent).toContain(LABEL)
    expect(ta().value).toBe('Suggested text')
    type('Suggested text, edited')
    expect(host.textContent).not.toContain(LABEL)
  })

  it('goes away once sent, and never sends by itself', async () => {
    const m = render({ mode: 'discussion', initialBody: 'Suggested text', aiDraft: true })
    expect(m.onSubmit).not.toHaveBeenCalled()
    await act(async () => sendBtn().click())
    expect(m.onSubmit).toHaveBeenCalledWith('Suggested text')
    expect(host.textContent).not.toContain(LABEL)
  })

  it('is described to assistive tech while shown', () => {
    render({ mode: 'discussion', initialBody: 'x', aiDraft: true })
    const label = [...host.querySelectorAll('p,div,span')].find((n) => n.textContent === LABEL)!
    expect(ta().getAttribute('aria-describedby')!.split(' ')).toContain(label.id)
  })

  it('is absent when not an AI draft', () => {
    render({ mode: 'discussion' })
    expect(host.textContent).not.toContain(LABEL)
  })
})

describe('mention picker in the composer', () => {
  it('has no combobox semantics while closed', () => {
    render()
    type('plain')
    expect(ta().getAttribute('role')).toBeNull()
    expect(ta().hasAttribute('aria-expanded')).toBe(false)
    expect(ta().hasAttribute('aria-controls')).toBe(false)
    expect(listbox()).toBeNull()
  })

  it('opens on @ at a word start with the full combobox contract', async () => {
    render()
    await openPicker()
    expect(ta().getAttribute('role')).toBe('combobox')
    expect(ta().getAttribute('aria-expanded')).toBe('true')
    expect(ta().getAttribute('aria-autocomplete')).toBe('list')
    const lb = listbox()!
    expect(ta().getAttribute('aria-controls')).toBe(lb.id)
    expect(lb.getAttribute('aria-label')).toBe('Mention someone')
    const opts = lb.querySelectorAll('[role=option]')
    expect(opts).toHaveLength(2)
    expect(ta().getAttribute('aria-activedescendant')).toBe(opts[0]!.id)
    expect(opts[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('does not open for an @ inside a word', async () => {
    render()
    await openPicker('mail a@b')
    expect(listbox()).toBeNull()
  })

  it('searches q = text after @ once, 150 ms after the last key', async () => {
    const m = render()
    type('@m')
    await settle(act, 100)
    type('@mi')
    await settle(act, 149)
    expect(m.source.searchMentions).not.toHaveBeenCalled()
    await settle(act, 1)
    expect(m.source.searchMentions).toHaveBeenCalledWith({ q: 'mi', limit: 20 })
  })

  it('↓ ↑ move the active option (wrapping) without moving the caret', async () => {
    render()
    await openPicker()
    const opts = () => [...listbox()!.querySelectorAll('[role=option]')]
    const down = key('ArrowDown')
    expect(down.defaultPrevented).toBe(true)
    expect(ta().getAttribute('aria-activedescendant')).toBe(opts()[1]!.id)
    key('ArrowDown')
    expect(ta().getAttribute('aria-activedescendant')).toBe(opts()[0]!.id)
    key('ArrowUp')
    expect(ta().getAttribute('aria-activedescendant')).toBe(opts()[1]!.id)
  })

  it('Enter picks: token + one space, caret after it, picker closed', async () => {
    render()
    await openPicker()
    expect(key('Enter').defaultPrevented).toBe(true)
    expect(ta().value).toBe(`Nhờ [@Minh Anh](mention://member/${ULID_A}) `)
    expect(ta().selectionStart).toBe(ta().value.length)
    expect(listbox()).toBeNull()
    expect(ta().getAttribute('role')).toBeNull()
  })

  it('Tab picks too (and keeps focus in the box)', async () => {
    render()
    await openPicker()
    key('ArrowDown')
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(ta().value).toContain('[@Mai Hương](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB) ')
    expect(document.activeElement).toBe(ta())
  })

  it('clicking an option picks it', async () => {
    render()
    await openPicker()
    act(() => (listbox()!.querySelectorAll('[role=option]')[1] as HTMLElement).click())
    expect(ta().value).toContain('[@Mai Hương](')
  })

  it('Esc closes the picker first and keeps the text; the next Esc cancels', async () => {
    const m = render()
    await openPicker('@Minh')
    const first = key('Escape')
    expect(first.defaultPrevented).toBe(true)
    expect(listbox()).toBeNull()
    expect(ta().value).toBe('@Minh')
    expect(m.onCancel).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    key('Escape')
    expect(dialog()).not.toBeNull() // the draft "@Minh" now asks before cancelling
  })

  it('a typed @Name that was not picked stays plain text when sent', async () => {
    const m = render()
    await openPicker('Thanks @Minh')
    key('Escape')
    await act(async () => {
      sendKeys()
    })
    expect(m.onSubmit).toHaveBeenCalledWith('Thanks @Minh')
  })

  it('a pasted valid token is kept and does not open the picker', async () => {
    const m = render()
    const token = `[@Nguyễn \\[An\\]](mention://member/${ULID_A})`
    type(`Xem ${token}`)
    await settle(act, 300)
    expect(listbox()).toBeNull()
    expect(ta().value).toBe(`Xem ${token}`)
    await act(async () => {
      sendKeys()
    })
    expect(m.onSubmit).toHaveBeenCalledWith(`Xem ${token}`)
  })

  it('Ctrl+Enter still sends while the picker is open', async () => {
    const m = render()
    await openPicker('hi @mi')
    await act(async () => {
      sendKeys()
    })
    expect(m.onSubmit).toHaveBeenCalledWith('hi @mi')
  })

  it('closes when the box loses focus', async () => {
    render()
    await openPicker()
    act(() => ta().blur())
    expect(listbox()).toBeNull()
  })

  it('announces the result count once through announce()', async () => {
    const m = render()
    await openPicker()
    expect(m.announce.mock.calls.filter((c) => c[0] === 'Results: 2')).toHaveLength(1)
    key('ArrowDown')
    await settle(act, 500)
    expect(m.announce.mock.calls.filter((c) => c[0] === 'Results: 2')).toHaveLength(1)
  })

  it('shows at most 20 rows', async () => {
    render({ source: fakeSource(manyCandidates(25)) })
    await openPicker()
    expect(listbox()!.querySelectorAll('[role=option]')).toHaveLength(20)
  })

  it('message rows are aria-disabled options; Enter on them does not insert anything', async () => {
    render({ source: fakeSource([]) })
    await openPicker('@zz')
    const opts = listbox()!.querySelectorAll('[role=option]')
    expect(opts).toHaveLength(1)
    expect(opts[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(ta().hasAttribute('aria-activedescendant')).toBe(false)
    key('Enter')
    expect(ta().value).toBe('@zz')
  })

  it('error: message + Retry option reachable by ↓ and Enter', async () => {
    let calls = 0
    const source = fakeSource([], async () => {
      calls++
      if (calls === 1) throw { code: 'network' }
      return { candidates: [candidate(ULID_A, 'Minh Anh')] }
    })
    render({ source })
    await openPicker('@mi')
    const opts = () => [...listbox()!.querySelectorAll('[role=option]')]
    expect(opts().map((o) => o.getAttribute('aria-disabled'))).toEqual(['true', null])
    expect(ta().getAttribute('aria-activedescendant')).toBe(opts()[1]!.id) // Retry is the only selectable row
    expect(ta().value).toBe('@mi') // typed text kept
    key('Enter')
    await settle(act, 0)
    expect(calls).toBe(2)
    expect(opts()[0]!.textContent).toContain('Minh Anh')
  })
})

describe('styles', () => {
  const css = readFileSync(new URL('../src/collab/collab-composer.css', import.meta.url), 'utf8')
  const tokens = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')

  it('uses no raw colour in a rule (custom-property definitions aside)', () => {
    const raw = css
      .split('\n')
      .filter((l) => !/^\s*--[\w-]+\s*:/.test(l))
      .filter((l) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(l))
    expect(raw).toEqual([])
  })

  it('every var(--token) it uses is defined for light and dark (or is a per-app accent)', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!))
    const perApp = new Set(['--accent', '--accent-soft', '--accent-dark'])
    const darkStart = tokens.indexOf("[data-theme='dark']")
    expect(darkStart).toBeGreaterThan(0)
    const light = tokens.slice(0, darkStart)
    const dark = tokens.slice(darkStart)
    for (const t of used) {
      if (perApp.has(t)) continue
      expect(light, `${t} in light`).toContain(`${t}:`)
      expect(dark, `${t} in dark`).toContain(`${t}:`)
    }
  })

  it('buttons and options are >= 24px, >= 44px under pointer: coarse', () => {
    const base = css.split('@media')[0]!
    expect(base).toMatch(/min-height:\s*(2[4-9]|[3-9]\d)px/)
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toContain('@media (pointer: coarse)')
    expect(coarse).toMatch(/\.collab-mention-option[^}]*min-height:\s*44px/s)
    expect(coarse).toMatch(/\.collab-composer-btn[^}]*min-height:\s*44px/s)
  })
})
