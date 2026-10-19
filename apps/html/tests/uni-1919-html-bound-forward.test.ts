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
   * Mounts the panel over a one-section document (or a blank one). `bound` is
   * what App feeds deps.access.uniworkBound (the shared uniworkBoundForAi
   * rule); `flip` changes it later on the same mounted panel. Returns a spy on
   * replaceAll: on a bound page no tool may rewrite the document.
   */
  async function mount(initialBound: boolean, opts: { blank?: boolean; readOnly?: boolean } = {}) {
    let bound = initialBound
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
    const text = opts.blank ? '' : '<!doctype html>\n<html><body><h1>Quarterly</h1></body></html>'
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
            ...(opts.readOnly ? { readOnly: true } : {}),
          }),
        ),
      )
    })
    return {
      replaceAll,
      flip(next: boolean) {
        bound = next
      },
    }
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

  it('a forced write_document call on a bound page errors and never replaces the document', async () => {
    const { replaceAll } = await mount(true)
    harness.reset('write')
    enqueueInComposer(container!, 'rewrite the whole page')
    await pumpUntil(() => harness.requests.length >= 2, 'follow-up turn request')
    // the composed skill only routes names a sub-skill currently offers, and a bound page no
    // longer offers write_document, so it answers "Unknown tool" itself: the html skill's
    // refuseBound is not reached here (it stays covered by uni-1919-html-web-bound.test.ts)
    expect(harness.requests.some((r) => r.purpose === 'one-shot')).toBe(false)
    const followUp = harness.requests.find(
      (r) => !r.purpose && r.messages.some((m) => m.role === 'tool'),
    )
    const toolMessage = followUp?.messages.find((m) => m.role === 'tool')
    const results = toolMessage && toolMessage.role === 'tool' ? toolMessage.results : []
    expect(results).toHaveLength(1)
    expect(results[0].isError).toBe(true)
    expect(results[0].output).toMatch(/Unknown tool|unavailable/)
    expect(replaceAll).not.toHaveBeenCalled()
  })

  it('follows a bound flip on one mounted panel: writers offered, then gone, with the note', async () => {
    const { flip } = await mount(false)
    harness.reset('text')
    enqueueInComposer(container!, 'improve the heading')
    await pumpUntil(() => harness.requests.length >= 1, 'turn 1 request')
    const turn1 = harness.requests[0]
    expect(turn1.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['plan_page', 'write_document']),
    )
    expect(turn1.system).not.toContain('plan_page and write_document are unavailable')

    // let the first turn settle before the second message goes in
    await pumpUntil(() => !container!.querySelector('.ai-chat[aria-busy="true"]'), 'turn 1 settled')
    flip(true)
    enqueueInComposer(container!, 'and the footer too')
    await pumpUntil(() => harness.requests.length >= 2, 'turn 2 request')
    const turn2 = harness.requests[1]
    const names = turn2.tools.map((tool) => tool.name)
    expect(names).not.toContain('plan_page')
    expect(names).not.toContain('write_document')
    expect(names).toContain('apply_ops')
    expect(turn2.system).toContain('plan_page and write_document are unavailable')
  })

  it('a bound view-only page gets the narrow read list and no bound note', async () => {
    await mount(true, { readOnly: true })
    harness.reset('text')
    enqueueInComposer(container!, 'what is on this page?')
    await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
    const request = harness.requests[0]
    expect(request.tools.map((tool) => tool.name)).not.toContain('apply_ops')
    // the view-only note must be present, or the absence check below proves nothing
    expect(request.system).toContain('this document is view-only')
    expect(request.system).not.toContain('plan_page and write_document are unavailable')
  })

  describe('blank bound page: the write intent is not offered (RHB-3)', () => {
    const intentCards = () =>
      Array.from(container!.querySelectorAll<HTMLElement>('.ai-intent-card')).map(
        (el) => el.querySelector('.ai-intent-card-title')?.textContent ?? '',
      )

    it('an unbound blank page keeps both intent cards and the WRITE directive', async () => {
      await mount(false, { blank: true })
      expect(intentCards()).toHaveLength(2)
      const write = container!.querySelectorAll<HTMLElement>('.ai-intent-card')[1]
      act(() => write.click())
      harness.reset('text')
      enqueueInComposer(container!, 'draft a memo')
      await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
      const first = harness.requests[0].messages.find((m) => m.role === 'user')
      expect(first && first.role === 'user' ? first.text : '').toContain('WRITE CONTENT')
    })

    it('a bound blank page shows no intent bar at all', async () => {
      await mount(true, { blank: true })
      expect(container!.querySelector('.ai-intent-bar')).toBeNull()
    })

    it('a write intent picked before the page became bound is dropped from the next turn', async () => {
      const { flip } = await mount(false, { blank: true })
      const write = container!.querySelectorAll<HTMLElement>('.ai-intent-card')[1]
      act(() => write.click())
      flip(true)
      harness.reset('text')
      enqueueInComposer(container!, 'draft a memo')
      await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
      const first = harness.requests[0].messages.find((m) => m.role === 'user')
      const text = first && first.role === 'user' ? first.text : ''
      expect(text).not.toContain('write_document')
      expect(text).not.toContain('WRITE CONTENT')
    })

    it('a stale write intent keeps the design empty-state copy once the page is bound', async () => {
      const { flip } = await mount(false, { blank: true })
      const write = container!.querySelectorAll<HTMLElement>('.ai-intent-card')[1]
      act(() => write.click())
      flip(true)
      // re-render without sending
      const textarea = container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      act(() => {
        setter.call(textarea, 'x')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(container!.querySelector('.ai-chat-empty-title')?.textContent).toBe(
        'Design a page with AI',
      )
      expect(container!.querySelector('.ai-intent-bar')).toBeNull()
    })
  })
})
