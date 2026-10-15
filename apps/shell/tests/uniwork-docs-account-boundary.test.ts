import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * GOA9-r3-04: on a shared computer, Sign out and a sign-in as another user
 * close the previous account's UniWork documents (through the normal close
 * prompts), delete the AI chat history of those documents and forget their S11
 * locks; local files and the current account's documents are left alone.
 */

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getAppPath: () => '/app',
    getPath: () => '/user-data',
    setAsDefaultProtocolClient: vi.fn(),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (buf: Buffer) => buf.toString(),
  },
}))
vi.mock('electron', () => electron)

import { AccountBoundary, workingCopyOwner } from '../src/main/uniwork-docs/account-boundary'
import { setUniworkSignOutHooks, signOutUniwork } from '../src/main/uniwork-auth'

const root = join('/user-data', 'uniwork-documents')
const copyOf = (user: string, doc: string, name: string) => join(root, 'default', user, doc, name)

const ownerA = { accountId: 'acc_a', deploymentId: 'default' }
const ownerB = { accountId: 'acc_b', deploymentId: 'default' }
const aSheet = copyOf('acc_a', 'doc_1', 'GO-A9 Bang tinh.xlsx')
const aDoc = copyOf('acc_a', 'doc_2', 'Report.docx')
const bDoc = copyOf('acc_b', 'doc_3', 'Plan.docx')
const otherDeployment = join(root, 'staging', 'acc_b', 'doc_4', 'Old.pptx')
const localFile = join('/home', 'me', 'Documents', 'local.docx')

function harness(
  open: string[],
  history: string[],
  refuse: ReadonlySet<string> = new Set(),
  locks: string[] = [],
  sessionOwner: { accountId: string; deploymentId: string } | null = null,
) {
  const shown = [...open]
  const known = [...history]
  const closed: string[] = []
  const forgotten: string[] = []
  const shownLocks = [...locks]
  const forgottenLocks: string[] = []
  const locked: Array<{ accountId: string; deploymentId: string } | null> = []
  const order: string[] = []
  const deps = {
    root,
    openPaths: () => [...shown],
    closeDocument: vi.fn(async (path: string) => {
      if (refuse.has(path)) return false
      closed.push(path)
      shown.splice(shown.indexOf(path), 1)
      return true
    }),
    // the prompts of a close alone: a refused one is the user pressing Cancel
    confirmClose: vi.fn(async (path: string) => !refuse.has(path)),
    closeNow: vi.fn((path: string) => {
      closed.push(path)
      shown.splice(shown.indexOf(path), 1)
    }),
    aiHistoryPaths: () => [...known],
    forgetAiHistory: vi.fn((paths: string[]) => {
      forgotten.push(...paths)
      for (const p of paths) known.splice(known.indexOf(p), 1)
    }),
    // the lock map of the service (pathKey-keyed there; here the raw paths)
    forgetLocks: vi.fn((match: (path: string) => boolean) => {
      order.push('forgetLocks')
      for (const path of [...shownLocks]) {
        if (!match(path)) continue
        shownLocks.splice(shownLocks.indexOf(path), 1)
        forgottenLocks.push(path)
      }
    }),
    closeConflictPrompt: vi.fn(),
    sessionOwner: () => sessionOwner,
    lockStore: vi.fn(async (owner: { accountId: string; deploymentId: string } | null) => {
      order.push('lockStore')
      locked.push(owner)
    }),
  }
  return {
    boundary: new AccountBoundary(deps),
    deps,
    shown,
    closed,
    forgotten,
    shownLocks,
    forgottenLocks,
    locked,
    order,
  }
}

describe('workingCopyOwner', () => {
  it('reads the account from the working-copy path; null outside the root', () => {
    expect(workingCopyOwner(root, aSheet)).toEqual({ deploymentId: 'default', userId: 'acc_a' })
    expect(workingCopyOwner(root, localFile)).toBeNull()
    expect(workingCopyOwner(root, join(root, 'last-account.json'))).toBe('unknown')
  })
})

