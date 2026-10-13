/**
 * G8-11 (UNI-1406): the shell Discussion panel's main-side bridge (lane
 * contract §2 D2/D3, §3.1). The panel lives in the SHELL renderer, so its
 * channels are served only for the shell webContents of a window, only for a
 * path that is an open tab of that window and bound, with `kind` forced to
 * 'discussion' on list/create. A launch reveal keeps its editor delivery
 * (G8-08) and is ALSO pushed to / held for the shell panel per path. Every
 * call runs against the in-memory fake server (fixtures/comments-fake-server).
 */
import { describe, expect, it } from 'vitest'
import type { IpcMain } from 'electron'
import { COMMENTS_CHANNELS, DISCUSSION_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import { createUniworkComments } from '../src/main/uniwork-docs/comments-wiring'
import { createFakeCommentServer } from './fixtures/comments-fake-server'

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const PATH = '/home/u/UniWork/Plan.docx'
/** bound to UniWork but not open in the shell window */
const OTHER = '/home/u/UniWork/Other.docx'
const OTHER_DOC = '01J8X4DOC0OTHER000000000'
/** open as a tab but a plain local file */
const LOCAL = '/home/u/Desktop/copy.docx'
const CMT = '01J8X4CMTN0000000000000001'
const SHELL_ID = 1
const EDITOR_ID = 7

type Listener = (...args: unknown[]) => void
type Handler = (event: unknown, payload: unknown) => unknown

/** the shell window's webContents: push target + realm events (D2-2 reset) */
function fakeShell(id = SHELL_ID) {
  const listeners = new Map<string, Set<Listener>>()
  const state = { destroyed: false }
  const sent: Array<{ channel: string; payload: unknown }> = []
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
  }
  return {
    id,
    isDestroyed: () => state.destroyed,
    send: (channel: string, payload: unknown): void => void sent.push({ channel, payload }),
    on: (event: string, listener: Listener): void => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    },
    removeListener: (event: string, listener: Listener): void => {
      listeners.get(event)?.delete(listener)
    },
    reload: (): void => emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }),
    inPage: (): void => emit('did-start-navigation', { isMainFrame: true, isSameDocument: true }),
    crash: (): void => emit('render-process-gone'),
    close: (): void => {
      state.destroyed = true
      emit('destroyed')
    },
    sent,
  }
}

function fakeIpc() {
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, fn: Handler) => void handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => void listeners.set(channel, fn),
  } as unknown as IpcMain
  return { ipcMain, handlers, listeners }
}

