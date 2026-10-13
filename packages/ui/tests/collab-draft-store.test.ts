/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, draftStorageKey, loadDraft, saveDraft } from '../src/collab/draft-store'

const KEY = { documentId: 'doc-1', threadKey: 'reply:c1' }

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('draft-store', () => {
  it('round-trips a draft by {documentId, threadKey}', () => {
    expect(loadDraft(KEY)).toBeNull()
    saveDraft(KEY, 'half a thought')
    expect(loadDraft(KEY)).toBe('half a thought')
  })

  it('keeps drafts of other threads and documents apart', () => {
    saveDraft(KEY, 'a')
    saveDraft({ documentId: 'doc-1', threadKey: 'reply:c2' }, 'b')
    saveDraft({ documentId: 'doc-2', threadKey: 'reply:c1' }, 'c')
    expect(loadDraft(KEY)).toBe('a')
    expect(loadDraft({ documentId: 'doc-1', threadKey: 'reply:c2' })).toBe('b')
    expect(loadDraft({ documentId: 'doc-2', threadKey: 'reply:c1' })).toBe('c')
  })

  it('does not let ids containing separators collide', () => {
    expect(draftStorageKey({ documentId: 'a:b', threadKey: 'c' })).not.toBe(
      draftStorageKey({ documentId: 'a', threadKey: 'b:c' }),
    )
  })

  it('lives in sessionStorage so it survives a reload of the page', () => {
    saveDraft(KEY, 'kept')
    expect(sessionStorage.getItem(draftStorageKey(KEY))).toBe('kept')
  })

  it('removes the entry when the text is empty or only whitespace', () => {
    saveDraft(KEY, 'x')
    saveDraft(KEY, '  \n ')
    expect(loadDraft(KEY)).toBeNull()
    expect(sessionStorage.getItem(draftStorageKey(KEY))).toBeNull()
  })

  it('clearDraft removes the entry', () => {
    saveDraft(KEY, 'x')
    clearDraft(KEY)
    expect(loadDraft(KEY)).toBeNull()
  })

  it('never throws when storage is blocked, and still remembers within the window', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const key = { documentId: 'blocked-doc', threadKey: 't' }
    expect(() => saveDraft(key, 'in memory')).not.toThrow()
    expect(loadDraft(key)).toBe('in memory')
    expect(() => clearDraft(key)).not.toThrow()
    expect(loadDraft(key)).toBeNull()
  })
})
