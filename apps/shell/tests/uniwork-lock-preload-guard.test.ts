/**
 * @vitest-environment jsdom
 */
/**
 * VG5-1 (G5-05u): the shell preload lock guard (`asUniworkLock`, `asUniworkLocks`)
 * must accept every `UniworkLockReason` from `UNIWORK_LOCK_REASONS` and preserve
 * `libraryOff: true` when it is `true`, while dropping unknown reasons and
 * missing paths.
 */
import { describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS, UNIWORK_LOCK_REASONS } from '../src/shared/home-api'
import type { UniworkDocLock, UniworkLockReason } from '../src/shared/home-api'

const ipcState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw: unknown) => void>(),
  locksReply: [] as unknown,
  exposed: {} as Record<string, unknown>,
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      ipcState.exposed[key] = value
    },
  },
  ipcRenderer: {
    on: (channel: string, cb: (event: unknown, raw: unknown) => void) => {
      ipcState.handlers.set(channel, cb)
    },
    invoke: async (channel: string) => {
      if (channel === UNIWORK_DOC_CHANNELS.locks) return ipcState.locksReply
      return undefined
    },
    send: () => undefined,
    removeListener: (channel: string, cb: unknown) => {
      if (ipcState.handlers.get(channel) === cb) ipcState.handlers.delete(channel)
    },
  },
  webUtils: { getPathForFile: () => '' },
}))

import { asUniworkLock, asUniworkLocks } from '../src/preload/index'

interface LockBridge {
  onUniworkLock(cb: (lock: UniworkDocLock) => void): () => void
  uniworkLocks(): Promise<UniworkDocLock[]>
  onUniworkLocksChanged(cb: (locks: UniworkDocLock[]) => void): () => void
}

describe('the preload lock guard (VG5-1)', () => {
  it.each(UNIWORK_LOCK_REASONS)('accepts %s in asUniworkLock and asUniworkLocks', (reason) => {
    const raw = { path: 'C:/cache/Plan.docx', reason, name: 'Plan.docx' }
    expect(asUniworkLock(raw)).toEqual(raw)
    expect(asUniworkLocks([raw])).toEqual([raw])
  })

  it('keeps libraryOff only when it is strictly true', () => {
    expect(
      asUniworkLock({
        path: 'C:/cache/Plan.docx',
        reason: 'lease_expired',
        name: 'Plan.docx',
        libraryOff: true,
      }),
    ).toEqual({
      path: 'C:/cache/Plan.docx',
      reason: 'lease_expired',
      name: 'Plan.docx',
      libraryOff: true,
    })

    for (const bad of [false, undefined, 'true', 1, null, {}]) {
      const parsed = asUniworkLock({
        path: 'C:/cache/Plan.docx',
        reason: 'lease_expired',
        name: 'Plan.docx',
        libraryOff: bad,
      })
      expect(parsed).toEqual({
        path: 'C:/cache/Plan.docx',
        reason: 'lease_expired',
        name: 'Plan.docx',
      })
      expect('libraryOff' in (parsed as object)).toBe(false)
    }
  })

  it('drops an unknown or non-string reason', () => {
    for (const reason of ['unknown_reason', 'keyring_unavailable', '', null, undefined, 42, {}]) {
      expect(asUniworkLock({ path: 'C:/cache/Plan.docx', reason, name: 'Plan.docx' })).toBeNull()
    }
  })

  it('drops a lock with a missing, empty or non-string path', () => {
    for (const raw of [
      null,
      undefined,
      'C:/cache/Plan.docx',
      { reason: 'lease_expired', name: 'Plan.docx' },
      { path: '', reason: 'lease_expired', name: 'Plan.docx' },
      { path: 123, reason: 'lease_expired', name: 'Plan.docx' },
    ]) {
      expect(asUniworkLock(raw)).toBeNull()
    }
  })

  it('delivers all lock reasons and libraryOff across onUniworkLock, uniworkLocks and onUniworkLocksChanged', async () => {
    const bridge = ipcState.exposed.aiOffice as LockBridge
    const pushed: UniworkDocLock[] = []
    const changed: UniworkDocLock[][] = []
    const offLock = bridge.onUniworkLock((lock) => pushed.push(lock))
    const offChanged = bridge.onUniworkLocksChanged((locks) => changed.push(locks))

    const allLocks: UniworkDocLock[] = UNIWORK_LOCK_REASONS.map((reason: UniworkLockReason, i) => ({
      path: `C:/cache/Doc-${i}.docx`,
      reason,
      name: `Doc-${i}.docx`,
      ...(reason === 'lease_expired' ? { libraryOff: true } : {}),
    }))

    for (const lock of allLocks) {
      ipcState.handlers.get(UNIWORK_DOC_CHANNELS.lock)?.({}, lock)
    }
    expect(pushed).toEqual(allLocks)

    ipcState.locksReply = [...allLocks, { path: 'C:/bad.docx', reason: 'junk', name: 'bad.docx' }]
    expect(await bridge.uniworkLocks()).toEqual(allLocks)

    ipcState.handlers.get(UNIWORK_DOC_CHANNELS.locksChanged)?.({}, ipcState.locksReply)
    expect(changed).toEqual([allLocks])

    offLock()
    offChanged()
  })
})
