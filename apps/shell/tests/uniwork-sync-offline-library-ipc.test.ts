import { describe, expect, it, vi } from 'vitest'
import type { UniworkDocLock } from '../src/shared/home-api'
import { UNIWORK_SYNC_CENTER_CHANNELS } from '../src/shared/sync-center'
import type { IpcMainLike } from '../src/main/uniwork-sync/sync-center'
import {
  createOfflineLibraryApi,
  registerOfflineLibraryIpc,
  type OfflineLibraryApi,
  type OfflineLibraryApiDeps,
} from '../src/main/uniwork-sync/offline-library/api'
import type { OfflineCopyOutcome } from '../src/main/uniwork-sync/offline-library/copies'
import type { OfflineLibraryManagerOptions } from '../src/main/uniwork-sync/offline-library'
import {
  ORG,
  SCOPE,
  WS,
  addDoc,
  createHarness,
  type Harness,
} from './uniwork-sync-offline-library-fakes'

/**
 * G5-05u B3/B4: the offline library IPC of the sync center object - pin returns
 * at once, the row arrives through the push, every refusal carries its code, and
 * no channel can set a row's ready/verified/lease state (A04-3).
 */

interface Bridge {
  api: OfflineLibraryApi
  h: Harness
  pushes: () => number
  locks: UniworkDocLock[]
  clock: { now: number }
}

function bridge(h: Harness, over: Partial<OfflineLibraryApiDeps> = {}): Bridge {
  const clock = { now: 0 }
  let pushes = 0
  const locks: UniworkDocLock[] = []
  const api = createOfflineLibraryApi({
    library: () => h.manager,
    activeOrgId: () => ORG,
    capabilityOn: async () => h.capability.on,
    signedOut: () => h.session.scope === null,
    lastOwner: () => null,
    libraryLayer: () => h.layer,
    openDocument: async () => false,
    openCopy: async () => ({ kind: 'none' }),
    revealLibraryFolder: async () => true,
    lockRefused: (lock) => locks.push(lock),
    changed: () => {
      pushes += 1
    },
    now: () => clock.now,
    ...over,
  })
  return { api, h, pushes: () => pushes, locks, clock }
}

/**
 * A library whose `onChange` reaches the api - what the runtime's
 * `library.onChange` wiring does in production, so the push really is the
 * engine's own signal.
 */
function wiredBridge(
  managerOptions: Partial<OfflineLibraryManagerOptions> = {},
  over: Partial<OfflineLibraryApiDeps> = {},
): Bridge {
  const apiRef: { current: OfflineLibraryApi | null } = { current: null }
  const h = createHarness({
    ...managerOptions,
    onChange: (documentId) => apiRef.current?.rowChanged(documentId),
  })
  const b = bridge(h, over)
  apiRef.current = b.api
  return b
}

/** a gate the fake download waits on before chunk `at` (a slow transfer) */
function slowDownload(h: Harness, documentId: string, at: number) {
  const gate = Promise.withResolvers<void>()
  const reached = Promise.withResolvers<void>()
  h.docs.beforeChunk = async (id, index) => {
    if (id !== documentId || index !== at) return
    reached.resolve()
    await gate.promise
  }
  return { release: () => gate.resolve(), waiting: reached.promise }
}

const pin = (b: Bridge, documentId = 'doc_1') => b.api.pin({ documentId, workspaceId: WS })

/**
 * The fake download is promise-only (no timers), so one macrotask boundary
 * flushes every remaining chunk and the commit behind it.
 */
