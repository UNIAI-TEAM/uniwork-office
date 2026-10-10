// Web draft recovery (CONTRACT C18): IndexedDB store, AES-GCM, writer timer, offer on open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DRAFTS_DB,
  DRAFTS_STORE,
  createDraftRecovery,
  createIdbDraftStore,
  decryptDraft,
  encryptDraft,
  type DraftChoice,
  type DraftHost,
  type DraftInfo,
  type DraftRecord,
  type DraftStore,
} from './draft-recovery'
import { createFakeIdb } from './testing/fake-idb'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: ArrayBuffer) => new TextDecoder().decode(b)

function newKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

function setup(over: { key?: CryptoKey; scope?: string; store?: DraftStore } = {}) {
  const fake = createFakeIdb()
  const store = over.store ?? createIdbDraftStore(fake.idb)
  const state = {
    file: { etag: 'e1', name: 'Report.docx' } as { etag?: string; name: string } | null,
    dirty: false,
    text: 'hello',
    grant: undefined as { key: CryptoKey; scope: string } | undefined,
  }
  const restored: Array<{ text: string; draft: DraftInfo }> = []
  let answer: DraftChoice = 'restore'
  const prompt = vi.fn(async (_d: DraftInfo) => answer)
  const host: DraftHost = {
    file: () => state.file,
    isDirty: () => state.dirty,
    bytes: async () => enc(state.text),
    restore: (bytes, draft) => {
      restored.push({ text: dec(bytes), draft })
    },
  }
  const target = new EventTarget()
  let clock = 1_000
  // one frame load = one recovery with its own tab id; a "reload" or "second tab" is another
  const make = (tabId: string) => {
    const r = createDraftRecovery({
      module: 'docs',
      recovery: () => state.grant,
      host,
      prompt,
      store,
      tabId,
      target: target as unknown as Window,
      now: () => clock,
    })
    disposers.push(() => r.dispose())
    return r
  }
  const recovery = make('tabA')
  return {
    fake,
    store,
    state,
    restored,
    prompt,
    target,
    recovery,
    /** a later frame load (page reload / second tab) over the same store and host key */
    load: (tabId = 'tabB') => make(tabId),
    answer: (c: DraftChoice) => {
      answer = c
    },
    tick: (ms: number) => {
      clock += ms
    },
    records: () => fake.store(DRAFTS_DB, DRAFTS_STORE) ?? new Map<string, unknown>(),
  }
}

let disposers: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  for (const d of disposers) d()
  disposers = []
  vi.useRealTimers()
})

function track<T extends { recovery: { dispose(): void } }>(t: T): T {
  disposers.push(() => t.recovery.dispose())
  return t
}

describe('crypto', () => {
  it('round-trips, binds the record key, and fails closed for another key', async () => {
    const key = await newKey()
    const { iv, ciphertext } = await encryptDraft(key, 'u:d:e1', enc('secret'))
    expect(dec(ciphertext)).not.toContain('secret')
    const record: DraftRecord = {
      iv,
      ciphertext,
      baseEtag: 'e1',
      savedAt: 1,
      module: 'docs',
      name: 'a',
    }
    expect(dec((await decryptDraft(key, 'u:d:e1', record))!)).toBe('secret')
    expect(await decryptDraft(key, 'u:d:e2', record)).toBeNull()
    expect(await decryptDraft(await newKey(), 'u:d:e1', record)).toBeNull()
  })
})

describe('IndexedDB store', () => {
  it('puts, lists by prefix, deletes, and closes every connection', async () => {
    const fake = createFakeIdb()
    const store = createIdbDraftStore(fake.idb)
    const rec = (n: string): DraftRecord => ({
      iv: new Uint8Array(12),
      ciphertext: new ArrayBuffer(4),
      baseEtag: n,
      savedAt: 1,
      module: 'pdf',
      name: n,
    })
    await store.put('u1:d1:e1', rec('e1'))
    await store.put('u1:d1:e2', rec('e2'))
    await store.put('u1:d10:e1', rec('x'))
    const listed = await store.list('u1:d1:')
    expect(listed.map((e) => e.key)).toEqual(['u1:d1:e1', 'u1:d1:e2'])
    expect(Object.prototype.toString.call(listed[0].record.iv)).toBe('[object Uint8Array]')
    await store.delete('u1:d1:e1')
    expect((await store.list('u1:d1:')).map((e) => e.key)).toEqual(['u1:d1:e2'])
    expect(fake.openConnections()).toBe(0)
  })
})