describe('Sign out', () => {
  it('closes every UniWork document tab and deletes their AI history; local tabs stay', async () => {
    const h = harness([localFile, aSheet, aDoc], [aSheet, aDoc, localFile])
    expect(await h.boundary.beforeSignOut()).toBe(true)
    expect(h.closed).toEqual([aSheet, aDoc])
    expect(h.shown).toEqual([localFile])
    expect(h.deps.closeConflictPrompt).toHaveBeenCalled()
    h.boundary.afterSignOut()
    expect(h.forgotten).toEqual([aSheet, aDoc])
  })

  it('forgets the S11 locks of every working copy, and never a local file (R1-be-6)', async () => {
    const h = harness([localFile, aSheet], [], new Set(), [aSheet, localFile, bDoc])
    expect(await h.boundary.beforeSignOut()).toBe(true)
    // every working copy's lock goes (any account); a local path is not account data
    expect(h.forgottenLocks).toEqual([aSheet, bDoc])
    expect(h.shownLocks).toEqual([localFile])
    h.boundary.afterSignOut()
    // a second pass at the sign-out is idempotent
    expect(h.shownLocks).toEqual([localFile])
  })

  it('a cancelled prompt closes nothing and keeps the locks: the account did not go away (R1-be-6)', async () => {
    const h = harness([aSheet], [], new Set([aSheet]), [aSheet])
    expect(await h.boundary.beforeSignOut()).toBe(false)
    expect(h.closed).toEqual([])
    expect(h.shown).toEqual([aSheet])
    // the user cancelled the sign-out, so the same account keeps its panel
    expect(h.shownLocks).toEqual([aSheet])
    // ...and afterSignOut (the sign-out did go ahead) does forget them
    h.boundary.afterSignOut()
    expect(h.shownLocks).toEqual([])
  })

  it('a cancelled unsaved-changes prompt closes nothing, not even the clean tabs (GOA9-r4-02)', async () => {
    // the clean sheet is listed first, the dirty doc after it: Cancel on the doc
    // must not leave the sheet already closed
    const h = harness([aSheet, aDoc], [aSheet], new Set([aDoc]))
    expect(await h.boundary.beforeSignOut()).toBe(false)
    expect(h.closed).toEqual([])
    expect(h.shown).toEqual([aSheet, aDoc])
    expect(h.deps.closeNow).not.toHaveBeenCalled()
  })

  it('asks every prompt before it closes the first tab', async () => {
    const order: string[] = []
    const h = harness([aSheet, aDoc], [])
    h.deps.confirmClose.mockImplementation(async (path: string) => {
      order.push(`confirm ${path}`)
      return true
    })
    h.deps.closeNow.mockImplementation((path: string) => {
      order.push(`close ${path}`)
    })
    expect(await h.boundary.beforeSignOut()).toBe(true)
    expect(order).toEqual([
      `confirm ${aSheet}`,
      `confirm ${aDoc}`,
      `close ${aSheet}`,
      `close ${aDoc}`,
    ])
    // the prompt-free close is the only one used, so no prompt shows twice
    expect(h.deps.closeDocument).not.toHaveBeenCalled()
  })

  it('signOutUniwork logs out only after every document closed, then clears', async () => {
    const order: string[] = []
    const account = {
      logout: vi.fn(async () => {
        order.push('logout')
        return { state: 'signed-out' }
      }),
      status: vi.fn(() => ({ state: 'signed-in' })),
    }
    let allow = false
    setUniworkSignOutHooks({
      before: async () => {
        order.push('before')
        return allow
      },
      after: () => order.push('after'),
    })
    try {
      // cancelled: still signed in, nothing cleared
      await signOutUniwork(account as never)
      expect(account.logout).not.toHaveBeenCalled()
      expect(order).toEqual(['before'])
      order.length = 0
      allow = true
      await signOutUniwork(account as never)
      expect(order).toEqual(['before', 'logout', 'after'])
    } finally {
      setUniworkSignOutHooks(null)
    }
  })
})

