/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchSnapshot, WorkbenchStoreApi } from '../src/shared/home-api'
import { WorkbenchAccountGate } from '../src/renderer/src/WorkbenchAccountGate'
import {
  exportLocalBackup,
  importLocalBackup,
  readEntitlements,
  simulatePurchase,
} from '../src/renderer/src/backup-addons'
import { loadMyAiHistory, saveMyAiHistory } from '../src/renderer/src/my-ai-history'
import {
  currentWorkbenchBucket,
  isWorkbenchBucketCleared,
} from '../src/renderer/src/workbench-bucket'
import { moveLegacyWorkbenchIdbMedia } from '../src/renderer/src/workbench-media-backup'
import {
  hydrateWorkbenchStore,
  importWorkbenchBackupUi,
  resetWorkbenchStore,
  wbStoreGetRaw,
  wbStoreKeys,
  wbStoreSetRaw,
  wbStoreWrite,
} from '../src/renderer/src/workbench-store-client'

// jsdom has no IndexedDB: the media move is a stub the tests steer
vi.mock('../src/renderer/src/workbench-media-backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-media-backup')>()),
  moveLegacyWorkbenchIdbMedia: vi.fn(async () => undefined),
}))

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const CHAT = 'uniwork.my-ai.chat.v1:teacher'

/**
 * The main process as the renderer sees it: one key/value map per bucket, the
 * active bucket set by the "account", and calls for another bucket ignored
 * (as workbench-accounts.ts does).
 */
class FakeMain {
  buckets = new Map<string, Map<string, string>>([['local', new Map()]])
  active = 'local'
  legacyTo: string | null = null
  legacyDone = false
  /** the first bucket an account opened takes the pre-upgrade copies */
  private legacyAssigned = false
  private listeners = new Set<(bucket: string) => void>()
  loadGate: Promise<void> = Promise.resolve()
  /** buckets the renderer actually loaded (after the gate) */
  loaded: string[] = []
  failLoad = false
  importBackupImpl: WorkbenchStoreApi['importBackup'] = async () => ({ ok: false })

  signIn(account: string): void {
    this.switchTo(`a-${account}`)
  }

  signOut(): void {
    this.switchTo('local')
  }

  private switchTo(bucket: string): void {
    if (bucket === this.active) return
    this.active = bucket
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map())
    if (bucket !== 'local' && !this.legacyAssigned) {
      this.legacyAssigned = true
      this.legacyTo = bucket
    }
    for (const cb of this.listeners) cb(bucket)
  }

  private db(bucket: unknown): Map<string, string> | null {
    return bucket === this.active ? (this.buckets.get(this.active) ?? null) : null
  }

  api(): WorkbenchStoreApi {
    return {
      loadAll: async (): Promise<WorkbenchSnapshot> => {
        await this.loadGate
        if (this.failLoad) throw new Error('load failed')
        this.loaded.push(this.active)
        const keys = Object.fromEntries(this.buckets.get(this.active)!)
        return {
          keys,
          keyCount: Object.keys(keys).length,
          dbPath: '',
          bucket: this.active,
          legacyPending: this.legacyTo === this.active && !this.legacyDone,
        }
      },
      getKey: async (key, bucket) => this.db(bucket)?.get(key) ?? null,
      setKey: async (key, value, bucket) => {
        this.db(bucket)?.set(key, value)
      },
      removeKey: async (key, bucket) => {
        this.db(bucket)?.delete(key)
      },
      importKeys: async (keys, bucket) => {
        const db = this.db(bucket)
        if (!db) return { imported: 0 }
        for (const [k, v] of Object.entries(keys)) db.set(k, v)
        return { imported: Object.keys(keys).length }
      },
      legacyDone: async (bucket) => {
        if (bucket === this.legacyTo && bucket === this.active) this.legacyDone = true
      },
      onBucketChanged: (cb) => {
        this.listeners.add(cb)
        return () => this.listeners.delete(cb)
      },
      exportBackup: async () => ({ ok: false }),
      importBackup: (bucket) => this.importBackupImpl(bucket),
    }
  }
}

function installMemoryLocalStorage(): Map<string, string> {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  return map
}

/** stands in for Home: shows the stored My AI chat of the teacher practice */
function ChatView() {
  const messages = loadMyAiHistory('teacher')
  return createElement(
    'ul',
    { className: 'chat' },
    messages.map((m) => createElement('li', { key: m.id }, m.text)),
  )
}

