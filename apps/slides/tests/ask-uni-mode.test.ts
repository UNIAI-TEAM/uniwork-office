// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniDocBridge, AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import {
  AskUniModeBody,
  AskUniModeToggle,
  askUniChatPaneProps,
  askUniLiveText,
  useAskUniMode,
} from '../src/renderer/ai/ask-uni-mode'

// Ask UNI as a mode of the docs AI panel (contract E1): a header toggle that exists only when the
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

function Panel(props: { lang?: 'en' | 'vi' }) {
  const lang = props.lang ?? 'en'
  const mode = useAskUniMode(lang)
  const [draft, setDraft] = useState('')
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

describe('slides panel: Ask UNI mode', () => {
  let host: HTMLDivElement
  let root: Root

  const mount = async (props: { lang?: 'en' | 'vi' } = {}) => {
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
      expect(host.querySelector('[data-slot="askuni-doc-chip"]')).toBeNull()
    })

    it('reads the flags again each time the mode is turned on (the file may have been saved to UniWork)', async () => {
      const bridge = (window as unknown as Win).uniworkAskUniDoc as ReturnType<typeof fakeBridge>
      await mount()
      const first = bridge.askUniDocFlags.mock.calls.length
      await click(toggle())
      expect(bridge.askUniDocFlags.mock.calls.length).toBeGreaterThan(first)
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

describe('slides panel wiring (source)', () => {
  const panel = readFileSync(new URL('../src/renderer/ai/AiPanel.tsx', import.meta.url), 'utf8')

  it('mounts the toggle in the header actions, the body and the hidden chat pane, and routes the live text', () => {
    expect(panel).toContain("from './ask-uni-mode'")
    const header = panel.slice(
      panel.indexOf('className="ai-panel-header-actions"'),
      panel.indexOf('className="ai-panel-header-actions"') + 600,
    )
    expect(header).toContain('<AskUniModeToggle')
    expect(panel).toContain('<AskUniModeBody')
    expect(panel).toContain('{...askUniChatPaneProps(askUni)}')
    expect(panel).toContain('askUniLiveText(askUni, liveText)')
  })

  it('keeps one polite live region in the panel render', () => {
    const start = panel.indexOf('ref={asideRef}')
    const render = panel.slice(start, panel.indexOf('</aside>', start))
    expect(render.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('names the file by its base name only', () => {
    expect(panel).toContain('askUniFileName(currentFilePath')
  })
})
