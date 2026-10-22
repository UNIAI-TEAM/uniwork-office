/** @vitest-environment jsdom */
import { act, createElement as h, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskUniAdapterProvider, AskUniComposerBox } from '../src/ask-uni'
import { fakeAdapter } from './ask-uni-kit'

// The plain composer box shared by Home and the editors: Enter / Shift+Enter / IME, plain-text paste,
// the 2000 cap with its counter, Send/Stop, and focus that follows a running turn. The host owns
// the value; picker and chip extras plug in through slots.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Handlers {
  onSend: ReturnType<typeof vi.fn<(value: string) => void>>
  onStop: ReturnType<typeof vi.fn<() => void>>
}

describe('AskUniComposerBox', () => {
  let host: HTMLDivElement
  let root: Root
  let fn: Handlers
  let carets: number[]

  function Harness(props: {
    initial?: string
    streaming?: boolean
    extra?: Record<string, unknown>
  }) {
    const [value, setValue] = useState(props.initial ?? '')
    const nextCaret = useRef<number | null>(null)
    return h(AskUniComposerBox, {
      value,
      streaming: props.streaming ?? false,
      onValueChange: (v: string, c: number) => {
        carets.push(c)
        setValue(v)
      },
      onSend: () => {
        fn.onSend(value)
        setValue('')
      },
      onStop: fn.onStop,
      nextCaretRef: nextCaret,
      ...props.extra,
    })
  }

  async function mount(props: Parameters<typeof Harness>[0] = {}): Promise<void> {
    await act(async () => {
      root.render(
        h(AskUniAdapterProvider, {
          adapter: fakeAdapter().adapter,
          children: h(Harness, props),
        }),
      )
    })
  }

  const box = () => host.querySelector('textarea') as HTMLTextAreaElement
  const send = () => host.querySelector('button[aria-label="Send"]') as HTMLButtonElement | null
  const stop = () => host.querySelector('button[aria-label="Stop"]') as HTMLButtonElement | null
  const type = async (el: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const key = async (init: KeyboardEventInit & { keyCode?: number }) => {
    await act(async () => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode })
      box().dispatchEvent(e)
    })
  }
  const paste = async (text: string, from: number, to: number) => {
    await act(async () => {
      box().setSelectionRange(from, to)
      const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { getData: (t: string) => string }
      }
      e.clipboardData = { getData: (t) => (t === 'text/plain' ? text : '') }
      box().dispatchEvent(e)
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    carets = []
    fn = { onSend: vi.fn(), onStop: vi.fn() }
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  describe('keys', () => {
    it('Enter sends the question and the host clears the box', async () => {
      await mount()
      await type(box(), 'What is blocked?')
      await key({ key: 'Enter' })
      expect(fn.onSend).toHaveBeenCalledExactlyOnceWith('What is blocked?')
      expect(box().value).toBe('')
    })

    it('Shift+Enter does not send (it breaks the line)', async () => {
      await mount()
      await type(box(), 'line one')
      await key({ key: 'Enter', shiftKey: true })
      expect(fn.onSend).not.toHaveBeenCalled()
    })

    it("an IME's Enter never sends, by isComposing or by keyCode 229", async () => {
      await mount()
      await type(box(), 'に')
      await key({ key: 'Enter', isComposing: true })
      await key({ key: 'Enter', keyCode: 229 })
      expect(fn.onSend).not.toHaveBeenCalled()
    })

    it('Enter on a blank box sends nothing', async () => {
      await mount()
      await type(box(), '   ')
      await key({ key: 'Enter' })
      expect(fn.onSend).not.toHaveBeenCalled()
    })

    it('the Send button follows the box: disabled while blank, sends on click', async () => {
      await mount()
      expect(send()?.disabled).toBe(true)
      await type(box(), 'Hello')
      expect(send()?.disabled).toBe(false)
      await act(async () => send()!.click())
      expect(fn.onSend).toHaveBeenCalledExactlyOnceWith('Hello')
    })
  })

  describe('paste and the cap', () => {
    it('pastes plain text at the caret and reports where the caret goes', async () => {
      await mount({ initial: 'ab cd' })
      await paste('XYZ', 2, 2)
      expect(box().value).toBe('abXYZ cd')
      expect(carets.at(-1)).toBe(5)
      expect(box().selectionStart).toBe(5)
    })

    it('replaces the selection and ignores a paste with no text', async () => {
      await mount({ initial: 'hello world' })
      await paste('there', 6, 11)
      expect(box().value).toBe('hello there')
      await paste('', 0, 0)
      expect(box().value).toBe('hello there')
    })

    it('cuts a paste at 2000 characters and ignores it when the box is full', async () => {
      await mount({ initial: 'a'.repeat(1990) })
      await paste('b'.repeat(50), 1990, 1990)
      expect(box().value).toHaveLength(2000)
      await paste('c', 2000, 2000)
      expect(box().value).toHaveLength(2000)
    })

    it('limits the box to 2000 and shows the counter only from 1800', async () => {
      await mount({ initial: 'a'.repeat(1799) })
      expect(box().maxLength).toBe(2000)
      expect(host.textContent).not.toContain('characters')
      await type(box(), 'a'.repeat(1800))
      expect(host.textContent).toContain('1800/2000 characters')
    })
  })

  describe('streaming', () => {
    it('disables the box and offers Stop instead of Send, and Stop calls the host', async () => {
      await mount({ streaming: true })
      expect(box().disabled).toBe(true)
      expect(send()).toBeNull()
      await act(async () => stop()!.click())
      expect(fn.onStop).toHaveBeenCalledTimes(1)
    })

    it('moves focus to Stop while a turn runs and back to the box after', async () => {
      await mount()
      await mount({ streaming: true })
      expect(document.activeElement).toBe(stop())
      await mount({ streaming: false })
      expect(document.activeElement).toBe(box())
    })

    it('leaves focus alone when the reader moved it somewhere else meanwhile', async () => {
      const other = document.createElement('button')
      document.body.appendChild(other)
      await mount()
      await mount({ streaming: true })
      other.focus()
      await mount({ streaming: false })
      expect(document.activeElement).toBe(other)
      other.remove()
    })
  })

  describe('Enter right after a send', () => {
    it('does not stop the new turn: a keyboard click on Stop within 300 ms is ignored', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        await mount({ initial: 'What is blocked?' })
        await mount({ initial: 'What is blocked?', streaming: true })
        expect(document.activeElement).toBe(stop())
        // the second Enter of a double tap or a key repeat lands on the focused Stop button
        await act(async () => stop()!.click())
        expect(fn.onStop).not.toHaveBeenCalled()
        vi.setSystemTime(Date.now() + 400)
        await act(async () => stop()!.click())
        expect(fn.onStop).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('a held Enter (keydown repeats) on Stop never stops the turn, at any time', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        await mount({ initial: 'What is blocked?' })
        await mount({ initial: 'What is blocked?', streaming: true })
        vi.setSystemTime(Date.now() + 2000)
        const repeat = new KeyboardEvent('keydown', {
          key: 'Enter',
          repeat: true,
          bubbles: true,
          cancelable: true,
        })
        await act(async () => {
          stop()!.dispatchEvent(repeat)
        })
        // the default action of a keydown on a button is the click: cancelling it is the guard
        expect(repeat.defaultPrevented).toBe(true)
        const first = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
        await act(async () => {
          stop()!.dispatchEvent(first)
        })
        expect(first.defaultPrevented).toBe(false)
        expect(fn.onStop).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('a pointer click on Stop is never held back', async () => {
      await mount({ initial: 'What is blocked?' })
      await mount({ initial: 'What is blocked?', streaming: true })
      await act(async () => {
        stop()!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      })
      expect(fn.onStop).toHaveBeenCalledTimes(1)
    })
  })

  describe('wording and slots', () => {
    it('labels the box and shows the default placeholder; the host can override both', async () => {
      await mount()
      expect(box().getAttribute('aria-label')).toBe('Question for UNI')
      expect(box().placeholder).toBe('Ask UNI about your work…')
      await mount({ extra: { label: 'About this file', placeholder: 'Ask about this file…' } })
      expect(box().getAttribute('aria-label')).toBe('About this file')
      expect(box().placeholder).toBe('Ask about this file…')
    })

    it('renders the host slots and passes textarea attributes through', async () => {
      await mount({
        extra: {
          above: h('div', { 'data-test': 'above' }, 'picker'),
          rowStart: h('span', { 'data-test': 'row-start' }, '+'),
          rowEnd: h('span', { 'data-test': 'row-end' }, 'model'),
          textareaProps: { 'aria-haspopup': 'listbox' },
          slot: 'askuni-composer',
          sendClassName: 'host-send',
        },
      })
      for (const id of ['above', 'row-start', 'row-end']) {
        expect(host.querySelector(`[data-test="${id}"]`), id).not.toBeNull()
      }
      expect(box().getAttribute('aria-haspopup')).toBe('listbox')
      expect(host.querySelector('[data-slot="askuni-composer"]')).not.toBeNull()
      expect(send()?.className).toBe('host-send')
    })

    it('keeps the box and row classes the shell styles by', async () => {
      await mount()
      expect(host.querySelector('.askuni2-composer-box .askuni2-composer-row')).not.toBeNull()
    })
  })
})