function mount(options: { tabs?: string[] } = {}) {
  const { ipcMain, handlers, listeners } = fakeIpc()
  const server = createFakeCommentServer()
  const shell = fakeShell()
  const tabs = options.tabs ?? [PATH, LOCAL]
  const editorReveals: Array<{ path: string; commentId: string }> = []
  const panels: Array<{ senderId: number; open: boolean; width: number }> = []
  const handle = createUniworkComments(ipcMain, {
    service: {
      recentSource: (path: string) =>
        path === PATH
          ? { documentId: DOC, workspaceId: 'ws-1', title: 'Plan', access: 'edit' as const }
          : path === OTHER
            ? { documentId: OTHER_DOC, workspaceId: 'ws-1', title: 'Other', access: 'edit' }
            : null,
    } as unknown as Parameters<typeof createUniworkComments>[1]['service'],
    profile: () => ({ apiOrigin: ORIGIN }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch: server.fetch,
    sendReveal: (payload) => {
      editorReveals.push(payload)
      return 'delivered'
    },
    shownPath: (sender) => (sender.id === EDITOR_ID ? PATH : null),
    shellTabPaths: (sender) => (sender.id === shell.id && !shell.isDestroyed() ? tabs : null),
    shellTarget: (path) => (tabs.includes(path) ? shell : null),
    setDiscussionPanel: (sender, panel) => void panels.push({ senderId: sender.id, ...panel }),
  })
  const call = (channel: string, payload: unknown, sender: { id: number } = shell) =>
    handlers.get(channel)!({ sender }, payload) as Promise<{
      ok: boolean
      value?: unknown
      error?: { code: string }
    }>
  const pull = (path: string, sender: { id: number } = shell) =>
    handlers.get(DISCUSSION_CHANNELS.revealPending)!({ sender }, { path }) as Promise<{
      path: string
      commentId: string
    } | null>
  const release = (path: string, sender: { id: number } = shell) =>
    listeners.get(DISCUSSION_CHANNELS.revealRelease)!({ sender }, { path })
  const setPanel = (payload: unknown, sender: { id: number } = shell) =>
    listeners.get(DISCUSSION_CHANNELS.panel)!({ sender }, payload)
  const shellReveals = () =>
    shell.sent.filter((s) => s.channel === DISCUSSION_CHANNELS.reveal).map((s) => s.payload)
  return {
    handle,
    handlers,
    listeners,
    server,
    shell,
    call,
    pull,
    release,
    setPanel,
    shellReveals,
    editorReveals,
    panels,
  }
}

describe('the discussion channels are registered next to the comments ones', () => {
  it('one handler per discussion request kind, the reveal pull, release and panel', () => {
    const { handlers, listeners } = mount()
    for (const key of [
      'list',
      'create',
      'update',
      'remove',
      'resolve',
      'reopen',
      'revisions',
      'searchMentions',
      'revealPending',
    ] as const) {
      expect(handlers.has(DISCUSSION_CHANNELS[key]), key).toBe(true)
    }
    expect(listeners.has(DISCUSSION_CHANNELS.revealRelease)).toBe(true)
    expect(listeners.has(DISCUSSION_CHANNELS.panel)).toBe(true)
    // the editor comments channels stay as they were
    expect(handlers.has(COMMENTS_CHANNELS.list)).toBe(true)
    expect(handlers.has(COMMENTS_CHANNELS.revealPending)).toBe(true)
  })
})

describe('sender and path refusals (D2): no request reaches the server', () => {
  it('an editor webContents is refused on every discussion channel', async () => {
    const { call, server } = mount()
    const editor = { id: EDITOR_ID }
    for (const [channel, payload] of [
      [DISCUSSION_CHANNELS.list, { path: PATH }],
      [DISCUSSION_CHANNELS.create, { path: PATH, body: 'x' }],
      [DISCUSSION_CHANNELS.update, { path: PATH, commentId: CMT, body: 'x' }],
      [DISCUSSION_CHANNELS.remove, { path: PATH, commentId: CMT }],
      [DISCUSSION_CHANNELS.resolve, { path: PATH, commentId: CMT }],
      [DISCUSSION_CHANNELS.reopen, { path: PATH, commentId: CMT }],
      [DISCUSSION_CHANNELS.revisions, { path: PATH, commentId: CMT }],
      [DISCUSSION_CHANNELS.searchMentions, { path: PATH, q: 'an' }],
    ] as const) {
      const reply = await call(channel, payload, editor)
      expect(reply, channel).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    }
    expect(server.calls).toHaveLength(0)
  })

  it('a destroyed shell (no window) is refused', async () => {
    const { call, shell, server } = mount()
    shell.close()
    expect(await call(DISCUSSION_CHANNELS.list, { path: PATH })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    expect(server.calls).toHaveLength(0)
  })

  it('a bound document that is not an open tab of that window reads not_found', async () => {
    const { call, server } = mount()
    expect(await call(DISCUSSION_CHANNELS.list, { path: OTHER })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(
      await call(DISCUSSION_CHANNELS.update, { path: OTHER, commentId: CMT, body: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect(server.calls).toHaveLength(0)
  })

  it('an open tab that is not bound (a local file) reads not_found', async () => {
    const { call, server } = mount()
    expect(await call(DISCUSSION_CHANNELS.list, { path: LOCAL })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(server.calls).toHaveLength(0)
  })

  it('a malformed payload is refused before any request', async () => {
    const { call, server } = mount()
    expect(await call(DISCUSSION_CHANNELS.create, { path: PATH, body: '' })).toMatchObject({
      ok: false,
      error: { code: 'malformed' },
    })
    expect(await call(DISCUSSION_CHANNELS.list, null)).toMatchObject({
      ok: false,
      error: { code: 'malformed' },
    })
    expect(server.calls).toHaveLength(0)
  })
})

describe('kind is forced to discussion (D2)', () => {
  it('list asks the server for kind=discussion only', async () => {
    const { call, server } = mount()
    server.seed(DOC, [
      { id: CMT, body: 'post', kind: 'discussion' },
      { id: '01J8X4CMTN0000000000000002', body: 'anchored', kind: 'comment' },
    ])
    const reply = (await call(DISCUSSION_CHANNELS.list, { path: PATH })) as {
      ok: true
      value: { comments: Array<{ id: string }> }
    }
    expect(reply.ok).toBe(true)
    expect(reply.value.comments.map((c) => c.id)).toEqual([CMT])
    expect(server.lastCall()?.url).toContain(`/api/v1/documents/${DOC}/comments?kind=discussion`)
  })

  it('list refuses a kind other than discussion', async () => {
    const { call, server } = mount()
    expect(await call(DISCUSSION_CHANNELS.list, { path: PATH, kind: 'comment' })).toMatchObject({
      ok: false,
      error: { code: 'malformed' },
    })
    expect(server.calls).toHaveLength(0)
  })

  it('create sends kind discussion with no anchor; a reply keeps its parent', async () => {
    const { call, server } = mount()
    const post = (await call(DISCUSSION_CHANNELS.create, { path: PATH, body: 'hello' })) as {
      ok: true
      value: { comment: { id: string } }
    }
    expect(post.ok).toBe(true)
    expect(server.lastCall()?.body).toEqual({ kind: 'discussion', body: 'hello' })
    await call(DISCUSSION_CHANNELS.create, {
      path: PATH,
      body: 'reply',
      parentId: post.value.comment.id,
    })
    expect(server.lastCall()?.body).toEqual({
      kind: 'discussion',
      body: 'reply',
      parent_id: post.value.comment.id,
    })
  })

  it('create refuses an anchor, a base version or kind comment', async () => {
    const { call, server } = mount()
    for (const extra of [
      { anchor: { format: 'docx', v: 1 }, baseVersionId: 'v1' },
      { baseVersionId: 'v1' },
      { kind: 'comment' },
    ]) {
      expect(
        await call(DISCUSSION_CHANNELS.create, { path: PATH, body: 'x', ...extra }),
      ).toMatchObject({ ok: false, error: { code: 'malformed' } })
    }
    expect(server.calls).toHaveLength(0)
  })

  it('id-based calls and mentions run against the bound document of that tab', async () => {
    const { call, server } = mount()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'discussion' }])
    expect(
      await call(DISCUSSION_CHANNELS.update, { path: PATH, commentId: CMT, body: 'new' }),
    ).toMatchObject({ ok: true })
    expect(await call(DISCUSSION_CHANNELS.resolve, { path: PATH, commentId: CMT })).toMatchObject(
      { ok: true },
    )
    expect(await call(DISCUSSION_CHANNELS.reopen, { path: PATH, commentId: CMT })).toMatchObject({
      ok: true,
    })
    expect(
      await call(DISCUSSION_CHANNELS.revisions, { path: PATH, commentId: CMT }),
    ).toMatchObject({ ok: true })
    expect(
      await call(DISCUSSION_CHANNELS.searchMentions, { path: PATH, q: 'an' }),
    ).toMatchObject({ ok: true })
    expect(await call(DISCUSSION_CHANNELS.remove, { path: PATH, commentId: CMT })).toMatchObject({
      ok: true,
    })
    for (const c of server.calls) expect(c.url).toContain(`/api/v1/documents/${DOC}/`)
  })
})

describe('reveal for the shell panel: push when armed, else hold; delivered once (D3)', () => {
  it('the editor delivery is unchanged and the shell holds the reveal until it pulls', async () => {
    const { handle, pull, shellReveals, editorReveals } = mount()
    handle.reveal(PATH, CMT)
    expect(editorReveals).toEqual([{ path: PATH, commentId: CMT }])
    expect(shellReveals()).toEqual([]) // the panel listener is not armed yet
    expect(await pull(PATH)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(PATH)).toBeNull() // once
  })

  it('an armed listener gets the push, and a resubscribe does not replay it', async () => {
    const { handle, pull, shellReveals } = mount()
    expect(await pull(PATH)).toBeNull()
    handle.reveal(PATH, CMT)
    expect(shellReveals()).toEqual([{ path: PATH, commentId: CMT }])
    expect(await pull(PATH)).toBeNull()
  })

  it('a released listener is not pushed: the reveal waits for the next pull', async () => {
    const { handle, pull, release, shellReveals } = mount()
    await pull(PATH)
    release(PATH)
    handle.reveal(PATH, CMT)
    expect(shellReveals()).toEqual([])
    expect(await pull(PATH)).toEqual({ path: PATH, commentId: CMT })
  })

  it('arming one path does not arm another', async () => {
    const tabs = [PATH, OTHER]
    const { handle, pull, shellReveals } = mount({ tabs })
    await pull(PATH)
    handle.reveal(OTHER, CMT)
    expect(shellReveals()).toEqual([])
    expect(await pull(OTHER)).toEqual({ path: OTHER, commentId: CMT })
  })

  it('a pull is refused for another sender, a path not open or not bound', async () => {
    const { handle, pull } = mount()
    handle.reveal(PATH, CMT)
    expect(await pull(PATH, { id: EDITOR_ID })).toBeNull()
    expect(await pull(OTHER)).toBeNull()
    expect(await pull(LOCAL)).toBeNull()
    // none of them cleared the hold
    expect(await pull(PATH)).toEqual({ path: PATH, commentId: CMT })
  })

  it('an unbound path is never held or pushed', async () => {
    const { handle, pull, shellReveals } = mount()
    await pull(LOCAL)
    handle.reveal(LOCAL, CMT)
    expect(shellReveals()).toEqual([])
    expect(await pull(LOCAL)).toBeNull()
  })

  it('a reload of the shell drops the armed listener (D2-2): the next pull gets the reveal', async () => {
    const { handle, pull, shell, shellReveals } = mount()
    await pull(PATH)
    shell.reload()
    handle.reveal(PATH, CMT)
    expect(shellReveals()).toEqual([])
    expect(await pull(PATH)).toEqual({ path: PATH, commentId: CMT })
  })

  it('a crash drops it too; an in-page navigation keeps it', async () => {
    const a = mount()
    await a.pull(PATH)
    a.shell.crash()
    a.handle.reveal(PATH, CMT)
    expect(a.shellReveals()).toEqual([])

    const b = mount()
    await b.pull(PATH)
    b.shell.inPage()
    b.handle.reveal(PATH, CMT)
    expect(b.shellReveals()).toEqual([{ path: PATH, commentId: CMT }])
  })

  it('the latest reveal for a path wins while held', async () => {
    const { handle, pull } = mount()
    handle.reveal(PATH, CMT)
    handle.reveal(PATH, '01J8X4CMTN0000000000000002')
    expect(await pull(PATH)).toEqual({ path: PATH, commentId: '01J8X4CMTN0000000000000002' })
  })
})

describe('setPanel narrows the active editor view of the sender window only', () => {
  it('forwards a well-formed panel request from the shell', () => {
    const { setPanel, panels } = mount()
    setPanel({ open: true, width: 360 })
    setPanel({ open: false, width: 360 })
    expect(panels).toEqual([
      { senderId: SHELL_ID, open: true, width: 360 },
      { senderId: SHELL_ID, open: false, width: 360 },
    ])
  })

  it('ignores an editor sender and a malformed payload', () => {
    const { setPanel, panels } = mount()
    setPanel({ open: true, width: 360 }, { id: EDITOR_ID })
    setPanel({ open: 'yes', width: 360 })
    setPanel({ open: true, width: Number.NaN })
    setPanel(null)
    expect(panels).toEqual([])
  })

  it('a shell reload or crash restores the editor view', () => {
    const { setPanel, shell, panels, pull } = mount()
    void pull(PATH) // the realm is watched from the first shell call on
    setPanel({ open: true, width: 360 })
    shell.reload()
    expect(panels.at(-1)).toEqual({ senderId: SHELL_ID, open: false, width: 0 })
  })
})
