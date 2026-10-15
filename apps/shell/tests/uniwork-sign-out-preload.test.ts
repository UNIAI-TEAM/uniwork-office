/**
 * @vitest-environment jsdom
 */
/**
 * G5-11: the main-initiated sign-out prompt crossing the shell preload. The
 * account-switch notice (`mode: 'notice'`) is told apart from the sign-out
 * confirm only by `mode`, so the preload must carry it to the renderer; an
 * unknown value is dropped (the renderer then treats the push as a confirm).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'
import type { SignOutPromptRequest } from '../src/shared/home-api'

interface PromptBridge {
  onSignOutPrompt(cb: (request: SignOutPromptRequest) => void): () => void
}

async function loadBridge() {
  vi.resetModules()
  const handlers = new Map<string, (event: unknown, raw: unknown) => void>()
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: (channel: string, cb: (event: unknown, raw: unknown) => void) => {
        handlers.set(channel, cb)
      },
      invoke: async () => undefined,
      send: () => undefined,
      removeListener: (channel: string, cb: unknown) => {
        if (handlers.get(channel) === cb) handlers.delete(channel)
      },
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  const bridge = exposed.aiOffice as unknown as PromptBridge
  const received: SignOutPromptRequest[] = []
  bridge.onSignOutPrompt((request) => received.push(request))
  const push = (raw: unknown) => handlers.get(UNIWORK_DOC_CHANNELS.signOutPrompt)?.({}, raw)
  return { received, push }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

const PLAN = { count: 2, waiting: 0, keystoreLocked: true, ramOnly: 2 }

describe('the sign-out prompt push crossing the preload (G5-11)', () => {
  it('carries mode notice to the renderer', async () => {
    const { received, push } = await loadBridge()
    push({ requestId: 'r1', plan: PLAN, mode: 'notice' })
    expect(received).toEqual([{ requestId: 'r1', plan: PLAN, mode: 'notice' }])
  })

  it('carries mode confirm to the renderer', async () => {
    const { received, push } = await loadBridge()
    push({ requestId: 'r2', plan: PLAN, mode: 'confirm' })
    expect(received).toEqual([{ requestId: 'r2', plan: PLAN, mode: 'confirm' }])
  })

  it('leaves mode absent when main sent none or an unknown value', async () => {
    const { received, push } = await loadBridge()
    push({ requestId: 'r3', plan: PLAN })
    push({ requestId: 'r4', plan: PLAN, mode: 'toast' })
    push({ requestId: 'r5', plan: PLAN, mode: 7 })
    expect(received).toEqual([
      { requestId: 'r3', plan: PLAN },
      { requestId: 'r4', plan: PLAN },
      { requestId: 'r5', plan: PLAN },
    ])
    for (const r of received) expect('mode' in r).toBe(false)
  })

  it('still drops a push without a request id', async () => {
    const { received, push } = await loadBridge()
    push({ plan: PLAN, mode: 'notice' })
    push(null)
    expect(received).toEqual([])
  })
})
