import { describe, expect, it, vi } from 'vitest'
import { askUniDocBinding } from '../src/main/uniwork-askuni/doc-binding'
import {
  createAskUniDocService,
  registerAskUniDocIpc,
  type AskUniDocBinding,
  type AskUniDocSender,
  type AskUniDocServiceDeps,
} from '../src/main/uniwork-askuni/doc-service'
import type {
  AskUniStreamClient,
  AskUniStreamPayload,
  AskUniStreamTerminal,
} from '../src/main/uniwork-askuni/stream-client'
import {
  ASKUNI_DOC_CHANNELS,
  type AskUniStreamEvent,
  type AskUniStreamRequest,
} from '../src/shared/askuni-api'

/**
 * UNI-2076 s7b: Ask UNI in an editor panel (`uniwork:askuni-doc:*`). Main
 * derives the workspace and the document focus from the sender's own bound
 * path, never from the renderer; a local file is not_bound, another account's
 * copy forbidden. Events go to the asking editor only, one stream per editor,
 * own cancel only, abort on destroyed / navigation / path change; history and
 * feedback only for the conversations that editor saw in its own `run` event.
 */

const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const DOC = '01J8DOC0000000000000000001'
const CONV = '01K4AICONV000000000000001'
const OTHER_CONV = '01K4AICONV000000000000999'
const MSG = '01K4AIMSG0000000000000001'

const DONE: AskUniStreamTerminal = {
  type: 'done',
  message: {
    id: MSG,
    role: 'assistant',
    content: 'hi',
    citations: [],
    createdAt: '2026-10-22T02:00:00Z',
  },
}

function controlledClient() {
  const calls: Array<{
    req: AskUniStreamRequest
    signal: AbortSignal
    emit(ev: AskUniStreamPayload): void
    end(t: AskUniStreamTerminal): void
  }> = []
  const client: AskUniStreamClient = {
    stream: (req, { signal, onEvent }) =>
      new Promise<AskUniStreamTerminal>((resolve) => {
        calls.push({ req, signal, emit: onEvent, end: resolve })
        signal.addEventListener('abort', () => resolve({ type: 'error', code: 'cancelled' }), {
          once: true,
        })
      }),
  }
  return { client, calls }
}

type Fake = AskUniDocSender & {
  sent: AskUniStreamEvent[]
  channels: string[]
  destroy(): void
  navigate(): void
  listenerCount(): number
}

