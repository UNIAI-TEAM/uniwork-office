import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * GOA9-r3-04: on a shared computer, Sign out and a sign-in as another user
 * close the previous account's UniWork documents (through the normal close
 * prompts) and delete the AI chat history of those documents; local files and
 * the current account's documents are left alone.
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

function harness(open: string[], history: string[], refuse: ReadonlySet<string> = new Set()) {
  const shown = [...open]
  const known = [...history]
  const closed: string[] = []
  const forgotten: string[] = []
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
    closeConflictPrompt: vi.fn(),
  }
  return { boundary: new AccountBoundary(deps), deps, shown, closed, forgotten }
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
    await h.boundary.enforce(ownerB)
    release(true)
    await first
    expect(h.deps.closeDocument).toHaveBeenCalledTimes(1)
  })
})
