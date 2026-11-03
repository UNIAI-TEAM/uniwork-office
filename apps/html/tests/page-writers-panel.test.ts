// UNI-2326 (ADR 0052): the desktop panel reaches the UniWork AI writer route like the web frame,
// and HTML has no C-BOUND any more, so every editable page is offered plan_page and write_document,
// a blank one shows the design / write intent cards, and a write_document call sends its one-shot
// page writer. These tests drive a real AgentLoop with a fake transport and read the offered tools
// off the requests the transport actually saw.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'
import { readyUniworkAi, resetUniworkAi } from '../../../packages/ui/tests/helpers/uniwork-ack'

/**
 * What the panel's transport sees. `reply` decides what the first non-one-shot
 * request answers; one-shot requests are the page writer inside write_document,
 * and this harness always answers them with a complete document.
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
              input: { plan: 'replace the page' },
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

describe('the HTML panel offers the whole-page writers everywhere (UNI-2326)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    vi.unstubAllGlobals()
    resetForTest()
    resetUniworkAi()
  })

  /** Mounts the panel over a one-section document (or a blank one); `web` mounts it as the web frame */
  async function mount(opts: { blank?: boolean; readOnly?: boolean; web?: boolean } = {}) {
    readyUniworkAi('/tmp/page.html')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    const bridgeStubs: Record<string, unknown> = opts.web
      ? { capabilities: { platform: 'web' } }
      : {}
    resetForTest()
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
    const deps: HtmlAiDeps = {
      access: {
        getText: () => text,
        getVersion: () => 1,
        getMap: () => buildParseMap(text, 1, null),
        getLastManualVersion: () => 0,
        getFilePath: () => '/tmp/page.html',
        getSelectedSid: () => null,
        applyOps: () => ({ ok: true, ranges: [] }),
        replaceAll: () => {},
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
  }

  it.each([false, true])(
    'offers plan_page and write_document on the wire (web frame: %s)',
    async (web) => {
      await mount({ web })
      harness.reset('text')
      enqueueInComposer(container!, 'improve the heading')
      await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
      const request = harness.requests[0]
      const names = request.tools.map((tool) => tool.name)
      expect(names).toEqual(expect.arrayContaining(['plan_page', 'write_document', 'apply_ops']))
      expect(request.system).not.toMatch(/are (not available here|unavailable on it)/)
    },
  )

  it('a write_document call on the desktop sends its one-shot page writer', async () => {
    await mount()
    harness.reset('write')
    enqueueInComposer(container!, 'rewrite the whole page')
    await pumpUntil(
      () => harness.requests.some((r) => r.purpose === 'one-shot'),
      'the page writer request',
    )
    const oneShot = harness.requests.find((r) => r.purpose === 'one-shot')!
    expect(oneShot.writer?.kind).toBe('html.page')
  })

  it('a view-only page gets the narrow read list and the view-only note', async () => {
    await mount({ readOnly: true })
    harness.reset('text')
    enqueueInComposer(container!, 'what is on this page?')
    await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
    const request = harness.requests[0]
    const names = request.tools.map((tool) => tool.name)
    expect(names).not.toContain('apply_ops')
    expect(names).not.toContain('write_document')
    expect(request.system).toContain('this document is view-only')
  })

  describe('a blank page offers the design / write intent (RHB-3)', () => {
    const intentCards = () =>
      Array.from(container!.querySelectorAll<HTMLElement>('.ai-intent-card')).map(
        (el) => el.querySelector('.ai-intent-card-title')?.textContent ?? '',
      )

    it.each([false, true])(
      'shows both intent cards and sends the WRITE directive (web frame: %s)',
      async (web) => {
        await mount({ blank: true, web })
        expect(intentCards()).toHaveLength(2)
        const write = container!.querySelectorAll<HTMLElement>('.ai-intent-card')[1]
        act(() => write.click())
        expect(container!.querySelector('.ai-chat-empty-title')?.textContent).not.toBe(
          'Design a page with AI',
        )
        harness.reset('text')
        enqueueInComposer(container!, 'draft a memo')
        await pumpUntil(() => harness.requests.length >= 1, 'first turn request')
        const first = harness.requests[0].messages.find((m) => m.role === 'user')
        expect(first && first.role === 'user' ? first.text : '').toContain('WRITE CONTENT')
      },
    )

    it('a view-only blank page shows no intent bar', async () => {
      await mount({ blank: true, readOnly: true })
      expect(container!.querySelector('.ai-intent-bar')).toBeNull()
    })
  })
})
