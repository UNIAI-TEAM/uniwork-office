/** @vitest-environment jsdom */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import { AskUniEditorBody, clearAskUniRatings } from '../src/ask-uni'
import { ev, fakeAdapter, msg, type FakeAdapter } from './ask-uni-kit'

// Ask UNI inside an editor AI panel: this document's chip (file name only), the thread and a plain
// composer, and one state per binding (local file / another account's copy / signed out). The host
// derives nothing for the renderer: no workspace, document or focus id ever reaches the adapter.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DOC: AskUniDocFlags = { streamEnabled: true, bound: 'document' }

describe('AskUniEditorBody', () => {
  let host: HTMLDivElement
  let root: Root
  let fake: FakeAdapter

  async function mount(
    flags: AskUniDocFlags | null = DOC,
    extra: { onLiveStatus?: (text: string) => void; documentName?: string } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        h(AskUniEditorBody, {
          adapter: fake.adapter,
          flags,
          documentName: extra.documentName ?? 'Q3 plan.docx',
          onLiveStatus: extra.onLiveStatus,
        }),
      )
    })
  }

  const box = () => host.querySelector('textarea') as HTMLTextAreaElement | null
  const text = () => host.textContent ?? ''
  const buttonByLabel = (label: string) =>
    host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  async function ask(question: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(box(), question)
      box()!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      box()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })
    await flush()
  }
  const emit = (e: Parameters<FakeAdapter['emit']>[0]) => act(async () => fake.emit(e))

  beforeEach(() => {
    clearAskUniRatings()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    fake = fakeAdapter()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  describe('a bound document', () => {
    it('shows the this-document chip with the file name only, and the composer', async () => {
      await mount()
      const chip = host.querySelector('[data-slot="askuni-doc-chip"]') as HTMLElement
      expect(chip.textContent).toBe('Q3 plan.docx')
      expect(chip.getAttribute('aria-label')).toBe('Asking about this document: Q3 plan.docx')
      expect(box()).not.toBeNull()
      expect(box()!.placeholder).toBe('Ask about this document…')
    })

    it('starts with a short empty state, not a blank panel', async () => {
      await mount()
      expect(text()).toContain('Ask UNI about this document')
      expect(host.querySelector('.askuni-v2-thread')).toBeNull()
    })

    it('shows a long file name whole in the title and lets the text ellipsise', async () => {
      const name = 'Quarterly plan with a very long title for the whole company 2026.docx'
      await mount(DOC, { documentName: name })
      const chip = host.querySelector('[data-slot="askuni-doc-chip"]') as HTMLElement
      expect(chip.title).toBe(name)
      expect(chip.textContent).toBe(name)
    })
  })

  describe('a document with no name yet', () => {
    it.each(['', '   '])('shows no empty chip for the name %j', async (name) => {
      await mount(DOC, { documentName: name })
      expect(host.querySelector('[data-slot="askuni-doc-chip"]')).toBeNull()
      expect(host.innerHTML).not.toMatch(/aria-label="[^"]*:\s*"/)
      expect(box()).not.toBeNull()
      expect(buttonByLabel('New chat')).not.toBeNull()
    })
  })

  describe('the other bindings', () => {
    it.each([
      ['local', 'Save to UniWork first'],
      ['hidden', 'No access to this document'],
      ['signed_out', 'Sign in to ask UNI'],
    ] as const)('%s shows its own state and no composer', async (bound, title) => {
      await mount({ streamEnabled: true, bound })
      expect(text()).toContain(title)
      expect(box()).toBeNull()
      expect(host.querySelector('[data-slot="askuni-doc-chip"]')).toBeNull()
      expect(fake.stream).not.toHaveBeenCalled()
      expect(fake.loadMessages).not.toHaveBeenCalled()
    })

    it('a local file tells how to continue, in words that name no ids', async () => {
      await mount({ streamEnabled: true, bound: 'local' })
      expect(text()).toContain('Save this file to UniWork')
    })

    it('shows a checking state while the flags are not known yet', async () => {
      await mount(null)
      expect(text()).toContain('Checking access…')
      expect(box()).toBeNull()
    })

    it('says the feature is off when the host still mounts it with the stream disabled', async () => {
      await mount({ streamEnabled: false, bound: 'document' })
      expect(box()).toBeNull()
      expect(text()).toContain('AI is not configured on this server.')
    })

    it('goes from a state to the composer when the binding changes (saved to UniWork)', async () => {
      await mount({ streamEnabled: true, bound: 'local' })
      expect(box()).toBeNull()
      await mount(DOC)
      expect(box()).not.toBeNull()
    })
  })

  describe('asking', () => {
    it('sends only the question and the language: no workspace, document, focus or model', async () => {
      await mount()
      await ask('Who owns billing?')
      expect(fake.stream).toHaveBeenCalledTimes(1)
      expect(fake.stream.mock.calls[0]![0]).toEqual({ question: 'Who owns billing?', locale: 'en' })
    })

    it('keeps the conversation named by run for the next question', async () => {
      await mount()
      await ask('First')
      await emit(ev.run('r1', 'conv-1'))
      await emit(ev.done())
      await ask('Second')
      expect(fake.stream.mock.calls[1]![0]).toEqual({
        question: 'Second',
        locale: 'en',
        conversationId: 'conv-1',
      })
    })

    it('no adapter call ever carries a workspace, document, focus or mention id', async () => {
      fake.loadMessages.mockResolvedValue({ ok: true, messages: [msg('u1', 'user', 'First')] })
      await mount()
      await ask('First')
      await emit(ev.run('r1', 'conv-1'))
      await emit(ev.done())
      await act(async () => {
        buttonByLabel('Helpful')?.click()
        await Promise.resolve()
      })
      const calls = JSON.stringify([
        fake.stream.mock.calls,
        fake.cancel.mock.calls,
        fake.loadMessages.mock.calls,
        fake.feedbackSet.mock.calls,
        fake.feedbackClear.mock.calls,
      ])
      for (const forbidden of ['workspaceId', 'documentId', 'focus', 'mentions', 'orgId']) {
        expect(calls, forbidden).not.toContain(forbidden)
      }
    })

    it('shows the answer in the thread, with the question above it', async () => {
      await mount()
      await ask('Who owns billing?')
      await emit(ev.run())
      await emit(ev.delta('Lan owns it.'))
      expect(text()).toContain('Who owns billing?')
      expect(text()).toContain('Lan owns it.')
      expect(host.querySelector('.askuni-v2-thread')).not.toBeNull()
    })

    it('Stop cancels the running request through the adapter', async () => {
      await mount()
      await ask('Slow one')
      expect(box()!.disabled).toBe(true)
      // a pointer click (detail 1): a bare .click() looks like the tail of the Enter that sent
      await act(async () => {
        buttonByLabel('Stop')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      })
      expect(fake.cancel).toHaveBeenCalledWith('r1')
    })

    it('New chat cancels what runs, clears the thread and starts the next question fresh', async () => {
      await mount()
      await ask('First')
      await emit(ev.run('r1', 'conv-1'))
      await emit(ev.delta('Partial'))
      await act(async () => buttonByLabel('New chat')!.click())
      expect(fake.cancel).toHaveBeenCalledWith('r1')
      expect(text()).not.toContain('Partial')
      expect(text()).toContain('Ask UNI about this document')
      await ask('Fresh')
      expect(fake.stream.mock.calls[1]![0]).toEqual({ question: 'Fresh', locale: 'en' })
    })

    it('sends in Vietnamese when the adapter language is vi', async () => {
      fake = fakeAdapter('vi')
      await mount()
      expect(text()).toContain('Hỏi UNI về tài liệu này')
      await ask('Ai giữ ngân sách?')
      expect(fake.stream.mock.calls[0]![0]).toMatchObject({ locale: 'vi' })
    })
  })

  describe('the live region', () => {
    it('renders exactly one polite region of its own when the host passes none', async () => {
      await mount()
      await ask('Q')
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
      expect(host.querySelector('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
    })

    it("uses the panel's setter and renders no region when the host passes one", async () => {
      const onLiveStatus = vi.fn()
      await mount(DOC, { onLiveStatus })
      await ask('Q')
      expect(host.querySelectorAll('[aria-live]')).toHaveLength(0)
      expect(onLiveStatus).toHaveBeenLastCalledWith('UNI is thinking…')
      await emit(ev.run())
      await emit(ev.done())
      expect(onLiveStatus).toHaveBeenLastCalledWith(expect.stringContaining('answer'))
    })
  })

  it('has one labelled region so the panel can find the body', async () => {
    await mount()
    expect(host.querySelector('section[aria-label="Ask UNI"]')).not.toBeNull()
  })
})