const flushTasks = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('G5-05u B4 offlinePin', () => {
  it('returns before the download finishes, and the row arrives through the push', async () => {
    const b = wiredBridge()
    const h = b.h
    addDoc(h, 'doc_1', 1, 4096)
    h.docs.chunkSize = 1024
    const slow = slowDownload(h, 'doc_1', 2)
    const order: string[] = []
    void slow.waiting.then(() => order.push('chunk-2'))
    expect(await pin(b)).toEqual({ ok: true })
    order.push('answered')
    // the transfer is still on chunk 2: the call answered while it ran
    expect(order).toEqual(['answered'])
    expect(b.pushes()).toBeGreaterThan(0)
    expect((await b.api.snapshot()).rows[0]).toMatchObject({
      documentId: 'doc_1',
      state: 'downloading',
    })
    slow.release()
    await flushTasks()
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'ready' })
  })

  it('a pin of an already pinned document answers at once without downloading', async () => {
    const h = createHarness()
    const b = bridge(h)
    addDoc(h, 'doc_1', 1)
    expect(await pin(b)).toEqual({ ok: true })
    h.docs.downloads.length = 0
    expect(await pin(b)).toEqual({ ok: true })
    expect(h.docs.downloads).toEqual([])
  })

  it('refuses with capability_off, pinning nothing (OQ-UX11 a)', async () => {
    const h = createHarness()
    const b = bridge(h)
    addDoc(h, 'doc_1', 1)
    h.capability.on = false
    expect(await pin(b)).toEqual({ ok: false, code: 'capability_off' })
    expect(await h.manager.row('doc_1')).toBeNull()
  })

  it('refuses with offline_cap_reached carrying the byte cap and the pin cap', async () => {
    const h = createHarness({ limits: { maxPins: 1 } })
    const b = bridge(h, {
      library: () => h.manager,
    })
    addDoc(h, 'doc_1', 1)
    addDoc(h, 'doc_2', 1)
    expect(await pin(b, 'doc_1')).toEqual({ ok: true })
    expect(await pin(b, 'doc_2')).toEqual({
      ok: false,
      code: 'offline_cap_reached',
      cap: 2 * 1024 * 1024 * 1024,
      maxDocs: 1,
    })
    expect(await h.manager.row('doc_2')).toBeNull()
  })

  it('refuses without a session and without the ids', async () => {
    const h = createHarness()
    const b = bridge(h, { library: () => null })
    expect(await pin(b)).toEqual({ ok: false, code: 'no_session' })
    const live = bridge(h)
    expect(await live.api.pin({ documentId: '', workspaceId: WS })).toEqual({
      ok: false,
      code: 'invalid',
    })
  })
})

describe('G5-05u B4 offlineUnpin / offlineCancel / offlineDownloadNow', () => {
  it('needs_confirm while the document has local work, then unpins when confirmed', async () => {
    const h = createHarness()
    const b = bridge(h)
    addDoc(h, 'doc_1', 1)
    expect(await pin(b)).toEqual({ ok: true })
    h.localWork.add('doc_1')
    expect(await b.api.unpin('doc_1')).toEqual({ ok: false, code: 'needs_confirm' })
    expect(await h.manager.row('doc_1')).not.toBeNull()
    expect(await b.api.unpin('doc_1', { confirmed: true })).toEqual({
      ok: true,
      deferred: false,
    })
    expect(await h.manager.row('doc_1')).toBeNull()
  })

  it('a deferred unpin (a tab is open) reports it', async () => {
    const h = createHarness()
    const b = bridge(h)
    addDoc(h, 'doc_1', 1)
    expect(await pin(b)).toEqual({ ok: true })
    h.manager.markOpen('doc_1')
    expect(await b.api.unpin('doc_1')).toEqual({ ok: true, deferred: true })
  })

  it('cancel stops the download and leaves the row interrupted, with no copy', async () => {
    const h = createHarness()
    const b = bridge(h)
    addDoc(h, 'doc_1', 1, 4096)
    h.docs.chunkSize = 1024
    const slow = slowDownload(h, 'doc_1', 2)
    const call = pin(b)
    await slow.waiting
    expect(await b.api.cancel('doc_1')).toEqual({ ok: true })
    slow.release()
    expect(await call).toEqual({ ok: true })
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'interrupted', bytes: 0 })
  })

  it('downloadNow returns at once and retries the interrupted download', async () => {
    const b = wiredBridge()
    const h = b.h
    addDoc(h, 'doc_1', 1, 4096)
    h.docs.chunkSize = 1024
    const slow = slowDownload(h, 'doc_1', 2)
    // the engine's own promise: this one does wait for the transfer to end
    const pinned = h.manager.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
    await slow.waiting
    await b.api.cancel('doc_1')
    slow.release()
    await pinned
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'interrupted' })
    // the retry is gated the same way: the call must answer while it still runs,
    // so an awaited handler would show here (BE-R1-7)
    const gate = slowDownload(h, 'doc_1', 2)
    const order: string[] = []
    void gate.waiting.then(() => order.push('chunk-2'))
    const retried = b.api.downloadNow('doc_1')
    void retried.then(() => order.push('answered'))
    await gate.waiting
    await flushTasks()
    // answered while the transfer is still gated at chunk 2 (BE-R1-7)
    expect(order).toContain('answered')
    gate.release()
    await retried
    await flushTasks()
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'ready', readyVersion: 1 })
  })

  it('a document that is not pinned refuses not_pinned', async () => {
    const h = createHarness()
    const b = bridge(h)
    expect(await b.api.downloadNow('doc_1')).toEqual({ ok: false, code: 'not_pinned' })
    expect(await b.api.unpin('doc_1')).toEqual({ ok: false, code: 'not_pinned' })
  })
})

