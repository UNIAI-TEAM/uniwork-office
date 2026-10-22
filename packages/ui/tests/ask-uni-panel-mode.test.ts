// @vitest-environment jsdom
import { act, createElement as h, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniDocBridge, AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import {
  AskUniModeBody,
  AskUniModeToggle,
  askUniChatPaneProps,
  askUniFileName,
  askUniLiveText,
  useAskUniMode,
} from '../src/ask-uni'

// Ask UNI as a mode of an editor AI panel (contract E1): a header toggle that exists only when the
// editor bridge is there and the stream is on, a body that replaces the chat without unmounting it,
// and the panel's one polite live region. The renderer never names a workspace or a document.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Win = { uniworkAskUniDoc?: AskUniDocBridge }

function fakeBridge(flags: AskUniDocFlags) {
  return {
    askUniDocStream: vi.fn(async () => ({ ok: true as const, requestId: 'r1' })),
    askUniDocStreamCancel: vi.fn(async () => ({ ok: true as const })),
    onAskUniDocStreamEvent: vi.fn(() => () => undefined),
    askUniDocMessages: vi.fn(async () => ({ ok: true as const, messages: [] })),
    askUniDocFeedbackSet: vi.fn(async () => ({ ok: true as const })),
    askUniDocFeedbackClear: vi.fn(async () => ({ ok: true as const })),
    askUniDocFlags: vi.fn(async () => flags),
  }
}

const DOC: AskUniDocFlags = { streamEnabled: true, bound: 'document' }

interface PanelProps {
  lang?: 'en' | 'vi'
  bindingKey?: string | null
  /** false = the dock is collapsed: like the real panels, a rail replaces the whole tree */
  open?: boolean
  /** a ribbon / menu AI action: a new nonce runs it in the chat */
  preset?: number
  /** the preset also moves focus into the chat (a prefilled composer, a refused send) */
  focusChat?: boolean
}

/** whether the chat pane was still hidden when the panel moved focus into it (null = never called) */
let paneHiddenAtFocus: boolean | null = null

function Panel(props: PanelProps) {
  const lang = props.lang ?? 'en'
  const mode = useAskUniMode(lang, props.bindingKey)
  const [draft, setDraft] = useState('')
  // what each panel's preset effect does: the run lands in the chat, so the chat has to show
  useEffect(() => {
    if (!props.preset) return
    if (props.focusChat) {
      mode.leave(() => {
        paneHiddenAtFocus = (document.querySelector('.ai-askuni-chat-pane') as HTMLElement).hidden
        document.getElementById('chat-input')?.focus()
      })
    } else mode.leave()
  }, [props.preset])
  if (props.open === false) return h('button', { className: 'ai-rail' }, 'rail')
  return h(
    'aside',
    null,
    h('div', { className: 'ai-panel-header-actions' }, h(AskUniModeToggle, { mode, lang })),
    h(
      'div',
      { className: 'ai-sr-status', 'aria-live': 'polite' },
      askUniLiveText(mode, 'chat says'),
    ),
    h(AskUniModeBody, { mode, documentName: 'Q3 plan.docx' }),
    h(
      'div',
      askUniChatPaneProps(mode),
      h('textarea', {
        id: 'chat-input',
        value: draft,
        onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      }),
    ),
  )
}

describe('Ask UNI as a mode of an editor AI panel', () => {
  let host: HTMLDivElement
  let root: Root

  const mount = async (props: PanelProps = {}) => {
    await act(async () => {
      root.render(h(Panel, props))
    })
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }
  const toggle = () => host.querySelector('button[data-ask-uni-toggle]') as HTMLButtonElement | null
  const click = async (el: Element | null) => {
    await act(async () => {
      ;(el as HTMLElement).click()
      await Promise.resolve()
    })
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as Win).uniworkAskUniDoc
  })

  describe('the toggle', () => {
    it('is not there without the editor bridge (the web build)', async () => {
      await mount()
      expect(toggle()).toBeNull()
    })

    it('is not there while the stream flag is off', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge({
        streamEnabled: false,
        bound: 'document',
      })
      await mount()
      expect(toggle()).toBeNull()
    })

    it('shows up when the bridge is there and the stream is on, labelled Ask UNI, not pressed', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge(DOC)
      await mount()
      expect(toggle()?.getAttribute('aria-label')).toBe('Ask UNI')
      expect(toggle()?.getAttribute('aria-pressed')).toBe('false')
      expect(toggle()?.closest('.ai-panel-header-actions')).not.toBeNull()
    })

    it('uses the panel language for its label', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge(DOC)
      await mount({ lang: 'vi' })
      expect(toggle()?.getAttribute('aria-label')).toBe('Hỏi UNI')
    })

    it('stays visible for a local file (the body then says to save first)', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge({
        streamEnabled: true,
        bound: 'local',
      })
      await mount()
      await click(toggle())
      expect(host.textContent).toContain('Save to UniWork first')
      expect(host.querySelector('[data-slot="askuni-doc-composer"]')).toBeNull()
    })
  })

  describe('swapping the body', () => {
    beforeEach(() => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge(DOC)
    })

    it('shows the Ask UNI body with this file name and hides the chat, which stays mounted with its draft', async () => {
      await mount()
      const input = host.querySelector('#chat-input') as HTMLTextAreaElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(input, 'half a thought')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await click(toggle())
      expect(toggle()?.getAttribute('aria-pressed')).toBe('true')
      expect(host.querySelector('[data-slot="askuni-doc-chip"]')?.textContent).toBe('Q3 plan.docx')
      const pane = host.querySelector('.ai-askuni-chat-pane') as HTMLElement
      expect(pane.hidden).toBe(true)
      expect(host.querySelector('#chat-input')).toBe(input)
      expect((host.querySelector('#chat-input') as HTMLTextAreaElement).value).toBe(
        'half a thought',
      )
      await click(toggle())
      expect(toggle()?.getAttribute('aria-pressed')).toBe('false')
      expect((host.querySelector('.ai-askuni-chat-pane') as HTMLElement).hidden).toBe(false)
      expect(host.querySelector('#chat-input')).toBe(input)
      expect((host.querySelector('#chat-input') as HTMLTextAreaElement).value).toBe(
        'half a thought',
      )
      // the Ask UNI body stays mounted (hidden) so its conversation survives the toggle
      expect((host.querySelector('.ai-askuni-pane') as HTMLElement).hidden).toBe(true)
    })

    it('reads the flags again each time the mode is turned on (the file may have been saved to UniWork)', async () => {
      const bridge = (window as unknown as Win).uniworkAskUniDoc as ReturnType<typeof fakeBridge>
      await mount()
      const first = bridge.askUniDocFlags.mock.calls.length
      await click(toggle())
      expect(bridge.askUniDocFlags.mock.calls.length).toBeGreaterThan(first)
    })

    it('reads the flags again when the binding key changes (the tab now shows another file) and not on an unrelated render', async () => {
      const bridge = (window as unknown as Win).uniworkAskUniDoc as ReturnType<typeof fakeBridge>
      await mount({ bindingKey: '/a/plan.docx' })
      const first = bridge.askUniDocFlags.mock.calls.length
      await mount({ bindingKey: '/a/plan.docx', lang: 'en' })
      expect(bridge.askUniDocFlags.mock.calls.length).toBe(first)
      await mount({ bindingKey: '/uniwork/plan.docx' })
      expect(bridge.askUniDocFlags.mock.calls.length).toBeGreaterThan(first)
    })
  })

  describe('collapsing the dock', () => {
    const ev = (e: Record<string, unknown>) => e as never

    function streamingBridge() {
      const bridge = fakeBridge(DOC)
      let emit: (e: never) => void = () => undefined
      bridge.onAskUniDocStreamEvent = vi.fn((cb: (e: never) => void) => {
        emit = cb
        return () => undefined
      }) as never
      bridge.askUniDocMessages = vi.fn(async () => ({
        ok: true as const,
        messages: [
          { id: 'u1', role: 'user', content: 'Who owns billing?', citations: [] },
          { id: 'a1', role: 'assistant', content: 'Dana owns it.', citations: [] },
        ],
      })) as never
      ;(window as unknown as Win).uniworkAskUniDoc = bridge
      return { bridge, emit: (e: Record<string, unknown>) => emit(ev(e)) }
    }
    const ask = async (question: string) => {
      const box = host.querySelector('textarea[aria-label]') as HTMLTextAreaElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(box, question)
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await Promise.resolve()
      })
      await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })
    }
    const stopButton = () => host.querySelector('button[aria-label="Stop"]')

    it('keeps a running turn: nothing is cancelled and the answer is still being written', async () => {
      const { bridge, emit } = streamingBridge()
      await mount()
      await click(toggle())
      await ask('Who owns billing?')
      expect(stopButton()).not.toBeNull()
      await mount({ open: false })
      expect(host.querySelector('.ai-rail')).not.toBeNull()
      expect(bridge.askUniDocStreamCancel).not.toHaveBeenCalled()
      // an event that arrives while the dock is collapsed still lands
      await act(async () => {
        emit({ type: 'run', requestId: 'r1', conversationId: 'c1', runId: 'x' })
        emit({ type: 'delta', requestId: 'r1', text: 'Dana' })
      })
      await mount({ open: true })
      expect(stopButton()).not.toBeNull()
      expect(host.textContent).toContain('Dana')
    })

    it('keeps the conversation and the draft: expanding again is not a new empty chat', async () => {
      const { emit } = streamingBridge()
      await mount()
      await click(toggle())
      await ask('Who owns billing?')
      await act(async () => {
        emit({ type: 'run', requestId: 'r1', conversationId: 'c1', runId: 'x' })
        emit({
          type: 'done',
          requestId: 'r1',
          message: { id: 'a1', role: 'assistant', content: 'Dana owns it.', citations: [] },
        })
      })
      const box = host.querySelector('textarea[aria-label]') as HTMLTextAreaElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(box, 'and the follow-up')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await mount({ open: false })
      await mount({ open: true })
      expect(host.querySelector('.askuni-doc-empty')).toBeNull()
      expect(host.textContent).toContain('Dana owns it.')
      expect((host.querySelector('textarea[aria-label]') as HTMLTextAreaElement).value).toBe(
        'and the follow-up',
      )
      expect(toggle()?.getAttribute('aria-pressed')).toBe('true')
    })

    it('Stop, reload, collapse, expand shows the turn once', async () => {
      const { bridge, emit } = streamingBridge()
      await mount()
      await click(toggle())
      await ask('Who owns billing?')
      await act(async () => {
        emit({ type: 'run', requestId: 'r1', conversationId: 'c1', runId: 'x' })
        emit({ type: 'delta', requestId: 'r1', text: 'Dana par' })
      })
      // the server stores the question and the partial answer with the stopped notice
      ;(bridge.askUniDocMessages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async () => ({
          ok: true as const,
          messages: [
            { id: 'u1', role: 'user', content: 'Who owns billing?', citations: [] },
            { id: 'a1', role: 'assistant', content: 'Dana par', citations: [], notice: 'stopped' },
          ],
        }),
      )
      // the Stop button ignores a press right after it took the send button's place
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350))
      })
      await click(stopButton())
      const thread = () => host.querySelector('.askuni-v2-thread')?.textContent ?? ''
      const count = () => thread().split('Who owns billing?').length - 1
      expect(count()).toBe(1)
      await mount({ open: false })
      await mount({ open: true })
      expect(count()).toBe(1)
    })

    it('stop, ask the same question again, stop: the live turn stays visible until the reload', async () => {
      const { bridge, emit } = streamingBridge()
      await mount()
      await click(toggle())
      const stopped = (content: string) =>
        (bridge.askUniDocMessages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
          async () => ({
            ok: true as const,
            messages: [
              { id: 'u1', role: 'user', content: 'Who owns billing?', citations: [] },
              { id: 'a1', role: 'assistant', content, citations: [], notice: 'stopped' },
            ],
          }),
        )
      const stopTurn = async (partial: string) => {
        const requestId = 'r1'
        await act(async () => {
          emit({ type: 'run', requestId, conversationId: 'c1', runId: 'x' })
          emit({ type: 'delta', requestId, text: partial })
        })
        // the Stop button ignores a press right after it took the send button's place
        await act(async () => {
          await new Promise((r) => setTimeout(r, 350))
        })
        await click(stopButton())
      }
      await ask('Who owns billing?')
      stopped('First partial')
      await stopTurn('First partial')
      // the post-Stop reload lands: the store now ends with the first stopped turn
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1800))
      })
      await ask('Who owns billing?')
      await stopTurn('Second partial')
      expect(host.textContent).toContain('Second partial')
    })

    it('a whole-panel unmount cancels a running turn', async () => {
      const { bridge } = streamingBridge()
      await mount()
      await click(toggle())
      await ask('Who owns billing?')
      expect(stopButton()).not.toBeNull()
      expect(bridge.askUniDocStreamCancel).not.toHaveBeenCalled()
      await act(async () => {
        root.render(h('div'))
      })
      expect(bridge.askUniDocStreamCancel).toHaveBeenCalledWith({ requestId: 'r1' })
    })
  })

  describe('a binding that is not a chat drops the session', () => {
    const ev = (e: Record<string, unknown>) => e as never
    const flagsOf = (bridge: ReturnType<typeof fakeBridge>, next: AskUniDocFlags) => {
      bridge.askUniDocFlags = vi.fn(async () => next) as never
    }
    const setBox = async (text: string) => {
      const box = host.querySelector('textarea[aria-label]') as HTMLTextAreaElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(box, text)
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      return box
    }
    const send = async (text: string) => {
      const box = await setBox(text)
      await act(async () => {
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await Promise.resolve()
      })
      await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })
    }
    function bridgeWithEvents() {
      const bridge = fakeBridge(DOC)
      let emit: (e: never) => void = () => undefined
      bridge.onAskUniDocStreamEvent = vi.fn((cb: (e: never) => void) => {
        emit = cb
        return () => undefined
      }) as never
      ;(window as unknown as Win).uniworkAskUniDoc = bridge
      return { bridge, emit: (e: Record<string, unknown>) => emit(ev(e)) }
    }

    it('a local binding notice drops the conversation and cancels a running turn', async () => {
      const { bridge, emit } = bridgeWithEvents()
      await mount({ bindingKey: '/a/plan.docx' })
      await click(toggle())
      await send('Who owns billing?')
      await act(async () => {
        emit({ type: 'run', requestId: 'r1', conversationId: 'c-A', runId: 'x' })
      })
      // the next question is drafted but not sent
      await setBox('half a follow-up')
      flagsOf(bridge, { streamEnabled: true, bound: 'local' })
      await mount({ bindingKey: '/local/plan.docx' })
      expect(host.textContent).toContain('Save to UniWork first')
      expect(bridge.askUniDocStreamCancel).toHaveBeenCalledWith({ requestId: 'r1' })
      // back on a UniWork document: an empty chat, no old conversation, no old text
      flagsOf(bridge, DOC)
      await mount({ bindingKey: '/uniwork/other.docx' })
      expect(host.querySelector('.askuni-doc-empty')).not.toBeNull()
      expect((host.querySelector('textarea[aria-label]') as HTMLTextAreaElement).value).toBe('')
      await send('And now?')
      const calls = bridge.askUniDocStream.mock.calls as unknown as Array<[Record<string, unknown>]>
      expect(calls[calls.length - 1]?.[0]).toEqual({ question: 'And now?', locale: 'en' })
    })

    it('signing out drops the conversation too', async () => {
      const { bridge, emit } = bridgeWithEvents()
      await mount({ bindingKey: '/a/plan.docx' })
      await click(toggle())
      await send('Who owns billing?')
      await act(async () => {
        emit({ type: 'run', requestId: 'r1', conversationId: 'c-A', runId: 'x' })
        emit({
          type: 'done',
          requestId: 'r1',
          message: { id: 'a1', role: 'assistant', content: 'Dana owns it.', citations: [] },
        })
      })
      flagsOf(bridge, { streamEnabled: true, bound: 'signed_out' })
      await mount({ bindingKey: '/a/plan.docx|out' })
      flagsOf(bridge, DOC)
      await mount({ bindingKey: '/a/plan.docx|in' })
      expect(host.querySelector('.askuni-doc-empty')).not.toBeNull()
      await send('And now?')
      const calls = bridge.askUniDocStream.mock.calls as unknown as Array<[Record<string, unknown>]>
      expect(calls[calls.length - 1]?.[0]).toEqual({ question: 'And now?', locale: 'en' })
    })
  })

  describe('an AI preset while Ask UNI shows', () => {
    it('moves focus into the chat only once its pane is shown again', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge(DOC)
      paneHiddenAtFocus = null
      await mount()
      await click(toggle())
      await mount({ preset: 1, focusChat: true })
      expect(paneHiddenAtFocus).toBe(false)
      expect(document.activeElement?.id).toBe('chat-input')
    })

    it('still runs the callback at once when the chat is already showing', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge(DOC)
      paneHiddenAtFocus = null
      await mount()
      await mount({ preset: 1, focusChat: true })
      expect(paneHiddenAtFocus).toBe(false)
      expect(document.activeElement?.id).toBe('chat-input')
    })

    it('leaves Ask UNI so the chat that runs it is the one on screen, and the Ask conversation stays', async () => {
      ;(window as unknown as Win).uniworkAskUniDoc = fakeBridge(DOC)
      await mount()
      await click(toggle())
      expect((host.querySelector('.ai-askuni-chat-pane') as HTMLElement).hidden).toBe(true)
      await mount({ preset: 1 })
      expect((host.querySelector('.ai-askuni-chat-pane') as HTMLElement).hidden).toBe(false)
      expect(toggle()?.getAttribute('aria-pressed')).toBe('false')
      expect((host.querySelector('.ai-askuni-pane') as HTMLElement).hidden).toBe(true)
      expect(host.querySelector('.ai-sr-status')?.textContent).toBe('chat says')
    })
  })

  describe('the one live region', () => {
    it('stays a single polite region in both modes and carries the body status while Ask UNI shows', async () => {
      const bridge = fakeBridge(DOC)
      ;(window as unknown as Win).uniworkAskUniDoc = bridge
      await mount()
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      expect(host.querySelector('.ai-sr-status')?.textContent).toBe('chat says')
      await click(toggle())
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      const box = host.querySelector('textarea[aria-label]') as HTMLTextAreaElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(box, 'Who owns billing?')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await Promise.resolve()
      })
      await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      expect(host.querySelector('.ai-sr-status')?.textContent).toBe('UNI is thinking…')
    })
  })

  describe('what the renderer sends', () => {
    it('only the question and the language: no workspace, document, focus or file path', async () => {
      const bridge = fakeBridge(DOC)
      ;(window as unknown as Win).uniworkAskUniDoc = bridge
      await mount()
      await click(toggle())
      const box = host.querySelector('textarea[aria-label]') as HTMLTextAreaElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(box, 'What changed?')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await Promise.resolve()
      })
      expect(bridge.askUniDocStream).toHaveBeenCalledTimes(1)
      const req = (bridge.askUniDocStream.mock.calls[0] as unknown[])[0]
      expect(req).toEqual({ question: 'What changed?', locale: 'en' })
      const everything = JSON.stringify([
        bridge.askUniDocStream.mock.calls,
        bridge.askUniDocMessages.mock.calls,
        bridge.askUniDocStreamCancel.mock.calls,
      ])
      for (const forbidden of ['workspaceId', 'documentId', 'focus', 'Q3 plan']) {
        expect(everything, forbidden).not.toContain(forbidden)
      }
    })
  })
})

describe('askUniFileName', () => {
  it('keeps the base name of a posix or windows path and nothing else', () => {
    expect(askUniFileName('/home/u/Q3 plan.docx')).toBe('Q3 plan.docx')
    expect(askUniFileName('C:\\Users\\u\\Q3 plan.docx')).toBe('Q3 plan.docx')
    expect(askUniFileName('plan.docx')).toBe('plan.docx')
  })

  it('is empty without a path', () => {
    expect(askUniFileName(null)).toBe('')
    expect(askUniFileName(undefined)).toBe('')
    expect(askUniFileName('')).toBe('')
  })
})
