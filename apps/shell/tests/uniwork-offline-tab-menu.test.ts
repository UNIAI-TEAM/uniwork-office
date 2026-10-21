import { describe, expect, it, vi } from 'vitest'
import type { OfflineUnpinResult } from '../src/shared/offline-library'
import { createOfflineLibraryApi } from '../src/main/uniwork-sync/offline-library/api'
import { offlineTabMenuItem, unpinTabDocument } from '../src/main/uniwork-sync/offline-library/menu'
import { ORG, SCOPE, WS, addDoc, createHarness } from './uniwork-sync-offline-library-fakes'

/**
 * G5-05u B8: the native tab menu's "Dùng khi không có mạng" / "Bỏ dùng khi
 * không có mạng" item - only for a UniWork-bound tab, and taking a new pin is
 * hidden while the org capability is off (OQ-UX11 a) while removing one stays.
 */

const LABELS = { pin: 'Lưu để dùng offline', unpin: 'Bỏ dùng offline' }
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

  it('an account switch while confirm is pending never unpins the incoming account pin (BE-R2-7)', async () => {
    const h = createHarness({ hasLocalWork: () => true })
    addDoc(h, 'doc_1', 1, 2048)
    const api = createOfflineLibraryApi({
      library: () => h.manager,
      activeOrgId: () => ORG,
      capabilityOn: async () => true,
      signedOut: () => h.session.scope === null,
      lastOwner: () => null,
      activeDeploymentId: () => SCOPE.deploymentId,
      libraryLayer: () => h.layer,
      openDocument: async () => ({ ok: false, error: 'network' }),
      openCopy: async () => ({ kind: 'none' }),
      revealLibraryFolder: async () => true,
      lockRefused: () => undefined,
      changed: () => undefined,
    })
    const accountA = { deploymentId: SCOPE.deploymentId, accountId: 'user_1' }
    const accountB = { deploymentId: SCOPE.deploymentId, accountId: 'user_2' }
    h.session.scope = accountA
    expect(await h.manager.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })).toMatchObject(
      { kind: 'pinned' },
    )
    h.session.scope = accountB
    expect(await h.manager.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })).toMatchObject(
      { kind: 'pinned' },
    )
    const quotaBefore = await h.manager.quota()
    expect(quotaBefore).toMatchObject({ pins: 1, usedBytes: 2048 })

    h.session.scope = accountA
    const asked = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<boolean>()
    const pending = unpinTabDocument({
      unpin: (id, options) => api.unpin(id, options),
      documentId: 'doc_1',
      account: () => h.session.scope,
      confirm: async () => {
        asked.resolve()
        return await gate.promise
      },
    })
    await asked.promise
    // the active account switches to B while the native confirm dialog is still open
    h.session.scope = accountB
    gate.resolve(true)
    await pending

    expect(await h.manager.row('doc_1')).toMatchObject({ documentId: 'doc_1', state: 'ready' })
    expect(await h.manager.quota()).toEqual(quotaBefore)
    h.session.scope = accountA
    expect(await h.manager.row('doc_1')).toMatchObject({ documentId: 'doc_1', state: 'ready' })
  })

  it('an account switch while hasLocalWork is parked never unpins the incoming account pin (BE-R3-1)', async () => {
    let gateLocalWork: (() => Promise<boolean>) | null = null
    const h = createHarness({
      hasLocalWork: async () => (gateLocalWork ? await gateLocalWork() : false),
    })
    addDoc(h, 'doc_1', 1, 2048)
    const api = createOfflineLibraryApi({
      library: () => h.manager,
      activeOrgId: () => ORG,
      capabilityOn: async () => true,
      signedOut: () => h.session.scope === null,
      lastOwner: () => null,
      activeDeploymentId: () => SCOPE.deploymentId,
      libraryLayer: () => h.layer,
      openDocument: async () => ({ ok: false, error: 'network' }),
      openCopy: async () => ({ kind: 'none' }),
      revealLibraryFolder: async () => true,
      lockRefused: () => undefined,
      changed: () => undefined,
    })
    const accountA = { deploymentId: SCOPE.deploymentId, accountId: 'user_1' }
    const accountB = { deploymentId: SCOPE.deploymentId, accountId: 'user_2' }
    h.session.scope = accountA
    expect(await h.manager.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })).toMatchObject(
      { kind: 'pinned' },
    )
    h.session.scope = accountB
    expect(await h.manager.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })).toMatchObject(
      { kind: 'pinned' },
    )
    const quotaBefore = await h.manager.quota()
    expect(quotaBefore).toMatchObject({ pins: 1, usedBytes: 2048 })

    h.session.scope = accountA
    const reached = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<boolean>()
    gateLocalWork = async () => {
      reached.resolve()
      return await gate.promise
    }
    const results: OfflineUnpinResult[] = []
    const confirm = vi.fn(async () => true)
    const pending = unpinTabDocument({
      unpin: async (id, options) => {
        const result = await api.unpin(id, options)
        results.push(result)
        return result
      },
      documentId: 'doc_1',
      account: () => h.session.scope,
      confirm,
    })
    await reached.promise
    // the active account switches to B after checkBoundary() while hasLocalWork() is still parked
    h.session.scope = accountB
    gate.resolve(false)
    await pending

    expect(results).toEqual([{ ok: false, code: 'interrupted' }])
    expect(confirm).not.toHaveBeenCalled()
    expect(await h.manager.row('doc_1')).toMatchObject({ documentId: 'doc_1', state: 'ready' })
    expect(await h.manager.quota()).toEqual(quotaBefore)
    h.session.scope = accountA
    expect(await h.manager.row('doc_1')).toMatchObject({ documentId: 'doc_1', state: 'ready' })
  })
})