describe('G5-05u B4 offlineState / offlineOpenFolder', () => {
  it('offlineState answers whether the document is pinned, with the capability', async () => {
    const h = createHarness()
    const b = bridge(h)
    addDoc(h, 'doc_1', 1)
    expect(await b.api.state('doc_1')).toEqual({
      pinned: false,
      state: null,
      capabilityOn: true,
    })
    await pin(b)
    expect(await b.api.state('doc_1')).toMatchObject({ pinned: true, state: 'ready' })
    h.capability.on = false
    expect(await b.api.state('doc_1')).toMatchObject({ pinned: true, capabilityOn: false })
  })

  it('offlineOpenFolder reports whether the shell opened the folder', async () => {
    const h = createHarness()
    expect(await bridge(h).api.openFolder()).toEqual({ ok: true })
    expect(await bridge(h, { revealLibraryFolder: async () => false }).api.openFolder()).toEqual({
      ok: false,
      code: 'unknown',
    })
  })
})

describe('G5-05u B4 offlineOpen', () => {
  it('opens the normal path when it works, the cached copy otherwise', async () => {
    const h = createHarness()
    const opened: OfflineCopyOutcome = { kind: 'opened', path: '/store/copy.docx', title: 'C.docx' }
    const b = bridge(h, {
      openDocument: async () => true,
      openCopy: async () => opened,
    })
    expect(await b.api.open('doc_1')).toEqual({ ok: true })
    const offline = bridge(h, {
      openDocument: async () => false,
      openCopy: async () => opened,
    })
    expect(await offline.api.open('doc_1')).toEqual({ ok: true })
    expect(offline.locks).toEqual([])
  })

  it('a refused cached copy names its S11 reason, pushes the lock and reports the failure', async () => {
    const h = createHarness()
    const b = bridge(h, {
      openDocument: async () => false,
      openCopy: async () => ({
        kind: 'refused',
        failure: {
          ok: false,
          code: 'lease_unusable',
          lockReason: 'lease_expired',
          libraryOff: true,
        },
        lock: {
          path: '/store/doc_1@offline/doc_1.docx',
          name: 'doc_1.docx',
          reason: 'lease_expired',
          libraryOff: true,
        },
      }),
    })
    expect(await b.api.open('doc_1')).toEqual({
      ok: false,
      code: 'lease_unusable',
      lockReason: 'lease_expired',
      libraryOff: true,
    })
    expect(b.locks).toEqual([
      {
        path: '/store/doc_1@offline/doc_1.docx',
        name: 'doc_1.docx',
        reason: 'lease_expired',
        libraryOff: true,
      },
    ])
  })

  it('nothing pinned and no server path refuses offline', async () => {
    const h = createHarness()
    const b = bridge(h, {
      openDocument: async () => false,
      openCopy: async () => ({ kind: 'none' }),
    })
    expect(await b.api.open('doc_1')).toEqual({ ok: false, code: 'offline' })
  })
})