function editor(id: number): Fake {
  const sent: AskUniStreamEvent[] = []
  const channels: string[] = []
  const on = { destroyed: new Set<() => void>(), 'did-navigate': new Set<() => void>() }
  let destroyed = false
  return {
    id,
    sent,
    channels,
    isDestroyed: () => destroyed,
    send: (channel: string, ev: AskUniStreamEvent) => {
      channels.push(channel)
      sent.push(ev)
    },
    once: (name: 'destroyed', fn: () => void) => {
      const once = () => {
        on[name].delete(once)
        fn()
      }
      ;(once as { fn?: () => void }).fn = fn
      on[name].add(once)
    },
    on: (name: 'did-navigate', fn: () => void) => {
      on[name].add(fn)
    },
    removeListener: (name: 'destroyed' | 'did-navigate', fn: () => void) => {
      for (const l of [...on[name]])
        if (l === fn || (l as { fn?: () => void }).fn === fn) on[name].delete(l)
    },
    destroy() {
      destroyed = true
      for (const fn of [...on.destroyed]) fn()
    },
    navigate() {
      for (const fn of [...on['did-navigate']]) fn()
    },
    listenerCount: () => on.destroyed.size + on['did-navigate'].size,
  } as Fake
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

function setup(over: Partial<AskUniDocServiceDeps> = {}) {
  const { client, calls } = controlledClient()
  let signedIn = true
  let scope = 'acc_1:org_a'
  const paths = new Map<number, string | null>([
    [7, '/w/plan.docx'],
    [8, '/w/budget.xlsx'],
    [9, '/w/local.docx'],
    [10, '/w/theirs.docx'],
  ])
  const bindings: Record<string, AskUniDocBinding> = {
    '/w/plan.docx': { workspaceId: WS, documentId: DOC },
    '/w/budget.xlsx': { workspaceId: WS, documentId: '01J8DOC0000000000000000002' },
    '/w/local.docx': null,
    '/w/theirs.docx': 'hidden',
  }
  const rest = {
    messages: vi.fn(async () => ({ ok: true as const, messages: [] })),
    feedbackSet: vi.fn(async () => ({ ok: true as const })),
    feedbackClear: vi.fn(async () => ({ ok: true as const })),
  }
  let n = 0
  const deps: AskUniDocServiceDeps = {
    isSignedIn: () => signedIn,
    scopeKey: () => (signedIn ? scope : null),
    shownPath: (s) => paths.get(s.id) ?? null,
    binding: (p) => bindings[p] ?? null,
    client,
    rest,
    flags: { flags: async () => ({ streamEnabled: true }) },
    newRequestId: () => `req_${++n}`,
    scopeCheckMs: 10,
    ...over,
  }
  return {
    doc: createAskUniDocService(deps),
    calls,
    rest,
    paths,
    signOut: () => void (signedIn = false),
    switchScope: (s: string) => void (scope = s),
  }
}

/** a stream that reached its `run` event, so CONV belongs to `wc` */
async function ownRun(t: ReturnType<typeof setup>, wc: Fake, conv = CONV) {
  const start = await t.doc.start(wc, { question: 'Tóm tắt tài liệu', locale: 'vi' })
  expect(start).toEqual({ ok: true, requestId: expect.any(String) })
  await flush()
  const call = t.calls[t.calls.length - 1]
  call.emit({ type: 'run', conversationId: conv, runId: 'run_1' })
  call.end(DONE)
  await flush()
  return start
}

describe('askUniDocBinding', () => {
  const store = (
    docs: Record<string, { workspaceId: string; documentId: string; orgId: string }>,
    inside = false,
  ) => ({
    store: {
      lookup: (p: string) => (docs[p] ? { binding: docs[p] } : null),
      isInside: () => inside,
    },
    owns: (d: { binding: { orgId: string } }) => d.binding.orgId === 'org_a',
  })

  it('a bound path of the account -> its workspace and document', () => {
    const svc = store({ '/w/a.docx': { workspaceId: WS, documentId: DOC, orgId: 'org_a' } })
    expect(askUniDocBinding(svc as never, '/w/a.docx')).toEqual({
      workspaceId: WS,
      documentId: DOC,
    })
  })

  it("another account's copy -> hidden, a local file -> null", () => {
    const svc = store({ '/w/a.docx': { workspaceId: WS, documentId: DOC, orgId: 'org_b' } })
    expect(askUniDocBinding(svc as never, '/w/a.docx')).toBe('hidden')
    expect(askUniDocBinding(store({}, true) as never, '/w/x.docx')).toBe('hidden')
    expect(askUniDocBinding(store({}) as never, '/tmp/x.docx')).toBeNull()
  })
})

describe('askuni-doc stream', () => {
  it('builds the request in main from the binding; renderer workspace, focus and mentions are dropped', async () => {
    const t = setup()
    const wc = editor(7)
    const start = await t.doc.start(wc, {
      question: '  Tóm tắt  ',
      locale: 'vi',
      model: 'sonnet',
      effort: 'low',
      workspaceId: '01J8OTHERWS000000000000001',
      focus: { kind: 'project', id: 'prj_1' },
      mentions: [{ kind: 'member', id: 'usr_1' }],
      token: 'x',
    })
    expect(start).toEqual({ ok: true, requestId: 'req_1' })
    await flush()
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].req).toEqual({
      workspaceId: WS,
      question: 'Tóm tắt',
      locale: 'vi',
      focus: { kind: 'document', id: DOC },
      model: 'sonnet',
      effort: 'low',
    })
  })

  it('locale defaults to en; a bad question or field is an error with no request', async () => {
    const t = setup()
    const wc = editor(7)
    await t.doc.start(wc, { question: 'Hello' })
    await flush()
    expect(t.calls[0].req.locale).toBe('en')
    expect(await t.doc.start(editor(8), { question: '   ' })).toEqual({ ok: false, error: 'error' })
    expect(await t.doc.start(editor(8), { question: 'x', model: 'gpt' })).toEqual({
      ok: false,
      error: 'error',
    })
    expect(await t.doc.start(editor(8), 'x')).toEqual({ ok: false, error: 'error' })
    await flush()
    expect(t.calls).toHaveLength(1)
  })

  it('a local file is not_bound, another account copy forbidden, no path not_bound, signed out signed_out', async () => {
    const t = setup()
    expect(await t.doc.start(editor(9), { question: 'x' })).toEqual({
      ok: false,
      error: 'not_bound',
    })
    expect(await t.doc.start(editor(10), { question: 'x' })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await t.doc.start(editor(42), { question: 'x' })).toEqual({
      ok: false,
      error: 'not_bound',
    })
    t.signOut()
    expect(await t.doc.start(editor(7), { question: 'x' })).toEqual({
      ok: false,
      error: 'signed_out',
    })
    await flush()
    expect(t.calls).toHaveLength(0)
  })

  it('events go to the asking editor only, on the doc event channel', async () => {
    const t = setup()
    const a = editor(7)
    const b = editor(8)
    await ownRun(t, a)
    expect(a.channels.every((c) => c === ASKUNI_DOC_CHANNELS.streamEvent)).toBe(true)
    expect(a.sent.map((e) => e.type)).toEqual(['run', 'done'])
    expect(b.sent).toEqual([])
  })

  it('a conversationId continues only a conversation of this editor', async () => {
    const t = setup()
    const a = editor(7)
    expect(await t.doc.start(a, { question: 'x', conversationId: OTHER_CONV })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    await ownRun(t, a)
    expect(await t.doc.start(a, { question: 'next', conversationId: CONV })).toEqual({
      ok: true,
      requestId: expect.any(String),
    })
    await flush()
    expect(t.calls[1].req.conversationId).toBe(CONV)
  })

  it('cancels its own request only', async () => {
    const t = setup()
    const a = editor(7)
    const b = editor(8)
    const start = await t.doc.start(a, { question: 'x' })
    await flush()
    const requestId = (start as { requestId: string }).requestId
    expect(t.doc.cancel(b, { requestId })).toEqual({ ok: false, error: 'forbidden' })
    expect(t.calls[0].signal.aborted).toBe(false)
    expect(t.doc.cancel(a, { requestId })).toEqual({ ok: true })
    expect(t.calls[0].signal.aborted).toBe(true)
    expect(a.sent).toEqual([{ type: 'error', code: 'cancelled', requestId }])
  })

  it('one stream per editor: a newer ask cancels the older', async () => {
    const t = setup()
    const a = editor(7)
    await t.doc.start(a, { question: 'one' })
    await flush()
    await t.doc.start(a, { question: 'two' })
    await flush()
    expect(t.calls[0].signal.aborted).toBe(true)
    expect(t.doc.active()).toBe(1)
  })

  it('the editor destroyed aborts its stream, sends nothing and drops its listeners', async () => {
    const t = setup()
    const a = editor(7)
    await t.doc.start(a, { question: 'x' })
    await flush()
    a.destroy()
    expect(t.calls[0].signal.aborted).toBe(true)
    expect(a.sent).toEqual([])
    expect(t.doc.active()).toBe(0)
    expect(a.listenerCount()).toBe(0)
  })

  it('a navigation of the editor aborts its stream and forgets its conversations', async () => {
    const t = setup()
    const a = editor(7)
    await ownRun(t, a)
    await t.doc.start(a, { question: 'x', conversationId: CONV })
    await flush()
    const before = a.sent.length
    a.navigate()
    // RB-8: nothing reaches the navigated page, not even a cancelled terminal
    await flush()
    expect(a.sent).toHaveLength(before)
    expect(t.calls[1].signal.aborted).toBe(true)
    expect(t.doc.active()).toBe(0)
    expect(await t.doc.messages(a, { conversationId: CONV })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(t.rest.messages).not.toHaveBeenCalled()
  })

  it('a path change of the editor ends its stream as cancelled and forgets its conversations', async () => {
    const t = setup()
    const a = editor(7)
    await ownRun(t, a)
    const start = await t.doc.start(a, { question: 'x', conversationId: CONV })
    await flush()
    // the tab now shows another bound document (save-as / rename)
    t.paths.set(7, '/w/budget.xlsx')
    t.calls[1].emit({ type: 'delta', text: 'late' })
    expect(t.calls[1].signal.aborted).toBe(true)
    const requestId = (start as { requestId: string }).requestId
    expect(a.sent.filter((e) => e.requestId === requestId)).toEqual([
      { type: 'error', code: 'cancelled', requestId },
    ])
    expect(await t.doc.messages(a, { conversationId: CONV })).toEqual({
      ok: false,
      error: 'forbidden',
    })
  })

  it('a sign-out or account switch ends the stream as cancelled', async () => {
    const t = setup()
    const a = editor(7)
    await t.doc.start(a, { question: 'x' })
    await flush()
    t.switchScope('acc_2:org_a')
    await new Promise((r) => setTimeout(r, 30))
    expect(t.calls[0].signal.aborted).toBe(true)
    expect(a.sent.at(-1)).toMatchObject({ type: 'error', code: 'cancelled' })
  })
})

describe('askuni-doc s1f (reviewer_be r1)', () => {
  it('RB-1: a done that lands after an account switch (before the next scope tick) is cancelled', async () => {
    const t = setup({ scopeCheckMs: 60_000 })
    const a = editor(7)
    const start = await t.doc.start(a, { question: 'x' })
    await flush()
    t.switchScope('acc_2:org_a')
    t.calls[0].end(DONE)
    await flush()
    const requestId = (start as { requestId: string }).requestId
    expect(a.sent).toEqual([{ type: 'error', code: 'cancelled', requestId }])
  })

  it('RB-8: after an account switch the forgotten conversations are forbidden for messages, feedback and follow-ups', async () => {
    const t = setup({ scopeCheckMs: 60_000 })
    const a = editor(7)
    await ownRun(t, a)
    t.switchScope('acc_2:org_a')
    const forbidden = { ok: false, error: 'forbidden' }
    expect(await t.doc.messages(a, { conversationId: CONV })).toEqual(forbidden)
    expect(
      await t.doc.feedbackSet(a, { conversationId: CONV, messageId: MSG, rating: 'up' }),
    ).toEqual(forbidden)
    expect(await t.doc.feedbackClear(a, { conversationId: CONV, messageId: MSG })).toEqual(
      forbidden,
    )
    expect(await t.doc.start(a, { question: 'x', conversationId: CONV })).toEqual(forbidden)
    expect(t.rest.messages).not.toHaveBeenCalled()
    expect(t.rest.feedbackSet).not.toHaveBeenCalled()
    expect(t.rest.feedbackClear).not.toHaveBeenCalled()
    expect(t.calls).toHaveLength(1)
  })
})

describe('askuni-doc history and feedback: own conversations only', () => {
  it('messages of a conversation this editor saw in its run event', async () => {
    const t = setup()
    const a = editor(7)
    await ownRun(t, a)
    expect(await t.doc.messages(a, { conversationId: CONV })).toEqual({ ok: true, messages: [] })
    expect(t.rest.messages).toHaveBeenCalledWith({ conversationId: CONV })
  })

  it('another conversation, or one another editor saw, is forbidden with no request', async () => {
    const t = setup()
    const a = editor(7)
    const b = editor(8)
    await ownRun(t, a)
    expect(await t.doc.messages(a, { conversationId: OTHER_CONV })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await t.doc.messages(b, { conversationId: CONV })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await t.doc.messages(a, { conversationId: 'bad id' })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(
      await t.doc.feedbackSet(b, { conversationId: CONV, messageId: MSG, rating: 'up' }),
    ).toEqual({ ok: false, error: 'forbidden' })
    expect(await t.doc.feedbackClear(b, { conversationId: CONV, messageId: MSG })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(t.rest.messages).not.toHaveBeenCalled()
    expect(t.rest.feedbackSet).not.toHaveBeenCalled()
    expect(t.rest.feedbackClear).not.toHaveBeenCalled()
  })

  it('feedback on an own conversation passes only the contract fields', async () => {
    const t = setup()
    const a = editor(7)
    await ownRun(t, a)
    expect(
      await t.doc.feedbackSet(a, {
        conversationId: CONV,
        messageId: MSG,
        rating: 'down',
        reason: 'not_helpful',
        note: 'n',
        workspaceId: 'x',
      }),
    ).toEqual({ ok: true })
    expect(t.rest.feedbackSet).toHaveBeenCalledWith({
      conversationId: CONV,
      messageId: MSG,
      rating: 'down',
      reason: 'not_helpful',
      note: 'n',
    })
    expect(await t.doc.feedbackClear(a, { conversationId: CONV, messageId: MSG })).toEqual({
      ok: true,
    })
    expect(t.rest.feedbackClear).toHaveBeenCalledWith({ conversationId: CONV, messageId: MSG })
  })

  it('the conversations are forgotten when the editor is destroyed', async () => {
    const t = setup()
    const a = editor(7)
    await ownRun(t, a)
    a.destroy()
    expect(await t.doc.messages(a, { conversationId: CONV })).toEqual({
      ok: false,
      error: 'forbidden',
    })
  })

  it('signed out -> signed_out; a local file -> not_bound, before any ownership read', async () => {
    const t = setup()
    const a = editor(7)
    await ownRun(t, a)
    expect(await t.doc.messages(editor(9), { conversationId: CONV })).toEqual({
      ok: false,
      error: 'not_bound',
    })
    t.signOut()
    expect(await t.doc.messages(a, { conversationId: CONV })).toEqual({
      ok: false,
      error: 'signed_out',
    })
    expect(t.rest.messages).not.toHaveBeenCalled()
  })
})

describe('askuni-doc flags', () => {
  it('streamEnabled from the flag reader + the bound state of the editor path', async () => {
    const t = setup()
    expect(await t.doc.flags(editor(7))).toEqual({ streamEnabled: true, bound: 'document' })
    expect(await t.doc.flags(editor(9))).toEqual({ streamEnabled: true, bound: 'local' })
    expect(await t.doc.flags(editor(42))).toEqual({ streamEnabled: true, bound: 'local' })
    expect(await t.doc.flags(editor(10))).toEqual({ streamEnabled: true, bound: 'hidden' })
    t.signOut()
    expect(await t.doc.flags(editor(7))).toEqual({ streamEnabled: false, bound: 'signed_out' })
  })

  it('a failing flag reader is off', async () => {
    const t = setup({ flags: { flags: async () => Promise.reject(new Error('x')) } })
    expect(await t.doc.flags(editor(7))).toEqual({ streamEnabled: false, bound: 'document' })
  })
})

describe('registerAskUniDocIpc', () => {
  function registry() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    return {
      ipcMain: {
        handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
          handlers.set(ch, fn),
      },
      handlers,
    }
  }

  it('registers the doc family; every handler checks the sender once and refuses others', async () => {
    const t = setup()
    const { ipcMain, handlers } = registry()
    const isEditorSender = vi.fn((event: unknown) => (event as { ok?: boolean }).ok === true)
    registerAskUniDocIpc(ipcMain as never, { doc: t.doc, isEditorSender })
    const channels = [
      ASKUNI_DOC_CHANNELS.stream,
      ASKUNI_DOC_CHANNELS.streamCancel,
      ASKUNI_DOC_CHANNELS.messages,
      ASKUNI_DOC_CHANNELS.feedbackSet,
      ASKUNI_DOC_CHANNELS.feedbackClear,
      ASKUNI_DOC_CHANNELS.flags,
    ]
    expect([...handlers.keys()].sort()).toEqual([...channels].sort())
    for (const ch of channels) {
      isEditorSender.mockClear()
      expect(await handlers.get(ch)!({ ok: false, sender: editor(7) }, {})).toEqual({
        ok: false,
        error: 'forbidden',
      })
      expect(isEditorSender).toHaveBeenCalledTimes(1)
    }
    await flush()
    expect(t.calls).toHaveLength(0)
    expect(t.rest.messages).not.toHaveBeenCalled()
  })

  it('an allowed editor reaches the service with its own webContents', async () => {
    const t = setup()
    const { ipcMain, handlers } = registry()
    registerAskUniDocIpc(ipcMain as never, { doc: t.doc, isEditorSender: () => true })
    const wc = editor(7)
    expect(await handlers.get(ASKUNI_DOC_CHANNELS.flags)!({ sender: wc })).toEqual({
      streamEnabled: true,
      bound: 'document',
    })
    expect(
      await handlers.get(ASKUNI_DOC_CHANNELS.stream)!({ sender: wc }, { question: 'x' }),
    ).toEqual({
      ok: true,
      requestId: 'req_1',
    })
  })
})