describe('the durable store at the account boundary (W3b / G5-11)', () => {
  it('sign-out locks the outgoing scope, after the locks and with a live owner', async () => {
    const h = harness([aSheet], [], new Set(), [aSheet], ownerA)
    expect(await h.boundary.beforeSignOut()).toBe(true)
    expect(h.locked).toEqual([ownerA])
    // the locks are forgotten first: a lock must not wait behind panel state
    expect(h.order.indexOf('forgetLocks')).toBeLessThan(h.order.indexOf('lockStore'))
  })

  it('a cancelled sign-out keeps the store open: the account did not go away', async () => {
    const h = harness([aSheet], [], new Set([aSheet]), [aSheet], ownerA)
    // a live session first (the first owner has nothing to lock)
    await h.boundary.enforce(ownerA)
    expect(h.locked).toEqual([])
    expect(await h.boundary.beforeSignOut()).toBe(false)
    expect(h.locked).toEqual([])
    // the sign-out does go ahead afterwards: the last owner locks its store
    h.boundary.afterSignOut()
    expect(h.locked).toEqual([ownerA])
  })

  it('a sign-in as another account locks only the switched-out scope', async () => {
    const h = harness([aSheet], [], new Set(), [], ownerA)
    // the first live session has nothing to lock (no owner before it)
    await h.boundary.enforce(ownerA)
    expect(h.locked).toEqual([])
    await h.boundary.enforce(ownerB)
    expect(h.locked).toEqual([ownerA])
    // the same owner again (a status push): nothing is locked twice
    await h.boundary.enforce(ownerB)
    expect(h.locked).toEqual([ownerA])
  })

  it('a deployment switch for the same account locks the outgoing deployment scope', async () => {
    const dep1 = { accountId: 'acc_a', deploymentId: 'dep_1' }
    const dep2 = { accountId: 'acc_a', deploymentId: 'dep_2' }
    const h = harness([aSheet], [], new Set(), [], dep1)
    await h.boundary.enforce(dep1)
    expect(h.locked).toEqual([])
    await h.boundary.enforce(dep2)
    expect(h.locked).toEqual([dep1])
  })
})

describe('a sign-in that changes the account', () => {
  it("closes the previous account's tabs and deletes their AI history; own and local stay", async () => {
    const h = harness(
      [localFile, aSheet, bDoc, otherDeployment],
      [aSheet, aDoc, bDoc, localFile, otherDeployment],
    )
    await h.boundary.enforce(ownerB)
    expect(h.closed).toEqual([aSheet, otherDeployment])
    expect(h.shown).toEqual([localFile, bDoc])
    expect(h.forgotten).toEqual([aSheet, aDoc, otherDeployment])
  })

  it('forgets the S11 locks of the account that went away, keeping its own (R1-be-6)', async () => {
    const h = harness([localFile, aSheet, bDoc], [], new Set(), [
      aSheet,
      bDoc,
      otherDeployment,
      localFile,
    ])
    await h.boundary.enforce(ownerB)
    // acc_a's and the other deployment's locks go; ownerB's own and the local path stay
    expect(h.shownLocks).toEqual([bDoc, localFile])
    expect(h.forgottenLocks).toEqual([aSheet, otherDeployment])
  })

  it('forgets the locks before it closes anything: panel state must not wait on a save prompt (F4 residual)', async () => {
    const order: string[] = []
    const h = harness([aSheet], [], new Set([aSheet]), [aSheet])
    const forget = h.deps.forgetLocks.getMockImplementation()
    h.deps.forgetLocks.mockImplementation((match: (path: string) => boolean) => {
      order.push('forgetLocks')
      forget?.(match)
    })
    const close = h.deps.closeDocument.getMockImplementation()
    h.deps.closeDocument.mockImplementation(async (path: string) => {
      order.push('closeDocument')
      return close ? close(path) : true
    })
    await h.boundary.enforce(ownerB)
    // the lock is forgotten first, so a renderer re-read on the account change
    // never waits behind the close prompt; the cancelled prompt still forgot it
    expect(order).toEqual(['forgetLocks', 'closeDocument'])
    expect(h.shownLocks).toEqual([])
  })

  it('runs once per account, and again after a switch', async () => {
    const h = harness([aSheet], [])
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerA)
    expect(h.deps.closeDocument).not.toHaveBeenCalled()
    await h.boundary.enforce(ownerB)
    expect(h.closed).toEqual([aSheet])
  })

  it('a cancelled prompt leaves the boundary open, so the next status push asks again', async () => {
    const refuse = new Set([aSheet])
    const h = harness([aSheet], [], refuse)
    await h.boundary.enforce(ownerB)
    expect(h.shown).toEqual([aSheet])
    refuse.clear()
    await h.boundary.enforce(ownerB)
    expect(h.shown).toEqual([])
    expect(h.deps.closeDocument).toHaveBeenCalledTimes(2)
  })

  it('a status push while prompts are open does not start a second pass', async () => {
    const h = harness([aSheet], [])
    let release: (value: boolean) => void = () => undefined
    h.deps.closeDocument.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    )
    const first = h.boundary.enforce(ownerB)
    // the second push joins the run in progress: it resolves once that run ended
    const second = h.boundary.enforce(ownerB)
    release(true)
    await Promise.all([first, second])
    expect(h.deps.closeDocument).toHaveBeenCalledTimes(1)
  })
})