let host: HTMLDivElement
let root: Root
let main: FakeMain
let ls: Map<string, string>

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function renderGate(): Promise<void> {
  act(() => {
    root.render(createElement(WorkbenchAccountGate, null, createElement(ChatView)))
  })
  await flush()
}

function chatText(): string {
  return host.querySelector('.chat')?.textContent ?? ''
}

beforeEach(() => {
  ls = installMemoryLocalStorage()
  main = new FakeMain()
  ;(window as unknown as { aiOffice: { wb: WorkbenchStoreApi } }).aiOffice = { wb: main.api() }
  vi.mocked(moveLegacyWorkbenchIdbMedia).mockReset()
  vi.mocked(moveLegacyWorkbenchIdbMedia).mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  resetWorkbenchStore()
  delete (window as unknown as { aiOffice?: unknown }).aiOffice
})

describe('My AI per UniWork account in the Home renderer', () => {
  it('sign-out removes the chat from the DOM at once; sign-in brings it back', async () => {
    main.signIn('owner')
    await renderGate()
    act(() => {
      saveMyAiHistory('teacher', [{ id: '1', role: 'user', text: 'owner secret' }])
    })
    await flush()
    // the write went to the owner's bucket in main, not to localStorage
    expect(main.buckets.get('a-owner')!.get(CHAT)).toContain('owner secret')
    expect([...ls.keys()].some((k) => k.includes('my-ai'))).toBe(false)
    // re-render with the stored chat
    await renderGate()
    expect(chatText()).toBe('owner secret')

    // hold the next load: the DOM must be clear before the new data arrives
    let release!: () => void
    main.loadGate = new Promise((resolve) => (release = resolve))
    act(() => main.signOut())
    expect(host.querySelector('.chat')).toBeNull()
    expect(host.textContent).not.toContain('owner secret')
    release()
    await flush()
    expect(host.querySelector('.chat')).not.toBeNull()
    expect(chatText()).toBe('')
    expect(currentWorkbenchBucket()).toBe('local')

    main.loadGate = Promise.resolve()
    act(() => main.signIn('owner'))
    await flush()
    expect(chatText()).toBe('owner secret')
  })

  it('a second account never sees the first one', async () => {
    main.signIn('owner')
    main.buckets.get('a-owner')!.set(CHAT, '[{"id":"1","role":"user","text":"owner secret"}]')
    await renderGate()
    expect(chatText()).toBe('owner secret')

    act(() => main.signIn('member'))
    await flush()
    expect(chatText()).toBe('')
    expect(wbStoreGetRaw(CHAT)).toBeNull()
  })

  it('a write still in flight for the previous account does not reach the next one', async () => {
    main.signIn('owner')
    await renderGate()
    const ownerBucket = currentWorkbenchBucket()
    act(() => main.signIn('member'))
    // a component of the owner writing while it unmounts: dropped, nothing anywhere
    wbStoreSetRaw(CHAT, '[{"id":"9","role":"user","text":"late owner write"}]')
    await flush()
    expect(main.buckets.get('a-member')!.has(CHAT)).toBe(false)
    expect(ls.size).toBe(0)
    // even a call that still names the owner's bucket is refused by main
    await main.api().setKey(CHAT, 'x', ownerBucket)
    expect(main.buckets.get('a-member')!.has(CHAT)).toBe(false)
  })

  it('signed-out use keeps its own bucket', async () => {
    await renderGate()
    act(() => {
      saveMyAiHistory('teacher', [{ id: '1', role: 'user', text: 'signed-out note' }])
    })
    expect(main.buckets.get('local')!.get(CHAT)).toContain('signed-out note')

    act(() => main.signIn('owner'))
    await flush()
    expect(chatText()).toBe('')
    act(() => main.signOut())
    await flush()
    expect(chatText()).toBe('signed-out note')
  })

  it('pre-upgrade localStorage copies move to the first account once, then leave localStorage', async () => {
    ls.set(CHAT, '[{"id":"1","role":"user","text":"before upgrade"}]')
    ls.set('uniwork.wb.tasks.teacher', '[]')
    ls.set('unrelated.key', 'stays')

    // signed-out first: not shown, not moved
    await renderGate()
    expect(chatText()).toBe('')
    expect(ls.has(CHAT)).toBe(true)

    act(() => main.signIn('owner'))
    await flush()
    expect(chatText()).toBe('before upgrade')
    expect(main.buckets.get('a-owner')!.get(CHAT)).toContain('before upgrade')
    expect(main.legacyDone).toBe(true)
    expect(ls.has(CHAT)).toBe(false)
    expect(ls.has('uniwork.wb.tasks.teacher')).toBe(false)
    expect(ls.get('unrelated.key')).toBe('stays')

    // the second account gets none of it
    act(() => main.signIn('member'))
    await flush()
    expect(chatText()).toBe('')
    expect(main.buckets.get('a-member')!.size).toBe(0)
  })

  it('keys already in the account win over pre-upgrade copies', async () => {
    main.signIn('owner')
    main.buckets.get('a-owner')!.set(CHAT, '[{"id":"2","role":"user","text":"newer"}]')
    ls.set(CHAT, '[{"id":"1","role":"user","text":"older copy"}]')
    await hydrateWorkbenchStore()
    expect(wbStoreGetRaw(CHAT)).toContain('newer')
    expect(main.buckets.get('a-owner')!.get(CHAT)).toContain('newer')
    expect(ls.has(CHAT)).toBe(false)
  })

  it('holds Home and every read/write until the first account status settled: a signed-in launch never loads the signed-out bucket', async () => {
    // main has not applied the first owner yet: it would still answer with the signed-out bucket
    let settle!: () => void
    main.loadGate = new Promise((resolve) => (settle = resolve))
    await renderGate()
    expect(host.querySelector('.chat')).toBeNull()
    expect(host.textContent).toBe('')
    // nothing is readable or writable meanwhile: a write lands nowhere
    wbStoreSetRaw(CHAT, '[{"id":"1","role":"user","text":"too early"}]')
    expect(wbStoreGetRaw(CHAT)).toBeNull()
    expect(main.buckets.get('local')!.size).toBe(0)
    expect(ls.size).toBe(0)

    // the restore finished: the stored session's account is the active bucket
    main.signIn('owner')
    main.buckets.get('a-owner')!.set(CHAT, '[{"id":"2","role":"user","text":"owner history"}]')
    settle()
    await flush()
    expect(chatText()).toBe('owner history')
    expect(main.loaded).not.toContain('local')
    expect(main.buckets.get('local')!.size).toBe(0)
  })

  it('a reset clears the bucket name; the account-changed guard of a backup import then holds', async () => {
    main.signIn('owner')
    await hydrateWorkbenchStore()
    expect(currentWorkbenchBucket()).toBe('a-owner')

    // the account changes while the import dialog is open
    main.importBackupImpl = async () => {
      resetWorkbenchStore()
      return { ok: true, keys: { [CHAT]: 'x' }, keyCount: 1 }
    }
    const result = await importWorkbenchBackupUi()
    expect(result).toEqual({ ok: false, error: 'account-changed' })
    expect(isWorkbenchBucketCleared()).toBe(true)
    expect(currentWorkbenchBucket()).toBe('')
    // the previous account's name is gone: nothing readable, no write reaches any bucket
    expect(wbStoreGetRaw(CHAT)).toBeNull()
    wbStoreSetRaw(CHAT, 'late')
    expect(main.buckets.get('a-owner')!.has(CHAT)).toBe(false)
    expect(ls.size).toBe(0)
  })

  it("a failed load stays closed: no localStorage fallback onto the previous account's copy", async () => {
    main.signIn('owner')
    await hydrateWorkbenchStore()
    // a fallback copy the previous account left under its own bucket name
    ls.set(`uniwork.wbacct.a-owner.${CHAT}`, '[{"id":"1","role":"user","text":"owner fallback"}]')

    main.signIn('member')
    main.failLoad = true
    await hydrateWorkbenchStore()
    expect(wbStoreGetRaw(CHAT)).toBeNull()
    expect(wbStoreKeys()).toEqual([])
    wbStoreSetRaw(CHAT, 'x')
    expect([...ls.keys()]).toEqual([`uniwork.wbacct.a-owner.${CHAT}`])
    expect(main.buckets.get('a-member')!.size).toBe(0)

    // the next load works again
    main.failLoad = false
    await hydrateWorkbenchStore()
    expect(currentWorkbenchBucket()).toBe('a-member')
    wbStoreSetRaw(CHAT, 'y')
    expect(wbStoreGetRaw(CHAT)).toBe('y')
  })
})

