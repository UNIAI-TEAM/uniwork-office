import { describe, expect, it, vi } from 'vitest'
import { AccountBoundary } from '../src/main/uniwork-docs/account-boundary'

/**
 * UNI-2068 D3: a zip download is the account's own; when the account signs out
 * or another one takes over, the run is abandoned (its temp file removed), never
 * carried into the next session.
 */

const ownerA = { accountId: 'acc_a', deploymentId: 'default' }
const ownerB = { accountId: 'acc_b', deploymentId: 'default' }

function harness(options: { confirmSignOut?: boolean } = {}) {
  const abortZipDownloads = vi.fn()
  const order: string[] = []
  abortZipDownloads.mockImplementation(() => void order.push('abort'))
  const boundary = new AccountBoundary({
    root: '/user-data/uniwork-documents',
    openPaths: () => [],
    closeDocument: async () => true,
    confirmClose: async () => true,
    closeNow: () => undefined,
    aiHistoryPaths: () => [],
    forgetAiHistory: () => undefined,
    forgetLocks: () => undefined,
    closeConflictPrompt: () => undefined,
    sessionOwner: () => ownerA,
    lockStore: async () => void order.push('lock'),
    abortZipDownloads,
    ...(options.confirmSignOut === false
      ? {
          confirmSignOut: async () => false,
          planSignOut: async () => ({ count: 1, waiting: 0, keystoreLocked: false, ramOnly: 0 }),
        }
      : {}),
  })
  return { boundary, abortZipDownloads, order }
}

describe('zip downloads at the account boundary', () => {
  it('a confirmed sign-out abandons the runs', async () => {
    const h = harness()
    expect(await h.boundary.beforeSignOut()).toBe(true)
    expect(h.abortZipDownloads).toHaveBeenCalledTimes(1)
  })

  it('a sign-out the user canceled leaves the runs alone', async () => {
    const h = harness({ confirmSignOut: false })
    expect(await h.boundary.beforeSignOut()).toBe(false)
    expect(h.abortZipDownloads).not.toHaveBeenCalled()
  })

  it('after the sign-out the runs are abandoned again (idempotent)', () => {
    const h = harness()
    h.boundary.afterSignOut()
    expect(h.abortZipDownloads).toHaveBeenCalledTimes(1)
  })

  it("an account switch abandons the previous account's runs", async () => {
    const h = harness()
    await h.boundary.enforce(ownerA)
    expect(h.abortZipDownloads).not.toHaveBeenCalled()
    await h.boundary.enforce(ownerB)
    expect(h.abortZipDownloads).toHaveBeenCalledTimes(1)
  })

  it('the same account being enforced again keeps its runs', async () => {
    const h = harness()
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerA)
    expect(h.abortZipDownloads).not.toHaveBeenCalled()
  })

  it('works without the hook (older wiring)', async () => {
    const boundary = new AccountBoundary({
      root: '/r',
      openPaths: () => [],
      closeDocument: async () => true,
      confirmClose: async () => true,
      closeNow: () => undefined,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
      forgetLocks: () => undefined,
      closeConflictPrompt: () => undefined,
    })
    expect(await boundary.beforeSignOut()).toBe(true)
    expect(() => boundary.afterSignOut()).not.toThrow()
  })
})
