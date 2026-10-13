/**
 * G8-20 (D2-2): the reveal `subscribed` flag is keyed by path, but the
 * subscription belongs to one realm of that path's editor. This reproduces the
 * review probe (W8M-review-be-delta-2-evidence/reveal-reload-probe.cjs): a
 * first realm subscribes, the editor reloads, a launch reveal is decided inside
 * the reload window, and the new realm pulls. Without the reset the stale flag
 * makes the deferred push answer `stillWanted` true - the push is sent before
 * the new listener is armed, the hold is cleared, and the pull reads null. With
 * the reset the hold survives and the pull delivers the reveal exactly once.
 */
import { describe, expect, it } from 'vitest'
import type { IpcMain } from 'electron'
import {
  COMMENTS_CHANNELS,
  type CommentsRevealPayload,
} from '@genoffice/electron-utils/comments-ipc'
import { createUniworkComments } from '../src/main/uniwork-docs/comments-wiring'
import { createPushHolder } from '../src/main/uniwork-docs/launch'

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const PATH = '/home/u/UniWork/Plan.docx'
const CMT = '01J8X4CMTN0000000000000001'

type Listener = (...args: unknown[]) => void

/**
 * The editor webContents: the reveal push target (`isDestroyed`,
 * `isLoadingMainFrame`, `once('did-finish-load')`, `send`) and the
 * `revealPending` sender (id plus the realm events the reset listens to).
 * `arm` marks the new realm's listener as mounted: a push sent before it lands
 * nowhere (the probe's "sent before new listener").
 */
function fakeEditor(id: number) {
  const listeners = new Map<string, Set<Listener>>()
  const whenLoaded: Array<() => void> = []
  const state = { loading: false, destroyed: false, armed: false }
  const received: CommentsRevealPayload[] = []
  const missed: CommentsRevealPayload[] = []

  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
  }

  return {
    id,
    isDestroyed: () => state.destroyed,
    isLoadingMainFrame: () => state.loading,
    send: (_channel: string, payload: unknown): void => {
      ;(state.armed ? received : missed).push(payload as CommentsRevealPayload)
    },
    once: (event: 'did-finish-load', listener: () => void): void => {
      if (event === 'did-finish-load') whenLoaded.push(listener)
    },
    on: (event: string, listener: Listener): void => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    },
    removeListener: (event: string, listener: Listener): void => {
      listeners.get(event)?.delete(listener)
    },
    /** a new document starts loading in the main frame: the realm is replaced */
    reload: (): void => {
      state.loading = true
      state.armed = false
      emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    },
    /** the new document committed (a main-frame navigation) */
    commit: (): void => emit('did-navigate'),
    /** an in-page navigation (same document): the realm stays */
    inPage: (): void => emit('did-start-navigation', { isMainFrame: true, isSameDocument: true }),
    /** a subframe navigation: the main document stays */
    subframe: (): void =>
      emit('did-start-navigation', { isMainFrame: false, isSameDocument: false }),
    /** the renderer process died */
    crash: (): void => emit('render-process-gone'),
    /** the editor window closed */
    close: (): void => {
      state.destroyed = true
      emit('destroyed')
    },
    /** the page finished loading: a deferred push is decided now */
    finishLoading: (): void => {
      state.loading = false
      for (const listener of whenLoaded.splice(0)) listener()
    },
    /** the new realm mounted its listener; the pull follows right away */
    arm: (): void => {
      state.armed = true
    },
    received,
    missed,
  }
}

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

function fakeIpc(): { ipcMain: IpcMain; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn)
    },
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

