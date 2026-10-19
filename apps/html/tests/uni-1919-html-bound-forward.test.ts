// UNI-1919 (SVR-1): the panel must forward deps.access.uniworkBound into the skill's live
// access object. It rebuilds HtmlDocAccess field by field and dropped this one, so a bound
// page still offered plan_page/write_document to the model and the skill's bound refusal was
// unreachable (the writers leaked onto the wire). These tests drive a real AgentLoop with a
// fake transport and read the offered tools off the request the transport actually saw.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

/**
 * What the panel's transport sees. `reply` decides what the first non-one-shot
 * request answers; one-shot requests are the page writer inside write_document,
 * and this harness always answers them with a complete document so a leaked
 * write_document would land a replacement.
 */
const harness = vi.hoisted(() => {
  type Reply = 'text' | 'write'
  const h = {
    requests: [] as AgentStreamRequest[],
    reply: 'text' as Reply,
  }
  return {
    ...h,
    transport: {
      stream(request: AgentStreamRequest, cb: AgentStreamCallbacks) {
        h.requests.push(request)
        queueMicrotask(() => {
          if (request.purpose === 'one-shot') {
            cb.onDelta('<!doctype html>\n<html><body><h1>Replaced</h1></body></html>')
            cb.onDone()
            return
          }
          if (h.reply === 'write' && h.requests.filter((r) => !r.purpose).length === 1) {
            cb.onToolCall({
              id: 'call-1',
              name: 'write_document',
              input: { plan: 'replace the bound page' },
            })
            cb.onDone()
            return
          }
          cb.onDelta('noted')
          cb.onDone()
        })
        return { cancel() {} }
      },
    },
    reset(reply: Reply) {
      h.requests.length = 0
      h.reply = reply
    },
  }
})

// the loop must stay real: the regression is the access literal it is built with
vi.mock('../src/renderer/ai/transport', () => ({
  createElectronTransport: () => harness.transport,
}))

import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'

/** drain React + the loop's promise chain; every hop is a microtask, never a real timer */
const pumpUntil = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 50 && !cond(); i++) await act(async () => {})
  if (!cond()) throw new Error(`never settled: ${what}`)
}

function enqueueInComposer(container: HTMLElement, text: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('AiPanel forwards uniworkBound to the document skill (UNI-1919)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    vi.unstubAllGlobals()
  })

  /**
   * Mounts the panel over a one-section document. `bound` is what App feeds
   * deps.access.uniworkBound (the shared uniworkBoundForAi rule). Returns a spy
   * on replaceAll: on a bound page no tool may rewrite the document.
   */
  async function mount(bound: boolean) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    const bridgeStubs: Record<string, unknown> = {}
    vi.stubGlobal(
      'htmlApi',
      new Proxy(bridgeStubs, {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined
          if (!(prop in target)) {
            target[prop] = /^on[A-Z]/.test(prop)
              ? vi.fn(() => () => {})
              : prop === 'getAiSettings'
                ? vi.fn(async () => usableAiSettings())
                : vi.fn(async () => undefined)
          }
          return target[prop]
        },
      }),
    )
    const text = '<!doctype html>\n<html><body><h1>Quarterly</h1></body></html>'
    const replaceAll = vi.fn()
    const deps: HtmlAiDeps = {
      access: {
        getText: () => text,
        getVersion: () => 1,
        getMap: () => buildParseMap(text, 1, null),
        getLastManualVersion: () => 0,
        getFilePath: () => '/tmp/page.html',
        getSelectedSid: () => null,
        applyOps: () => ({ ok: true, ranges: [] }),
        replaceAll,
        uniworkBound: () => bound,
      },
      getSnapshot: () => ({ text }),
      restoreSnapshot: () => {},
      onRunDone: () => null,
      onSaveOffer: () => {},
      clearHighlights: () => {},
      navigateTo: () => {},
      onBriefConfirmed: () => {},
      previewDraft: () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, {
            deps,
            filePath: '/tmp/page.html',
            editQueue: [],
            onQueueEditInstruction: () => {},
            onQueueRemove: () => {},
            onQueueClear: () => {},
            onQueueFocus: () => {},
            onQueueConsume: () => {},
            onCollapse: () => {},
          }),
        ),
      )
    })
    return { replaceAll }
  }

  it('a bound page is offered neither plan_page nor write_document on the wire', async () => {
    await mount(true)
    harness.reset('text')
    enqueueInComposer(container!, 'improve the heading')
    await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
    const names = harness.requests[0].tools.map((tool) => tool.name)
    expect(names).not.toContain('plan_page')
    expect(names).not.toContain('write_document')
    expect(names).toContain('apply_ops')
    expect(names).toContain('get_outline')
  })

  it('an unbound page still offers the whole-page writers', async () => {
    await mount(false)
    harness.reset('text')
    enqueueInComposer(container!, 'improve the heading')
    await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
    const names = harness.requests[0].tools.map((tool) => tool.name)
    expect(names).toContain('plan_page')
    expect(names).toContain('write_document')
  })

  it('a bound turn refuses a forced write_document call; the document is never replaced', async () => {
    const { replaceAll } = await mount(true)
    harness.reset('write')
    enqueueInComposer(container!, 'rewrite the whole page')
    await pumpUntil(() => harness.requests.length >= 2, 'follow-up turn request')
    // the refused call stays inside the turn; the page writer is never asked
    expect(harness.requests.some((r) => r.purpose === 'one-shot')).toBe(false)
    const followUp = harness.requests.find(
      (r) => !r.purpose && r.messages.some((m) => m.role === 'tool'),
    )
    const toolMessage = followUp?.messages.find((m) => m.role === 'tool')
    const results = toolMessage && toolMessage.role === 'tool' ? toolMessage.results : []
    expect(results).toHaveLength(1)
    expect(results[0].isError).toBe(true)
    expect(replaceAll).not.toHaveBeenCalled()
  })
})