describe('writer', () => {
  it('writes an encrypted copy every 30 s while dirty, keyed scope:etag:tabId', async () => {
    const t = track(setup())
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    vi.advanceTimersByTime(30_000)
    await t.recovery.flush() // drains the queue; clean: nothing written
    expect(t.records().size).toBe(0)

    t.state.dirty = true
    vi.advanceTimersByTime(30_000)
    await t.recovery.flush()
    const stored = t.records().get('u1:d1:e1:tabA') as DraftRecord
    expect(stored).toMatchObject({ baseEtag: 'e1', module: 'docs', name: 'Report.docx' })
    expect(stored.savedAt).toBe(1_000)
    expect(dec(stored.ciphertext)).not.toContain('hello')
    expect(dec((await decryptDraft(t.state.grant.key, 'u1:d1:e1:tabA', stored))!)).toBe('hello')
  })

  it('writes nothing without a grant or a document', async () => {
    const t = track(setup())
    t.state.dirty = true
    await t.recovery.flush()
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    t.state.file = null
    await t.recovery.flush()
    expect(t.records().size).toBe(0)
  })

  it('writes on pagehide', async () => {
    const t = track(setup())
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    t.state.dirty = true
    t.target.dispatchEvent(new Event('pagehide'))
    await t.recovery.flush()
    expect([...t.records().keys()]).toEqual(['u1:d1:e1:tabA'])
  })

  it('a save that lands while a write runs still clears the scope', async () => {
    const t = track(setup())
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    t.state.dirty = true
    const write = t.recovery.flush()
    const saved = t.recovery.saved()
    await Promise.all([write, saved])
    expect(t.records().size).toBe(0)
  })

  it('stops after dispose', async () => {
    const t = setup()
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    t.state.dirty = true
    t.recovery.dispose()
    vi.advanceTimersByTime(60_000)
    await t.recovery.flush()
    expect(t.records().size).toBe(0)
  })
})