describe('an account switch that is already effective (Q2 = a)', () => {
  type Owner = { accountId: string; deploymentId: string }
  const switching = (plan: { count: number; ramOnly: number }) => {
    const h = harness([aSheet], [aSheet], new Set(), [], ownerA)
    const order: string[] = []
    const lockStore = h.deps.lockStore.getMockImplementation()!
    const deps = {
      ...h.deps,
      lockStore: vi.fn(async (owner: Owner | null) => {
        order.push('lock')
        await lockStore(owner)
      }),
      planSignOut: vi.fn(async () => ({
        count: plan.count,
        waiting: 0,
        keystoreLocked: plan.ramOnly > 0,
        ramOnly: plan.ramOnly,
      })),
      // the user would press Back (or never answer): it must not matter any more
      confirmSignOut: vi.fn(async () => false),
      noticeSwitchLoss: vi.fn((_owner: Owner, _plan: unknown) => {
        order.push('notice')
      }),
    }
    return { ...h, deps, order, boundary: new AccountBoundary(deps) }
  }

  it('locks the account it leaves even when a prompt would be cancelled, and closes its tabs', async () => {
    const h = switching({ count: 1, ramOnly: 0 })
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerB)
    expect(h.deps.confirmSignOut).not.toHaveBeenCalled()
    expect(h.locked).toEqual([ownerA])
    expect(h.closed).toEqual([aSheet])
    expect(h.forgotten).toEqual([aSheet])
    // the boundary is enforced: the next status push changes nothing
    await h.boundary.enforce(ownerB)
    expect(h.locked).toEqual([ownerA])
  })

  it('sends no prompt and no notice when nothing RAM-only was lost', async () => {
    const h = switching({ count: 2, ramOnly: 0 })
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerB)
    expect(h.deps.noticeSwitchLoss).not.toHaveBeenCalled()
    expect(h.deps.confirmSignOut).not.toHaveBeenCalled()
  })

  it('sends exactly one notice when RAM-only content was lost, after the lock', async () => {
    const h = switching({ count: 1, ramOnly: 2 })
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerB)
    expect(h.deps.noticeSwitchLoss).toHaveBeenCalledTimes(1)
    expect(h.deps.noticeSwitchLoss).toHaveBeenCalledWith(
      ownerA,
      expect.objectContaining({ ramOnly: 2 }),
    )
    expect(h.order).toEqual(['lock', 'notice'])
    expect(h.deps.confirmSignOut).not.toHaveBeenCalled()
  })

  it('a notice that throws does not undo the lock or stop the tabs closing', async () => {
    const h = switching({ count: 0, ramOnly: 1 })
    h.deps.noticeSwitchLoss.mockImplementation(() => {
      throw new Error('no window')
    })
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerB)
    expect(h.locked).toEqual([ownerA])
    expect(h.closed).toEqual([aSheet])
  })

  it('d5-1: a switch lock that could not keep N+1 is told it is a switch, and the one notice counts the lost documents with the RAM-only ones', async () => {
    const h = switching({ count: 3, ramOnly: 1 })
    h.deps.lockStore.mockImplementation(async (owner: Owner | null) => {
      h.order.push('lock')
      h.locked.push(owner)
      return { ok: true, lost: 2 }
    })
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerB)
    expect(h.deps.lockStore).toHaveBeenCalledWith(ownerA, { switch: true })
    expect(h.deps.noticeSwitchLoss).toHaveBeenCalledTimes(1)
    expect(h.deps.noticeSwitchLoss).toHaveBeenCalledWith(
      ownerA,
      expect.objectContaining({ ramOnly: 3 }),
    )
    expect(h.order).toEqual(['lock', 'notice'])
    expect(h.closed).toEqual([aSheet])
  })

  it('d5-1: a lost N+1 alone (nothing RAM-only) still sends the notice', async () => {
    const h = switching({ count: 1, ramOnly: 0 })
    h.deps.lockStore.mockImplementation(async () => ({ ok: true, lost: 1 }))
    await h.boundary.enforce(ownerA)
    await h.boundary.enforce(ownerB)
    expect(h.deps.noticeSwitchLoss).toHaveBeenCalledTimes(1)
    expect(h.deps.noticeSwitchLoss).toHaveBeenCalledWith(
      ownerA,
      expect.objectContaining({ ramOnly: 1 }),
    )
  })

  it('A -> B -> C while the lock of A runs: C runs right after it without another status push, never two runs at once', async () => {
    const ownerC = { accountId: 'acc_c', deploymentId: 'default' }
    const h = switching({ count: 0, ramOnly: 0 })
    let active = 0
    let maxActive = 0
    let releaseA: () => void = () => undefined
    h.deps.lockStore.mockImplementation(async (owner: Owner | null) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      h.locked.push(owner)
      if (owner?.accountId === 'acc_a') {
        await new Promise<void>((resolve) => {
          releaseA = resolve
        })
      }
      active -= 1
    })
    await h.boundary.enforce(ownerA)
    const toB = h.boundary.enforce(ownerB)
    await vi.waitFor(() => expect(h.locked).toEqual([ownerA]))
    const toC = h.boundary.enforce(ownerC)
    // C's push lands while A's lock is held: nothing else starts yet
    await Promise.resolve()
    expect(h.locked).toEqual([ownerA])
    releaseA()
    await Promise.all([toB, toC])
    // B was live and is left for C, so B is locked next, with no new push
    expect(h.locked).toEqual([ownerA, ownerB])
    expect(maxActive).toBe(1)
    // C's boundary is enforced: its next push changes nothing
    await h.boundary.enforce(ownerC)
    expect(h.locked).toEqual([ownerA, ownerB])
  })

  it('d6-1: B and C both push while the lock of the account before A runs: B, live in between, is still locked (by C), in order, one run at a time', async () => {
    const ownerX = { accountId: 'acc_x', deploymentId: 'default' }
    const ownerC = { accountId: 'acc_c', deploymentId: 'default' }
    const h = switching({ count: 0, ramOnly: 0 })
    let active = 0
    let maxActive = 0
    let releaseX: () => void = () => undefined
    h.deps.lockStore.mockImplementation(async (owner: Owner | null) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      h.locked.push(owner)
      if (owner?.accountId === 'acc_x') {
        await new Promise<void>((resolve) => {
          releaseX = resolve
        })
      }
      active -= 1
    })
    await h.boundary.enforce(ownerX)
    const toA = h.boundary.enforce(ownerA)
    await vi.waitFor(() => expect(h.locked).toEqual([ownerX]))
    // B signs in and C signs in before A's run has locked X: B is queued, never run yet
    const toB = h.boundary.enforce(ownerB)
    const toBAgain = h.boundary.enforce(ownerB)
    const toC = h.boundary.enforce(ownerC)
    await Promise.resolve()
    expect(h.locked).toEqual([ownerX])
    releaseX()
    await Promise.all([toA, toB, toBAgain, toC])
    // A is locked by B's run and B by C's run: nobody who was live is skipped,
    // and the repeated push of B adds no run of its own
    expect(h.locked).toEqual([ownerX, ownerA, ownerB])
    expect(maxActive).toBe(1)
    await h.boundary.enforce(ownerC)
    expect(h.locked).toEqual([ownerX, ownerA, ownerB])
  })

  it("d6-4: a push resolves when its own run ended, not when a later owner's lock did", async () => {
    const ownerC = { accountId: 'acc_c', deploymentId: 'default' }
    const h = switching({ count: 0, ramOnly: 0 })
    let releaseB: () => void = () => undefined
    h.deps.lockStore.mockImplementation(async (owner: Owner | null) => {
      h.locked.push(owner)
      // B's lock (the run of C) is held
      if (owner?.accountId === 'acc_b') {
        await new Promise<void>((resolve) => {
          releaseB = resolve
        })
      }
    })
    await h.boundary.enforce(ownerA)
    const settled: string[] = []
    const toB = h.boundary.enforce(ownerB).then(() => settled.push('B'))
    const toC = h.boundary.enforce(ownerC).then(() => settled.push('C'))
    // B's run (it locked A) is over and its push resolves while C's run is still locking B
    await vi.waitFor(() => expect(h.locked).toEqual([ownerA, ownerB]))
    await toB
    expect(settled).toEqual(['B'])
    releaseB()
    await toC
    expect(settled).toEqual(['B', 'C'])
  })

  it('d6-4: a failed run rejects only its own push; a later owner still runs and resolves', async () => {
    const ownerC = { accountId: 'acc_c', deploymentId: 'default' }
    const h = switching({ count: 0, ramOnly: 0 })
    h.deps.closeDocument.mockRejectedValueOnce(new Error('close failed'))
    await h.boundary.enforce(ownerA)
    const toB = h.boundary.enforce(ownerB)
    const toBFails = expect(toB).rejects.toThrow('close failed')
    const toC = h.boundary.enforce(ownerC)
    await toBFails
    await expect(toC).resolves.toBeUndefined()
    expect(h.locked).toEqual([ownerA, ownerB])
  })

  it('d1-2: a run nobody awaits is no unhandled rejection, and an awaiting enforce still rejects', async () => {
    // a caller that awaits its run still receives that run's failure
    const awaited = switching({ count: 0, ramOnly: 0 })
    await awaited.boundary.enforce(ownerA)
    awaited.deps.closeDocument.mockRejectedValueOnce(new Error('close failed'))
    await expect(awaited.boundary.enforce(ownerB)).rejects.toThrow('close failed')

    // a run whose push promise nobody awaits (the drain never reached the
    // enforce's `await run.done`) still has an observer on its own promise
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const h = switching({ count: 0, ramOnly: 0 })
      const internals = h.boundary as unknown as {
        queued: Array<{ settle: { reject(error: unknown): void } }>
        drain(): Promise<void>
      }
      vi.spyOn(internals, 'drain').mockImplementationOnce(() => {
        throw new Error('no drain')
      })
      const lost = h.boundary.enforce(ownerB)
      void lost.catch(() => undefined)
      internals.queued[0].settle.reject(new Error('lock failed'))
      await new Promise((resolve) => setImmediate(resolve))
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('d7-1: a non-adjacent repeat of an owner locks each account exactly once (every run locks the owner before it)', async () => {
    const ownerX = { accountId: 'acc_x', deploymentId: 'default' }
    const h = switching({ count: 0, ramOnly: 0 })
    let releaseX: () => void = () => undefined
    h.deps.lockStore.mockImplementation(async (owner: Owner | null) => {
      h.locked.push(owner)
      if (owner?.accountId === 'acc_x') {
        await new Promise<void>((resolve) => {
          releaseX = resolve
        })
      }
    })
    await h.boundary.enforce(ownerX)
    const toA = h.boundary.enforce(ownerA)
    await vi.waitFor(() => expect(h.locked).toEqual([ownerX]))
    // X(running) A B A: B was live between the two A pushes, so the second A is a run of its own
    const rest = [ownerB, ownerA].map((owner) => h.boundary.enforce(owner))
    releaseX()
    await Promise.all([toA, ...rest])
    expect(h.locked).toEqual([ownerX, ownerA, ownerB])
  })

  it('an explicit Sign out still asks, and a cancel there changes nothing', async () => {
    const h = switching({ count: 1, ramOnly: 0 })
    await h.boundary.enforce(ownerA)
    expect(await h.boundary.beforeSignOut()).toBe(false)
    expect(h.deps.confirmSignOut).toHaveBeenCalledTimes(1)
    expect(h.locked).toEqual([])
    expect(h.closed).toEqual([])
  })
})
