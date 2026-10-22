// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import type { AskUniModelSelection } from '../src/renderer/src/askuni-v2/model-choice'
import {
  AskUniComposer,
  type AskUniComposerProps,
} from '../src/renderer/src/askuni-v2/AskUniComposer'
import type {
  AskUniLookupItem,
  AskUniLookupRequest,
  AskUniLookupResult,
  AskUniObjectKind,
} from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SELECTION: AskUniModelSelection = {
  status: 'ready',
  enabled: [],
  autoModel: '',
  model: '',
  effort: '',
  setModel: vi.fn(),
  setEffort: vi.fn(),
}

const DATA: Partial<Record<AskUniObjectKind, AskUniLookupItem[]>> = {
  member: [
    { kind: 'member', id: 'u1', title: 'Lan Nguyen' },
    { kind: 'member', id: 'u2', title: 'Minh Tran' },
  ],
  task: [{ kind: 'task', id: 't1', title: 'Fix invoice export' }],
  document: [{ kind: 'document', id: 'd1', title: 'Budget 2026.docx' }],
  project: [{ kind: 'project', id: 'p1', title: 'Website relaunch' }],
}

describe('Ask UNI v2 composer', () => {
  let host: HTMLDivElement
  let root: Root
  let lookup: ReturnType<typeof vi.fn<(req: AskUniLookupRequest) => Promise<AskUniLookupResult>>>
  let onSend: ReturnType<typeof vi.fn<AskUniComposerProps['onSend']>>
  let onStop: ReturnType<typeof vi.fn<() => void>>

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
  }
  async function mount(
    over: Partial<AskUniComposerProps> = {},
    lang: 'en' | 'vi' = 'en',
  ): Promise<void> {
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: lang,
          children: h(AskUniComposer, {
            workspaceId: 'ws-1',
            streaming: false,
            selection: SELECTION,
            onSend,
            onStop,
            ...over,
          }),
        }),
      )
    })
    await flush()
  }
  const box = () => host.querySelector('textarea') as HTMLTextAreaElement
  const sendBtn = () =>
    host.querySelector(`button[aria-label="${en.askUniSend}"]`) as HTMLButtonElement | null
  const stopBtn = () =>
    host.querySelector(`button[aria-label="${en.askUniStop}"]`) as HTMLButtonElement | null
  const options = () => [...host.querySelectorAll('[role="option"]')] as HTMLElement[]

  async function type(value: string, caret = value.length): Promise<void> {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        box(),
        value,
      )
      box().setSelectionRange(caret, caret)
      box().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
  }
  async function key(k: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
    await act(async () => {
      box().dispatchEvent(ev)
    })
    return ev
  }
  async function pickFromScope(title: string): Promise<void> {
    const plus = host.querySelector(`button[aria-label="${en.askUniV2ScopeAdd}"]`) as HTMLElement
    await act(async () => plus.click())
    await flush()
    const opt = options().find((o) => o.textContent?.includes(title)) as HTMLElement
    await act(async () => opt.click())
    await flush()
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onSend = vi.fn()
    onStop = vi.fn()
    lookup = vi.fn(async (req) => ({ ok: true as const, items: DATA[req.kind] ?? [] }))
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      askUniLookup: lookup,
      setLanguage: vi.fn(async () => undefined),
    }
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('sending', () => {
    it('Enter sends the trimmed question and clears the box', async () => {
      await mount()
      await type('  What is due today?  ')
      const ev = await key('Enter')
      expect(ev.defaultPrevented).toBe(true)
      expect(onSend).toHaveBeenCalledTimes(1)
      expect(onSend.mock.calls[0]![0]).toMatchObject({
        question: 'What is due today?',
        locale: 'en',
      })
      expect(box().value).toBe('')
    })

    it('Shift+Enter is a new line, not a send', async () => {
      await mount()
      await type('line one')
      const ev = await key('Enter', { shiftKey: true })
      expect(ev.defaultPrevented).toBe(false)
      expect(onSend).not.toHaveBeenCalled()
    })

    it('Enter while an IME is composing does not send', async () => {
      await mount()
      await type('xin chao')
      await key('Enter', { isComposing: true })
      await key('Enter', { keyCode: 229 })
      expect(onSend).not.toHaveBeenCalled()
      expect(box().value).toBe('xin chao')
    })

    it('does not send an empty or blank question', async () => {
      await mount()
      expect(sendBtn()!.disabled).toBe(true)
      await type('   ')
      await key('Enter')
      expect(onSend).not.toHaveBeenCalled()
      expect(sendBtn()!.disabled).toBe(true)
    })

    it('the Send button sends too', async () => {
      await mount()
      await type('hello')
      expect(sendBtn()!.disabled).toBe(false)
      await act(async () => sendBtn()!.click())
      expect(onSend).toHaveBeenCalledTimes(1)
    })

    it('sends the locale of the UI: vi for Vietnamese, en for everything else', async () => {
      await mount({}, 'vi')
      await type('Task nào quá hạn?')
      await key('Enter')
      expect(onSend.mock.calls[0]![0].locale).toBe('vi')
    })

    it('has a labelled textarea and the web placeholder', async () => {
      await mount()
      expect(box().getAttribute('aria-label')).toBe(en.askUniV2ComposerLabel)
      expect(box().placeholder).toBe(en.askUniPlaceholder)
    })
  })

  describe('limits and paste', () => {
    it('caps the question at 2000 characters', async () => {
      await mount()
      expect(box().maxLength).toBe(2000)
    })

    it('shows the counter only from 1800 characters', async () => {
      await mount()
      await type('a'.repeat(1799))
      expect(host.textContent).not.toContain('1799/2000')
      await type('a'.repeat(1800))
      expect(host.textContent).toContain(
        en.askUniCounter.replace('{used}', '1800').replace('{max}', '2000'),
      )
    })

    function paste(data: Record<string, string>): ClipboardEvent {
      const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
      Object.defineProperty(ev, 'clipboardData', {
        value: { getData: (t: string) => data[t] ?? '', types: Object.keys(data) },
      })
      return ev
    }

    it('pastes as plain text at the caret, never the HTML flavour', async () => {
      await mount()
      await type('ab', 1)
      const ev = paste({ 'text/plain': 'XY', 'text/html': '<b>XY</b>' })
      await act(async () => {
        box().dispatchEvent(ev)
      })
      expect(ev.defaultPrevented).toBe(true)
      expect(box().value).toBe('aXYb')
    })

    it('trims a paste that would pass the cap', async () => {
      await mount()
      await type('a'.repeat(1995))
      await act(async () => {
        box().dispatchEvent(paste({ 'text/plain': 'b'.repeat(50) }))
      })
      expect(box().value.length).toBe(2000)
    })

    it('ignores a paste with no text (nothing is inserted)', async () => {
      await mount()
      const ev = paste({ 'image/png': 'x' })
      await act(async () => {
        box().dispatchEvent(ev)
      })
      expect(ev.defaultPrevented).toBe(true)
      expect(box().value).toBe('')
    })
  })

  describe('streaming', () => {
    it('swaps Send for Stop and disables the box while a turn streams', async () => {
      await mount({ streaming: true })
      expect(box().disabled).toBe(true)
      expect(sendBtn()).toBeNull()
      expect(stopBtn()).not.toBeNull()
      await act(async () => stopBtn()!.click())
      expect(onStop).toHaveBeenCalledTimes(1)
    })

    it('disables the scope and model pickers while streaming', async () => {
      await mount({ streaming: true })
      const plus = host.querySelector(
        `button[aria-label="${en.askUniV2ScopeAdd}"]`,
      ) as HTMLButtonElement
      expect(plus.disabled).toBe(true)
      expect(
        (host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    it('moves focus to Stop when a turn starts and back to the box when it ends', async () => {
      await mount()
      box().focus()
      await mount({ streaming: true })
      expect(document.activeElement).toBe(stopBtn())
      await mount({ streaming: false })
      expect(document.activeElement).toBe(box())
    })

    it('does not steal focus back when the reader moved elsewhere', async () => {
      await mount({ streaming: true })
      const other = document.createElement('button')
      document.body.appendChild(other)
      other.focus()
      await mount({ streaming: false })
      expect(document.activeElement).toBe(other)
      other.remove()
    })

    it('never sends while streaming', async () => {
      await mount({ streaming: true })
      await key('Enter')
      expect(onSend).not.toHaveBeenCalled()
    })
  })

  describe('scope chip', () => {
    it('a picked scope shows as a chip above the box and is sent as the focus', async () => {
      await mount()
      await pickFromScope('Website relaunch')
      const chip = host.querySelector('[data-chip="focus"]') as HTMLElement
      expect(chip.textContent).toContain(`${en.askUniV2KindProject}: Website relaunch`)
      await type('How is it going?')
      await key('Enter')
      expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: 'project', id: 'p1' })
      // the focus stays for the next question until it is removed (web P2)
      expect(host.querySelector('[data-chip="focus"]')).not.toBeNull()
    })

    it('removes the chip with its button, naming it', async () => {
      await mount()
      await pickFromScope('Budget 2026.docx')
      const name = `${en.askUniV2KindDocument}: Budget 2026.docx`
      const remove = host.querySelector(
        `button[aria-label="${en.askUniV2ScopeRemove.replace('{name}', name)}"]`,
      ) as HTMLElement
      await act(async () => remove.click())
      expect(host.querySelector('[data-chip="focus"]')).toBeNull()
      await type('x')
      await key('Enter')
      expect(onSend.mock.calls[0]![0].focus).toBeUndefined()
    })

    it('takes a pending focus once (the document entry) and reports it consumed', async () => {
      const consumed = vi.fn()
      await mount({
        pendingFocus: { kind: 'document', id: 'doc-7', label: 'Q3 plan.docx' },
        onPendingFocusConsumed: consumed,
      })
      expect(host.querySelector('[data-chip="focus"]')?.textContent).toContain('Q3 plan.docx')
      expect(consumed).toHaveBeenCalledTimes(1)
      await type('Summarise')
      await key('Enter')
      expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: 'document', id: 'doc-7' })
    })

    it('shows just the kind when the pending focus has no label', async () => {
      await mount({ pendingFocus: { kind: 'meeting', id: 'm-1' }, onPendingFocusConsumed: vi.fn() })
      expect(host.querySelector('[data-chip="focus"]')?.textContent).toContain(
        en.askUniV2KindMeeting,
      )
    })
  })

  describe('@ mentions', () => {
    it('typing @ opens the mention picker and names the box as its combobox', async () => {
      await mount()
      await type('Ask @')
      expect(host.querySelector('[role="listbox"]')).not.toBeNull()
      expect(box().getAttribute('role')).toBe('combobox')
      expect(box().getAttribute('aria-expanded')).toBe('true')
      expect(box().getAttribute('aria-controls')).toBe(host.querySelector('[role="listbox"]')!.id)
    })

    it('an @ inside a word (an email) does not open it', async () => {
      await mount()
      await type('mail me at lan@')
      expect(host.querySelector('[role="listbox"]')).toBeNull()
    })

    it('Enter picks the highlighted person instead of sending, and inserts @name', async () => {
      await mount()
      await type('Ask @')
      await key('Enter')
      expect(onSend).not.toHaveBeenCalled()
      expect(box().value).toBe('Ask @Lan Nguyen ')
      expect(host.querySelector('[data-chip="mention"]')?.textContent).toContain('Lan Nguyen')
      await key('Enter')
      expect(onSend).toHaveBeenCalledTimes(1)
      expect(onSend.mock.calls[0]![0].mentions).toEqual([{ kind: 'member', id: 'u1' }])
    })

    it('Escape closes the picker and the text stays', async () => {
      await mount()
      await type('Ask @')
      await key('Escape')
      expect(host.querySelector('[role="listbox"]')).toBeNull()
      expect(box().value).toBe('Ask @')
    })

    it('removes a mention chip with its button', async () => {
      await mount()
      await type('@')
      await key('Enter')
      const remove = host.querySelector(
        `button[aria-label="${en.askUniV2MentionRemove.replace('{name}', 'Lan Nguyen')}"]`,
      ) as HTMLElement
      await act(async () => remove.click())
      expect(host.querySelector('[data-chip="mention"]')).toBeNull()
    })

    it('does not add the same object twice', async () => {
      await mount()
      await type('@')
      await key('Enter')
      await type('and again @', 'and again @'.length)
      await key('Enter')
      expect(host.querySelectorAll('[data-chip="mention"]')).toHaveLength(1)
    })

    it('allows at most five mentions and says so', async () => {
      const members = Array.from({ length: 7 }, (_, i) => ({
        kind: 'member' as const,
        id: `u${i}`,
        title: `Person ${i}`,
      }))
      lookup.mockImplementation(async (req) => ({
        ok: true,
        items:
          req.kind === 'member'
            ? members
            : req.kind === 'task'
              ? [{ kind: 'task' as const, id: 't9', title: 'Plan the launch' }]
              : [],
      }))
      await mount()
      for (let i = 0; i < 5; i++) {
        await type('@')
        for (let j = 0; j < i; j++) await key('ArrowDown')
        await key('Enter')
        await type('')
      }
      expect(host.querySelectorAll('[data-chip="mention"]')).toHaveLength(5)
      // a sixth distinct object (a task, found with a query) is refused
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await type('@p')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      for (let j = 0; j < 5; j++) await key('ArrowDown')
      await key('Enter')
      expect(host.querySelectorAll('[data-chip="mention"]')).toHaveLength(5)
      expect(host.textContent).toContain(en.askUniV2MentionLimit.replace('{max}', '5'))
    })

    it('chips clear after a send, the picker can open again for the next question', async () => {
      await mount()
      await type('@')
      await key('Enter')
      await key('Enter')
      expect(host.querySelector('[data-chip="mention"]')).toBeNull()
      await type('@')
      expect(host.querySelector('[role="listbox"]')).not.toBeNull()
    })
  })

  describe('layout hooks', () => {
    it('keeps the box in a composer region with the pickers on one row', async () => {
      await mount()
      const region = host.querySelector('[data-slot="askuni-composer"]') as HTMLElement
      expect(region).not.toBeNull()
      const row = region.querySelector('.askuni2-composer-row') as HTMLElement
      const plus = row.querySelector(`button[aria-label="${en.askUniV2ScopeAdd}"]`)
      expect(plus).not.toBeNull()
      expect(row.querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
      expect(row.querySelector(`button[aria-label="${en.askUniSend}"]`)).not.toBeNull()
      // "+" comes first, model picker then send last
      expect(row.firstElementChild?.contains(plus)).toBe(true)
    })

    it('focuses the box when a conversation is chosen', async () => {
      await mount({ conversationId: null })
      const other = document.createElement('button')
      document.body.appendChild(other)
      other.focus()
      await mount({ conversationId: 'conv-2' })
      expect(document.activeElement).toBe(box())
      other.remove()
    })
  })
})