describe('offer on open', () => {
  /** tab A (a load that then crashed / closed) leaves a draft behind */
  async function withDraft(etag: string, text = 'draft text') {
    const t = track(setup())
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    t.state.file = { etag, name: 'Report.docx' }
    t.state.dirty = true
    t.state.text = text
    await t.recovery.flush()
    t.state.dirty = false
    t.state.text = 'server text'
    return t
  }

  it('after a reload with the same key: Restore hands the bytes over, then the copy moves to the new load', async () => {
    const t = await withDraft('e1')
    const reloaded = t.load('tabB')
    await reloaded.opened()
    expect(t.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Report.docx', older: false, baseEtag: 'e1' }),
    )
    expect(t.restored).toEqual([
      { text: 'draft text', draft: expect.objectContaining({ older: false }) },
    ])
    // the restored record is gone; one copy under this load's key survives until a save
    expect([...t.records().keys()]).toEqual(['u1:d1:e1:tabB'])
    await reloaded.saved()
    expect(t.records().size).toBe(0)
  })

  it('Discard deletes the offered copy and restores nothing', async () => {
    const t = await withDraft('e1')
    t.answer('discard')
    await t.load().opened()
    expect(t.restored).toEqual([])
    expect(t.records().size).toBe(0)
  })

  it('Escape (dismiss) keeps the copy and restores nothing', async () => {
    const t = await withDraft('e1')
    t.answer('dismiss')
    await t.load().opened()
    expect(t.restored).toEqual([])
    expect(t.records().size).toBe(1)
  })

  it('offers a draft of an older version, labelled, and re-keys it on Restore', async () => {
    const t = await withDraft('e1')
    t.state.file = { etag: 'e2', name: 'Report.docx' }
    await t.load().opened()
    expect(t.prompt).toHaveBeenCalledWith(expect.objectContaining({ older: true, baseEtag: 'e1' }))
    expect(t.restored[0].text).toBe('draft text')
    expect([...t.records().keys()]).toEqual(['u1:d1:e2:tabB'])
    const moved = t.records().get('u1:d1:e2:tabB') as DraftRecord
    expect(moved.baseEtag).toBe('e2')
    expect(dec((await decryptDraft(t.state.grant!.key, 'u1:d1:e2:tabB', moved))!)).toBe(
      'draft text',
    )
  })

  it('offers the newest decryptable record of the scope', async () => {
    const t = await withDraft('e1', 'older draft')
    t.state.file = { etag: 'e0', name: 'Report.docx' }
    t.state.dirty = true
    t.state.text = 'newer draft'
    t.tick(5_000)
    await t.load('tabC').flush()
    t.state.dirty = false
    t.state.file = { etag: 'e1', name: 'Report.docx' }
    await t.load('tabD').opened()
    expect(t.restored[0].text).toBe('newer draft')
    expect(t.prompt).toHaveBeenCalledWith(expect.objectContaining({ older: true, baseEtag: 'e0' }))
    // the restored record moved to this load; the other draft (tab A) is untouched
    expect([...t.records().keys()].sort()).toEqual(['u1:d1:e1:tabA', 'u1:d1:e1:tabD'])
  })

  it('a new key (second sign-in) must not delete the old record: it is skipped', async () => {
    const t = await withDraft('e1')
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    await t.load().opened()
    expect(t.prompt).not.toHaveBeenCalled()
    expect([...t.records().keys()]).toEqual(['u1:d1:e1:tabA'])
  })

  it("a second tab does not delete, overwrite or consume the first tab's live draft", async () => {
    const t = await withDraft('e1', 'tab A edits')
    // tab B (another key object cannot read it, the same persisted key can): B declines the offer
    t.answer('dismiss')
    const tabB = t.load('tabB')
    await tabB.opened()
    t.state.dirty = true
    t.state.text = 'tab B edits'
    await tabB.flush()
    await tabB.saved() // B saves: only B's records go
    expect([...t.records().keys()]).toEqual(['u1:d1:e1:tabA'])
    const stored = t.records().get('u1:d1:e1:tabA') as DraftRecord
    expect(dec((await decryptDraft(t.state.grant!.key, 'u1:d1:e1:tabA', stored))!)).toBe(
      'tab A edits',
    )
  })

  it("never offers this load's own records, and a damaged record is skipped, not deleted", async () => {
    const t = track(setup())
    t.state.grant = { key: await newKey(), scope: 'u1:d1' }
    t.state.dirty = true
    await t.recovery.flush()
    await t.store.put('u1:d1:e1:junk', { broken: true } as unknown as DraftRecord)
    await t.recovery.opened() // own record + damaged record: nothing to offer
    expect(t.prompt).not.toHaveBeenCalled()
    expect([...t.records().keys()].sort()).toEqual(['u1:d1:e1:junk', 'u1:d1:e1:tabA'])
  })

  it('shows nothing without a grant and leaves other scopes alone', async () => {
    const t = await withDraft('e1')
    const grant = t.state.grant!
    t.state.grant = { key: grant.key, scope: 'u1:d2' }
    const other = t.load()
    await other.opened()
    await other.saved()
    expect(t.prompt).not.toHaveBeenCalled()
    expect(t.records().size).toBe(1)
    t.state.grant = undefined
    await t.load('tabC').opened()
    expect(t.prompt).not.toHaveBeenCalled()
  })
})

describe('shared database', () => {
  it('upgrades a database the host created with only its keys store', async () => {
    const fake = createFakeIdb()
    fake.seed(DRAFTS_DB, 1, ['keys'])
    const store = createIdbDraftStore(fake.idb)
    await store.put('u1:d1:e1:t', {
      iv: new Uint8Array(12),
      ciphertext: new ArrayBuffer(4),
      baseEtag: 'e1',
      savedAt: 1,
      module: 'pdf',
      name: 'n',
    })
    expect(fake.version(DRAFTS_DB)).toBe(2)
    expect(fake.store(DRAFTS_DB, 'keys')).toBeDefined()
    expect(fake.store(DRAFTS_DB, DRAFTS_STORE)?.size).toBe(1)
    expect(fake.openConnections()).toBe(0)
  })
})
