// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_SAVED_SIGNATURES } from '../../../apps/pdf/src/shared/signature-list'
import { FRAME_DB, STORE_SIGNATURES } from '../../docs/bridge/frame-idb'
import { createFakeIdb } from '../../docs/bridge/testing/fake-idb'
import { LEGACY_SIGNATURES_KEY, createSignatureStore } from './signatures'

const sig = (n: number) => ({ kind: 'image' as const, image: `img${n}`, width: 10, height: 5 })

const newKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

beforeEach(() => localStorage.clear())

async function setup(scope = 'u1:doc-1') {
  const fake = createFakeIdb()
  const key = await newKey()
  let grant: { key: CryptoKey; scope: string } | undefined = { key, scope }
  const open = () =>
    createSignatureStore({ recovery: () => grant, idb: () => fake.idb, legacy: () => localStorage })
  return {
    fake,
    key,
    open,
    setGrant: (g: typeof grant) => {
      grant = g
    },
    rows: () => fake.store(FRAME_DB, STORE_SIGNATURES) ?? new Map<string, unknown>(),
  }
}

describe('encrypted per-user saved signatures', () => {
  it('adds newest first, dedupes, caps, removes, and a new page load reads the same list', async () => {
    const t = await setup()
    const store = t.open()
    expect(await store.list()).toEqual([])
    await store.add(sig(1))
    const list = await store.add(sig(2))
    expect(list.map((s) => s.data)).toEqual([sig(2), sig(1)])
    // same payload again: moves to the front instead of duplicating
    expect((await store.add(sig(1))).map((s) => s.data)).toEqual([sig(1), sig(2)])
    for (let i = 3; i < 20; i++) await store.add(sig(i))
    expect(await store.list()).toHaveLength(MAX_SAVED_SIGNATURES)
    const first = (await store.list())[0]!
    expect((await store.remove(first.id)).some((s) => s.id === first.id)).toBe(false)
    expect(await t.open().list()).toEqual(await store.list())
    expect(t.fake.openConnections()).toBe(0)
  })

  it('stores ciphertext only, keyed by the user part of the scope, nothing in localStorage', async () => {
    const t = await setup('u1:doc-9')
    await t.open().add(sig(7))
    expect([...t.rows().keys()]).toEqual(['u1'])
    const row = t.rows().get('u1') as { ciphertext: ArrayBuffer }
    const text = new TextDecoder('latin1').decode(row.ciphertext)
    expect(text).not.toContain('img7')
    expect(localStorage.length).toBe(0)
  })

  it('is shared by the same user across documents and invisible to another user', async () => {
    const t = await setup('u1:doc-1')
    await t.open().add(sig(1))
    t.setGrant({ key: t.key, scope: 'u1:doc-2' })
    expect((await t.open().list()).map((s) => s.data)).toEqual([sig(1)])
    // another user's key: the record is unreadable and the list is empty
    t.setGrant({ key: await newKey(), scope: 'u1:doc-3' })
    expect(await t.open().list()).toEqual([])
    // a different user id has its own record
    t.setGrant({ key: t.key, scope: 'u2:doc-1' })
    expect(await t.open().list()).toEqual([])
  })

  it('goes away with the database (sign-out) and never resurfaces', async () => {
    const t = await setup()
    await t.open().add(sig(1))
    t.fake.idb.deleteDatabase(FRAME_DB)
    await new Promise((r) => setTimeout(r, 10))
    expect(await t.open().list()).toEqual([])
  })

  it('without a grant the list lives in memory only', async () => {
    const t = await setup()
    t.setGrant(undefined)
    const store = t.open()
    expect((await store.add(sig(1))).map((s) => s.data)).toEqual([sig(1)])
    expect((await store.list()).map((s) => s.data)).toEqual([sig(1)])
    expect(t.rows().size).toBe(0)
    expect((await t.open().list()).length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('ignores malformed payloads', async () => {
    const t = await setup()
    expect(await t.open().add({ kind: 'image', image: '', width: 1, height: 1 })).toEqual([])
  })

  it('keeps working in memory when IndexedDB is unavailable', async () => {
    const store = createSignatureStore({
      recovery: () => ({ key: undefined as unknown as CryptoKey, scope: 'u1:d' }),
      idb: () => null,
      legacy: () => localStorage,
    })
    expect((await store.add(sig(1))).map((s) => s.data)).toEqual([sig(1)])
    expect((await store.list()).map((s) => s.data)).toEqual([sig(1)])
  })
})

describe('legacy plaintext localStorage list', () => {
  const legacy = [
    { id: 'old1', createdAt: 5, data: sig(1) },
    { id: 'old2', createdAt: 6, data: sig(2) },
  ]

  it('is migrated once into the encrypted store and the plaintext key is deleted', async () => {
    const t = await setup()
    localStorage.setItem(LEGACY_SIGNATURES_KEY, JSON.stringify(legacy))
    const list = await t.open().list()
    expect(list.map((s) => s.id).sort()).toEqual(['old1', 'old2'])
    expect(localStorage.getItem(LEGACY_SIGNATURES_KEY)).toBeNull()
    // the next page load finds them in the encrypted store, not in localStorage
    expect((await t.open().list()).map((s) => s.id).sort()).toEqual(['old1', 'old2'])
    expect(t.rows().size).toBe(1)
  })

  it('is deleted, not kept, when there is no grant to encrypt with', async () => {
    const t = await setup()
    t.setGrant(undefined)
    localStorage.setItem(LEGACY_SIGNATURES_KEY, JSON.stringify(legacy))
    expect(await t.open().list()).toEqual([])
    expect(localStorage.getItem(LEGACY_SIGNATURES_KEY)).toBeNull()
  })

  it('a corrupt legacy value is dropped', async () => {
    const t = await setup()
    localStorage.setItem(LEGACY_SIGNATURES_KEY, '{not json')
    expect(await t.open().list()).toEqual([])
    expect(localStorage.getItem(LEGACY_SIGNATURES_KEY)).toBeNull()
  })
})
