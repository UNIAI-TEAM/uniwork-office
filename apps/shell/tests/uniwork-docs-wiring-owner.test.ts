import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R2-5: the last-owner record follows the session itself. The account status
 * callback that `activate` installs tells the service to note the live
 * identity, so an account that signs in and never touches a UniWork document
 * is still the recorded owner when it signs out.
 */

let dir: string
let statusListener: ((status: { state: string }) => void) | null = null
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
}))

vi.mock('../src/main/uniwork-auth', () => ({
  authorizedRequest: vi.fn(),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: (listener: (status: { state: string }) => void) => {
    statusListener = listener
    return () => undefined
  },
  uniworkAccount: () => ({ status: () => ({ state: 'signed-out', org: null }) }),
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-wiring-'))
  statusListener = null
  identity = null
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('last owner follows the session identity (R2-5)', () => {
  it('the account status callback records the signed-in account', async () => {
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const handle = createUniworkDocs({ handle: vi.fn() } as never, {
      shellWindow: () => null,
      shellContents: () => null,
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [],
      closePath: async () => true,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
    })
    handle.activate(() => undefined)
    const note = vi.spyOn(handle.service, 'noteSessionIdentity')
    expect(statusListener).not.toBeNull()
    identity = { accountId: 'acc_9', deviceSessionId: 'dev_1', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in' })
    expect(note).toHaveBeenCalledTimes(1)
    const doc = {
      deploymentId: 'default',
      userId: 'acc_9',
    } as never
    identity = null
    expect(handle.service.ownsLocally(doc)).toBe(true)
    expect(handle.service.ownsLocally({ deploymentId: 'default', userId: 'acc_1' } as never)).toBe(
      false,
    )
  })
})

describe('a sign-in as another account (GOA9-r3-04)', () => {
  it("closes the previous account's open documents and deletes their AI history", async () => {
    const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
    const root = join(dir, 'uniwork-documents')
    const previous = join(root, 'default', 'acc_a', 'doc_1', 'Sheet.xlsx')
    const own = join(root, 'default', 'acc_b', 'doc_2', 'Plan.docx')
    const local = join(dir, 'local.docx')
    const open = [local, previous, own]
    const closePath = vi.fn(async (path: string) => {
      open.splice(open.indexOf(path), 1)
      return true
    })
    const forgetAiHistory = vi.fn()
    const handle = createUniworkDocs({ handle: vi.fn() } as never, {
      shellWindow: () => null,
      shellContents: () => null,
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [...open],
      closePath,
      aiHistoryPaths: () => [previous, own, local],
      forgetAiHistory,
    })
    handle.activate(() => undefined)
    identity = { accountId: 'acc_b', deviceSessionId: 'dev_2', deploymentId: 'default' }
    statusListener?.({ state: 'signed-in' })
    await vi.waitFor(() => expect(forgetAiHistory).toHaveBeenCalled())
    expect(closePath).toHaveBeenCalledTimes(1)
    expect(closePath).toHaveBeenCalledWith(previous)
    expect(open).toEqual([local, own])
    expect(forgetAiHistory).toHaveBeenCalledWith([previous])
  })
})
