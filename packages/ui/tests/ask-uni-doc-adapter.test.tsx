/** @vitest-environment jsdom */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskUniDocBridge, AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import { askUniText } from '../src/strings-ask-uni'
import { createAskUniDocAdapter, useAskUniDocFlags } from '../src/ask-uni'

// The adapter an editor builds from window.uniworkAskUniDoc, and the hook that reads its flags.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fakeBridge(): {
  [K in keyof AskUniDocBridge]: ReturnType<typeof vi.fn>
} & AskUniDocBridge {
  const off = vi.fn()
  return {
    askUniDocStream: vi.fn(async () => ({ ok: true as const, requestId: 'r1' })),
    askUniDocStreamCancel: vi.fn(async () => ({ ok: true as const })),
    onAskUniDocStreamEvent: vi.fn(() => off),
    askUniDocMessages: vi.fn(async () => ({ ok: true as const, messages: [] })),
    askUniDocFeedbackSet: vi.fn(async () => ({ ok: true as const })),
    askUniDocFeedbackClear: vi.fn(async () => ({ ok: true as const })),
    askUniDocFlags: vi.fn(async () => ({ streamEnabled: true, bound: 'document' as const })),
  } as never
}

describe('createAskUniDocAdapter', () => {
  it('maps every adapter call to the matching bridge method and passes the request through', async () => {
    const bridge = fakeBridge()
    const t = (k: Parameters<typeof askUniText>[1]) => askUniText('en', k)
    const adapter = createAskUniDocAdapter(bridge, t, 'en')
    expect(adapter.lang).toBe('en')
    expect(adapter.t).toBe(t)

    const req = { question: 'Q', locale: 'en' as const, conversationId: 'c1' }
    expect(await adapter.stream(req)).toEqual({ ok: true, requestId: 'r1' })
    expect(bridge.askUniDocStream).toHaveBeenCalledExactlyOnceWith(req)

    await adapter.cancel('r1')
    expect(bridge.askUniDocStreamCancel).toHaveBeenCalledExactlyOnceWith({ requestId: 'r1' })

    await adapter.loadMessages('c1')
    expect(bridge.askUniDocMessages).toHaveBeenCalledExactlyOnceWith({ conversationId: 'c1' })

    const fb = { conversationId: 'c1', messageId: 'm1', rating: 'up' as const }
    await adapter.feedbackSet(fb)
    expect(bridge.askUniDocFeedbackSet).toHaveBeenCalledExactlyOnceWith(fb)
    await adapter.feedbackClear({ conversationId: 'c1', messageId: 'm1' })
    expect(bridge.askUniDocFeedbackClear).toHaveBeenCalledExactlyOnceWith({
      conversationId: 'c1',
      messageId: 'm1',
    })
  })

  it('hands the stream subscription and its unsubscribe through', () => {
    const bridge = fakeBridge()
    const adapter = createAskUniDocAdapter(bridge, (k) => String(k), 'vi')
    const cb = vi.fn()
    const off = adapter.onEvent(cb)
    expect(bridge.onAskUniDocStreamEvent).toHaveBeenCalledExactlyOnceWith(cb)
    expect(typeof off).toBe('function')
  })

  it('has no citation opener: the editor bridge has no open channel', () => {
    const adapter = createAskUniDocAdapter(fakeBridge(), (k) => String(k), 'en')
    expect(adapter.openCitation).toBeUndefined()
  })
})

describe('useAskUniDocFlags', () => {
  let host: HTMLDivElement
  let root: Root
  let seen: AskUniDocFlags | null | undefined

  function Probe(props: { bridge: AskUniDocBridge | undefined; refreshKey?: number }) {
    seen = useAskUniDocFlags(props.bridge, props.refreshKey)
    return null
  }
  const mount = (bridge: AskUniDocBridge | undefined, refreshKey = 0) =>
    act(async () => {
      root.render(h(Probe, { bridge, refreshKey }))
    })

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    seen = undefined
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('is null until the flags arrive, then the validated flags', async () => {
    const bridge = fakeBridge()
    let release: (f: AskUniDocFlags) => void = () => undefined
    bridge.askUniDocFlags = vi.fn(
      () =>
        new Promise<AskUniDocFlags>((res) => {
          release = res
        }),
    )
    await mount(bridge)
    expect(seen).toBeNull()
    await act(async () => release({ streamEnabled: true, bound: 'local' }))
    expect(seen).toEqual({ streamEnabled: true, bound: 'local' })
  })

  it('asks again when the refresh key changes (the file was saved to UniWork)', async () => {
    const bridge = fakeBridge()
    await mount(bridge, 0)
    await mount(bridge, 1)
    expect(bridge.askUniDocFlags).toHaveBeenCalledTimes(2)
  })

  it('treats a failing call as off and signed out, and a missing bridge as null', async () => {
    const bridge = fakeBridge()
    bridge.askUniDocFlags = vi.fn(async () => {
      throw new Error('gone')
    })
    await mount(bridge)
    expect(seen).toEqual({ streamEnabled: false, bound: 'signed_out' })
    await mount(undefined)
    expect(seen).toBeNull()
  })
})
