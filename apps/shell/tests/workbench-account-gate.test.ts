/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkbenchSnapshot, WorkbenchStoreApi } from '../src/shared/home-api'
import { WorkbenchAccountGate } from '../src/renderer/src/WorkbenchAccountGate'
import { loadMyAiHistory, saveMyAiHistory } from '../src/renderer/src/my-ai-history'
import { currentWorkbenchBucket } from '../src/renderer/src/workbench-bucket'
import {
  hydrateWorkbenchStore,
  resetWorkbenchStore,
  wbStoreGetRaw,
  wbStoreSetRaw,
} from '../src/renderer/src/workbench-store-client'

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
      importBackup: async () => ({ ok: false }),
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
})
