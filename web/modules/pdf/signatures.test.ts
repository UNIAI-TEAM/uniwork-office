// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_SAVED_SIGNATURES } from '../../../apps/pdf/src/shared/signature-list'
import { SIGNATURES_KEY, createSignatureStore } from './signatures'

const sig = (n: number) => ({ kind: 'image' as const, image: `img${n}`, width: 10, height: 5 })

beforeEach(() => localStorage.clear())

describe('browser-local saved signatures', () => {
  it('adds newest first, dedupes, caps, removes, and persists in localStorage', async () => {
    const store = createSignatureStore()
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
    // a fresh store (next page load) reads the same list back
    expect(await createSignatureStore().list()).toEqual(await store.list())
    expect(JSON.parse(localStorage.getItem(SIGNATURES_KEY)!)).toHaveLength(MAX_SAVED_SIGNATURES - 1)
  })

  it('ignores malformed payloads and a corrupt stored value', async () => {
    localStorage.setItem(SIGNATURES_KEY, '{not json')
    const store = createSignatureStore()
    expect(await store.list()).toEqual([])
    expect(await store.add({ kind: 'image', image: '', width: 1, height: 1 })).toEqual([])
  })

  it('keeps working in memory when storage throws (private mode)', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    const store = createSignatureStore(() => broken)
    expect((await store.add(sig(1))).map((s) => s.data)).toEqual([sig(1)])
    expect((await store.list()).map((s) => s.data)).toEqual([sig(1)])
  })
})