describe('Settings > Backup and add-ons through the per-account store', () => {
  it('an export after a store write contains the key', async () => {
    main.signIn('owner')
    await hydrateWorkbenchStore()
    wbStoreWrite(CHAT, [{ id: '1', role: 'user', text: 'in the backup' }])
    wbStoreSetRaw('uniwork.wb.tasks.teacher', '[]')
    wbStoreSetRaw('not.allowlisted', 'no')
    const snap = exportLocalBackup()
    expect(Object.keys(snap.keys).sort()).toEqual([CHAT, 'uniwork.wb.tasks.teacher'].sort())
    expect(snap.keys[CHAT]).toContain('in the backup')
    // the export reads the account store, never localStorage (shared by every account)
    expect(ls.size).toBe(0)
  })

  it('add-on entitlements survive the one-time move into the first account', async () => {
    ls.set(
      'uniwork.addons.entitlements',
      JSON.stringify({
        version: 1,
        backupPlanId: 'backup-plus',
        storagePackIds: ['storage-50'],
        lastCloudBackupAt: null,
        usedBytes: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    )
    main.signIn('owner')
    await hydrateWorkbenchStore()
    expect(main.legacyDone).toBe(true)
    // gone from the shared localStorage, kept in the account, and read from there
    expect(ls.has('uniwork.addons.entitlements')).toBe(false)
    expect(main.buckets.get('a-owner')!.has('uniwork.addons.entitlements')).toBe(true)
    expect(readEntitlements().backupPlanId).toBe('backup-plus')
    expect(readEntitlements().storagePackIds).toEqual(['storage-50'])

    // changes are per account
    simulatePurchase('storage-200')
    expect(readEntitlements().storagePackIds).toEqual(['storage-50', 'storage-200'])
    main.signIn('member')
    await hydrateWorkbenchStore()
    expect(readEntitlements().backupPlanId).toBeNull()
  })

  it('a backup file round trips: export, import into an account, export again', async () => {
    main.signIn('owner')
    await hydrateWorkbenchStore()
    wbStoreWrite(CHAT, [{ id: '1', role: 'user', text: 'round trip' }])
    simulatePurchase('backup-basic')
    const snap = exportLocalBackup()
    expect(Object.keys(snap.keys)).toContain('uniwork.addons.entitlements')

    main.signIn('member')
    await hydrateWorkbenchStore()
    expect(exportLocalBackup().keys).toEqual({})
    expect(importLocalBackup(snap)).toEqual({ ok: true, count: Object.keys(snap.keys).length })
    expect(exportLocalBackup().keys).toEqual(snap.keys)
    expect(main.buckets.get('a-member')!.get(CHAT)).toContain('round trip')
    expect(readEntitlements().backupPlanId).toBe('backup-basic')
  })
})

describe('pre-upgrade media move', () => {
  it('moves into the bucket that was loaded; legacyDone follows the move', async () => {
    main.signIn('owner')
    await hydrateWorkbenchStore()
    expect(moveLegacyWorkbenchIdbMedia).toHaveBeenCalledWith('a-owner')
    expect(main.legacyDone).toBe(true)
  })

  it('a failed media move is not confirmed and is tried again on the next load', async () => {
    ls.set(CHAT, '[{"id":"1","role":"user","text":"before upgrade"}]')
    vi.mocked(moveLegacyWorkbenchIdbMedia).mockRejectedValueOnce(new Error('idb_delete_blocked'))
    main.signIn('owner')
    await hydrateWorkbenchStore()
    // the keys moved and left localStorage, the shared media databases are still there
    expect(wbStoreGetRaw(CHAT)).toContain('before upgrade')
    expect(ls.has(CHAT)).toBe(false)
    expect(main.legacyDone).toBe(false)

    await hydrateWorkbenchStore()
    expect(moveLegacyWorkbenchIdbMedia).toHaveBeenCalledTimes(2)
    expect(main.legacyDone).toBe(true)
    expect(wbStoreGetRaw(CHAT)).toContain('before upgrade')
  })
})
