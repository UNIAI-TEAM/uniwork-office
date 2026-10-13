/**
 * G8-11 (UNI-1406): the shell preload exposes `window.uniworkDiscussion`
 * (lane contract §3.1) and the six editor preloads do not. Each call forwards
 * to its `uniwork:discussion:*` channel and resolves to the CommentsReply
 * envelope unchanged (R1-1). `onReveal(path)` arms main's push for that path,
 * pulls the held reveal once, ignores pushes for other paths, drops a pull
 * answer a newer push superseded and disarms on unsubscribe. `setPanel` is a
 * one-way send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISCUSSION_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import type { UniworkDiscussionApi } from '@genoffice/electron-utils/comments-ipc'

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoked: [] as Array<{ channel: string; args: unknown[] }>,
  sent: [] as Array<{ channel: string; args: unknown[] }>,
  listeners: new Map<string, Set<(event: unknown, payload: unknown) => void>>(),
  invokeImpl: undefined as undefined | ((channel: string, args: unknown[]) => Promise<unknown>),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => void bridge.exposed.set(name, value),
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      bridge.invoked.push({ channel, args })
      return bridge.invokeImpl
        ? bridge.invokeImpl(channel, args)
        : Promise.resolve({ ok: true, value: undefined })
    },
    send: (channel: string, ...args: unknown[]) => void bridge.sent.push({ channel, args }),
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => {
      const set = bridge.listeners.get(channel) ?? new Set()
      set.add(listener)
      bridge.listeners.set(channel, set)
    },
    removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) =>
      void bridge.listeners.get(channel)?.delete(listener),
  },
  webUtils: { getPathForFile: () => '' },
}))

const PATH = '/w/Plan.docx'

function push(payload: unknown): void {
  for (const listener of bridge.listeners.get(DISCUSSION_CHANNELS.reveal) ?? []) {
    listener({}, payload)
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function api(): Promise<UniworkDiscussionApi> {
  const { createUniworkDiscussionApi } = await import('@genoffice/electron-utils/discussion-bridge')
  return createUniworkDiscussionApi()
}

beforeEach(() => {
  bridge.exposed.clear()
  bridge.invoked.length = 0
  bridge.sent.length = 0
  bridge.listeners.clear()
  bridge.invokeImpl = undefined
})

describe('the discussion bridge surface', () => {
  it('installs under window.uniworkDiscussion with the contract §3.1 methods', async () => {
    const { installUniworkDiscussionBridge } =
      await import('@genoffice/electron-utils/discussion-bridge')
    installUniworkDiscussionBridge()
    const exposed = bridge.exposed.get('uniworkDiscussion') as Record<string, unknown>
    expect(Object.keys(exposed).sort()).toEqual(
      [
        'list',
        'create',
        'update',
        'remove',
        'resolve',
        'reopen',
        'revisions',
        'searchMentions',
        'onReveal',
        'setPanel',
      ].sort(),
    )
  })

  it('forwards each call to its uniwork:discussion:* channel and returns the envelope', async () => {
    const a = await api()
    bridge.invokeImpl = async () => ({ ok: false, error: { code: 'not_found', message: 'x' } })
    expect(await a.list({ path: PATH })).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'x' },
    })
    await a.create({ path: PATH, body: 'hi' })
    await a.remove({ path: PATH, commentId: 'c1' })
    await a.searchMentions({ path: PATH, q: 'an' })
    expect(bridge.invoked.map((c) => c.channel)).toEqual([
      'uniwork:discussion:list',
      'uniwork:discussion:create',
      'uniwork:discussion:delete',
      'uniwork:discussion:search-mentions',
    ])
    expect(bridge.invoked[1]!.args).toEqual([{ path: PATH, body: 'hi' }])
  })

  it('setPanel is a one-way send of { open, width }', async () => {
    const a = await api()
    a.setPanel({ open: true, width: 320 })
    expect(bridge.sent).toEqual([
      { channel: DISCUSSION_CHANNELS.panel, args: [{ open: true, width: 320 }] },
    ])
  })
})

describe('onReveal(path)', () => {
  it('pulls the held reveal for its path once, then hears pushes for that path only', async () => {
    const a = await api()
    bridge.invokeImpl = async (channel) =>
      channel === DISCUSSION_CHANNELS.revealPending ? { path: PATH, commentId: 'c1' } : null
    const heard: string[] = []
    a.onReveal(PATH, (id) => heard.push(id))
    await flush()
    expect(bridge.invoked).toEqual([
      { channel: DISCUSSION_CHANNELS.revealPending, args: [{ path: PATH }] },
    ])
    push({ path: PATH, commentId: 'c2' })
    push({ path: '/w/Other.docx', commentId: 'c3' })
    push({ path: PATH, commentId: '' })
    expect(heard).toEqual(['c1', 'c2'])
  })

  it('a pull answer for another path is dropped', async () => {
    const a = await api()
    bridge.invokeImpl = async () => ({ path: '/w/Other.docx', commentId: 'c1' })
    const heard: string[] = []
    a.onReveal(PATH, (id) => heard.push(id))
    await flush()
    expect(heard).toEqual([])
  })

  it('a push that lands while the pull is in flight supersedes its answer', async () => {
    const a = await api()
    let answer: (value: unknown) => void = () => undefined
    bridge.invokeImpl = () => new Promise((resolve) => (answer = resolve))
    const heard: string[] = []
    a.onReveal(PATH, (id) => heard.push(id))
    push({ path: PATH, commentId: 'new' })
    answer({ path: PATH, commentId: 'old' })
    await flush()
    expect(heard).toEqual(['new'])
  })

  it('the unsubscribe stops pushes, drops a late pull answer and releases the path', async () => {
    const a = await api()
    let answer: (value: unknown) => void = () => undefined
    bridge.invokeImpl = () => new Promise((resolve) => (answer = resolve))
    const heard: string[] = []
    const off = a.onReveal(PATH, (id) => heard.push(id))
    off()
    answer({ path: PATH, commentId: 'late' })
    await flush()
    push({ path: PATH, commentId: 'c2' })
    expect(heard).toEqual([])
    expect(bridge.sent).toEqual([
      { channel: DISCUSSION_CHANNELS.revealRelease, args: [{ path: PATH }] },
    ])
  })
})

describe('only the shell preload installs it', () => {
  it('the shell preload calls installUniworkDiscussionBridge; no editor preload does', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
    expect(read('../src/preload/index.ts')).toMatch(/installUniworkDiscussionBridge\(\)/)
    for (const app of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']) {
      expect(read(`../../${app}/src/preload/index.ts`), app).not.toMatch(
        /uniworkDiscussion|discussion-bridge/i,
      )
    }
  })
})
