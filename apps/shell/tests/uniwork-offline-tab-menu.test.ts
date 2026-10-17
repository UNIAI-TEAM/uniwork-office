import { describe, expect, it, vi } from 'vitest'
import type { OfflineUnpinResult } from '../src/shared/offline-library'
import { offlineTabMenuItem, unpinTabDocument } from '../src/main/uniwork-sync/offline-library/menu'

/**
 * G5-05u B8: the native tab menu's "Dùng khi không có mạng" / "Bỏ dùng khi
 * không có mạng" item - only for a UniWork-bound tab, and taking a new pin is
 * hidden while the org capability is off (OQ-UX11 a) while removing one stays.
 */

const LABELS = { pin: 'Dùng khi không có mạng', unpin: 'Bỏ dùng khi không có mạng' }
const BOUND = { documentId: 'doc_1', workspaceId: 'ws_1', orgId: 'org_1' }

const item = (over: {
  bound?: typeof BOUND | null
  pinned?: boolean
  capabilityOn?: boolean
  pin?: () => void
  unpin?: () => void
}) =>
  offlineTabMenuItem({
    bound: over.bound === undefined ? BOUND : over.bound,
    state: {
      pinned: over.pinned === true,
      state: over.pinned === true ? 'ready' : null,
      capabilityOn: over.capabilityOn !== false,
    },
    labels: LABELS,
    pin: over.pin ?? (() => undefined),
    unpin: over.unpin ?? (() => undefined),
  })

describe('G5-05u B8 the tab menu pin item', () => {
  it('a UniWork-bound tab that is not pinned offers the pin', () => {
    const built = item({})
    expect(built).toMatchObject({ label: LABELS.pin })
  })

  it('a plain local file offers nothing', () => {
    expect(item({ bound: null })).toBeNull()
  })

  it('a pinned document offers the unpin, even with the capability off', () => {
    expect(item({ pinned: true })).toMatchObject({ label: LABELS.unpin })
    expect(item({ pinned: true, capabilityOn: false })).toMatchObject({ label: LABELS.unpin })
  })

  it('taking a new pin is hidden while the capability is off', () => {
    expect(item({ capabilityOn: false })).toBeNull()
  })

  it('the item calls back into the library, never a path of its own', () => {
    const pin = vi.fn()
    const unpin = vi.fn()
    item({ pin })?.click?.({} as never, {} as never, {} as never)
    expect(pin).toHaveBeenCalledTimes(1)
    item({ pinned: true, unpin })?.click?.({} as never, {} as never, {} as never)
    expect(unpin).toHaveBeenCalledTimes(1)
  })
})

describe('G5-05u B8 the tab menu unpin confirms before it unpins (BE-R1-3)', () => {
  /** the engine's answers, in order, with every call the api received */
  const engine = (answers: OfflineUnpinResult[]) => {
    const calls: Array<{ documentId: string; confirmed?: boolean }> = []
    return {
      calls,
      unpin: async (documentId: string, options?: { confirmed?: boolean }) => {
        calls.push({ documentId, ...options })
        return answers[Math.min(calls.length - 1, answers.length - 1)]!
      },
    }
  }

  it('a document with no local work unpins at once, with no confirm', async () => {
    const engine_ = engine([{ ok: true, deferred: false }])
    const confirm = vi.fn(async () => true)
    await unpinTabDocument({ unpin: engine_.unpin, documentId: 'doc_1', confirm })
    expect(engine_.calls).toEqual([{ documentId: 'doc_1' }])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('needs_confirm asks the native confirm first: a refused confirm leaves the pin alone', async () => {
    const engine_ = engine([{ ok: false, code: 'needs_confirm' }])
    const confirm = vi.fn(async () => false)
    await unpinTabDocument({ unpin: engine_.unpin, documentId: 'doc_1', confirm })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(engine_.calls).toEqual([{ documentId: 'doc_1' }])
  })

  it('needs_confirm then a confirmed answer unpins with confirmed: true', async () => {
    const engine_ = engine([
      { ok: false, code: 'needs_confirm' },
      { ok: true, deferred: false },
    ])
    await unpinTabDocument({ unpin: engine_.unpin, documentId: 'doc_1', confirm: async () => true })
    expect(engine_.calls).toEqual([
      { documentId: 'doc_1' },
      { documentId: 'doc_1', confirmed: true },
    ])
  })

  it('a refusal that is not needs_confirm never asks and never retries', async () => {
    const engine_ = engine([{ ok: false, code: 'not_pinned' }])
    const confirm = vi.fn(async () => true)
    await unpinTabDocument({ unpin: engine_.unpin, documentId: 'doc_1', confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(engine_.calls).toEqual([{ documentId: 'doc_1' }])
  })
})