/** mount the wiring over one editor; `current` is the editor the path shows */
function mount(current: () => ReturnType<typeof fakeEditor>) {
  const { ipcMain, handlers } = fakeIpc()
  const handle = createUniworkComments(ipcMain, {
    service: {
      recentSource: (path: string) =>
        path === PATH
          ? { documentId: DOC, workspaceId: 'ws-1', title: 'Plan', access: 'edit' as const }
          : null,
    } as unknown as Parameters<typeof createUniworkComments>[1]['service'],
    profile: () => ({ apiOrigin: ORIGIN }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    // the shell's sendReveal: the real push holder over the editor webContents
    sendReveal: (payload, stillWanted) =>
      createPushHolder<CommentsRevealPayload>(
        () => current(),
        COMMENTS_CHANNELS.reveal,
        stillWanted,
      )(payload),
    shownPath: (sender) => (sender.id === current().id ? PATH : null),
  })
  const pull = async (editor: ReturnType<typeof fakeEditor>) =>
    (await handlers.get(COMMENTS_CHANNELS.revealPending)!({ sender: editor }, undefined)) as {
      path: string
      commentId: string
    } | null
  return { handle, pull }
}

describe('D2-2: a replaced editor realm drops its reveal subscription', () => {
  it('a deferred push across a reload stays held and the new realm pulls it once (probe)', async () => {
    const editor = fakeEditor(7)
    const { handle, pull } = mount(() => editor)

    expect(await pull(editor)).toBeNull() // the first realm subscribes, nothing held
    editor.reload() // the document starts loading; its listener is gone
    handle.reveal(PATH, 'new-after-reload') // the launch reveal lands inside the reload window
    editor.finishLoading() // did-finish-load: the stale realm must not deliver it
    expect(editor.received).toEqual([]) // the push never reached a mounted listener
    editor.arm() // the new realm mounts its listener and pulls
    expect(await pull(editor)).toEqual({ path: PATH, commentId: 'new-after-reload' })
    expect(await pull(editor)).toBeNull() // delivered once

    // the new subscription is live: a later reveal goes straight to it
    handle.reveal(PATH, 'c2')
    expect(editor.received).toEqual([{ path: PATH, commentId: 'c2' }])
    expect(await pull(editor)).toBeNull()
  })

  it('a reveal decided after the reload, before the new realm pulls, stays held', async () => {
    const editor = fakeEditor(7)
    const { handle, pull } = mount(() => editor)

    expect(await pull(editor)).toBeNull()
    editor.reload()
    editor.finishLoading() // the new document is loaded; nothing subscribed yet
    handle.reveal(PATH, CMT) // handed straight to a realm whose listener is not armed
    expect(editor.received).toEqual([])
    expect(await pull(editor)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(editor)).toBeNull()
  })

  it('a main-frame commit (did-navigate) resets too', async () => {
    const editor = fakeEditor(7)
    const { handle, pull } = mount(() => editor)

    expect(await pull(editor)).toBeNull()
    editor.commit()
    handle.reveal(PATH, CMT)
    expect(await pull(editor)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(editor)).toBeNull()
  })

  it('a crashed renderer drops the subscription, so the next pull gets the reveal', async () => {
    const editor = fakeEditor(7)
    const { handle, pull } = mount(() => editor)

    expect(await pull(editor)).toBeNull()
    editor.crash() // the renderer process died; the realm is gone
    handle.reveal(PATH, CMT) // not loading: the push is sent into the crashed realm
    expect(await pull(editor)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(editor)).toBeNull()
  })

  it("a closed editor's subscription does not outlive it: the reopened editor pulls the hold", async () => {
    const first = fakeEditor(7)
    const reopened = fakeEditor(9)
    let current = first
    const { handle, pull } = mount(() => current)

    expect(await pull(first)).toBeNull() // the first editor subscribes
    first.close() // the window closes; its realm is gone
    current = reopened // the path opens again in a fresh webContents
    reopened.reload() // its document loads
    handle.reveal(PATH, CMT) // the reveal is decided during that load
    reopened.finishLoading()
    reopened.arm()
    expect(await pull(reopened)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(reopened)).toBeNull()
  })

  it('in-page and subframe navigations keep the subscription: a delivered push ends the hold', async () => {
    const editor = fakeEditor(7)
    const { handle, pull } = mount(() => editor)

    expect(await pull(editor)).toBeNull()
    editor.arm() // the realm's listener is mounted from the moment it pulls
    editor.inPage()
    editor.subframe()
    handle.reveal(PATH, CMT) // the realm is still the subscribed one: it lands there
    expect(editor.received).toEqual([{ path: PATH, commentId: CMT }])
    expect(await pull(editor)).toBeNull() // D1-1: nothing is replayed
  })
})