describe('G5-05u B3 pushes are throttled per row', () => {
  it('a burst inside one window is one leading and one trailing push', () => {
    vi.useFakeTimers()
    try {
      const h = createHarness()
      const b = bridge(h)
      for (let i = 0; i < 10; i += 1) b.api.rowChanged('doc_1')
      expect(b.pushes()).toBe(1)
      b.clock.now += 250
      vi.advanceTimersByTime(250)
      expect(b.pushes()).toBe(2)
      // the next window starts with its own leading push
      b.clock.now += 250
      b.api.rowChanged('doc_1')
      expect(b.pushes()).toBe(3)
      vi.advanceTimersByTime(250)
      expect(b.pushes()).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('two documents do not throttle each other', () => {
    vi.useFakeTimers()
    try {
      const h = createHarness()
      const b = bridge(h)
      b.api.rowChanged('doc_1')
      b.api.rowChanged('doc_2')
      expect(b.pushes()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a real download pushes far fewer times than the engine reports changes', async () => {
    vi.useFakeTimers()
    try {
      const b = wiredBridge()
      addDoc(b.h, 'doc_1', 1, 64 * 1024)
      b.h.docs.chunkSize = 4096
      let seen = 0
      // every engine report is counted in front of the throttled api
      const inner = b.api.rowChanged
      vi.spyOn(b.api, 'rowChanged').mockImplementation((documentId) => {
        seen += 1
        inner(documentId)
      })
      // the engine's own promise: only this waits for the whole transfer
      await b.h.manager.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
      expect(seen).toBeGreaterThan(10)
      expect(b.pushes()).toBe(1)
      vi.advanceTimersByTime(250)
      expect(b.pushes()).toBe(2)
      expect((await b.api.snapshot()).rows[0]).toMatchObject({ state: 'ready' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('G5-05u B1 signed out the api snapshot counts and never names (BE-R1-10)', () => {
  it('reports rows: [] and the last owner count, with no file name in the JSON', async () => {
    const h = createHarness()
    let signedOut = false
    const b = bridge(h, {
      signedOut: () => signedOut,
      lastOwner: () => ({ deploymentId: SCOPE.deploymentId, accountId: SCOPE.accountId }),
    })
    addDoc(h, 'doc_1', 1)
    addDoc(h, 'doc_2', 1)
    expect(await pin(b, 'doc_1')).toEqual({ ok: true })
    expect(await pin(b, 'doc_2')).toEqual({ ok: true })
    expect((await b.api.snapshot()).rows).toHaveLength(2)
    signedOut = true
    const snapshot = await b.api.snapshot()
    // the count of what the last account kept, never a row and never a name
    expect(snapshot.rows).toEqual([])
    expect(snapshot.signedOutLockedCount).toBe(2)
    expect(JSON.stringify(snapshot)).not.toContain('doc_1.docx')
    expect(JSON.stringify(snapshot)).not.toContain('doc_1')
  })
})

describe('G5-05u B4 the channel surface (A04-3)', () => {
  it('registers exactly the seven intent channels of the offline library', () => {
    const handled = new Map<string, unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, listener) => handled.set(channel, listener) }
    const h = createHarness()
    registerOfflineLibraryIpc(ipcMain, bridge(h).api)
    expect([...handled.keys()].sort()).toEqual(
      [
        UNIWORK_SYNC_CENTER_CHANNELS.offlineCancel,
        UNIWORK_SYNC_CENTER_CHANNELS.offlineDownloadNow,
        UNIWORK_SYNC_CENTER_CHANNELS.offlineOpen,
        UNIWORK_SYNC_CENTER_CHANNELS.offlineOpenFolder,
        UNIWORK_SYNC_CENTER_CHANNELS.offlinePin,
        UNIWORK_SYNC_CENTER_CHANNELS.offlineState,
        UNIWORK_SYNC_CENTER_CHANNELS.offlineUnpin,
      ].sort(),
    )
    // no channel names a state the renderer must not be able to set
    for (const channel of handled.keys()) {
      expect(channel).not.toMatch(/ready|verified|lease|progress|state:set/i)
    }
  })

  it('the handlers forward their arguments and answer main-owned values only', async () => {
    const handled = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = {
      handle: (channel, listener) => handled.set(channel, listener as never),
    }
    const h = createHarness()
    const b = bridge(h)
    registerOfflineLibraryIpc(ipcMain, b.api)
    addDoc(h, 'doc_1', 1)
    const invoke = (channel: string, ...args: unknown[]) =>
      handled.get(channel)!(null, ...args) as Promise<unknown>
    expect(
      await invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlinePin, {
        documentId: 'doc_1',
        workspaceId: WS,
      }),
    ).toEqual({ ok: true })
    const state = await invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineState, 'doc_1')
    expect(state).toMatchObject({ pinned: true })
    // the channel answers the engine's row, not anything a renderer sent
    expect(
      await invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineState, 'doc_1', { ready: true }),
    ).toEqual(state)
  })
})
