import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS, type UniworkDocLock } from '../src/shared/home-api'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'

/**
 * G5-04g wiring: the lock IPC and the open-route diversion. `lock` is a push
 * to the shell window, `locks`/`dismissLock` are invoke handlers, and the
 * service's openPath goes through the guard, so no module ever opens a working
 * copy whose folder declares a store this build does not read.
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
}))

vi.mock('../src/main/uniwork-auth', () => ({
  authorizedRequest: vi.fn(),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: () => () => undefined,
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
  dir = mkdtempSync(join(tmpdir(), 'uw-lock-wiring-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const docDir = () => join(dir, 'uniwork-documents', 'default', 'acc_1', 'doc_1')
const docPath = () => join(docDir(), 'Plan.docx')

function seed(binding: unknown): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), 'working copy bytes')
  writeFileSync(join(docDir(), BINDING_FILE), JSON.stringify(binding))
}

async function setup(openPath = vi.fn(() => true)) {
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    once: () => undefined,
  }
  const handle = createUniworkDocs(
    { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) } as never,
    {
      shellWindow: () => null,
      shellContents: () => wc as never,
      openPath,
      refuseLockedPath: (path: string) => handle.service.refuseLockedPath(path),
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [],
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
    },
  )
  handle.activate(() => undefined)
  return { handle, handlers, sent, openPath }
}

describe('the newer-store lock IPC (G5-04g)', () => {
  it('registers locks / dismissLock and answers an empty list', async () => {
    const { handlers } = await setup()
    // `lock` is a push to the shell window, not an invoke handler
    expect(handlers.has(UNIWORK_DOC_CHANNELS.locks)).toBe(true)
    expect(handlers.has(UNIWORK_DOC_CHANNELS.dismissLock)).toBe(true)
    expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([])
    expect(handlers.get(UNIWORK_DOC_CHANNELS.dismissLock)!(null, 42)).toBeUndefined()
  })

  it('a refusal pushes the lock on the lock channel and the list reports it', async () => {
    seed({ schema: 2, min_app_version: '99.0.0' })
    const { handle, handlers, sent } = await setup()
    expect(handle.service.refuseLockedPath(docPath())).toBe(true)
    const lock: UniworkDocLock = { path: docPath(), reason: 'store_newer', name: 'Plan.docx' }
    expect(sent).toEqual([{ channel: UNIWORK_DOC_CHANNELS.lock, payload: lock }])
    expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([lock])
    handlers.get(UNIWORK_DOC_CHANNELS.dismissLock)!(null, docPath())
    expect(handlers.get(UNIWORK_DOC_CHANNELS.locks)!(null)).toEqual([])
  })

  it('the service openPath never reaches the module router for a locked path', async () => {
    seed({ schema: 2 })
    const openPath = vi.fn(() => true)
    const { handle, sent } = await setup(openPath)
    // the service asks its deps.openPath; the wiring refuses before the router
    const shown = (handle.service as unknown as {
      show(path: string, binding: unknown): unknown
    })
    expect(() => shown.show(docPath(), {})).toThrowError(
      expect.objectContaining({ code: 'engine_incompatible' }),
    )
    expect(openPath).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
  })

  it('a schema-1 working copy still opens through the router', async () => {
    seed({
      schema: 1,
      documentId: 'doc_1',
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: 'abc',
      state: 'ready',
    })
    const openPath = vi.fn(() => true)
    const { handle, sent } = await setup(openPath)
    const shown = (handle.service as unknown as {
      show(path: string, binding: unknown): unknown
    })
    expect(shown.show(docPath(), { title: 'Plan.docx' })).toEqual({
      path: docPath(),
      title: 'Plan.docx',
    })
    expect(openPath).toHaveBeenCalledWith(docPath())
    // the status chip is pushed as usual; no lock is
    expect(sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.lock)).toEqual([])
    expect(sent.map((m) => m.channel)).toEqual([UNIWORK_DOC_CHANNELS.docStatusEvent])
  })
})